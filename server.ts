import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';
import {
  createCollection,
  createNotification,
  createProcessingDocument,
  deleteDocumentById,
  deleteThread,
  getAdminObservability,
  getDocumentById,
  getDocumentPreviewChunks,
  getThreadMessages,
  getUserWithPasswordByEmail,
  listCollections,
  listDocuments,
  listUserNotifications,
  listUserThreads,
  listUsers,
  markNotificationsRead,
  recordApiMetric,
  registerPasswordUser,
  updateUserRole,
  writeAuditLog,
} from './src/db/queries.ts';
import { hashPassword, signSessionJwt, verifyPassword } from './src/lib/jwt.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { upsertGoogleUser } from './src/db/queries.ts';
import { requireAdmin, requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { processPdfIngestion, runStreamingRagQuery } from './src/services/pdf-rag.ts';
import { broadcastEvent, getActiveConnectionsCount, initWebSocketHub, registerRagWsHandler } from './src/services/ws-hub.ts';

const PORT = 3000;
const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '2mb' }));

// API Latency Telemetry Middleware
app.use('/api', (req: AuthRequest, res: Response, next: NextFunction) => {
  const startedAt = performance.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const latencyMs = performance.now() - startedAt;
    const normalizedPath = req.route?.path
      ? `/api${req.route.path}`
      : `/api${req.path.replace(/\/\d+/g, '/:id')}`;
    void recordApiMetric({
      method: req.method,
      path: normalizedPath,
      statusCode: res.statusCode,
      latencyMs,
      userId: req.user?.id ?? null,
    });
  });
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB max PDF
  },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are supported.'));
    }
  },
});

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Valid email is required').max(160),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

const googleAuthSchema = z.object({
  idToken: z.string().min(10, 'Firebase ID token is required'),
});

const createCollectionSchema = z.object({
  name: z.string().trim().min(2, 'Collection name is required').max(80),
  description: z.string().trim().max(300).optional().default(''),
});

const updateRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

const markReadSchema = z.object({
  notificationIds: z.array(z.number().int().positive()).optional(),
});

const ragQueryRestSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  threadId: z.number().int().positive().nullable().optional(),
  collectionId: z.number().int().positive().nullable().optional(),
});

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeSockets: getActiveConnectionsCount() });
});

// Auth: Register with Email/Password
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
  }

  try {
    const passwordHash = hashPassword(parsed.data.password);
    const user = await registerPasswordUser({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
    });

    const token = await signSessionJwt({
      sub: user.uid,
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    await writeAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: String(user.id),
      metadata: { provider: 'password', assignedRole: user.role },
      status: 'success',
    });

    res.status(201).json({ token, user });
  } catch (error: any) {
    if (error?.message === 'EMAIL_EXISTS') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    res.status(500).json({ error: error?.message || 'Registration failed.' });
  }
});

// Auth: Login with Email/Password
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
  }

  try {
    const record = await getUserWithPasswordByEmail(parsed.data.email);
    if (!record || !record.passwordHash || !verifyPassword(parsed.data.password, record.passwordHash)) {
      await writeAuditLog({
        actorId: record?.id ?? null,
        actorEmail: parsed.data.email.toLowerCase(),
        action: 'auth.login',
        resourceType: 'user',
        resourceId: record ? String(record.id) : 'unknown',
        metadata: { provider: 'password', reason: 'invalid_credentials' },
        status: 'failure',
      });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = {
      id: record.id,
      uid: record.uid,
      email: record.email,
      name: record.name,
      authProvider: record.authProvider,
      role: (record.role === 'admin' ? 'admin' : 'member') as 'admin' | 'member',
      avatarUrl: record.avatarUrl,
      createdAt: record.createdAt,
    };

    const token = await signSessionJwt({
      sub: user.uid,
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    await writeAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: String(user.id),
      metadata: { provider: 'password' },
      status: 'success',
    });

    res.json({ token, user });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Sign-in failed.' });
  }
});

// Auth: Google OAuth (Firebase ID Token Exchange)
app.post('/api/auth/google', async (req: Request, res: Response) => {
  const parsed = googleAuthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid token payload' });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(parsed.data.idToken);
    if (!decoded.email) {
      return res.status(400).json({ error: 'Google account did not provide an email address.' });
    }

    const { user, isNew } = await upsertGoogleUser({
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name || decoded.email.split('@')[0],
      avatarUrl: decoded.picture ?? null,
    });

    await writeAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      action: isNew ? 'auth.register' : 'auth.login',
      resourceType: 'user',
      resourceId: String(user.id),
      metadata: { provider: 'google', assignedRole: user.role },
      status: 'success',
    });

    res.json({ token: parsed.data.idToken, user });
  } catch (error: any) {
    console.error('Google token exchange error:', error);
    res.status(401).json({ error: 'Failed to verify Google OAuth token.' });
  }
});

