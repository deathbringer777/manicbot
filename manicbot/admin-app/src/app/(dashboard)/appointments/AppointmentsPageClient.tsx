"use client";

/**
 * Platform-level Appointments page (God Mode).
 *
 * Renders the same 5-view calendar as the salon dashboard
 * (`/dashboard?tab=appointments`) — Day / Week / Calendar / Agenda / List —
 * but scoped to the platform-wide `appointments.getAll` feed instead of a
 * single tenant.
 *
 * "Calendar columns" become tenants instead of masters: each appointment's
 * `tenantId` is hashed to a stable numeric `chatId` that the row-typed
 * `MasterRow` of SalonDayView / SalonWeekView / CalendarLeftRail / MonthCalendar
 * expects. No backend changes — purely a client-side adapter.
 */

import { useMemo, useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { PageHeader } from "~/components/ui/PageHeader";
import { EmptyState } from "~/components/ui/EmptyState";
import {
  CalendarDays,
  Download,
  X,
  Search,
} from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SalonDayView } from "~/components/dashboards/SalonDayView";
import { SalonWeekView } from "~/components/dashboards/SalonWeekView";
import { SalonAgendaView } from "~/components/dashboards/SalonAgendaView";
import { MonthCalendar } from "~/components/calendar/MonthCalendar";
import { CalendarLeftRail, type StatusKey } from "~/components/dashboards/CalendarLeftRail";
import { QuickAddFab } from "~/components/dashboards/QuickAddFab";
import { ManualBookingModal } from "~/components/dashboard/ManualBookingModal";
import { TimeReservationDialog } from "~/components/dashboard/TimeReservationDialog";
import { TimeOffDialog } from "~/components/dashboard/TimeOffDialog";
import { CalendarViewSwitcher, type CalendarViewMode, normalizeViewMode, useMobileInitialDayView } from "~/components/dashboards/CalendarViewSwitcher";

type AptViewMode = CalendarViewMode;

/**
 * Stable djb2-style hash: tenant string id → positive integer.
 *
 * `MasterRow.chatId` is typed as `number` so platform-wide tenants need a
 * numeric handle to flow through SalonDayView/Week/MonthCalendar's master-
 * column grouping. Collisions are tolerable: false matches at the column
 * level still render a sensible group, and the underlying API key
 * (`tenant.id`) is preserved on every row for callbacks.
 */
function hashTenantId(tenantId: string): number {
  let h = 5381;
  for (let i = 0; i < tenantId.length; i++) {
    h = ((h << 5) + h + tenantId.charCodeAt(i)) | 0;
  }
  const n = Math.abs(h);
  return n === 0 ? 1 : n;
}

function fmtISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function downloadCSV(data: string, filename: string) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getStatusOf(a: Record<string, unknown>): StatusKey {
  if (a.noShow) return "no_show";
  if (a.cancelled || a.status === "cancelled" || a.status === "rejected") return "cancelled";
  if (a.status === "done") return "done";
  if (a.status === "confirmed") return "confirmed";
  return "pending";
}

