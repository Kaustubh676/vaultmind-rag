import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { User, UserRole } from '../types.ts';

export function TeamView() {
  const { user: currentUser, apiFetch } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiFetch<{ users: User[] }>('/api/admin/users');
      setMembers(data.users);
    } catch (err: any) {
      setError(err?.message || 'Failed to load team directory.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const handleRoleChange = async (memberId: number, role: UserRole) => {
    setError(null);
    setUpdatingId(memberId);
    try {
      const res = await apiFetch<{ user: User }>(`/api/admin/users/${memberId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMembers((prev) => prev.map((m) => (m.id === memberId ? res.user : m)));
    } catch (err: any) {
      setError(err?.message || 'Failed to update user role.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Team &amp; Role Access Control
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage workspace members and assign Administrator or Member permissions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadMembers()}
          disabled={loading}
          className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            <div className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            <div className="h-10 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
          </div>
        ) : members.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No workspace members found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4">Auth Provider</th>
                  <th className="py-3 px-4">Joined</th>
                  <th className="py-3 px-4">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                {members.map((m) => {
                  const isSelf = m.id === currentUser?.id;
                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-700 dark:text-slate-300 shrink-0">
                            {m.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">
                              {m.name} {isSelf && <span className="text-xs text-slate-400">(You)</span>}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {m.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400 capitalize">
                        {m.authProvider}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono tabular-nums text-slate-500">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="inline-flex items-center gap-2">
                          <Shield
                            className={`w-3.5 h-3.5 ${
                              m.role === 'admin'
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-slate-400'
                            }`}
                          />
                          <select
                            aria-label={`Role for ${m.name}`}
                            disabled={isSelf || updatingId === m.id}
                            value={m.role}
                            onChange={(e) =>
                              void handleRoleChange(m.id, e.target.value as UserRole)
                            }
                            className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 disabled:opacity-50"
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
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
    </div>
  );
}
