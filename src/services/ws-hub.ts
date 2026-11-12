import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { verifyAccessToken } from '../middleware/auth.ts';
import type { SafeUser } from '../db/queries.ts';
import type { CitationRecord } from '../db/schema.ts';

interface AuthenticatedClient {
  ws: WebSocket;
  user: SafeUser;
}

const clients = new Set<AuthenticatedClient>();

const wsAskSchema = z.object({
  type: z.literal('rag:ask'),
  requestId: z.string().min(1).max(100),
  question: z.string().trim().min(1).max(4000),
  threadId: z.number().int().positive().nullable().optional(),
  collectionId: z.number().int().positive().nullable().optional(),
});

export type RagQueryHandler = (
  client: { send: (payload: Record<string, unknown>) => void; user: SafeUser },
  input: z.infer<typeof wsAskSchema>
) => Promise<void>;

let activeRagHandler: RagQueryHandler | null = null;

export function registerRagWsHandler(handler: RagQueryHandler) {
  activeRagHandler = handler;
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function broadcastEvent(event: string, data: Record<string, unknown>) {
  const payload = { event, data, timestamp: new Date().toISOString() };
  for (const client of clients) {
    sendJson(client.ws, payload);
  }
}

export function sendToUser(userId: number, event: string, data: Record<string, unknown>) {
  const payload = { event, data, timestamp: new Date().toISOString() };
  for (const client of clients) {
    if (client.user.id === userId) {
      sendJson(client.ws, payload);
    }
  }
}

export function getActiveConnectionsCount(): number {
  return clients.size;
}

export function initWebSocketHub(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== '/ws') {
        return;
      }

      const token = url.searchParams.get('token') || '';
      const user = await verifyAccessToken(token);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, user);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, _req: unknown, user: SafeUser) => {
    const client: AuthenticatedClient = { ws, user };
    clients.add(client);

    sendJson(ws, {
      event: 'ws:connected',
      data: { userId: user.id, role: user.role },
      timestamp: new Date().toISOString(),
    });

    ws.on('message', async (raw) => {
      try {
        const parsedJson = JSON.parse(raw.toString());
        const parsed = wsAskSchema.safeParse(parsedJson);
        if (!parsed.success) {
          sendJson(ws, {
            event: 'rag:error',
            data: {
              requestId: typeof parsedJson?.requestId === 'string' ? parsedJson.requestId : null,
              error: parsed.error.issues[0]?.message || 'Invalid WebSocket payload',
            },
          });
          return;
        }

        if (!activeRagHandler) {
          sendJson(ws, {
            event: 'rag:error',
            data: {
              requestId: parsed.data.requestId,
              error: 'RAG engine not initialized.',
            },
          });
          return;
        }

        await activeRagHandler(
          {
            user: client.user,
            send: (payload) => sendJson(ws, payload),
          },
          parsed.data
        );
      } catch (error: any) {
        sendJson(ws, {
          event: 'rag:error',
          data: {
            requestId: null,
            error: error?.message || 'Failed to process WebSocket message.',
          },
        });
      }
    });

    ws.on('close', () => {
      clients.delete(client);
    });
  });

  return wss;
}

export type { CitationRecord };
