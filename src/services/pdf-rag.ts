import { extractText } from 'unpdf';
import {
  appendChatMessage,
  createNotification,
  createOrGetThread,
  finalizeDocumentChunks,
  getThreadMessages,
  markDocumentFailed,
  recordApiMetric,
  searchSimilarChunks,
  writeAuditLog,
  type SafeUser,
} from '../db/queries.ts';
import type { CitationRecord } from '../db/schema.ts';
import { embedSingleQuery, embedTexts, extractPdfPagesWithGemini, streamRagAnswer } from '../lib/gemini.ts';
import { broadcastEvent } from './ws-hub.ts';

interface TextChunk {
  pageNumber: number;
  chunkIndex: number;
  content: string;
}

export function chunkPageRecords(
  pages: Array<{ pageNumber: number; text: string }>
): TextChunk[] {
  const chunks: TextChunk[] = [];
  const maxChunkChars = 850;
  const overlapChars = 150;
  let globalIndex = 0;

  for (const page of pages) {
    const raw = (page.text || '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;

    let start = 0;
    while (start < raw.length) {
      let end = Math.min(start + maxChunkChars, raw.length);
      if (end < raw.length) {
        const lastSpace = raw.lastIndexOf(' ', end);
        if (lastSpace > start + 250) {
          end = lastSpace;
        }
      }

      const slice = raw.slice(start, end).trim();
      if (slice.length > 10) {
        chunks.push({
          pageNumber: page.pageNumber,
          chunkIndex: globalIndex++,
          content: slice,
        });
      }

      if (end >= raw.length) break;
      start = Math.max(start + 1, end - overlapChars);
    }
  }

  return chunks;
}

export async function processPdfIngestion(params: {
  documentId: number;
  collectionId: number;
  collectionName: string;
  title: string;
  buffer: Buffer;
  actor: SafeUser;
}) {
  try {
    let pageCount = 0;
    let textChunks: TextChunk[] = [];

    try {
      const extracted = await extractText(new Uint8Array(params.buffer), {
        mergePages: false,
      });

      const pages = Array.isArray(extracted.text)
        ? extracted.text
        : [String(extracted.text || '')];

      pageCount = extracted.totalPages || pages.length;
      textChunks = chunkPageRecords(
        pages.map((text, idx) => ({ pageNumber: idx + 1, text }))
      );
    } catch {
      // Fall back to multimodal Gemini PDF extraction below
    }

    if (textChunks.length === 0) {
      const geminiPages = await extractPdfPagesWithGemini(params.buffer);
      if (geminiPages.length > 0) {
        pageCount = Math.max(
          pageCount,
          ...geminiPages.map((p) => p.pageNumber),
          geminiPages.length
        );
        textChunks = chunkPageRecords(geminiPages);
      }
    }

    if (textChunks.length === 0) {
      throw new Error(
        'No readable text or content could be extracted from this PDF.'
      );
    }

    const embeddings = await embedTexts(textChunks.map((c) => c.content));
    const readyDoc = await finalizeDocumentChunks({
      documentId: params.documentId,
      pageCount,
      chunks: textChunks.map((c, idx) => ({
        pageNumber: c.pageNumber,
        chunkIndex: c.chunkIndex,
        content: c.content,
        embedding: embeddings[idx],
      })),
    });

    await writeAuditLog({
      actorId: params.actor.id,
      actorEmail: params.actor.email,
      action: 'document.upload',
      resourceType: 'document',
      resourceId: String(params.documentId),
      metadata: {
        title: params.title,
        collectionId: params.collectionId,
        pageCount: readyDoc.pageCount,
        chunkCount: readyDoc.chunkCount,
      },
      status: 'success',
    });

    const notification = await createNotification({
      actorId: params.actor.id,
      type: 'document.indexed',
      title: 'New PDF Indexed',
      message: `${params.actor.name} indexed "${params.title}" (${readyDoc.pageCount} pages, ${readyDoc.chunkCount} chunks) in ${params.collectionName}.`,
      resourceId: String(params.documentId),
    });

    broadcastEvent('document:status', {
      documentId: params.documentId,
      status: 'ready',
      pageCount: readyDoc.pageCount,
      chunkCount: readyDoc.chunkCount,
    });

    broadcastEvent('notification:new', {
      ...notification,
      actorName: params.actor.name,
      isRead: false,
    });
  } catch (error: any) {
    const message = error?.message || 'PDF indexing failed.';
    await markDocumentFailed(params.documentId, message);
    await writeAuditLog({
      actorId: params.actor.id,
      actorEmail: params.actor.email,
      action: 'document.upload',
      resourceType: 'document',
      resourceId: String(params.documentId),
      metadata: { title: params.title, error: message },
      status: 'failure',
    });

    const failNotification = await createNotification({
      actorId: params.actor.id,
      type: 'document.failed',
      title: 'PDF Indexing Failed',
      message: `"${params.title}" failed to index: ${message}`,
      resourceId: String(params.documentId),
    });

    broadcastEvent('document:status', {
      documentId: params.documentId,
      status: 'failed',
      errorMessage: message,
    });

    broadcastEvent('notification:new', {
      ...failNotification,
      actorName: params.actor.name,
      isRead: false,
    });
  }
}

export async function runStreamingRagQuery(params: {
  user: SafeUser;
  requestId: string;
  question: string;
  threadId?: number | null;
  collectionId?: number | null;
  onEvent: (payload: Record<string, unknown>) => void;
}) {
  const startedAt = performance.now();

  try {
    const thread = await createOrGetThread({
      threadId: params.threadId,
      userId: params.user.id,
      collectionId: params.collectionId,
      titleSeed: params.question,
    });

    const existingThreadData = await getThreadMessages(thread.id, params.user.id);
    const history = (existingThreadData?.messages ?? []).map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }));

    const userMsg = await appendChatMessage({
      threadId: thread.id,
      role: 'user',
      content: params.question,
    });

    params.onEvent({
      event: 'rag:start',
      data: {
        requestId: params.requestId,
        threadId: thread.id,
        threadTitle: thread.title,
        userMessageId: userMsg.id,
      },
    });

    const queryEmbedding = await embedSingleQuery(params.question);
    const matched = await searchSimilarChunks({
      embedding: queryEmbedding,
      collectionId: params.collectionId ?? thread.collectionId ?? null,
      limit: 6,
    });

    const citations: CitationRecord[] = matched.map((m, idx) => ({
      index: idx + 1,
      chunkId: m.chunkId,
      documentId: m.documentId,
      documentTitle: m.documentTitle,
      pageNumber: m.pageNumber,
      snippet: m.content,
      score: Number(Number(m.score ?? 0).toFixed(3)),
    }));

    params.onEvent({
      event: 'rag:citations',
      data: {
        requestId: params.requestId,
        threadId: thread.id,
        citations,
      },
    });

    let fullAnswer = '';

    if (citations.length === 0) {
      fullAnswer =
        'No indexed document chunks matched this scope yet. Upload a PDF into this collection (or switch to All Collections) so I can answer with verified source citations.';
      params.onEvent({
        event: 'rag:chunk',
        data: {
          requestId: params.requestId,
          threadId: thread.id,
          delta: fullAnswer,
        },
      });
    } else {
      const contextBlocks = citations
        .map(
          (c) =>
            `[${c.index}] Document: "${c.documentTitle}" (Page ${c.pageNumber}, Relevance ${(c.score * 100).toFixed(0)}%)\n${c.snippet}`
        )
        .join('\n\n---\n\n');

      const stream = await streamRagAnswer({
        question: params.question,
        history,
        contextBlocks,
      });

      for await (const chunk of stream) {
        const delta = chunk.text || '';
        if (delta) {
          fullAnswer += delta;
          params.onEvent({
            event: 'rag:chunk',
            data: {
              requestId: params.requestId,
              threadId: thread.id,
              delta,
            },
          });
        }
      }
    }

    const latencyMs = Math.round(performance.now() - startedAt);
    const assistantMsg = await appendChatMessage({
      threadId: thread.id,
      role: 'assistant',
      content: fullAnswer,
      citations,
      latencyMs,
    });

    await Promise.all([
      writeAuditLog({
        actorId: params.user.id,
        actorEmail: params.user.email,
        action: 'rag.query',
        resourceType: 'chat_thread',
        resourceId: String(thread.id),
        metadata: {
          collectionId: params.collectionId ?? thread.collectionId ?? null,
          citationCount: citations.length,
          latencyMs,
        },
        status: 'success',
      }),
      recordApiMetric({
        method: 'WS',
        path: '/ws/rag/query',
        statusCode: 200,
        latencyMs,
        userId: params.user.id,
      }),
    ]);

    params.onEvent({
      event: 'rag:done',
      data: {
        requestId: params.requestId,
        threadId: thread.id,
        message: assistantMsg,
        latencyMs,
      },
    });
  } catch (error: any) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message =
      error?.message || 'Unable to generate RAG response. Please verify your Gemini API key in Settings > Secrets.';

    await Promise.all([
      writeAuditLog({
        actorId: params.user.id,
        actorEmail: params.user.email,
        action: 'rag.query',
        resourceType: 'chat_thread',
        resourceId: String(params.threadId ?? 'new'),
        metadata: { error: message, latencyMs },
        status: 'failure',
      }),
      recordApiMetric({
        method: 'WS',
        path: '/ws/rag/query',
        statusCode: 500,
        latencyMs,
        userId: params.user.id,
      }),
    ]);

    params.onEvent({
      event: 'rag:error',
      data: {
        requestId: params.requestId,
        error: message,
      },
    });
  }
}