export default function AppointmentsPageClient() {
  const { lang } = useLang();

  // Calendar overhaul (2026-05-16): default flipped from "day" → "week" to
  // match Google Calendar parity; the dropdown surface lets us drop the
  // 5-pill bar entirely and reclaim header width for the page title.
  const [aptViewMode, setAptViewMode] = useState<AptViewMode>(() => normalizeViewMode("week"));
  // Phones land on single-day instead of the horizontally-scrolling week grid.
  useMobileInitialDayView(setAptViewMode);
  const [calViewDate, setCalViewDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  // 2026-05-26: single-select dropdown (was Set<StatusKey>) to match the
  // new CalendarLeftRail FilterDropdown contract — see SalonDashboard.
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string | null>(null);
  const [hiddenTenantHashes, setHiddenTenantHashes] = useState<Set<number>>(new Set());

  // God Mode booking modal flow:
  //   Step 1 (showBookingModal=true, bookingTenantId=null)  → tenant picker overlay
  //   Step 2 (showBookingModal=true, bookingTenantId=<id>)  → ManualBookingModal
  // Calendar overhaul (2026-05-16): same two-step pattern reused for the
  // new TimeReservation and TimeOff scenarios — pick a tenant first,
  // then open the dialog. `pendingFabFlow` tracks which dialog to open
  // once a tenant is chosen.
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingTenantId, setBookingTenantId] = useState<string | null>(null);
  const [tenantSearch, setTenantSearch] = useState("");
  const [pendingFabFlow, setPendingFabFlow] = useState<"booking" | "reservation" | "timeOff">("booking");

  const closebookingModal = () => {
    setShowBookingModal(false);
    setBookingTenantId(null);
    setTenantSearch("");
  };

  const utils = api.useUtils();

  // ── Tenants → calendar columns ──────────────────────────────────────────
  const tenantsQ = api.tenants.getAll.useQuery();
  const tenantMasters = useMemo(() => {
    const ts = tenantsQ.data ?? [];
    return ts.map((row) => ({
      chatId: hashTenantId(row.id),
      name: row.name ?? row.id,
    }));
  }, [tenantsQ.data]);

  // ── Per-view data fetching ──────────────────────────────────────────────
  const calYear = calViewDate.getFullYear();
  const calMonth = calViewDate.getMonth();
  const calDate = calViewDate.getDate();
  const calDateFrom = fmtISO(calYear, calMonth, 1);
  const calDateTo = fmtISO(calYear, calMonth, new Date(calYear, calMonth + 1, 0).getDate());

  const dayApts = api.appointments.getAll.useQuery(
    { dateFrom: fmtISO(calYear, calMonth, calDate), dateTo: fmtISO(calYear, calMonth, calDate), limit: 300 },
    { enabled: aptViewMode === "day" },
  );

  const weekRange = useMemo(() => {
    const start = new Date(calViewDate);
    const dayIdx = (start.getDay() + 6) % 7; // Mon=0 … Sun=6
    start.setDate(start.getDate() - dayIdx);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      from: fmtISO(start.getFullYear(), start.getMonth(), start.getDate()),
      to: fmtISO(end.getFullYear(), end.getMonth(), end.getDate()),
    };
  }, [calViewDate]);
  const weekApts = api.appointments.getAll.useQuery(
    { dateFrom: weekRange.from, dateTo: weekRange.to, limit: 500 },
    { enabled: aptViewMode === "week" },
  );

  const calApts = api.appointments.getAll.useQuery(
    { dateFrom: calDateFrom, dateTo: calDateTo, limit: 500 },
    { enabled: aptViewMode === "calendar" },
  );

  const listApts = api.appointments.getAll.useQuery(
    { limit: 100, offset: 0 },
    { enabled: aptViewMode === "list" },
  );

  // ── Adapter: assign each appointment a synthetic masterId = hash(tenantId).
  // SalonDayView / SalonWeekView / MonthCalendar group apts by `masterId`;
  // overriding it makes tenants behave like masters at the platform level. ─
  type AdaptedApt = Record<string, unknown> & {
    id: string | number;
    date: string;
    time: string;
    status: string;
    masterId: number | null;
    svcId?: string | null;
    tenantId?: string;
  };
  const adaptRows = (rows: ReadonlyArray<Record<string, unknown>> | undefined): AdaptedApt[] => {
    return (rows ?? []).map((a) => ({
      ...a,
      masterId: typeof a.tenantId === "string" ? hashTenantId(a.tenantId) : null,
    })) as AdaptedApt[];
  };

  const dayRows = useMemo(() => adaptRows(dayApts.data?.appointments), [dayApts.data]);
  const weekRows = useMemo(() => adaptRows(weekApts.data?.appointments), [weekApts.data]);
  const calRows = useMemo(() => adaptRows(calApts.data?.appointments), [calApts.data]);
  const listRows = useMemo(() => adaptRows(listApts.data?.appointments), [listApts.data]);

  // ── Service rail items: aggregate unique svcIds across visible feeds. ──
  const serviceRailItems = useMemo(() => {
    const counts = new Map<string, number>();
    const allRows = [...dayRows, ...weekRows, ...calRows, ...listRows];
    for (const a of allRows) {
      const svc = a.svcId;
      if (typeof svc !== "string" || !svc) continue;
      counts.set(svc, (counts.get(svc) ?? 0) + 1);
    }
    return Array.from(counts, ([svcId, count]) => ({ svcId, name: svcId, count }));
  }, [dayRows, weekRows, calRows, listRows]);

  // ── Filter callbacks ──
  const toggleMasterVisible = (chatId: number) =>
    setHiddenTenantHashes((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  const showAllMasters = () => setHiddenTenantHashes(new Set());

  // ── Combined filter applied to every view ──
  // Single-select dropdown semantics: only the chosen status / service
  // passes through when set; null = "show all".
  const filterApt = (a: Record<string, unknown>): boolean => {
    const status = getStatusOf(a);
    if (statusFilter != null && status !== statusFilter) return false;
    const svc = a.svcId;
    if (serviceFilter != null && (typeof svc !== "string" || svc !== serviceFilter)) return false;
    const masterId = a.masterId;
    if (typeof masterId === "number" && hiddenTenantHashes.has(masterId)) return false;
    return true;
  };

  const dayFiltered = useMemo(() => dayRows.filter(filterApt), [dayRows, statusFilter, serviceFilter, hiddenTenantHashes]);
  const weekFiltered = useMemo(() => weekRows.filter(filterApt), [weekRows, statusFilter, serviceFilter, hiddenTenantHashes]);
  const calFiltered = useMemo(() => calRows.filter(filterApt), [calRows, statusFilter, serviceFilter, hiddenTenantHashes]);
  const listFiltered = useMemo(() => listRows.filter(filterApt), [listRows, statusFilter, serviceFilter, hiddenTenantHashes]);

  // ── Mutations ──
  const updateStatus = api.appointments.updateStatus.useMutation({
    onSuccess: () => {
      void utils.appointments.getAll.invalidate();
    },
  });
  // Resolve the row's tenant from the loaded feeds so the God Mode mutation
  // carries an explicit tenantId (the server scopes the write by it).
  const tenantIdForApt = (id: number | string): string | undefined => {
    const sid = String(id);
    for (const r of [...dayRows, ...weekRows, ...calRows, ...listRows]) {
      if (String(r.id) === sid && typeof r.tenantId === "string") return r.tenantId;
    }
    return undefined;
  };
  const onAction = (id: number | string, status: "confirmed" | "cancelled" | "rejected") => {
    const tenantId = tenantIdForApt(id);
    if (!tenantId) return;
    updateStatus.mutate({ id: String(id), status, tenantId });
  };
  const onNoShow = (id: number | string, _by: "client" | "master") => {
    const tenantId = tenantIdForApt(id);
    if (!tenantId) return;
    updateStatus.mutate({ id: String(id), status: "no_show", tenantId });
  };

  // ── CSV export ──
  const exportQuery = api.export.appointments.useQuery({ format: "csv" }, { enabled: false });
  const handleExport = async () => {
    const res = await exportQuery.refetch();
    if (res.data) downloadCSV(res.data.data, res.data.filename);
  };

  const filtersActive =
    statusFilter != null || serviceFilter != null || hiddenTenantHashes.size > 0;

  return (
    <Shell>
      <div className="space-y-4">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <PageHeader
            title={t("gmAppts.title", lang)}
            subtitle={t("gmAppts.subtitle", lang)}
          />
          <button
            onClick={handleExport}
            data-testid="apt-export-csv"
            className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:bg-slate-600 text-slate-900 dark:text-white px-3 py-2 text-xs font-medium rounded-xl transition-all shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>

        {/* ── Two-column body: left rail + view ─────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-4">
          <CalendarLeftRail
            selectedDate={calViewDate}
            setSelectedDate={setCalViewDate}
            lang={lang}
            masters={tenantMasters}
            hiddenMasterIds={hiddenTenantHashes}
            toggleMasterVisible={toggleMasterVisible}
            showAllMasters={showAllMasters}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            services={serviceRailItems}
            serviceFilter={serviceFilter}
            setServiceFilter={setServiceFilter}
          />

          <div className="flex-1 min-w-0 space-y-3">
            {/* Calendar overhaul: the view switcher now rides inside each
                view's header (right of the date nav) via `headerRight`, so it
                no longer needs its own row here — saves vertical space. */}
            <div
              key={aptViewMode}
              data-testid="apt-view-transition"
              data-mode={aptViewMode}
              className="apt-view-transition"
            >
            {aptViewMode === "day" && (
              <SalonDayView
                headerRight={<CalendarViewSwitcher mode={aptViewMode} setMode={setAptViewMode} lang={lang} />}
                date={calViewDate}
                setDate={setCalViewDate}
                apts={dayFiltered}
                masters={tenantMasters}
                isLoading={dayApts.isLoading || tenantsQ.isLoading}
                lang={lang}
                onAction={onAction}
                onNoShow={onNoShow}
                hiddenMasterIds={hiddenTenantHashes}
                toggleMasterVisible={toggleMasterVisible}
                showAllMasters={showAllMasters}
              />
            )}

            {aptViewMode === "week" && (
              <SalonWeekView
                headerRight={<CalendarViewSwitcher mode={aptViewMode} setMode={setAptViewMode} lang={lang} />}
                date={calViewDate}
                setDate={setCalViewDate}
                apts={weekFiltered}
                masters={tenantMasters}
                isLoading={weekApts.isLoading || tenantsQ.isLoading}
                lang={lang}
                onAction={onAction}
                onNoShow={onNoShow}
              />
            )}

            {aptViewMode === "calendar" && (
              <MonthCalendar
                headerRight={<CalendarViewSwitcher mode={aptViewMode} setMode={setAptViewMode} lang={lang} />}
                apts={calFiltered}
                masters={tenantMasters}
                viewDate={calViewDate}
                setViewDate={(d) => {
                  setCalViewDate(d);
                  setSelectedDay(null);
                }}
                selectedDay={selectedDay}
                setSelectedDay={setSelectedDay}
                isLoading={calApts.isFetching}
                lang={lang}
              />
            )}

            {aptViewMode === "list" && (
              <>
                {listApts.isLoading ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-end">
                      <CalendarViewSwitcher mode={aptViewMode} setMode={setAptViewMode} lang={lang} />
                    </div>
                    <div className="glass-card rounded-2xl p-6 text-center text-slate-500 dark:text-slate-400 text-sm">
                      …
                    </div>
                  </div>
                ) : listFiltered.length === 0 && listRows.length === 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-end">
                      <CalendarViewSwitcher mode={aptViewMode} setMode={setAptViewMode} lang={lang} />
                    </div>
                    <EmptyState
                      icon={CalendarDays}
                      title={t("gmAppts.noAptsTitle", lang)}
                      description={t("gmAppts.noAptsHint", lang)}
                    />
                  </div>
                ) : (
                  <SalonAgendaView
                    headerRight={<CalendarViewSwitcher mode={aptViewMode} setMode={setAptViewMode} lang={lang} />}
                    apts={listFiltered}
                    isLoading={false}
                    lang={lang}
                    onAction={onAction}
                    onNoShow={onNoShow}
                    masters={tenantMasters}
                    serviceNames={{}}
                    filtersActive={filtersActive && listRows.length > 0}
                  />
                )}
              </>
            )}
            </div>
          </div>
        </div>
      </div>
      {/* FAB — three real flows. Each picks a tenant first (step 1), then
          opens the dialog appropriate to the chosen FAB scenario (step 2). */}
      <QuickAddFab
        lang={lang}
        onNewBooking={() => { setPendingFabFlow("booking"); setShowBookingModal(true); }}
        onTimeReservation={() => { setPendingFabFlow("reservation"); setShowBookingModal(true); }}
        onTimeOff={() => { setPendingFabFlow("timeOff"); setShowBookingModal(true); }}
      />

      {/* God Mode booking — Step 1: pick a tenant */}
      {showBookingModal && bookingTenantId === null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closebookingModal(); }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm shadow-2xl shadow-black/40 border border-slate-200 dark:border-white/10 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/10">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {t("gmAppts.pickTenant", lang)}
              </h2>
              <button
                type="button"
                onClick={closebookingModal}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 pt-3 pb-1">
              <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-2">
                <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                <input
                  type="search"
                  value={tenantSearch}
                  onChange={(e) => setTenantSearch(e.target.value)}
                  placeholder={t("gmAppts.searchPlaceholder", lang)}
                  autoFocus
                  className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
                />
              </div>
            </div>

            {/* Tenant list */}
            <div className="max-h-72 overflow-y-auto py-2">
              {(tenantsQ.data ?? [])
                .filter((tn) =>
                  (tn.name ?? tn.id).toLowerCase().includes(tenantSearch.toLowerCase()),
                )
                .map((tn) => (
                  <button
                    key={tn.id}
                    type="button"
                    onClick={() => setBookingTenantId(tn.id)}
                    className="w-full text-left px-5 py-2.5 text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
                  >
                    {tn.name ?? tn.id}
                  </button>
                ))}
              {tenantsQ.isLoading && (
                <p className="text-center text-xs text-slate-400 py-4">…</p>
              )}
              {!tenantsQ.isLoading &&
                (tenantsQ.data ?? []).filter((tn) =>
                  (tn.name ?? tn.id).toLowerCase().includes(tenantSearch.toLowerCase()),
                ).length === 0 && (
                  <p className="text-center text-xs text-slate-400 py-4">
                    {t("gmAppts.empty", lang)}
                  </p>
                )}
            </div>
          </div>
        </div>
      )}

      {/* God Mode FAB — Step 2: open the dialog for the chosen scenario. */}
      {showBookingModal && bookingTenantId !== null && pendingFabFlow === "booking" && (
        <ManualBookingModal
          tenantId={bookingTenantId}
          onClose={closebookingModal}
          onCreated={() => {
            void utils.appointments.getAll.invalidate();
            closebookingModal();
          }}
        />
      )}
      {showBookingModal && bookingTenantId !== null && pendingFabFlow === "reservation" && (
        <TimeReservationDialog
          tenantId={bookingTenantId}
          onClose={closebookingModal}
          onCreated={() => {
            void utils.appointments.getAll.invalidate();
            closebookingModal();
          }}
        />
      )}
      {showBookingModal && bookingTenantId !== null && pendingFabFlow === "timeOff" && (
        <TimeOffDialog
          tenantId={bookingTenantId}
          onClose={closebookingModal}
          onCreated={() => {
            void utils.appointments.getAll.invalidate();
            closebookingModal();
          }}
        />
      )}
    </Shell>
  );
}
