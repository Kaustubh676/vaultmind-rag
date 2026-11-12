import React, { useEffect, useState } from 'react';
import { FileUp, FolderPlus, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { Collection } from '../types.ts';

interface UploadModalProps {
  open: boolean;
  collections: Collection[];
  onClose: () => void;
  onUploaded: (documentTitle: string) => Promise<void>;
  onCollectionCreated: () => Promise<void>;
}

export function UploadModal({
  open,
  collections,
  onClose,
  onUploaded,
  onCollectionCreated,
}: UploadModalProps) {
  const { apiFetch } = useAuth();
  const [collectionId, setCollectionId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [savingCollection, setSavingCollection] = useState(false);

  useEffect(() => {
    if (open && collections.length > 0 && !collectionId) {
      setCollectionId(String(collections[0].id));
    }
  }, [collectionId, collections, open]);

  if (!open) return null;

  const handleCreateCollection = async () => {
    const trimmed = newCollectionName.trim();
    if (trimmed.length < 2) {
      setError('Collection name must be at least 2 characters.');
      return;
    }
    setError(null);
    setSavingCollection(true);
    try {
      const res = await apiFetch<{ collection: { id: number } }>('/api/collections', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed, description: '' }),
      });
      await onCollectionCreated();
      setCollectionId(String(res.collection.id));
      setNewCollectionName('');
      setCreatingCollection(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to create collection.');
    } finally {
      setSavingCollection(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (
      dropped.type === 'application/pdf' ||
      dropped.name.toLowerCase().endsWith('.pdf')
    ) {
      setFile(dropped);
      setError(null);
    } else {
      setError('Only PDF files are supported.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a PDF file to upload.');
      return;
    }
    if (!collectionId) {
      setError('Please select a target collection.');
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('collectionId', collectionId);
      const displayTitle =
        title.trim() || file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
      if (title.trim()) {
        formData.append('title', title.trim());
      }

      await apiFetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      setFile(null);
      setTitle('');
      onClose();
      await onUploaded(displayTitle || file.name);
    } catch (err: any) {
      setError(err?.message || 'PDF upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Upload &amp; Auto-Index PDF
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Text and scanned PDFs are extracted, chunked, and embedded into pgvector.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="upload-collection"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Target Collection
              </label>
              <button
                type="button"
                onClick={() => setCreatingCollection((prev) => !prev)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>{creatingCollection ? 'Cancel' : 'New Collection'}</span>
              </button>
            </div>

            {creatingCollection ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="e.g. Marketing Analytics"
                  className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                />
                <button
                  type="button"
                  disabled={savingCollection}
                  onClick={() => void handleCreateCollection()}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  {savingCollection ? 'Adding...' : 'Add'}
                </button>
              </div>
            ) : (
              <select
                id="upload-collection"
                required
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30"
              >
                {collections.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label
              htmlFor="upload-title"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Document Title (Optional)
            </label>
            <input
              id="upload-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to PDF filename"
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/30"
            />
          </div>

          <div>
            <label
              htmlFor="upload-file"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              PDF File (Max 20 MB)
            </label>
            <label
              htmlFor="upload-file"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center p-6 rounded-xl border border-dashed cursor-pointer transition-colors text-center ${
                dragging
                  ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/60 hover:border-blue-500'
              }`}
            >
              <FileUp className="w-6 h-6 text-slate-400 mb-2" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
                {file ? file.name : 'Drop a PDF here or click to browse'}
              </span>
              {file && (
                <span className="text-[11px] font-mono tabular-nums text-slate-500 mt-1">
                  {(file.size / 1024).toFixed(1)} KB
                </span>
              )}
              <input
                id="upload-file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="sr-only"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !file}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : 'Upload & Index'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
