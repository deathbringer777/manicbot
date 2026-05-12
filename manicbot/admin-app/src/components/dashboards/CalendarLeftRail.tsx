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
 *   │ Auto-confirm       │
 *   │ Web         [ON]   │
 *   │ Telegram    [OFF]  │
 *   │ ...                │
 *   └────────────────────┘
 *
 * The rail is stateless w.r.t. selectedDate (parent owns) but does
 * forward master-visibility + auto-confirm controls. When a `masters`
 * list is supplied, the "My calendars" section renders. When
 * `autoConfirm` settings are supplied, the auto-confirm block renders.
 */

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Users, Filter, Scissors, Zap } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";

/** Brand-derived palette — must match SalonDayView/SalonWeekView so the
 *  same master gets the same color in the rail and the grid. */
const MASTER_PALETTE = [
  { dot: "#7c3aed", bg: "rgba(124,58,237,0.15)" },
  { dot: "#0b9b6b", bg: "rgba(11,155,107,0.15)" },
  { dot: "#0891b2", bg: "rgba(6,182,212,0.15)" },
  { dot: "#ec4899", bg: "rgba(244,114,182,0.15)" },
  { dot: "#d97706", bg: "rgba(245,158,11,0.15)" },
  { dot: "#2563eb", bg: "rgba(59,130,246,0.15)" },
  { dot: "#9333ea", bg: "rgba(168,85,247,0.15)" },
  { dot: "#0d9488", bg: "rgba(20,184,166,0.15)" },
] as const;

/** Status palette — drives both the rail toggle dot and the agenda row pill.
 *  Keys match the status filter Set values so callers can look up a tone
 *  by status string. */
export const STATUS_TONE: Record<string, { dot: string; bg: string; text: string }> = {
  pending:   { dot: "#d97706", bg: "rgba(245,158,11,0.15)",  text: "#b45309" },
  confirmed: { dot: "#059669", bg: "rgba(16,185,129,0.15)",  text: "#047857" },
  cancelled: { dot: "#dc2626", bg: "rgba(239,68,68,0.15)",   text: "#b91c1c" },
  no_show:   { dot: "#ea580c", bg: "rgba(249,115,22,0.15)",  text: "#c2410c" },
  done:      { dot: "#0b9b6b", bg: "rgba(11,155,107,0.15)",  text: "#0b9b6b" },
};

export type StatusKey = "pending" | "confirmed" | "cancelled" | "no_show" | "done";
export const STATUS_KEYS: StatusKey[] = ["pending", "confirmed", "cancelled", "no_show", "done"];

export type AutoConfirmChannel = "web" | "telegram" | "whatsapp" | "instagram";

export interface MasterRailItem {
  chatId: number;
  name: string | null;
}

export interface ServiceRailItem {
  svcId: string;
  name: string;
  count?: number;
}

export interface AutoConfirmState {
  web: boolean;
  telegram: boolean;
  whatsapp: boolean;
  instagram: boolean;
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

  /** ── Status filter section ────────────────────────────────────── */
  hiddenStatuses?: Set<StatusKey>;
  toggleStatusVisible?: (status: StatusKey) => void;
  showAllStatuses?: () => void;

  /** ── Service filter section ───────────────────────────────────── */
  services?: ServiceRailItem[];
  hiddenServiceIds?: Set<string>;
  toggleServiceVisible?: (svcId: string) => void;
  showAllServices?: () => void;

