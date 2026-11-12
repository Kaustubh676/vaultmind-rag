import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { ObservabilityData } from '../types.ts';

const ACTION_FILTERS = [
  { value: 'all', label: 'All Events' },
  { value: 'rag.query', label: 'RAG Queries' },
  { value: 'document.upload', label: 'Uploads' },
  { value: 'document.delete', label: 'Deletions' },
  { value: 'auth.login', label: 'Sign Ins' },
  { value: 'auth.register', label: 'Registrations' },
  { value: 'role.update', label: 'Role Changes' },
];

export function ObservabilityView() {
  const { apiFetch } = useAuth();
  const [data, setData] = useState<ObservabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchObservability = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (actionFilter !== 'all') params.set('action', actionFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await apiFetch<ObservabilityData>(
        `/api/admin/observability?${params.toString()}`
      );
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load observability telemetry.');
    } finally {
      setLoading(false);
    }
  }, [actionFilter, apiFetch, search]);

  useEffect(() => {
    void fetchObservability();
  }, [fetchObservability]);

  const maxLatency = Math.max(
    50,
    ...(data?.latencySeries.map((s) => s.latencyMs) ?? [100])
  );

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Admin Observability &amp; Audit Log
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Real-time usage metrics, API/WebSocket latency percentiles, and workspace security audit trail.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchObservability()}
          disabled={loading}
          className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Telemetry</span>
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

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total RAG Queries
          </p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-white mt-2">
            {data ? data.summary.totalQueries : '—'}
          </p>
          <p className="text-xs font-mono tabular-nums text-slate-500 mt-1">
            {data ? `${data.summary.requests24h} API calls (24h)` : 'Loading'}
          </p>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Indexed Vector Chunks
          </p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-white mt-2">
            {data ? data.summary.totalChunks : '—'}
          </p>
          <p className="text-xs font-mono tabular-nums text-slate-500 mt-1">
            {data ? `${data.summary.totalDocuments} PDF documents` : 'Loading'}
          </p>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Mean / P95 Latency
          </p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-white mt-2">
            {data ? `${data.summary.meanLatencyMs} ms` : '—'}
          </p>
          <p className="text-xs font-mono tabular-nums text-slate-500 mt-1">
            {data ? `P95: ${data.summary.p95LatencyMs} ms · ${data.summary.serverErrors24h} errors` : 'Loading'}
          </p>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Workspace Members &amp; Sockets
          </p>
          <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-white mt-2">
            {data ? data.summary.totalUsers : '—'}
          </p>
          <p className="text-xs font-mono tabular-nums text-slate-500 mt-1">
            {data ? `${data.activeConnections} active WebSocket(s)` : 'Loading'}
          </p>
        </div>
      </div>

      {/* Latency Series & Endpoint Breakdown */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Recent Request Latency (ms)
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              Last {data?.latencySeries.length ?? 0} calls
            </span>
          </div>

          {!data || data.latencySeries.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-xs text-slate-500">
              Latency samples appear as API and RAG queries execute.
            </div>
          ) : (
            <div className="h-44 flex items-end gap-1.5 pt-4 border-b border-slate-200 dark:border-slate-800">
              {data.latencySeries.map((item) => {
                const heightPct = Math.max(6, Math.round((item.latencyMs / maxLatency) * 100));
                const isError = item.statusCode >= 500;
                return (
                  <div
                    key={item.id}
                    className="flex-1 h-full flex flex-col justify-end group relative"
                    title={`${item.label} · ${item.latencyMs} ms (${item.statusCode})`}
                  >
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t transition-opacity group-hover:opacity-80 ${
                        isError
                          ? 'bg-red-500'
                          : 'bg-blue-600 dark:bg-blue-500'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500">
            <span>0 ms</span>
            <span>Peak {maxLatency} ms</span>
          </div>
        </div>

        <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Endpoint Latency Breakdown (24h)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Endpoint</th>
                  <th className="py-2.5 px-4 text-right">Requests</th>
                  <th className="py-2.5 px-4 text-right">Avg (ms)</th>
                  <th className="py-2.5 px-4 text-right">Max (ms)</th>
                  <th className="py-2.5 px-4 text-right">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {!data || data.endpointBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No API requests recorded in the past 24 hours.
                    </td>
                  </tr>
                ) : (
                  data.endpointBreakdown.map((ep) => (
                    <tr key={ep.endpoint} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-slate-800 dark:text-slate-200">
                        {ep.endpoint}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {ep.requests}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-white">
                        {ep.avgLatencyMs}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {ep.maxLatencyMs}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                          ep.errorCount > 0
                            ? 'text-red-600 dark:text-red-400 font-semibold'
                            : 'text-slate-500'
                        }`}
                      >
                        {ep.errorCount}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto max-w-full">
            {ACTION_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setActionFilter(f.value)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  actionFilter === f.value
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actor or resource..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 text-xs font-medium text-slate-500">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Resource</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Context</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {!data || data.auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No audit events match the active filter.
                  </td>
                </tr>
              ) : (
                data.auditLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200 font-medium">
                      {log.actorEmail}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 dark:text-slate-300">
                      {log.action}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">
                      {log.resourceType} #{log.resourceId}
                    </td>
                    <td className="py-2.5 px-4 font-medium">
                      {log.status === 'success' ? (
                        <span className="text-emerald-700 dark:text-emerald-400">Success</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">Failure</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 max-w-xs truncate">
                      {JSON.stringify(log.metadata)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
