"use client";

/**
 * SystemCustomersClient — Sysadmin Platform Customers page.
 *
 * Two tabs:
 *   - «Аккаунты салонов»    — JOIN web_users (role='tenant_owner') + tenants
 *   - «Подписчики рассылки» — newsletter_subscribers OR email_subscribers
 *
 * Pattern lifted from SystemMarketingClient: amber PLATFORM badge,
 * useRole sysadmin gate, api.platformCustomers.* (adminProcedure).
 *
 * Defensive layering:
 *   - Layout intercepts non-sysadmin URLs with the role dashboard.
 *   - This page still gates on `role === "system_admin"` so a direct hit
 *     under a tenant-role preview shows a clean placeholder, not data.
 */

import { useEffect, useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Users, Mail, Activity, TrendingUp, Search, Building2,
  CheckCircle2, XCircle, ExternalLink, Filter, ArrowLeftCircle, ArrowRightCircle,
  type LucideIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { Shell } from "~/components/layout/Shell";
import { PlatformCustomerDetailModal } from "~/components/system/PlatformCustomerDetailModal";

// ─── constants ────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const PLAN_OPTIONS: Array<{ value: "start" | "pro" | "max"; label: string }> = [
  { value: "start", label: "Start" },
  { value: "pro", label: "Pro" },
  { value: "max", label: "Max" },
];

type StatusFilter =
  | "trialing"
  | "active"
  | "grace"
  | "past_due"
  | "expired"
  | "cancelled";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "trialing", label: "Триал" },
  { value: "active", label: "Активен" },
  { value: "grace", label: "Грейс" },
  { value: "past_due", label: "Просрочка" },
  { value: "expired", label: "Истёк" },
  { value: "cancelled", label: "Отменён" },
];

// ─── helpers ──────────────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

