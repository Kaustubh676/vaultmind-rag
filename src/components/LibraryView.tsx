import React, { useMemo, useState } from 'react';
import {
  Eye,
  FileText,
  FolderPlus,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { Collection, DocumentChunkPreview, DocumentItem } from '../types.ts';

interface LibraryViewProps {
  collections: Collection[];
  documents: DocumentItem[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenUpload: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function LibraryView({
  collections,
  documents,
  loading,
  onRefresh,
  onOpenUpload,
}: LibraryViewProps) {
  const { user, apiFetch } = useAuth();

  const [selectedCollectionId, setSelectedCollectionId] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [collectionDesc, setCollectionDesc] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inspectingDoc, setInspectingDoc] = useState<DocumentItem | null>(null);
  const [chunks, setChunks] = useState<DocumentChunkPreview[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (selectedCollectionId !== 'all' && doc.collectionId !== selectedCollectionId) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          doc.title.toLowerCase().includes(q) ||
          doc.fileName.toLowerCase().includes(q) ||
          doc.collectionName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [documents, searchQuery, selectedCollectionId]);

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreatingCollection(true);
    try {
      await apiFetch('/api/collections', {
        method: 'POST',
        body: JSON.stringify({ name: collectionName, description: collectionDesc }),
      });
      setCollectionName('');
      setCollectionDesc('');
      setShowNewCollection(false);
      await onRefresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to create collection.');
    } finally {
      setCreatingCollection(false);
    }
  };

  const handleInspect = async (doc: DocumentItem) => {
    setInspectingDoc(doc);
    setLoadingChunks(true);
    try {
      const data = await apiFetch<{ chunks: DocumentChunkPreview[] }>(
        `/api/documents/${doc.id}/chunks`
      );
      setChunks(data.chunks);
    } catch (err: any) {
      setError(err?.message || 'Failed to load indexed chunks.');
    } finally {
      setLoadingChunks(false);
    }
  };

  const handleDelete = async (doc: DocumentItem) => {
    setError(null);
    try {
      await apiFetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      if (inspectingDoc?.id === doc.id) {
        setInspectingDoc(null);
      }
      await onRefresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete document.');
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Document Library
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Shared organizational PDF collections indexed into PostgreSQL with pgvector.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowNewCollection(true)}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <FolderPlus className="w-4 h-4" />
            <span>New Collection</span>
          </button>
          <button
            type="button"
            onClick={onOpenUpload}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span>Upload PDF</span>
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300 flex items-center justify-between"
        >
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setSelectedCollectionId('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedCollectionId === 'all'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            All ({documents.length})
          </button>
          {collections.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => setSelectedCollectionId(col.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                selectedCollectionId === col.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {col.name} ({col.documentCount})
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter documents..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
          />
        </div>
      </div>

      {/* Data Grid */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            <div className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            <div className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-3">
            <FileText className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              No PDFs in this view
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              Upload a PDF document to automatically extract pages, generate vector embeddings, and make it searchable.
            </p>
            <button
              type="button"
              onClick={onOpenUpload}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Upload PDF</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4">Document</th>
                  <th className="py-3 px-4">Collection</th>
                  <th className="py-3 px-4">Index Stats</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Uploaded By</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {filteredDocuments.map((doc) => {
                  const canDelete = user?.role === 'admin' || doc.uploadedBy === user?.id;
                  return (
                    <tr
                      key={doc.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900 dark:text-white">
                          {doc.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                          {doc.fileName}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700 dark:text-slate-300">
                        {doc.collectionName}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {doc.pageCount} pages · {doc.chunkCount} chunks · {formatBytes(doc.fileSize)}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium">
                        {doc.status === 'ready' && (
                          <span className="text-emerald-700 dark:text-emerald-400">Ready</span>
                        )}
                        {doc.status === 'processing' && (
                          <span className="text-amber-600 dark:text-amber-400">Indexing...</span>
                        )}
                        {doc.status === 'failed' && (
                          <div className="space-y-0.5 max-w-[220px]">
                            <span className="text-red-600 dark:text-red-400">Failed</span>
                            {doc.errorMessage && (
                              <p className="text-[11px] font-normal text-red-600/90 dark:text-red-400/90 leading-snug">
                                {doc.errorMessage}
                              </p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                        <p>{doc.uploaderName || 'Member'}</p>
                        <p className="text-[11px] font-mono tabular-nums text-slate-400">
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={doc.status !== 'ready'}
                            onClick={() => void handleInspect(doc)}
                            className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Chunks</span>
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => void handleDelete(doc)}
                              aria-label={`Delete ${doc.title}`}
                              className="p-1.5 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Collection Modal */}
      {showNewCollection && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Create Shared Collection
              </h2>
              <button
                type="button"
                onClick={() => setShowNewCollection(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCollection} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Collection Name
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  placeholder="Engineering Architecture"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={collectionDesc}
                  onChange={(e) => setCollectionDesc(e.target.value)}
                  placeholder="RFCs, architecture specs, and runbooks."
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30 resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewCollection(false)}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingCollection}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                >
                  {creatingCollection ? 'Creating...' : 'Create Collection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Chunk Inspector Modal */}
      {inspectingDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-end">
          <div className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white truncate">
                  {inspectingDoc.title}
                </h2>
                <p className="text-xs font-mono tabular-nums text-slate-500 mt-0.5">
                  {inspectingDoc.pageCount} pages · {inspectingDoc.chunkCount} embedded chunks
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingDoc(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {loadingChunks ? (
                <div className="space-y-3">
                  <div className="h-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
                  <div className="h-24 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
                </div>
              ) : (
                chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-500">
                      <span>Chunk #{chunk.chunkIndex + 1}</span>
                      <span>Page {chunk.pageNumber}</span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {chunk.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
