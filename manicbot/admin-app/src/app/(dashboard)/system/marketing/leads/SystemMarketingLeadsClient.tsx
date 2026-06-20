"use client";

/**
 * SystemMarketingLeadsClient — Platform-wide marketing contacts (cross-tenant).
 *
 * Reads `api.marketing.contactsList` with search + subscribed-only filter.
 * Sysadmin-only. Contacts created by the landing-page lead form (`tenant_id
 * IS NULL`) sit alongside per-tenant marketing contacts and are surfaced
 * with a `platform` badge.
 *
 * Inline subscribed-toggle uses `api.marketing.contactUpdate` (the same
 * proc the tenant-side marketing module uses, but scoped to adminProcedure).
 */

import { useState } from "react";
import { Users, Search, MailX, ToggleLeft, ToggleRight } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { SystemMarketingShell } from "../SystemMarketingShell";
import { useLang } from "~/components/LangContext";
import { formatDate as i18nFormatDate, type Lang } from "~/lib/i18n";

const PAGE_SIZE = 100;

function fmtDate(ts: number | null | undefined, lang: Lang): string {
  if (!ts) return "—";
  return i18nFormatDate(new Date(ts * 1000), lang);
}

export default function SystemMarketingLeadsClient() {
  const { role } = useRole();
  const { lang } = useLang();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  // Debounce search input by 250ms.
  useDebouncedEffect(() => {
    setDebounced(search.trim());
    setOffset(0);
  }, [search], 250);

  const listQ = api.marketing.contactsList.useQuery(
    {
      limit: PAGE_SIZE,
      offset,
      subscribedOnly,
      search: debounced || undefined,
    },
    { enabled: role === "system_admin" },
  );

  const utils = api.useUtils();
  const updateM = api.marketing.contactUpdate.useMutation({
    onSuccess: () => utils.marketing.contactsList.invalidate(),
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const hasMore = offset + items.length < total;
  const hasPrev = offset > 0;

  return (
    <SystemMarketingShell title="Лиды" subtitle="Все маркетинговые контакты платформы — кросс-тенантный реестр">
      <div className="space-y-4">
        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по email, имени или телефону…"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs placeholder:text-slate-400 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={subscribedOnly}
              onChange={(e) => {
                setSubscribedOnly(e.target.checked);
                setOffset(0);
              }}
              className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-violet-500"
            />
            Только подписанные
          </label>
          <span className="ml-auto text-[11px] text-slate-500">
            {listQ.isLoading ? "загрузка…" : `${total.toLocaleString()} всего`}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
          {listQ.isLoading && items.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-slate-100 dark:bg-slate-800/40" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Users className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-700" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {debounced || subscribedOnly
                  ? "Под выбранные фильтры лидов нет."
                  : "На платформе пока нет маркетинговых контактов."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-left dark:border-white/5">
                    <th className="px-4 py-2 font-medium text-slate-500">Email</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Имя</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Телефон</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Тенант</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Источник</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Подписан</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Последний контакт</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {items.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {row.email ?? <span className="italic text-slate-400">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                        {row.name ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                        {row.phone ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px]">
                        {row.tenantId ? (
                          <span className="text-slate-500">{row.tenantId}</span>
                        ) : (
                          <span className="italic text-amber-500">platform</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-500">{row.source ?? "—"}</td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          disabled={updateM.isPending}
                          onClick={() =>
                            updateM.mutate({
                              id: row.id,
                              unsubscribed: row.unsubscribed === 0,
                            })
                          }
                          className="inline-flex items-center gap-1 text-[11px] disabled:opacity-50"
                          title={row.unsubscribed === 0 ? "Снять подписку" : "Вернуть подписку"}
                        >
                          {row.unsubscribed === 0 ? (
                            <>
                              <ToggleRight className="h-4 w-4 text-emerald-500" />
                              <span className="text-emerald-600 dark:text-emerald-400">да</span>
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="h-4 w-4 text-slate-400" />
                              <span className="text-slate-500">нет</span>
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-slate-500">{fmtDate(row.lastSeenAt, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div>
            {total > 0 && (
              <>
                {(offset + 1).toLocaleString()}–{Math.min(offset + items.length, total).toLocaleString()} из {total.toLocaleString()}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!hasPrev || listQ.isFetching}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
            >
              ← Назад
            </button>
            <button
              type="button"
              disabled={!hasMore || listQ.isFetching}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
            >
              Вперёд →
            </button>
          </div>
        </div>
      </div>
    </SystemMarketingShell>
  );
}

// Suppress unused-icon import warning.
export const _icons = { MailX };

/** Tiny debounce hook to avoid pulling in another lib. */
import { useEffect } from "react";
function useDebouncedEffect(fn: () => void, deps: unknown[], delay: number) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