// Auth: Current User Session
app.get('/api/auth/me', requireAuth, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// Collections: List & Create
app.get('/api/collections', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await listCollections();
    res.json({ collections: rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load collections.' });
  }
});

app.post('/api/collections', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = createCollectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid collection payload' });
  }

  try {
    const user = req.user!;
    const created = await createCollection({
      name: parsed.data.name,
      description: parsed.data.description,
      createdBy: user.id,
    });

    await writeAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      action: 'collection.create',
      resourceType: 'collection',
      resourceId: String(created.id),
      metadata: { name: created.name },
      status: 'success',
    });

    const notification = await createNotification({
      actorId: user.id,
      type: 'collection.created',
      title: 'Collection Created',
      message: `${user.name} created collection "${created.name}".`,
      resourceId: String(created.id),
    });

    broadcastEvent('collection:created', created);
    broadcastEvent('notification:new', {
      ...notification,
      actorName: user.name,
      isRead: false,
    });

    res.status(201).json({ collection: created });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to create collection.' });
  }
});

// Documents: List, Upload PDF, View Chunks, Delete
app.get('/api/documents', requireAuth, async (req: AuthRequest, res: Response) => {
  const collectionIdParam = req.query.collectionId;
  let collectionId: number | undefined;
  if (typeof collectionIdParam === 'string' && collectionIdParam.trim() !== '') {
    const num = Number(collectionIdParam);
    if (!Number.isInteger(num) || num <= 0) {
      return res.status(400).json({ error: 'Invalid collectionId query parameter.' });
    }
    collectionId = num;
  }

  try {
    const docs = await listDocuments(collectionId);
    res.json({ documents: docs });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load documents.' });
  }
});

app.post(
  '/api/documents/upload',
  requireAuth,
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      if (!req.file) {
        return res.status(400).json({ error: 'PDF file is required.' });
      }

      const bodySchema = z.object({
        collectionId: z.coerce.number().int().positive('Target collection is required'),
        title: z.string().trim().min(1).max(160).optional(),
      });

      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid upload metadata' });
      }

      const allCollections = await listCollections();
      const targetCollection = allCollections.find((c) => c.id === parsed.data.collectionId);
      if (!targetCollection) {
        return res.status(404).json({ error: 'Target collection not found.' });
      }

      const cleanTitle =
        parsed.data.title ||
        req.file.originalname.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() ||
        'Untitled Document';

      const doc = await createProcessingDocument({
        collectionId: targetCollection.id,
        uploadedBy: user.id,
        title: cleanTitle,
        fileName: req.file.originalname,
        fileSize: req.file.size,
      });

      broadcastEvent('document:status', {
        documentId: doc.id,
        status: 'processing',
        title: doc.title,
        collectionId: doc.collectionId,
      });

      // Run chunking & pgvector embedding pipeline asynchronously while returning 202
      void processPdfIngestion({
        documentId: doc.id,
        collectionId: targetCollection.id,
        collectionName: targetCollection.name,
        title: cleanTitle,
        buffer: req.file.buffer,
        actor: user,
      });

      res.status(202).json({ document: doc });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Document upload failed.' });
    }
  }
);

app.get('/api/documents/:id/chunks', requireAuth, async (req: AuthRequest, res: Response) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return res.status(400).json({ error: 'Invalid document ID.' });
  }

  try {
    const doc = await getDocumentById(docId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    const chunks = await getDocumentPreviewChunks(docId);
    res.json({ document: doc, chunks });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load document chunks.' });
  }
});

app.delete('/api/documents/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const docId = Number(req.params.id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return res.status(400).json({ error: 'Invalid document ID.' });
  }

  try {
    const user = req.user!;
    const existing = await getDocumentById(docId);
    if (!existing) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    if (user.role !== 'admin' && existing.uploadedBy !== user.id) {
      return res.status(403).json({ error: 'Only Admins or the uploader can delete this document.' });
    }

    await deleteDocumentById(docId);
    await writeAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      action: 'document.delete',
      resourceType: 'document',
      resourceId: String(docId),
      metadata: { title: existing.title },
      status: 'success',
    });

    broadcastEvent('document:deleted', { documentId: docId });
    res.json({ deletedId: docId });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to delete document.' });
  }
});

