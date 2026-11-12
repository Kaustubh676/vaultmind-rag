import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ExternalLink,
  FileText,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { ChatMessage, ChatThread, Citation, Collection, DocumentItem } from '../types.ts';

interface AskViewProps {
  collections: Collection[];
  documents: DocumentItem[];
  onOpenUpload: () => void;
}

function CitedProse({
  text,
  citations,
  activeCitationKey,
  onSelectCitation,
}: {
  text: string;
  citations: Citation[];
  activeCitationKey: string | null;
  onSelectCitation: (citation: Citation) => void;
}) {
  const citationMap = useMemo(() => {
    const map = new Map<number, Citation>();
    for (const c of citations) {
      map.set(c.index, c);
    }
    return map;
  }, [citations]);

  const segments = text.split(/(\[\d+\])/g);

  return (
    <div className="text-[15px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
      {segments.map((part, idx) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          const num = Number(match[1]);
          const citation = citationMap.get(num);
          if (citation) {
            const key = `${citation.chunkId}-${citation.index}`;
            const isSelected = activeCitationKey === key;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onSelectCitation(citation)}
                title={`${citation.documentTitle} · Page ${citation.pageNumber}`}
                className={`inline-flex items-center justify-center mx-0.5 px-1.5 py-0.5 rounded text-xs font-mono font-semibold tabular-nums align-baseline transition-colors ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900'
                }`}
              >
                {num}
              </button>
            );
          }
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </div>
  );
}

