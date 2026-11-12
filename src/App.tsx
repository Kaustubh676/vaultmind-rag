import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  BookOpen,
  FolderOpen,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Sun,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { AskView } from './components/AskView.tsx';
import { LibraryView } from './components/LibraryView.tsx';
import { ObservabilityView } from './components/ObservabilityView.tsx';
import { TeamView } from './components/TeamView.tsx';
import { NotificationDrawer } from './components/NotificationDrawer.tsx';
import { UploadModal } from './components/UploadModal.tsx';
import type { Collection, DocumentItem, NotificationItem } from './types.ts';

type WorkspaceTab = 'ask' | 'library' | 'observability' | 'team';

function WorkspaceShell() {
  const { user, loading, logout, apiFetch, subscribeWs } = useAuth();

  const [darkMode, setDarkMode] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('ask');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const loadWorkspaceData = useCallback(async () => {
    if (!user) return;
    try {
      setLoadingWorkspace(true);
      const [colsRes, docsRes, notifRes] = await Promise.all([
        apiFetch<{ collections: Collection[] }>('/api/collections'),
        apiFetch<{ documents: DocumentItem[] }>('/api/documents'),
        apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),
      ]);
      setCollections(colsRes.collections);
      setDocuments(docsRes.documents);
      setNotifications(notifRes.notifications);
    } catch (err) {
      console.error('Failed to hydrate workspace data:', err);
    } finally {
      setLoadingWorkspace(false);
    }
  }, [apiFetch, user]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Real-time WebSocket event synchronization
  useEffect(() => {
    if (!user) return;
    return subscribeWs((msg) => {
      if (msg.event === 'notification:new') {
        setNotifications((prev) => {
          if (prev.some((n) => n.id === msg.data.id)) return prev;
          return [msg.data, ...prev];
        });
      } else if (
        msg.event === 'document:status' ||
        msg.event === 'document:deleted' ||
        msg.event === 'collection:created'
      ) {
        void loadWorkspaceData();
      } else if (msg.event === 'member:role_updated' && msg.data?.userId === user.id) {
        window.location.reload();
      }
    });
  }, [loadWorkspaceData, subscribeWs, user]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const handleMarkAllRead = async () => {
    await apiFetch('/api/notifications/read', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
          Initializing Verity Vault...
        </p>
      </div>
    );
  }

  if (!user) {
    return <AuthGate darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />;
  }

  const navItems: Array<{
    id: WorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    adminOnly?: boolean;
  }> = [
    { id: 'ask', label: 'Ask Knowledge Base', icon: MessageSquare },
    { id: 'library', label: 'Document Library', icon: FolderOpen },
    { id: 'observability', label: 'Observability & Audit', icon: Activity, adminOnly: true },
    { id: 'team', label: 'Team & Roles', icon: Users, adminOnly: true },
  ];

  const visibleNav = navItems.filter((item) => !item.adminOnly || user.role === 'admin');
  const activeLabel = visibleNav.find((n) => n.id === activeTab)?.label ?? 'Workspace';

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* 260px Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[260px] shrink-0 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            <BookOpen className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="font-display text-base font-bold tracking-tight">
              Verity Vault
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-blue-600 dark:text-blue-400' : ''
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {user.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                {user.name}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {user.role === 'admin' ? 'Administrator' : 'Member'} · {user.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="flex-1 py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{darkMode ? 'Light' : 'Dark'}</span>
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="py-1.5 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 hover:text-red-600 dark:hover:text-red-400 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Breadcrumb Bar */}
        <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline">Workspace</span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <span className="font-display font-semibold text-slate-900 dark:text-white truncate">
                {activeLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              aria-label="Open notifications"
              className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-mono font-semibold tabular-nums flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload PDF</span>
            </button>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto">
          {uploadNotice && (
            <div className="mx-6 mt-4 p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/40 text-xs text-blue-800 dark:text-blue-200 flex items-center justify-between gap-3">
              <span>{uploadNotice}</span>
              <button
                type="button"
                onClick={() => setUploadNotice(null)}
                className="text-blue-600 dark:text-blue-400 hover:opacity-75"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {activeTab === 'ask' && (
            <AskView
              collections={collections}
              documents={documents}
              onOpenUpload={() => setUploadOpen(true)}
            />
          )}
          {activeTab === 'library' && (
            <LibraryView
              collections={collections}
              documents={documents}
              loading={loadingWorkspace}
              onRefresh={loadWorkspaceData}
              onOpenUpload={() => setUploadOpen(true)}
            />
          )}
          {activeTab === 'observability' && user.role === 'admin' && <ObservabilityView />}
          {activeTab === 'team' && user.role === 'admin' && <TeamView />}
        </main>
      </div>

      <UploadModal
        open={uploadOpen}
        collections={collections}
        onClose={() => setUploadOpen(false)}
        onCollectionCreated={loadWorkspaceData}
        onUploaded={async (docTitle) => {
          setActiveTab('library');
          setUploadNotice(`"${docTitle}" uploaded — extracting pages and generating pgvector embeddings.`);
          await loadWorkspaceData();
        }}
      />

      <NotificationDrawer
        open={notificationsOpen}
        notifications={notifications}
        onClose={() => setNotificationsOpen(false)}
        onMarkAllRead={handleMarkAllRead}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceShell />
    </AuthProvider>
  );
}
