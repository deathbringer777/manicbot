"use client";

/**
 * ScheduleTab — master "Расписание" surface, modernized 2026-05-17.
 *
 * Before: a MonthCalendar grid + AptRow list with a hand-rolled
 * calendar/list toggle. The owner-side SalonDashboard had moved to a
 * 4-mode view stack (day/week/calendar/list) with drag-to-reschedule
 * and rich detail panels — masters and salon owners viewing "as
 * master" via the sidebar `previewMasterId` were stuck on the legacy
 * grid.
 *
 * Now: the same SalonDayView / SalonWeekView / MonthCalendar (month
 * mode) / SalonAgendaView stack used in SalonDashboard, scoped to a
 * SINGLE master column (this master). Drag-to-reschedule routes
 * through `appointments.rescheduleAppointment` which already
 * special-cases `webRole === "master"` to allow own-booking moves
 * (see `routers/appointments.ts:525`). Status mutations stay
 * conservative: master role has no `appointments.updateStatus` /
 * `appointments.markNoShow` equivalent, so we wire `onNoShow` to the
 * existing `master.markNoShow` mutation (passed in from
 * MasterDashboard) and leave `onAction` (confirm/reject/cancel)
 * undefined — the children gracefully hide those affordances.
 */

import { useState, useCallback } from "react";
import { Loader2, X } from "lucide-react";
import { api } from "~/trpc/react";
import { t, type Lang } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import {
  CalendarViewSwitcher,
  type CalendarViewMode,
} from "~/components/dashboards/CalendarViewSwitcher";
import { SalonDayView } from "~/components/dashboards/SalonDayView";
import { SalonWeekView } from "~/components/dashboards/SalonWeekView";
import { SalonAgendaView } from "~/components/dashboards/SalonAgendaView";
import { MonthCalendar } from "~/components/calendar/MonthCalendar";
import { AptCard } from "~/components/dashboard-ui/AptCard";
import type { MoveCommit } from "~/lib/calendar/useDragToMove";

interface ScheduleData {
  isLoading: boolean;
  isError: boolean;
  data?: unknown[];
  refetch?: () => void;
}

interface MarkNoShowMutation {
  mutate: (input: { tenantId: string; id: string; noShowBy: "client" | "master" }) => void;
}

interface ScheduleTabProps {
  tenantId: string;
  masterId: number;
  lang: Lang;
  schedule: ScheduleData;
  /** Whether the caller is allowed to write (false when isDelegating without
   *  allowDelegation — matches `canMutate` in MasterDashboard). */
  canMutate: boolean;
  markNoShowMut: MarkNoShowMutation;
  /** Display name for the single column header. */
  masterName: string | null;
  /** Raw `work_hours` from the master row — parsed by SalonDayView for the
   *  non-working-hours tint. Optional; null/undefined => column treated as
   *  fully open. */
  masterWorkHours?: unknown;
  /** Owner is viewing the dashboard "as master" via the sidebar chip. Carried
   *  for future surface decisions (e.g. delegation banner); the current
   *  behavior is identical for both modes. */
  isDelegating: boolean;
}

type Pending = Record<string, { date: string; time: string; masterId: number }>;

/**
 * Re-build the `ts` (epoch seconds) so list-mode `ORDER BY ts` keeps the
 * dragged row in order until the server round-trip lands. Mirrors the
 * salon-side helper in SalonDashboard.applyPendingMoves.
 */
function applyPendingMoves(rows: any[] | undefined, pending: Pending): any[] {
  if (!rows) return [];
  const ids = Object.keys(pending);
  if (ids.length === 0) return rows;
  return rows.map((r) => {
    const patch = pending[String(r.id)];
    if (!patch) return r;
    const [hh, mm] = patch.time.split(":").map(Number);
    const [y, mo, d] = patch.date.split("-").map(Number);
    const ts = Math.floor(Date.UTC(y!, mo! - 1, d!, hh!, mm!) / 1000);
    return { ...r, date: patch.date, time: patch.time, ts };
  });
}