export function AskView({ collections, documents, onOpenUpload }: AskViewProps) {
  const { apiFetch, sendWsMessage, subscribeWs, wsConnected } = useAuth();

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | 'all'>('all');
  const [question, setQuestion] = useState('');
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [streamingRequestId, setStreamingRequestId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [inspectorSources, setInspectorSources] = useState<Citation[]>([]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);

  const readyDocsCount = useMemo(
    () => documents.filter((d) => d.status === 'ready').length,
    [documents]
  );

  const fetchThreads = useCallback(async () => {
    try {
      setLoadingThreads(true);
      const data = await apiFetch<{ threads: ChatThread[] }>('/api/threads');
      setThreads(data.threads);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to load conversation history.');
    } finally {
      setLoadingThreads(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  const loadThread = useCallback(
    async (threadId: number) => {
      try {
        setLoadingMessages(true);
        setErrorBanner(null);
        const data = await apiFetch<{ thread: ChatThread; messages: ChatMessage[] }>(
          `/api/threads/${threadId}`
        );
        setActiveThreadId(threadId);
        setMessages(data.messages);
        if (data.thread.collectionId) {
          setSelectedCollectionId(data.thread.collectionId);
        } else {
          setSelectedCollectionId('all');
        }

        const lastAssistant = [...data.messages]
          .reverse()
          .find((m) => m.role === 'assistant' && m.citations?.length > 0);
        if (lastAssistant) {
          setInspectorSources(lastAssistant.citations);
          setSelectedCitation(lastAssistant.citations[0] ?? null);
        } else {
          setInspectorSources([]);
          setSelectedCitation(null);
        }
      } catch (err: any) {
        setErrorBanner(err?.message || 'Failed to load thread messages.');
      } finally {
        setLoadingMessages(false);
      }
    },
    [apiFetch]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  useEffect(() => {
    return subscribeWs((msg) => {
      const reqId = activeRequestIdRef.current;
      if (!reqId || msg.data?.requestId !== reqId) return;

      if (msg.event === 'rag:start') {
        setActiveThreadId(msg.data.threadId);
        void fetchThreads();
      } else if (msg.event === 'rag:citations') {
        const cits: Citation[] = msg.data.citations || [];
        setStreamingCitations(cits);
        setInspectorSources(cits);
        if (cits.length > 0) setSelectedCitation(cits[0]);
      } else if (msg.event === 'rag:chunk') {
        setStreamingText((prev) => prev + (msg.data.delta || ''));
      } else if (msg.event === 'rag:done') {
        const finalMsg: ChatMessage = msg.data.message;
        setMessages((prev) => [...prev, finalMsg]);
        setStreamingRequestId(null);
        activeRequestIdRef.current = null;
        setStreamingText('');
        setStreamingCitations([]);
        void fetchThreads();
      } else if (msg.event === 'rag:error') {
        setErrorBanner(msg.data.error || 'Failed to stream answer.');
        setStreamingRequestId(null);
        activeRequestIdRef.current = null;
      }
    });
  }, [fetchThreads, subscribeWs]);

  const startNewThread = () => {
    setActiveThreadId(null);
    setMessages([]);
    setStreamingText('');
    setStreamingCitations([]);
    setInspectorSources([]);
    setSelectedCitation(null);
    setErrorBanner(null);
  };

  const handleDeleteThread = async (threadId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiFetch(`/api/threads/${threadId}`, { method: 'DELETE' });
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThreadId === threadId) {
        startNewThread();
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Failed to delete thread.');
    }
  };

  const submitQuestion = async (promptText?: string) => {
    const trimmed = (promptText ?? question).trim();
    if (!trimmed || streamingRequestId) return;

    setErrorBanner(null);
    setQuestion('');

    const optimisticUserMsg: ChatMessage = {
      id: Date.now(),
      threadId: activeThreadId ?? 0,
      role: 'user',
      content: trimmed,
      citations: [],
      latencyMs: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    activeRequestIdRef.current = requestId;
    setStreamingRequestId(requestId);
    setStreamingText('');
    setStreamingCitations([]);

    const collectionId = selectedCollectionId === 'all' ? null : selectedCollectionId;

    const sentViaWs = wsConnected
      ? sendWsMessage({
          type: 'rag:ask',
          requestId,
          question: trimmed,
          threadId: activeThreadId,
          collectionId,
        })
      : false;

    if (!sentViaWs) {
      // REST fallback when WebSocket is temporarily reconnecting
      try {
        const res = await apiFetch<{ threadId: number; message: ChatMessage }>('/api/rag/query', {
          method: 'POST',
          body: JSON.stringify({
            question: trimmed,
            threadId: activeThreadId,
            collectionId,
          }),
        });
        setActiveThreadId(res.threadId);
        setMessages((prev) => [...prev, res.message]);
        if (res.message.citations?.length > 0) {
          setInspectorSources(res.message.citations);
          setSelectedCitation(res.message.citations[0]);
        }
        await fetchThreads();
      } catch (err: any) {
        setErrorBanner(err?.message || 'Failed to generate answer.');
      } finally {
        setStreamingRequestId(null);
        activeRequestIdRef.current = null;
      }
    }
  };

  const activeCitationKey = selectedCitation
    ? `${selectedCitation.chunkId}-${selectedCitation.index}`
    : null;

  return (
    <div className="h-[calc(100vh-4rem)] flex overflow-hidden">
      {/* Thread History Column */}
      <aside className="hidden xl:flex w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Query Threads
          </h2>
          <button
            type="button"
            onClick={startNewThread}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingThreads ? (
            <div className="space-y-2 p-2">
              <div className="h-9 rounded-md bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
              <div className="h-9 rounded-md bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
              <div className="h-9 rounded-md bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
            </div>
          ) : threads.length === 0 ? (
            <p className="p-3 text-xs text-slate-500 dark:text-slate-400">
              Your previous knowledge queries will appear here.
            </p>
          ) : (
            threads.map((t) => (
              <div
                key={t.id}
                onClick={() => void loadThread(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') void loadThread(t.id);
                }}
                className={`group flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left cursor-pointer transition-colors ${
                  activeThreadId === t.id
                    ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{t.title}</p>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                    {t.collectionName || 'All Collections'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => void handleDeleteThread(t.id, e)}
                  aria-label="Delete thread"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Center Conversation Column */}
      <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950">
        {/* Scope Toolbar */}
        <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-950">
          <div className="flex items-center gap-3">
            <label htmlFor="scope-select" className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Search Scope
            </label>
            <select
              id="scope-select"
              value={selectedCollectionId === 'all' ? 'all' : String(selectedCollectionId)}
              onChange={(e) =>
                setSelectedCollectionId(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
            >
              <option value="all">All Collections ({readyDocsCount} indexed PDFs)</option>
              {collections.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name} ({c.documentCount})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={startNewThread}
              className="xl:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Query</span>
            </button>
            <span className="font-mono tabular-nums">
              {wsConnected ? 'WebSocket Stream Ready' : 'HTTP Fallback Active'}
            </span>
          </div>
        </div>

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {errorBanner && (
              <div
                role="alert"
                className="p-3.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-3"
              >
                <span>{errorBanner}</span>
                <button
                  type="button"
                  onClick={() => setErrorBanner(null)}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {loadingMessages ? (
              <div className="space-y-4">
                <div className="h-16 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse" />
                <div className="h-32 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse" />
              </div>
            ) : messages.length === 0 && !streamingRequestId ? (
              <div className="py-12 px-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/40 text-center space-y-5">
                <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center mx-auto text-blue-600 dark:text-blue-400">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div className="space-y-2 max-w-lg mx-auto">
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    {readyDocsCount > 0
                      ? 'Ask across your indexed team knowledge'
                      : 'Upload your first PDF to activate RAG search'}
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {readyDocsCount > 0
                      ? 'Every response streams in real time with clickable inline citations linked to exact PDF pages.'
                      : 'Verity Vault automatically extracts pages, chunks content, and stores pgvector embeddings in PostgreSQL.'}
                  </p>
                </div>

                {readyDocsCount === 0 ? (
                  <button
                    type="button"
                    onClick={onOpenUpload}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Upload First PDF</span>
                  </button>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-2.5 max-w-xl mx-auto pt-2 text-left">
                    {[
                      'Summarize the key policies and deadlines across our documents.',
                      'What security or compliance controls are specified in the uploaded PDFs?',
                    ].map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        onClick={() => void submitQuestion(starter)}
                        className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-600 text-xs text-slate-700 dark:text-slate-300 transition-colors"
                      >
                        {starter}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`rounded-xl p-5 border ${
                      msg.role === 'user'
                        ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 ml-8 sm:ml-16'
                        : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-2.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {msg.role === 'user' ? 'You' : 'Verity Vault Answer'}
                      </span>
                      <div className="flex items-center gap-2 font-mono tabular-nums">
                        {msg.latencyMs !== null && <span>{msg.latencyMs} ms</span>}
                        {msg.role === 'assistant' && msg.citations?.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() => {
                                setInspectorSources(msg.citations);
                                setSelectedCitation(msg.citations[0]);
                              }}
                              className="text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {msg.citations.length} sources
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {msg.role === 'user' ? (
                      <p className="text-[15px] text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    ) : (
                      <div className="space-y-4">
                        <CitedProse
                          text={msg.content}
                          citations={msg.citations || []}
                          activeCitationKey={activeCitationKey}
                          onSelectCitation={(c) => {
                            setInspectorSources(msg.citations || []);
                            setSelectedCitation(c);
                          }}
                        />

                        {msg.citations?.length > 0 && (
                          <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap gap-2">
                            {msg.citations.map((c) => {
                              const key = `${c.chunkId}-${c.index}`;
                              const active = activeCitationKey === key;
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => {
                                    setInspectorSources(msg.citations);
                                    setSelectedCitation(c);
                                  }}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors ${
                                    active
                                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                                  }`}
                                >
                                  <span className="font-mono font-semibold tabular-nums">[{c.index}]</span>
                                  <span className="truncate max-w-[180px]">{c.documentTitle}</span>
                                  <span className="text-slate-400 font-mono tabular-nums">p.{c.pageNumber}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {streamingRequestId && (
                  <div className="rounded-xl p-5 border border-blue-200 dark:border-blue-900 bg-white dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-4 mb-2.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-blue-600 dark:text-blue-400">
                        Streaming Answer
                      </span>
                      <span className="font-mono tabular-nums">
                        {streamingCitations.length} matched chunks
                      </span>
                    </div>
                    {streamingText ? (
                      <CitedProse
                        text={streamingText}
                        citations={streamingCitations}
                        activeCitationKey={activeCitationKey}
                        onSelectCitation={(c) => {
                          setInspectorSources(streamingCitations);
                          setSelectedCitation(c);
                        }}
                      />
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Retrieving pgvector matches and synthesizing response...
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitQuestion();
          }}
          className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950"
        >
          <div className="max-w-3xl mx-auto flex items-end gap-3">
            <div className="flex-1">
              <textarea
                rows={2}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submitQuestion();
                  }
                }}
                placeholder="Ask a question across your PDF knowledge base (Enter to send, Shift+Enter for newline)..."
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={!question.trim() || Boolean(streamingRequestId)}
              className="px-4 py-2.5 h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>{streamingRequestId ? 'Streaming' : 'Ask'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Right-Hand Clickable Citation & Source Excerpt Inspector */}
      <aside className="hidden lg:flex w-80 xl:w-96 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex-col">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Source Citation Inspector
            </h2>
          </div>
          {inspectorSources.length > 0 && (
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {inspectorSources.length} retrieved
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {selectedCitation ? (
            <>
              <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-blue-600 dark:text-blue-400 font-semibold">
                      Citation [{selectedCitation.index}]
                    </p>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5 break-words">
                      {selectedCitation.documentTitle}
                    </h3>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span>Page {selectedCitation.pageNumber}</span>
                  <span aria-hidden="true">·</span>
                  <span>Similarity {(selectedCitation.score * 100).toFixed(1)}%</span>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    Indexed Excerpt
                  </p>
                  <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800">
                    {selectedCitation.snippet}
                  </p>
                </div>
              </div>

              {inspectorSources.length > 1 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    All Retrieved Passages
                  </h4>
                  <div className="space-y-2">
                    {inspectorSources.map((src) => {
                      const active =
                        selectedCitation.chunkId === src.chunkId &&
                        selectedCitation.index === src.index;
                      return (
                        <button
                          key={`${src.chunkId}-${src.index}`}
                          type="button"
                          onClick={() => setSelectedCitation(src)}
                          className={`w-full text-left p-3 rounded-lg border transition-colors ${
                            active
                              ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                              [{src.index}] Page {src.pageNumber}
                            </span>
                            <span className="font-mono tabular-nums text-slate-500">
                              {(src.score * 100).toFixed(0)}%
                            </span>
                          </div>
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                            {src.documentTitle}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-12 text-center space-y-2">
              <FileText className="w-7 h-7 text-slate-300 dark:text-slate-700 mx-auto" />
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                No citation selected
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-500 max-w-[220px] mx-auto">
                Click any inline citation marker like [1] in an answer to verify its PDF page and passage.
              </p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
