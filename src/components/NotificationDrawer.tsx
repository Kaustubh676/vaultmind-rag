import React from 'react';
import { CheckCheck, X } from 'lucide-react';
import type { NotificationItem } from '../types.ts';

interface NotificationDrawerProps {
  open: boolean;
  notifications: NotificationItem[];
  onClose: () => void;
  onMarkAllRead: () => Promise<void>;
}

export function NotificationDrawer({
  open,
  notifications,
  onClose,
  onMarkAllRead,
}: NotificationDrawerProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/30 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-sm h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Live Team Notifications
          </h2>
          <div className="flex items-center gap-2">
            {notifications.some((n) => !n.isRead) && (
              <button
                type="button"
                onClick={() => void onMarkAllRead()}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark read</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {notifications.length === 0 ? (
            <div className="py-12 px-6 text-center text-xs text-slate-500 dark:text-slate-400">
              Real-time events appear here when teammates upload PDFs, create collections, or update roles.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`p-4 space-y-1 ${
                  !n.isRead ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    {n.title}
                  </p>
                  {!n.isRead && (
                    <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                      New
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {n.message}
                </p>
                <p className="text-[11px] font-mono tabular-nums text-slate-400">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