// RAG Threads & REST Fallback Query
app.get('/api/threads', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const threads = await listUserThreads(req.user!.id);
    res.json({ threads });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load threads.' });
  }
});

app.get('/api/threads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const threadId = Number(req.params.id);
  if (!Number.isInteger(threadId) || threadId <= 0) {
    return res.status(400).json({ error: 'Invalid thread ID.' });
  }

  try {
    const data = await getThreadMessages(threadId, req.user!.id);
    if (!data) {
      return res.status(404).json({ error: 'Thread not found.' });
    }
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load thread.' });
  }
});

app.delete('/api/threads/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const threadId = Number(req.params.id);
  if (!Number.isInteger(threadId) || threadId <= 0) {
    return res.status(400).json({ error: 'Invalid thread ID.' });
  }

  try {
    const deleted = await deleteThread(threadId, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Thread not found.' });
    }
    res.json({ deletedId: threadId });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to delete thread.' });
  }
});

app.post('/api/rag/query', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = ragQueryRestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query payload' });
  }

  let finalThreadId: number | null = null;
  let finalMessage: unknown = null;
  let errorMessage: string | null = null;

  await runStreamingRagQuery({
    user: req.user!,
    requestId: `rest_${Date.now()}`,
    question: parsed.data.question,
    threadId: parsed.data.threadId ?? null,
    collectionId: parsed.data.collectionId ?? null,
    onEvent: (payload) => {
      if (payload.event === 'rag:done') {
        const data = payload.data as { threadId: number; message: unknown };
        finalThreadId = data.threadId;
        finalMessage = data.message;
      } else if (payload.event === 'rag:error') {
        const data = payload.data as { error: string };
        errorMessage = data.error;
      }
    },
  });

  if (errorMessage) {
    return res.status(500).json({ error: errorMessage });
  }
  res.json({ threadId: finalThreadId, message: finalMessage });
});

// Notifications
app.get('/api/notifications', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const items = await listUserNotifications(req.user!.id);
    res.json({ notifications: items });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load notifications.' });
  }
});

app.post('/api/notifications/read', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = markReadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid notification IDs.' });
  }

  try {
    await markNotificationsRead(req.user!.id, parsed.data.notificationIds);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to mark notifications read.' });
  }
});

// Admin Observability & RBAC Management
app.get('/api/admin/observability', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const action = typeof req.query.action === 'string' ? req.query.action : 'all';
  const search = typeof req.query.search === 'string' ? req.query.search : '';

  try {
    const data = await getAdminObservability({ action, search, limit: 100 });
    res.json({
      ...data,
      activeConnections: getActiveConnectionsCount(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load observability telemetry.' });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const users = await listUsers();
    res.json({ users });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load team directory.' });
  }
});

app.patch('/api/admin/users/:id/role', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  const targetUserId = Number(req.params.id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  const parsed = updateRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid role' });
  }

  if (targetUserId === req.user!.id && parsed.data.role !== 'admin') {
    return res.status(400).json({ error: 'Admins cannot demote their own active session.' });
  }

  try {
    const updated = await updateUserRole(targetUserId, parsed.data.role);
    if (!updated) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await writeAuditLog({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'role.update',
      resourceType: 'user',
      resourceId: String(updated.id),
      metadata: { targetEmail: updated.email, newRole: updated.role },
      status: 'success',
    });

    const notification = await createNotification({
      actorId: req.user!.id,
      type: 'role.updated',
      title: 'Workspace Role Updated',
      message: `${req.user!.name} updated ${updated.name}'s role to ${updated.role}.`,
      resourceId: String(updated.id),
    });

    broadcastEvent('member:role_updated', { userId: updated.id, role: updated.role });
    broadcastEvent('notification:new', {
      ...notification,
      actorName: req.user!.name,
      isRead: false,
    });

    res.json({ user: updated });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to update role.' });
  }
});

// Express JSON error handler (catches multer file validation errors etc.)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError || err?.message === 'Only PDF files are supported.') {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
});

// Register WebSocket RAG handler & start WS Hub
registerRagWsHandler(async (client, input) => {
  await runStreamingRagQuery({
    user: client.user,
    requestId: input.requestId,
    question: input.question,
    threadId: input.threadId ?? null,
    collectionId: input.collectionId ?? null,
    onEvent: (payload) => client.send(payload),
  });
});

initWebSocketHub(server);

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Verity Vault server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