export function ScheduleTab({
  tenantId,
  masterId,
  lang,
  schedule,
  canMutate,
  markNoShowMut,
  masterName,
  masterWorkHours,
}: ScheduleTabProps) {
  const [aptViewMode, setAptViewMode] = useState<CalendarViewMode>("day");
  const [calViewDate, setCalViewDate] = useState<Date>(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [pendingMoves, setPendingMoves] = useState<Pending>({});

  // Drag-to-reschedule wiring. The backend procedure already allows
  // `webRole === "master"` to move bookings on their own calendar — see
  // routers/appointments.ts:525. For delegating owners (webRole ===
  // "tenant_owner") the procedure passes through `assertTenantOwner` as
  // normal.
  const rescheduleApt = api.appointments.rescheduleAppointment.useMutation({
    onMutate: (vars) => {
      setPendingMoves((prev) => ({
        ...prev,
        [vars.appointmentId]: {
          date: vars.newDate,
          time: vars.newTime,
          masterId: vars.newMasterId ?? masterId,
        },
      }));
    },
    onError: (err, vars) => {
      const msg = err?.message ?? "";
      if (msg === "slot_conflict") {
        toast.error(t("salon.reschedule.conflict", lang));
      } else if (msg === "appointment_terminal") {
        toast.error(t("salon.reschedule.failed", lang));
      } else {
        toast.error(t("salon.reschedule.failed", lang), msg || undefined);
      }
      setPendingMoves((prev) => {
        const next = { ...prev };
        delete next[vars.appointmentId];
        return next;
      });
    },
    onSuccess: () => {
      toast.success(t("salon.reschedule.success", lang));
    },
    onSettled: (_data, _err, vars) => {
      setPendingMoves((prev) => {
        const next = { ...prev };
        delete next[vars.appointmentId];
        return next;
      });
      schedule.refetch?.();
    },
  });

  const handleMoveAppointment = useCallback(
    (move: MoveCommit) => {
      // Master views are single-column → master never changes on drag.
      // We omit newMasterId so the backend keeps the existing assignment.
      rescheduleApt.mutate({
        tenantId,
        appointmentId: String(move.appointmentId),
        newDate: move.toDate,
        newTime: move.toTime,
      });
    },
    [rescheduleApt, tenantId],
  );

  const noShowCb = canMutate
    ? (id: number | string, noShowBy: "client" | "master") =>
        markNoShowMut.mutate({ tenantId, id: String(id), noShowBy })
    : undefined;

  // Single-column master setup — pass [thisMaster] so SalonDayView /
  // SalonWeekView render exactly one column scoped to this master, with
  // the same brand-palette color used in SalonDashboard.
  const thisMaster = {
    chatId: masterId,
    name: masterName,
    workHours: masterWorkHours,
  };

  const apts = (schedule.data ?? []) as any[];
  const aptsWithMoves = applyPendingMoves(apts, pendingMoves);
  const dayMap: Record<string, any[]> = {};
  apts.forEach((a: any) => {
    (dayMap[a.date] ??= []).push(a);
  });
  const selectedDayApts = selectedDay ? dayMap[selectedDay] ?? [] : [];

  return (
    <div className="space-y-3" data-testid="master-schedule-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex-1">
          {t("master.allApts", lang)}
        </h2>
        <CalendarViewSwitcher
          mode={aptViewMode}
          setMode={setAptViewMode}
          lang={lang}
          testIdPrefix="master-schedule"
        />
      </div>

      {schedule.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {schedule.isError && (
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-400">{t("common.errorLoading", lang)}</p>
        </div>
      )}

      <div
        key={aptViewMode}
        data-testid="master-schedule-view-transition"
        data-mode={aptViewMode}
        className="space-y-3"
      >
        {aptViewMode === "day" && (
          <SalonDayView
            date={calViewDate}
            setDate={setCalViewDate}
            apts={aptsWithMoves}
            masters={[thisMaster]}
            isLoading={schedule.isLoading}
            lang={lang}
            onAction={undefined}
            onNoShow={noShowCb}
            onMoveAppointment={canMutate ? handleMoveAppointment : undefined}
            // Empty hiddenMasterIds — single-column means no rail toggle.
            hiddenMasterIds={new Set<number>()}
            // Master self-view: hide redundant per-column avatar + name strip,
            // show empty-state when the day is empty, skip auto-scroll-to-now
            // on empty days. Owner-side SalonDashboard leaves this off and
            // keeps the multi-master header. See SalonDayView Props.
            singleColumnMode
          />
        )}

        {aptViewMode === "week" && (
          <SalonWeekView
            date={calViewDate}
            setDate={setCalViewDate}
            apts={aptsWithMoves}
            masters={[thisMaster]}
            isLoading={schedule.isLoading}
            lang={lang}
            onAction={undefined}
            onNoShow={noShowCb}
            onMoveAppointment={canMutate ? handleMoveAppointment : undefined}
          />
        )}

        {aptViewMode === "calendar" && (
          <>
            <MonthCalendar
              apts={apts}
              viewDate={calViewDate}
              setViewDate={(d) => {
                setCalViewDate(d);
                setSelectedDay(null);
              }}
              selectedDay={selectedDay}
              setSelectedDay={setSelectedDay}
              isLoading={schedule.isLoading}
              lang={lang}
            />
            {selectedDay && (
              <div className="glass-card rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white capitalize">
                    {new Date(selectedDay + "T12:00:00").toLocaleDateString(
                      lang === "ua"
                        ? "uk-UA"
                        : lang === "pl"
                          ? "pl-PL"
                          : lang === "en"
                            ? "en-US"
                            : "ru-RU",
                      { weekday: "long", day: "numeric", month: "long" },
                    )}
                    {selectedDayApts.length > 0 && (
                      <span className="ml-2 text-slate-400 dark:text-slate-500 font-medium">
                        · {selectedDayApts.length}
                      </span>
                    )}
                  </h3>
                  <button
                    onClick={() => setSelectedDay(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  {selectedDayApts.map((a: any) => (
                    <AptCard
                      key={a.id}
                      a={a}
                      lang={lang}
                      onNoShow={noShowCb}
                    />
                  ))}
                  {selectedDayApts.length === 0 && (
                    <p className="text-slate-500 text-sm text-center py-4">
                      {t("master.noApts", lang)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {aptViewMode === "list" && (
          <SalonAgendaView
            apts={apts}
            isLoading={schedule.isLoading}
            lang={lang}
            onAction={undefined}
            onNoShow={noShowCb}
            masters={[thisMaster]}
            filtersActive={false}
          />
        )}
      </div>
    </div>
  );
}
