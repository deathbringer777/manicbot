"use client";

/**
 * CalendarLeftRail — Google Calendar / Booksy style left rail next to
 * Day / Week / Month / Agenda views.
 *
 *   ┌─ May 2026 ──── ‹ › ┐
 *   │ M T W T F S S      │
 *   │ 4 5 6 7 8 9 ●10    │  ← today highlighted; click → jumps view
 *   ├────────────────────┤
 *   │ My calendars       │
 *   │ ☑ Anna  🟣 👁       │
 *   │ ☑ Olga  🟢 👁       │
 *   │ ☐ Petr  🔵 ✕       │
 *   ├────────────────────┤
 *   │ Status: [Все ▾]    │
 *   │ Service: [Все ▾]   │
 *   └────────────────────┘
 *
 * 2026-05-26: status + service filters switched from per-row toggle lists
 * to single-select FilterDropdown (UX complaint — the vertical toggle
 * stack hogged rail space and looked clumsy). The auto-confirm section
 * was removed entirely — it lives canonically in /settings?section=salon
 * (MySalonSection → AutoConfirmSettings) and having it duplicated in the
 * rail confused owners about which surface was the source of truth.
 *
 * The rail is stateless w.r.t. selectedDate (parent owns) but forwards
 * master-visibility, status filter, and service filter to the parent
 * via the supplied setters.
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Eye, EyeOff, Users, Filter, Scissors } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { FilterDropdown } from "~/components/ui/FilterDropdown";
import { masterHueSet } from "~/lib/theme/palette";

/** Brand-derived palette — must match SalonDayView/SalonWeekView so the
 *  same master gets the same color in the rail and the grid. Sourced from
 *  the shared theme palette (red/turquoise first). */
const MASTER_PALETTE = Array.from({ length: 8 }, (_, i) => {
  const s = masterHueSet(i);
  return { dot: s.dot, bg: s.bg };
});

/** Status palette — drives both the rail toggle dot and the agenda row pill.
 *  Keys match the status filter Set values so callers can look up a tone
 *  by status string. */
export const STATUS_TONE: Record<string, { dot: string; bg: string; text: string }> = {
  pending:   { dot: "var(--status-pending-dot)",   bg: "var(--status-pending-bg)",   text: "var(--status-pending-text)" },
  confirmed: { dot: "var(--status-confirmed-dot)", bg: "var(--status-confirmed-bg)", text: "var(--status-confirmed-text)" },
  cancelled: { dot: "var(--status-cancelled-dot)", bg: "var(--status-cancelled-bg)", text: "var(--status-cancelled-text)" },
  no_show:   { dot: "var(--status-noshow-dot)",    bg: "var(--status-noshow-bg)",    text: "var(--status-noshow-text)" },
  done:      { dot: "var(--status-done-dot)",      bg: "var(--status-done-bg)",      text: "var(--status-done-text)" },
};

export type StatusKey = "pending" | "confirmed" | "cancelled" | "no_show" | "done";
export const STATUS_KEYS: StatusKey[] = ["pending", "confirmed", "cancelled", "no_show", "done"];

export interface MasterRailItem {
  chatId: number;
  name: string | null;
}

export interface ServiceRailItem {
  svcId: string;
  name: string;
  count?: number;
}

interface Props {
  selectedDate: Date;
  setSelectedDate: (d: Date) => void;
  lang: Lang;
  /** Optional anchor month (defaults to selectedDate's month). */
  viewMonth?: Date;
  setViewMonth?: (d: Date) => void;

  /** ── My Calendars section ─────────────────────────────────────── */
  masters?: MasterRailItem[];
  hiddenMasterIds?: Set<number>;
  toggleMasterVisible?: (chatId: number) => void;
  showAllMasters?: () => void;

  /** ── Status filter section (single-select dropdown) ───────────── */
  statusFilter?: StatusKey | null;
  setStatusFilter?: (next: StatusKey | null) => void;

