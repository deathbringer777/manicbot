"use client";

/**
 * SystemEventsClient — sysadmin event-stream inspector (Blocker 5).
 *
 * Reads the `analytics_events` table via the `analyticsEvents` tRPC
 * router (adminProcedure). Two cards on top show 24h / 7d counts per
 * canonical event slug; the bottom table is paginated raw events with
 * filters for event name, tenantId, userId, free-text in properties.
 *
 * Gate: `role === "system_admin"` AND no `previewRole` — same defensive
 * pattern as /system/customers. The (dashboard) layout already
 * intercepts non-sysadmin URLs, but the in-page check is the second
 * line of defence in case the layout invariant ever drifts.
 */

import { useState } from "react";
import { Activity, Filter, Search, TrendingUp, ArrowLeftCircle, ArrowRightCircle } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { Shell } from "~/components/layout/Shell";

const PAGE_SIZE = 50;

export default function SystemEventsClient() {
  const { role, previewRole } = useRole();
  const [eventFilter, setEventFilter] = useState<string>("");
  const [tenantFilter, setTenantFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");
  const [propSearch, setPropSearch] = useState<string>("");
  const [page, setPage] = useState(1);

  const guardOk = role === "system_admin" && !previewRole;

  const statsQuery = api.analyticsEvents.stats.useQuery(undefined, { enabled: guardOk });
  const distinctQuery = api.analyticsEvents.distinctEvents.useQuery(undefined, { enabled: guardOk });
  const listQuery = api.analyticsEvents.list.useQuery(
    {
      events: eventFilter ? [eventFilter] : undefined,
      tenantId: tenantFilter || undefined,
      userId: userFilter || undefined,
      searchProperties: propSearch || undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    { enabled: guardOk },
  );

  if (!guardOk) {
    return (
      <Shell>
        <div className="px-4 py-10 text-sm text-slate-500">
          Access denied — this page is only available to platform administrators.
        </div>
      </Shell>
    );
  }

  const totalPages = listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <Shell>
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-600 ring-1 ring-amber-500/30">
                PLATFORM
              </span>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Analytics Events</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Raw event stream from <code className="font-mono text-xs">analytics_events</code>. Cross-tenant by design.
            </p>
          </div>
        </div>

        {/* Stats per canonical slug */}
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <TrendingUp className="h-4 w-4" />
            Last 24h / 7d
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(statsQuery.data ?? []).map((row) => (
              <button
                key={row.event}
                onClick={() => { setEventFilter(row.event); setPage(1); }}
                className="rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                <div className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">{row.event}</div>
                <div className="mt-1 text-sm">
                  <span className="text-lg font-bold text-slate-900 dark:text-slate-100">{row.day}</span>
                  <span className="ml-1 text-xs text-slate-500">/ {row.week}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Filters */}
        <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <Filter className="h-4 w-4" /> Filters
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Event</span>
              <select
                value={eventFilter}
                onChange={(e) => { setEventFilter(e.target.value); setPage(1); }}
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="">— all —</option>
                {(distinctQuery.data ?? []).map((slug) => (
                  <option key={slug} value={slug}>{slug}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Tenant ID</span>
              <input
                value={tenantFilter}
                onChange={(e) => { setTenantFilter(e.target.value); setPage(1); }}
                placeholder="t_xxxx"
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">User ID</span>
              <input
                value={userFilter}
                onChange={(e) => { setUserFilter(e.target.value); setPage(1); }}
                placeholder="u_xxxx or chat_id"
                className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">Search in properties (JSON)</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={propSearch}
                  onChange={(e) => { setPropSearch(e.target.value); setPage(1); }}
                  placeholder='e.g. "via_google":true'
                  className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 pl-9 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </label>
          </div>
        </section>

        {/* Table */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Properties</th>
              </tr>
            </thead>
            <tbody>
              {(listQuery.data?.rows ?? []).map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top hover:bg-slate-50/50 dark:border-slate-800 dark:hover:bg-slate-950/50">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                    {new Date(row.createdAt * 1000).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">{row.event}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.tenantId ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.userId ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400 break-all">{row.properties}</td>
                </tr>
              ))}
              {listQuery.isLoading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {!listQuery.isLoading && (listQuery.data?.rows ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">No events match these filters.</td></tr>
              )}
            </tbody>
          </table>
          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" />
              {listQuery.data ? `${listQuery.data.total.toLocaleString()} events total` : "—"}
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                <ArrowLeftCircle className="h-4 w-4" />
              </button>
              <span>Page {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                <ArrowRightCircle className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}
