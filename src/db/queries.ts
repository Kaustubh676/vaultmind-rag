import { and, cosineDistance, count, desc, eq, gte, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from './index.ts';
import {
  apiMetrics,
  auditLogs,
  chatMessages,
  chatThreads,
  collections,
  documentChunks,
  documents,
  notificationReads,
  notifications,
  users,
  type CitationRecord,
} from './schema.ts';

export type UserRole = 'admin' | 'member';

export interface SafeUser {
  id: number;
  uid: string;
  email: string;
  name: string;
  authProvider: string;
  role: UserRole;
  avatarUrl: string | null;
  createdAt: Date;
}

function sanitizeUser(row: typeof users.$inferSelect): SafeUser {
  return {
    id: row.id,
    uid: row.uid,
    email: row.email,
    name: row.name,
    authProvider: row.authProvider,
    role: row.role === 'admin' ? 'admin' : 'member',
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
  };
}

const STARTER_COLLECTIONS = [
  {
    name: 'General Knowledge',
    description: 'Default workspace collection for company handbooks, policies, and shared PDFs.',
  },
  {
    name: 'Engineering & Architecture',
    description: 'Technical specifications, RFCs, system runbooks, and infrastructure docs.',
  },
  {
    name: 'Product & Analytics',
    description: 'Product requirements, analytics reports, user research, and metrics.',
  },
  {
    name: 'Policies & Compliance',
    description: 'Security guidelines, HR policies, onboarding, and legal agreements.',
  },
];

async function ensureDefaultCollections(userId: number | null) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(90421)`);
    const existing = await tx.select({ name: collections.name }).from(collections);
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

    const missing = STARTER_COLLECTIONS.filter(
      (c) => !existingNames.has(c.name.toLowerCase())
    );

    if (missing.length > 0 && existing.length <= 1) {
      await tx.insert(collections).values(
        missing.map((c) => ({
          name: c.name,
          description: c.description,
          createdBy: userId,
        }))
      );
    }
  });
}

export async function getUserById(userId: number): Promise<SafeUser | null> {
  try {
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ? sanitizeUser(rows[0]) : null;
  } catch (error) {
    console.error('Database query failed (getUserById):', error);
    throw new Error('Failed to retrieve user profile.', { cause: error });
  }
}

export async function getUserWithPasswordByEmail(email: string) {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (getUserWithPasswordByEmail):', error);
    throw new Error('Failed to look up account.', { cause: error });
  }
}

export async function registerPasswordUser(params: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<SafeUser> {
  try {
    const normalizedEmail = params.email.toLowerCase();
    const created = await db.transaction(async (tx) => {
      const existingByEmail = await tx
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existingByEmail[0]) {
        throw new Error('EMAIL_EXISTS');
      }

      const totalRows = await tx.select({ total: count() }).from(users);
      const isFirstUser = (totalRows[0]?.total ?? 0) === 0;

      const inserted = await tx
        .insert(users)
        .values({
          uid: `local_${randomUUID()}`,
          email: normalizedEmail,
          name: params.name.trim(),
          passwordHash: params.passwordHash,
          authProvider: 'password',
          role: isFirstUser ? 'admin' : 'member',
        })
        .returning();

      return inserted[0];
    });

    await ensureDefaultCollections(created.id);
    return sanitizeUser(created);
  } catch (error: any) {
    if (error?.message === 'EMAIL_EXISTS') {
      throw error;
    }
    console.error('Database query failed (registerPasswordUser):', error);
    throw new Error('Failed to create account.', { cause: error });
  }
}

export async function upsertGoogleUser(params: {
  uid: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}): Promise<{ user: SafeUser; isNew: boolean }> {
  try {
    const normalizedEmail = params.email.toLowerCase();
    const result = await db.transaction(async (tx) => {
      const existingByUid = await tx
        .select()
        .from(users)
        .where(eq(users.uid, params.uid))
        .limit(1);

      if (existingByUid[0]) {
        const updated = await tx
          .update(users)
          .set({
            email: normalizedEmail,
            name: params.name || existingByUid[0].name,
            avatarUrl: params.avatarUrl ?? existingByUid[0].avatarUrl,
          })
          .where(eq(users.id, existingByUid[0].id))
          .returning();
        return { row: updated[0], isNew: false };
      }

      const existingByEmail = await tx
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existingByEmail[0]) {
        const linked = await tx
          .update(users)
          .set({
            uid: params.uid,
            name: params.name || existingByEmail[0].name,
            authProvider: 'google',
            avatarUrl: params.avatarUrl ?? existingByEmail[0].avatarUrl,
          })
          .where(eq(users.id, existingByEmail[0].id))
          .returning();
        return { row: linked[0], isNew: false };
      }

      const totalRows = await tx.select({ total: count() }).from(users);
      const isFirstUser = (totalRows[0]?.total ?? 0) === 0;

      const inserted = await tx
        .insert(users)
        .values({
          uid: params.uid,
          email: normalizedEmail,
          name: params.name || normalizedEmail.split('@')[0],
          authProvider: 'google',
          role: isFirstUser ? 'admin' : 'member',
          avatarUrl: params.avatarUrl ?? null,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: {
            email: normalizedEmail,
            name: params.name || normalizedEmail.split('@')[0],
            avatarUrl: params.avatarUrl ?? null,
          },
        })
        .returning();

      return { row: inserted[0], isNew: true };
    });

    await ensureDefaultCollections(result.row.id);
    return { user: sanitizeUser(result.row), isNew: result.isNew };
  } catch (error) {
    console.error('Database query failed (upsertGoogleUser):', error);
    throw new Error('Failed to synchronize Google account.', { cause: error });
  }
}

export async function listUsers(): Promise<SafeUser[]> {
  try {
    const rows = await db.select().from(users).orderBy(users.createdAt);
    return rows.map(sanitizeUser);
  } catch (error) {
    console.error('Database query failed (listUsers):', error);
    throw new Error('Failed to load team directory.', { cause: error });
  }
}

export async function updateUserRole(userId: number, role: UserRole): Promise<SafeUser | null> {
  try {
    const updated = await db
      .update(users)
      .set({ role })
      .where(eq(users.id, userId))
      .returning();
    return updated[0] ? sanitizeUser(updated[0]) : null;
  } catch (error) {
    console.error('Database query failed (updateUserRole):', error);
    throw new Error('Failed to update user role.', { cause: error });
  }
}

export async function listCollections() {
  try {
    await ensureDefaultCollections(null);
    const rows = await db
      .select({
        id: collections.id,
        name: collections.name,
        description: collections.description,
        createdBy: collections.createdBy,
        createdAt: collections.createdAt,
        creatorName: users.name,
        documentCount: count(documents.id),
      })
      .from(collections)
      .leftJoin(users, eq(collections.createdBy, users.id))
      .leftJoin(documents, eq(documents.collectionId, collections.id))
      .groupBy(collections.id, users.name)
      .orderBy(collections.createdAt);

    return rows;
  } catch (error) {
    console.error('Database query failed (listCollections):', error);
    throw new Error('Failed to load collections.', { cause: error });
  }
}

export async function createCollection(params: {
  name: string;
  description: string;
  createdBy: number;
}) {
  try {
    const inserted = await db
      .insert(collections)
      .values({
        name: params.name.trim(),
        description: params.description.trim(),
        createdBy: params.createdBy,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createCollection):', error);
    throw new Error('Failed to create collection.', { cause: error });
  }
}

export async function listDocuments(collectionId?: number) {
  try {
    const baseQuery = db
      .select({
        id: documents.id,
        collectionId: documents.collectionId,
        collectionName: collections.name,
        uploadedBy: documents.uploadedBy,
        uploaderName: users.name,
        uploaderEmail: users.email,
        title: documents.title,
        fileName: documents.fileName,
        fileSize: documents.fileSize,
        pageCount: documents.pageCount,
        chunkCount: documents.chunkCount,
        status: documents.status,
        errorMessage: documents.errorMessage,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .innerJoin(collections, eq(documents.collectionId, collections.id))
      .leftJoin(users, eq(documents.uploadedBy, users.id));

    const rows = collectionId
      ? await baseQuery
          .where(eq(documents.collectionId, collectionId))
          .orderBy(desc(documents.createdAt))
      : await baseQuery.orderBy(desc(documents.createdAt));

    return rows;
  } catch (error) {
    console.error('Database query failed (listDocuments):', error);
    throw new Error('Failed to load documents.', { cause: error });
  }
}

export async function getDocumentById(documentId: number) {
  try {
    const rows = await db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed (getDocumentById):', error);
    throw new Error('Failed to fetch document.', { cause: error });
  }
}

export async function createProcessingDocument(params: {
  collectionId: number;
  uploadedBy: number;
  title: string;
  fileName: string;
  fileSize: number;
}) {
  try {
    const inserted = await db
      .insert(documents)
      .values({
        collectionId: params.collectionId,
        uploadedBy: params.uploadedBy,
        title: params.title,
        fileName: params.fileName,
        fileSize: params.fileSize,
        status: 'processing',
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createProcessingDocument):', error);
    throw new Error('Failed to create document record.', { cause: error });
  }
}

export async function finalizeDocumentChunks(params: {
  documentId: number;
  pageCount: number;
  chunks: Array<{
    pageNumber: number;
    chunkIndex: number;
    content: string;
    embedding: number[];
  }>;
}) {
  try {
    return await db.transaction(async (tx) => {
      if (params.chunks.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < params.chunks.length; i += batchSize) {
          const slice = params.chunks.slice(i, i + batchSize);
          await tx.insert(documentChunks).values(
            slice.map((c) => ({
              documentId: params.documentId,
              pageNumber: c.pageNumber,
              chunkIndex: c.chunkIndex,
              content: c.content,
              embedding: c.embedding,
            }))
          );
        }
      }

      const updated = await tx
        .update(documents)
        .set({
          pageCount: params.pageCount,
          chunkCount: params.chunks.length,
          status: 'ready',
          errorMessage: null,
        })
        .where(eq(documents.id, params.documentId))
        .returning();

      return updated[0];
    });
  } catch (error) {
    console.error('Database query failed (finalizeDocumentChunks):', error);
    throw new Error('Failed to store document embeddings.', { cause: error });
  }
}

export async function markDocumentFailed(documentId: number, errorMessage: string) {
  try {
    const updated = await db
      .update(documents)
      .set({
        status: 'failed',
        errorMessage,
      })
      .where(eq(documents.id, documentId))
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database query failed (markDocumentFailed):', error);
    throw new Error('Failed to update document failure status.', { cause: error });
  }
}

export async function deleteDocumentById(documentId: number) {
  try {
    const deleted = await db
      .delete(documents)
      .where(eq(documents.id, documentId))
      .returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteDocumentById):', error);
    throw new Error('Failed to delete document.', { cause: error });
  }
}

export async function getDocumentPreviewChunks(documentId: number) {
  try {
    return await db
      .select({
        id: documentChunks.id,
        pageNumber: documentChunks.pageNumber,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
      })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId))
      .orderBy(documentChunks.chunkIndex);
  } catch (error) {
    console.error('Database query failed (getDocumentPreviewChunks):', error);
    throw new Error('Failed to load document chunks.', { cause: error });
  }
}

export async function searchSimilarChunks(params: {
  embedding: number[];
  collectionId?: number | null;
  limit?: number;
}) {
  try {
    const distance = cosineDistance(documentChunks.embedding, params.embedding);
    const similarity = sql<number>`1 - (${distance})`;

    const whereClause = params.collectionId
      ? and(eq(documents.status, 'ready'), eq(documents.collectionId, params.collectionId))
      : eq(documents.status, 'ready');

    const rows = await db
      .select({
        chunkId: documentChunks.id,
        documentId: documents.id,
        documentTitle: documents.title,
        collectionName: collections.name,
        pageNumber: documentChunks.pageNumber,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        score: similarity,
      })
      .from(documentChunks)
      .innerJoin(documents, eq(documentChunks.documentId, documents.id))
      .innerJoin(collections, eq(documents.collectionId, collections.id))
      .where(whereClause)
      .orderBy(distance)
      .limit(params.limit ?? 6);

    return rows;
  } catch (error) {
    console.error('Database query failed (searchSimilarChunks):', error);
    throw new Error('Vector similarity search failed.', { cause: error });
  }
}

export async function listUserThreads(userId: number) {
  try {
    return await db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        collectionId: chatThreads.collectionId,
        collectionName: collections.name,
        createdAt: chatThreads.createdAt,
        updatedAt: chatThreads.updatedAt,
      })
      .from(chatThreads)
      .leftJoin(collections, eq(chatThreads.collectionId, collections.id))
      .where(eq(chatThreads.userId, userId))
      .orderBy(desc(chatThreads.updatedAt));
  } catch (error) {
    console.error('Database query failed (listUserThreads):', error);
    throw new Error('Failed to load chat threads.', { cause: error });
  }
}

export async function getThreadMessages(threadId: number, userId: number) {
  try {
    const thread = await db
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)))
      .limit(1);

    if (!thread[0]) return null;

    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(chatMessages.createdAt);

    return { thread: thread[0], messages };
  } catch (error) {
    console.error('Database query failed (getThreadMessages):', error);
    throw new Error('Failed to load thread messages.', { cause: error });
  }
}

export async function createOrGetThread(params: {
  threadId?: number | null;
  userId: number;
  collectionId?: number | null;
  titleSeed: string;
}) {
  try {
    if (params.threadId) {
      const existing = await db
        .select()
        .from(chatThreads)
        .where(
          and(
            eq(chatThreads.id, params.threadId),
            eq(chatThreads.userId, params.userId)
          )
        )
        .limit(1);
      if (existing[0]) return existing[0];
    }

    const title = params.titleSeed.trim().slice(0, 72) || 'New Knowledge Query';
    const inserted = await db
      .insert(chatThreads)
      .values({
        userId: params.userId,
        collectionId: params.collectionId ?? null,
        title,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createOrGetThread):', error);
    throw new Error('Failed to initialize chat thread.', { cause: error });
  }
}

export async function deleteThread(threadId: number, userId: number) {
  try {
    const deleted = await db
      .delete(chatThreads)
      .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)))
      .returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database query failed (deleteThread):', error);
    throw new Error('Failed to delete chat thread.', { cause: error });
  }
}

export async function appendChatMessage(params: {
  threadId: number;
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationRecord[];
  latencyMs?: number | null;
}) {
  try {
    const inserted = await db
      .insert(chatMessages)
      .values({
        threadId: params.threadId,
        role: params.role,
        content: params.content,
        citations: params.citations ?? [],
        latencyMs: params.latencyMs ?? null,
      })
      .returning();

    await db
      .update(chatThreads)
      .set({ updatedAt: new Date() })
      .where(eq(chatThreads.id, params.threadId));

    return inserted[0];
  } catch (error) {
    console.error('Database query failed (appendChatMessage):', error);
    throw new Error('Failed to save chat message.', { cause: error });
  }
}

export async function createNotification(params: {
  actorId: number | null;
  type: string;
  title: string;
  message: string;
  resourceId?: string;
}) {
  try {
    const inserted = await db
      .insert(notifications)
      .values({
        actorId: params.actorId,
        type: params.type,
        title: params.title,
        message: params.message,
        resourceId: params.resourceId ?? null,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (createNotification):', error);
    throw new Error('Failed to store notification.', { cause: error });
  }
}

export async function listUserNotifications(userId: number) {
  try {
    const rows = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        resourceId: notifications.resourceId,
        createdAt: notifications.createdAt,
        actorName: users.name,
        readAt: notificationReads.readAt,
      })
      .from(notifications)
      .leftJoin(users, eq(notifications.actorId, users.id))
      .leftJoin(
        notificationReads,
        and(
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId)
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(30);

    return rows.map((r) => ({
      ...r,
      isRead: Boolean(r.readAt),
    }));
  } catch (error) {
    console.error('Database query failed (listUserNotifications):', error);
    throw new Error('Failed to load notifications.', { cause: error });
  }
}

export async function markNotificationsRead(userId: number, notificationIds?: number[]) {
  try {
    const unread = await db
      .select({ id: notifications.id })
      .from(notifications)
      .leftJoin(
        notificationReads,
        and(
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId)
        )
      )
      .where(isNull(notificationReads.id))
      .limit(50);

    const targets = notificationIds?.length
      ? unread.filter((n) => notificationIds.includes(n.id))
      : unread;

    if (targets.length === 0) return;

    await db
      .insert(notificationReads)
      .values(
        targets.map((t) => ({
          notificationId: t.id,
          userId,
        }))
      )
      .onConflictDoNothing();
  } catch (error) {
    console.error('Database query failed (markNotificationsRead):', error);
    throw new Error('Failed to mark notifications as read.', { cause: error });
  }
}

export async function writeAuditLog(params: {
  actorId: number | null;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  status?: 'success' | 'failure';
}) {
  try {
    const inserted = await db
      .insert(auditLogs)
      .values({
        actorId: params.actorId,
        actorEmail: params.actorEmail,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: params.metadata ?? {},
        status: params.status ?? 'success',
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed (writeAuditLog):', error);
  }
}

export async function recordApiMetric(params: {
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  userId?: number | null;
}) {
  try {
    await db.insert(apiMetrics).values({
      method: params.method,
      path: params.path,
      statusCode: params.statusCode,
      latencyMs: Math.max(0, Math.round(params.latencyMs)),
      userId: params.userId ?? null,
    });
  } catch (error) {
    console.error('Database query failed (recordApiMetric):', error);
  }
}

export async function getAdminObservability(params?: {
  action?: string;
  search?: string;
  limit?: number;
}) {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      userCountRes,
      docCountRes,
      chunkCountRes,
      queryCountRes,
      recentMetrics,
      auditConditions,
    ] = await Promise.all([
      db.select({ total: count() }).from(users),
      db.select({ total: count() }).from(documents),
      db.select({ total: count() }).from(documentChunks),
      db
        .select({ total: count() })
        .from(chatMessages)
        .where(eq(chatMessages.role, 'assistant')),
      db
        .select({
          id: apiMetrics.id,
          method: apiMetrics.method,
          path: apiMetrics.path,
          statusCode: apiMetrics.statusCode,
          latencyMs: apiMetrics.latencyMs,
          createdAt: apiMetrics.createdAt,
        })
        .from(apiMetrics)
        .where(gte(apiMetrics.createdAt, since))
        .orderBy(desc(apiMetrics.createdAt))
        .limit(300),
      (async () => {
        const filters = [];
        if (params?.action && params.action !== 'all') {
          filters.push(eq(auditLogs.action, params.action));
        }
        if (params?.search?.trim()) {
          const term = `%${params.search.trim()}%`;
          filters.push(
            or(
              ilike(auditLogs.actorEmail, term),
              ilike(auditLogs.action, term),
              ilike(auditLogs.resourceType, term),
              ilike(auditLogs.resourceId, term)
            )
          );
        }
        const whereClause = filters.length > 0 ? and(...filters) : undefined;
        return db
          .select()
          .from(auditLogs)
          .where(whereClause)
          .orderBy(desc(auditLogs.createdAt))
          .limit(params?.limit ?? 100);
      })(),
    ]);

    const latencies = recentMetrics.map((m) => m.latencyMs).sort((a, b) => a - b);
    const meanLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length)
        : 0;
    const p95LatencyMs =
      latencies.length > 0
        ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
        : 0;
    const errorCount = recentMetrics.filter((m) => m.statusCode >= 500).length;

    const endpointMap = new Map<
      string,
      { endpoint: string; count: number; totalMs: number; maxMs: number; errors: number }
    >();

    for (const m of recentMetrics) {
      const key = `${m.method} ${m.path}`;
      const existing = endpointMap.get(key) ?? {
        endpoint: key,
        count: 0,
        totalMs: 0,
        maxMs: 0,
        errors: 0,
      };
      existing.count += 1;
      existing.totalMs += m.latencyMs;
      existing.maxMs = Math.max(existing.maxMs, m.latencyMs);
      if (m.statusCode >= 400) existing.errors += 1;
      endpointMap.set(key, existing);
    }

    const endpointBreakdown = Array.from(endpointMap.values())
      .map((e) => ({
        endpoint: e.endpoint,
        requests: e.count,
        avgLatencyMs: Math.round(e.totalMs / e.count),
        maxLatencyMs: e.maxMs,
        errorCount: e.errors,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 10);

    const latencySeries = recentMetrics
      .slice(0, 24)
      .reverse()
      .map((m) => ({
        id: m.id,
        label: `${m.method} ${m.path}`,
        latencyMs: m.latencyMs,
        statusCode: m.statusCode,
        createdAt: m.createdAt,
      }));

    return {
      summary: {
        totalUsers: userCountRes[0]?.total ?? 0,
        totalDocuments: docCountRes[0]?.total ?? 0,
        totalChunks: chunkCountRes[0]?.total ?? 0,
        totalQueries: queryCountRes[0]?.total ?? 0,
        meanLatencyMs,
        p95LatencyMs,
        requests24h: recentMetrics.length,
        serverErrors24h: errorCount,
      },
      endpointBreakdown,
      latencySeries,
      auditLogs: auditConditions,
    };
  } catch (error) {
    console.error('Database query failed (getAdminObservability):', error);
    throw new Error('Failed to load observability telemetry.', { cause: error });
  }
}

export async function pruneOldMetrics() {
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    await db.delete(apiMetrics).where(lt(apiMetrics.createdAt, cutoff));
  } catch {
    // Non-critical background cleanup
  }
}