function fmtRel(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 0) {
    const future = -diff;
    if (future < 86400) return `через ${Math.round(future / 3600)} ч`;
    return `через ${Math.round(future / 86400)} дн`;
  }
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.round(diff / 60)} мин`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ч`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} дн`;
  return new Date(ts * 1000).toLocaleDateString();
}

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString();
}

function statusTone(status: string | null | undefined): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-emerald-500/20";
    case "grace":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-amber-500/20";
    case "trialing":
    case "trial":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-300 ring-blue-500/20";
    case "past_due":
      return "bg-orange-500/10 text-orange-600 dark:text-orange-300 ring-orange-500/20";
    case "expired":
    case "cancelled":
    case "canceled":
      return "bg-red-500/10 text-red-600 dark:text-red-300 ring-red-500/20";
    default:
      return "bg-slate-500/10 text-slate-500 ring-slate-500/20";
  }
}

// ─── KPI card primitive (matches SystemMarketingClient) ───────────────

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  loading?: boolean;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-500 dark:text-emerald-400"
      : tone === "warn"
      ? "text-amber-500 dark:text-amber-400"
      : tone === "bad"
      ? "text-red-500 dark:text-red-400"
      : "text-slate-900 dark:text-white";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {loading ? (
        <div className="h-7 animate-pulse rounded bg-slate-200 dark:bg-slate-800/40" />
      ) : (
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      )}
      {hint && !loading && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  );
}

// ─── Multi-select checkbox dropdown (brand-styled, modal-friendly) ────

function MultiCheckFilter<V extends string>({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: Array<{ value: V; label: string }>;
  values: V[];
  onChange: (v: V[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    values.length === 0
      ? "Все"
      : values.length === 1
      ? options.find((o) => o.value === values[0])?.label ?? "1"
      : `${values.length} выбрано`;

  // Close on outside click — minimal handler, no portal needed.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-multi-filter="${label}"]`)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, label]);

  return (
    <div className="relative" data-multi-filter={label}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        <Filter className="h-3 w-3" />
        <span>{label}:</span>
        <span className="font-semibold">{summary}</span>
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {options.map((opt) => {
            const checked = values.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    if (checked) onChange(values.filter((v) => v !== opt.value));
                    else onChange([...values, opt.value]);
                  }}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-violet-500"
                />
                <span className="text-slate-700 dark:text-slate-200">{opt.label}</span>
              </label>
            );
          })}
          {values.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-left text-[11px] text-violet-500 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Сбросить
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────

export default function SystemCustomersClient() {
  const { role, previewRole } = useRole();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get("tab");
  const activeTab: "accounts" | "subscribers" =
    tabParam === "subscribers" ? "subscribers" : "accounts";

  const switchTab = useCallback(
    (next: "accounts" | "subscribers") => {
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      sp.set("tab", next);
      router.replace(`${pathname}?${sp.toString()}`);
    },
    [pathname, router, searchParams],
  );

  // Defensive gate — sysadmin only, AND no active tenant-role preview.
  // A sysadmin who has activated a tenant_owner preview must see the
  // placeholder so that previewed-tenant data never bleeds across.
  if (role !== "system_admin" || previewRole) {
    return (
      <Shell title="Клиенты платформы" subtitle="Платформа">
        <div
          className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-700 dark:text-red-300"
          data-testid="customers-page-forbidden"
        >
          Эта страница доступна только системному администратору.
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Клиенты платформы" subtitle="Аккаунты салонов · Подписчики рассылки">
      <div className="space-y-5">
        {/* Hero strap — visually distinct from tenant surfaces. */}
        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-transparent to-violet-500/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Клиенты ManicBot
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Зарегистрированные владельцы салонов, их тарифы и платёжный статус, плюс
                подписчики email-рассылки. Только чтение — действия с подпиской через Stripe.
              </p>
            </div>
          </div>
        </div>

        {/* Stats row — always rendered (covers both tabs). */}
        <StatsRow />

        {/* Sub-nav */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Platform
          </span>
          <div className="ml-1 flex flex-wrap gap-1.5">
            <TabLink
              label="Аккаунты салонов"
              icon={Building2}
              active={activeTab === "accounts"}
              onClick={() => switchTab("accounts")}
              testId="customers-tab-accounts"
            />
            <TabLink
              label="Подписчики рассылки"
              icon={Mail}
              active={activeTab === "subscribers"}
              onClick={() => switchTab("subscribers")}
              testId="customers-tab-subscribers"
            />
          </div>
        </div>

        {activeTab === "accounts" ? <AccountsTab /> : <SubscribersTab />}
      </div>
    </Shell>
  );
}

// ─── stats row ────────────────────────────────────────────────────────

function StatsRow() {
  const statsQ = api.platformCustomers.stats.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const s = statsQ.data;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <StatCard
        icon={Users}
        label="Всего аккаунтов"
        value={(s?.total_accounts ?? 0).toLocaleString()}
        loading={statsQ.isLoading}
      />
      <StatCard
        icon={CheckCircle2}
        label="Платят"
        value={(s?.paying ?? 0).toLocaleString()}
        tone="good"
        loading={statsQ.isLoading}
      />
      <StatCard
        icon={Activity}
        label="На триале"
        value={(s?.trialing ?? 0).toLocaleString()}
        loading={statsQ.isLoading}
      />
      <StatCard
        icon={XCircle}
        label="Churned"
        value={(s?.churned ?? 0).toLocaleString()}
        tone={(s?.churned ?? 0) > 0 ? "warn" : "neutral"}
        loading={statsQ.isLoading}
      />
      <StatCard
        icon={TrendingUp}
        label="MRR"
        value={`${(s?.mrr_total_pln ?? 0).toLocaleString()} PLN`}
        tone="good"
        loading={statsQ.isLoading}
      />
      <StatCard
        icon={Mail}
        label="Подписчики"
        value={(s?.newsletter_subs ?? 0).toLocaleString()}
        loading={statsQ.isLoading}
      />
    </div>
  );
}

function TabLink({
  label,
  icon: Icon,
  active,
  onClick,
  testId,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "border border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300"
          : "border border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ─── Accounts tab ─────────────────────────────────────────────────────

function AccountsTab() {
  const [plans, setPlans] = useState<("start" | "pro" | "max")[]>([]);
  const [statuses, setStatuses] = useState<StatusFilter[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [activeWebUserId, setActiveWebUserId] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search, 250);

  // Reset page when filters change.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, plans.length, statuses.length]);

  const listQ = api.platformCustomers.listAccounts.useQuery({
    page,
    pageSize: PAGE_SIZE,
    filters: {
      plans: plans.length ? plans : undefined,
      statuses: statuses.length ? statuses : undefined,
      search: debouncedSearch.trim() || undefined,
    },
  });

  const rows = listQ.data?.rows ?? [];
  const total = listQ.data?.total ?? 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Filters strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по email или имени…"
            className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs placeholder:text-slate-400 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
        </div>
        <MultiCheckFilter
          label="План"
          options={PLAN_OPTIONS}
          values={plans}
          onChange={setPlans}
        />
        <MultiCheckFilter
          label="Статус"
          options={STATUS_OPTIONS}
          values={statuses}
          onChange={setStatuses}
        />
        <span className="ml-auto text-[11px] text-slate-500">
          {listQ.isLoading ? "загрузка…" : `${total.toLocaleString()} всего`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        {listQ.isLoading && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800/40" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Building2 className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-700" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Под выбранные фильтры аккаунтов нет.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left dark:border-white/5">
                  <th className="px-4 py-2 font-medium text-slate-500">Имя</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Email</th>
                  <th className="px-4 py-2 font-medium text-slate-500">План</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Статус</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Триал до</th>
                  <th className="px-4 py-2 font-medium text-slate-500">MRR</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Регистрация</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Последний вход</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Мастеров</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Записей 30д</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map((r) => (
                  <tr
                    key={r.webUserId}
                    onClick={() => setActiveWebUserId(r.webUserId)}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {r.name ?? <span className="italic text-slate-400">—</span>}
                      </div>
                      {r.isTest === 1 && (
                        <span className="mt-0.5 inline-block rounded bg-yellow-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-yellow-700 dark:text-yellow-300">
                          TEST
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{r.email}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-200">
                      {r.plan ?? <span className="italic text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      {r.billingStatus ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${statusTone(r.billingStatus)}`}
                        >
                          {r.billingStatus}
                        </span>
                      ) : (
                        <span className="italic text-slate-400">нет тенанта</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{fmtRel(r.trialEndsAt)}</td>
                    <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                      {r.mrrPln > 0 ? `${r.mrrPln} PLN` : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{fmtRel(r.createdAt)}</td>
                    <td className="px-4 py-2 text-slate-500">{fmtRel(r.lastLoginAt)}</td>
                    <td className="px-4 py-2 text-center text-slate-700 dark:text-slate-200">
                      {r.mastersCount}
                    </td>
                    <td className="px-4 py-2 text-center text-slate-700 dark:text-slate-200">
                      {r.appointments30d}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div>
            {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} из {total.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0 || listQ.isFetching}
              onClick={() => setPage(Math.max(0, page - 1))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
            >
              <ArrowLeftCircle className="h-3.5 w-3.5" /> Назад
            </button>
            <button
              type="button"
              disabled={!hasNext || listQ.isFetching}
              onClick={() => setPage(page + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
            >
              Вперёд <ArrowRightCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {activeWebUserId && (
        <PlatformCustomerDetailModal
          webUserId={activeWebUserId}
          onClose={() => setActiveWebUserId(null)}
        />
      )}
    </div>
  );
}

// ─── Subscribers tab ──────────────────────────────────────────────────

function SubscribersTab() {
  const [source, setSource] = useState("");
  const [lang, setLang] = useState("");
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [source, lang, confirmedOnly]);

  const listQ = api.platformCustomers.listSubscribers.useQuery({
    page,
    pageSize: PAGE_SIZE,
    filters: {
      source: source || undefined,
      lang: lang || undefined,
      confirmedOnly: confirmedOnly || undefined,
    },
  });

  const data = listQ.data;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const tableMissing = data?.tableMissing ?? false;
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  // Derive unique source / lang lists from the visible page so the
  // filter dropdowns stay useful without a separate facets endpoint.
  const sourceChoices = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.source) set.add(r.source);
    return Array.from(set).sort();
  }, [rows]);
  const langChoices = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.lang) set.add(r.lang);
    return Array.from(set).sort();
  }, [rows]);

  if (tableMissing) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-300">
        <p className="font-semibold">Таблица ещё не создана.</p>
        <p className="mt-1 text-xs">
          Миграция таблицы подписчиков рассылки в работе. Подождите и обновите страницу.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
        <SmallSelect
          value={source}
          onChange={setSource}
          placeholder="Все источники"
          options={sourceChoices.map((s) => ({ value: s, label: s }))}
          testId="subs-filter-source"
        />
        <SmallSelect
          value={lang}
          onChange={setLang}
          placeholder="Все языки"
          options={langChoices.map((l) => ({ value: l, label: l.toUpperCase() }))}
          testId="subs-filter-lang"
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={confirmedOnly}
            onChange={(e) => setConfirmedOnly(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-violet-500"
          />
          Только подтверждённые
        </label>
        <span className="ml-auto text-[11px] text-slate-500">
          {listQ.isLoading
            ? "загрузка…"
            : `${total.toLocaleString()} всего${data?.table ? ` · из ${data.table}` : ""}`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        {listQ.isLoading && rows.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-slate-100 dark:bg-slate-800/40" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Mail className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-700" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Подписчиков пока нет.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left dark:border-white/5">
                  <th className="px-4 py-2 font-medium text-slate-500">Email</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Источник</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Язык</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Подтверждён</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Отписан</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Создан</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map((r) => (
                  <tr key={`${r.email}-${r.createdAt}`} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-slate-900 dark:text-slate-100">{r.email}</td>
                    <td className="px-4 py-2 text-slate-500">{r.source ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-500">{r.lang ?? "—"}</td>
                    <td className="px-4 py-2">
                      {r.confirmed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> да
                        </span>
                      ) : (
                        <span className="text-slate-400">нет</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {r.unsubscribed ? (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                          <XCircle className="h-3 w-3" /> да
                        </span>
                      ) : (
                        <span className="text-slate-400">нет</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div>
            {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} из {total.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0 || listQ.isFetching}
              onClick={() => setPage(Math.max(0, page - 1))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
            >
              <ArrowLeftCircle className="h-3.5 w-3.5" /> Назад
            </button>
            <button
              type="button"
              disabled={!hasNext || listQ.isFetching}
              onClick={() => setPage(page + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
            >
              Вперёд <ArrowRightCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SmallSelect({
  value,
  onChange,
  placeholder,
  options,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  testId?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="appearance-none rounded-md border border-slate-200 bg-white py-1.5 pl-3 pr-7 text-xs text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Quiet unused-import — kept so the icon set is complete for future toolbar
// expansion (export / inline Stripe link in the row, etc.).
void ExternalLink;