  /** ── Service filter section (single-select dropdown) ──────────── */
  services?: ServiceRailItem[];
  serviceFilter?: string | null;
  setServiceFilter?: (next: string | null) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS_BY_LANG: Record<string, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  ua: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  pl: ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"],
};

export function CalendarLeftRail({
  selectedDate,
  setSelectedDate,
  lang,
  viewMonth: viewMonthProp,
  setViewMonth: setViewMonthProp,
  masters,
  hiddenMasterIds,
  toggleMasterVisible,
  showAllMasters,
  statusFilter,
  setStatusFilter,
  services,
  serviceFilter,
  setServiceFilter,
}: Props) {
  const viewMonth = viewMonthProp ?? selectedDate;
  // Local month nav uses an internal callback if the parent didn't supply one.
  const setVm = setViewMonthProp ?? setSelectedDate;

  // «My calendars» collapses to a single header row (dropdown) to save rail
  // space; expanding reveals the per-master visibility toggles. Default closed.
  const [calendarsOpen, setCalendarsOpen] = useState(false);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const todayIso = fmtIso(new Date());
  const selectedIso = fmtIso(selectedDate);

  const cells: (number | null)[] = useMemo(() => {
    const firstDowSun = new Date(year, month, 1).getDay();
    // Mon-anchored week — JS getDay returns 0=Sun, we want Mon=0.
    const firstDow = (firstDowSun + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (number | null)[] = [
      ...Array<null>(firstDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, month]);

  const monthLabel = viewMonth.toLocaleString(
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU",
    { month: "long", year: "numeric" },
  );
  const weekdays = WEEKDAYS_BY_LANG[lang] ?? WEEKDAYS_BY_LANG.ru!;

  const jumpDay = (day: number) => {
    const d = new Date(year, month, day);
    setSelectedDate(d);
  };

  const goPrevMonth = () => setVm(new Date(year, month - 1, 1));
  const goNextMonth = () => setVm(new Date(year, month + 1, 1));

  return (
    <aside
      data-testid="calendar-left-rail"
      className="hidden lg:flex flex-col gap-4 w-56 shrink-0"
    >
      {/* Mini month grid */}
      <section className="glass-card rounded-2xl p-3" data-testid="calendar-mini-month">
        <header className="flex items-center justify-between mb-2 px-1">
          <p className="text-xs font-bold text-slate-900 dark:text-white capitalize truncate">
            {monthLabel}
          </p>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={goPrevMonth}
              data-testid="mini-month-prev"
              aria-label={t("salon.day.prev", lang)}
              className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={goNextMonth}
              data-testid="mini-month-next"
              aria-label={t("salon.day.next", lang)}
              className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-px mb-0.5">
          {weekdays.map((d) => (
            <div
              key={d}
              className="text-center text-[9px] font-medium uppercase text-slate-400 dark:text-slate-500"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-px">
          {cells.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} className="h-6" />;
            const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
            const isToday = iso === todayIso;
            const isSelected = iso === selectedIso;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => jumpDay(day)}
                data-testid="mini-month-day"
                data-day={iso}
                data-today={isToday ? "1" : "0"}
                data-selected={isSelected ? "1" : "0"}
                className={`h-6 w-full rounded text-[10px] font-medium tabular-nums transition-colors ${
                  isSelected
                    ? "bg-brand-500 text-white"
                    : isToday
                      ? "bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </section>

      {/* My Calendars — vertical list of master toggles, GCal-parity */}
      {masters && masters.length > 0 && hiddenMasterIds && toggleMasterVisible && (
        <section className="glass-card rounded-2xl p-3" data-testid="rail-my-calendars">
          <header className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setCalendarsOpen((v) => !v)}
              data-testid="rail-my-calendars-toggle"
              aria-expanded={calendarsOpen}
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <Users className="h-3 w-3" />
              {t("salon.day.myCalendars", lang)}
              <span className="text-slate-300 dark:text-slate-600 normal-case tracking-normal">({masters.length})</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${calendarsOpen ? "rotate-180" : ""}`} />
            </button>
            {calendarsOpen && hiddenMasterIds.size > 0 && showAllMasters && (
              <button
                type="button"
                onClick={showAllMasters}
                data-testid="rail-show-all-masters"
                className="text-[10px] font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 underline-offset-2 hover:underline shrink-0"
              >
                {t("salon.day.showAll", lang)}
              </button>
            )}
          </header>
          {calendarsOpen && (
            <ul className="space-y-0.5 mt-2">
            {masters.map((m, idx) => {
              const tone = MASTER_PALETTE[idx % MASTER_PALETTE.length]!;
              const visible = !hiddenMasterIds.has(m.chatId);
              return (
                <li key={m.chatId}>
                  <button
                    type="button"
                    onClick={() => toggleMasterVisible(m.chatId)}
                    data-testid="rail-master-toggle"
                    data-master-id={m.chatId}
                    data-visible={visible ? "1" : "0"}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                      visible
                        ? "hover:bg-slate-100 dark:hover:bg-white/[0.04]"
                        : "opacity-50 hover:opacity-80"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-sm shrink-0 border"
                      style={{
                        background: visible ? tone.dot : "transparent",
                        borderColor: tone.dot,
                      }}
                    />
                    <span
                      className={`flex-1 text-[11px] font-medium truncate text-left ${
                        visible
                          ? "text-slate-700 dark:text-slate-200"
                          : "text-slate-400 dark:text-slate-500 line-through"
                      }`}
                    >
                      {m.name ?? `#${m.chatId}`}
                    </span>
                    {visible ? (
                      <Eye className="h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0" />
                    ) : (
                      <EyeOff className="h-3 w-3 text-slate-300 dark:text-slate-600 shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          )}
        </section>
      )}

      {/* Filters card — status + service, single-select dropdowns. Replaces
          the per-row toggle list. The Set-based multi-toggle UX hogged
          rail space and stopped scaling once a salon added more than 3
          services. */}
      {(setStatusFilter || (services && setServiceFilter)) && (
        <section className="glass-card rounded-2xl p-3 space-y-2" data-testid="rail-filters">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
            <Filter className="h-3 w-3" />
            {t("salon.rail.filters", lang)}
          </p>

          {setStatusFilter && (
            <div data-testid="rail-status-filter">
              <p className="mb-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                {t("salon.rail.statusFilter", lang)}
              </p>
              <FilterDropdown<StatusKey>
                label={t("salon.day.showAll", lang)}
                allLabel={t("salon.day.showAll", lang)}
                value={statusFilter ?? null}
                onChange={(v) => setStatusFilter(v)}
                triggerTestId="rail-status-filter-trigger"
                options={STATUS_KEYS.map((s) => ({
                  value: s,
                  label: t(`status.${s}` as any, lang),
                  testId: `rail-status-filter-option-${s}`,
                }))}
              />
            </div>
          )}

          {services && services.length > 0 && setServiceFilter && (
            <div data-testid="rail-service-filter">
              <p className="mb-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <Scissors className="h-3 w-3" />
                {t("salon.rail.serviceFilter", lang)}
              </p>
              <FilterDropdown<string>
                label={t("salon.day.showAll", lang)}
                allLabel={t("salon.day.showAll", lang)}
                value={serviceFilter ?? null}
                onChange={(v) => setServiceFilter(v)}
                triggerTestId="rail-service-filter-trigger"
                options={services.map((svc) => ({
                  value: svc.svcId,
                  label: typeof svc.count === "number" && svc.count > 0
                    ? `${svc.name} (${svc.count})`
                    : svc.name,
                  testId: `rail-service-filter-option-${svc.svcId}`,
                }))}
              />
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