  /** ── Auto-confirm section ─────────────────────────────────────── */
  autoConfirm?: AutoConfirmState;
  autoConfirmLoading?: boolean;
  setAutoConfirm?: (channel: AutoConfirmChannel, enabled: boolean) => void;
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
  hiddenStatuses,
  toggleStatusVisible,
  showAllStatuses,
  services,
  hiddenServiceIds,
  toggleServiceVisible,
  showAllServices,
  autoConfirm,
  autoConfirmLoading,
  setAutoConfirm,
}: Props) {
  const viewMonth = viewMonthProp ?? selectedDate;
  // Local month nav uses an internal callback if the parent didn't supply one.
  const setVm = setViewMonthProp ?? setSelectedDate;

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
          <header className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <Users className="h-3 w-3" />
              {t("salon.day.myCalendars", lang)}
            </p>
            {hiddenMasterIds.size > 0 && showAllMasters && (
              <button
                type="button"
                onClick={showAllMasters}
                data-testid="rail-show-all-masters"
                className="text-[10px] font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 underline-offset-2 hover:underline"
              >
                {t("salon.day.showAll", lang)}
              </button>
            )}
          </header>
          <ul className="space-y-0.5">
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
        </section>
      )}

      {/* Status filter — checkboxes per appointment status. GCal-parity:
          each status renders as its own "calendar" toggle. */}
      {hiddenStatuses && toggleStatusVisible && (
        <section className="glass-card rounded-2xl p-3" data-testid="rail-status-filter">
          <header className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <Filter className="h-3 w-3" />
              {t("salon.rail.statusFilter", lang)}
            </p>
            {hiddenStatuses.size > 0 && showAllStatuses && (
              <button
                type="button"
                onClick={showAllStatuses}
                data-testid="rail-show-all-statuses"
                className="text-[10px] font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 underline-offset-2 hover:underline"
              >
                {t("salon.day.showAll", lang)}
              </button>
            )}
          </header>
          <ul className="space-y-0.5">
            {STATUS_KEYS.map((status) => {
              const tone = STATUS_TONE[status]!;
              const visible = !hiddenStatuses.has(status);
              return (
                <li key={status}>
                  <button
                    type="button"
                    onClick={() => toggleStatusVisible(status)}
                    data-testid="rail-status-toggle"
                    data-status={status}
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
                      {t(`status.${status}` as any, lang)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Service filter — toggle per service. Optional: render only when a
          services list is provided (e.g. caller derives it from the active
          service catalog or from the visible appointments). */}
      {services && services.length > 0 && hiddenServiceIds && toggleServiceVisible && (
        <section className="glass-card rounded-2xl p-3" data-testid="rail-service-filter">
          <header className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <Scissors className="h-3 w-3" />
              {t("salon.rail.serviceFilter", lang)}
            </p>
            {hiddenServiceIds.size > 0 && showAllServices && (
              <button
                type="button"
                onClick={showAllServices}
                data-testid="rail-show-all-services"
                className="text-[10px] font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 underline-offset-2 hover:underline"
              >
                {t("salon.day.showAll", lang)}
              </button>
            )}
          </header>
          <ul className="space-y-0.5 max-h-48 overflow-y-auto pr-0.5">
            {services.map((svc) => {
              const visible = !hiddenServiceIds.has(svc.svcId);
              return (
                <li key={svc.svcId}>
                  <button
                    type="button"
                    onClick={() => toggleServiceVisible(svc.svcId)}
                    data-testid="rail-service-toggle"
                    data-service-id={svc.svcId}
                    data-visible={visible ? "1" : "0"}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
                      visible
                        ? "hover:bg-slate-100 dark:hover:bg-white/[0.04]"
                        : "opacity-50 hover:opacity-80"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-sm shrink-0 border border-slate-400 dark:border-slate-500"
                      style={{
                        background: visible ? "rgb(100 116 139)" : "transparent",
                      }}
                    />
                    <span
                      className={`flex-1 text-[11px] font-medium truncate text-left ${
                        visible
                          ? "text-slate-700 dark:text-slate-200"
                          : "text-slate-400 dark:text-slate-500 line-through"
                      }`}
                    >
                      {svc.name}
                    </span>
                    {typeof svc.count === "number" && svc.count > 0 && (
                      <span className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                        {svc.count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Auto-confirm — channel toggles. Mirrors AutoConfirmSettings on
          the dashboard but in a compact rail-friendly layout. */}
      {autoConfirm && setAutoConfirm && (
        <section className="glass-card rounded-2xl p-3" data-testid="rail-auto-confirm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1 flex items-center gap-1.5">
            <Zap className="h-3 w-3" />
            {t("salon.autoConfirm.title", lang)}
          </p>
          <p className="text-[10px] text-slate-500 dark:text-slate-500 mb-2 leading-snug">
            {t("salon.rail.autoConfirmHint", lang)}
          </p>
          <ul className="space-y-1">
            {(["web", "telegram", "whatsapp", "instagram"] as const).map((ch) => {
              const enabled = autoConfirm[ch];
              const channelLabel =
                ch === "web"
                  ? t("salon.channels.web.label", lang)
                  : ch === "instagram"
                    ? t("salon.channels.instagram.label", lang)
                    : ch === "telegram"
                      ? "Telegram"
                      : "WhatsApp";
              return (
                <li
                  key={ch}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors"
                  data-testid="rail-auto-confirm-row"
                  data-channel={ch}
                  data-enabled={enabled ? "1" : "0"}
                >
                  <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">
                    {channelLabel}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    disabled={!!autoConfirmLoading}
                    onClick={() => setAutoConfirm(ch, !enabled)}
                    data-testid="rail-auto-confirm-toggle"
                    data-channel={ch}
                    className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                      enabled ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-600"
                    } ${autoConfirmLoading ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${
                        enabled ? "translate-x-3.5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

    </aside>
  );
}
