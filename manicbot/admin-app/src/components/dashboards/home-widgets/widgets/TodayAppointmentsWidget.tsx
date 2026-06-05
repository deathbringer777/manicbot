"use client";

/**
 * today_appointments widget — the salon's #1 "must not regress" surface.
 *
 * Rather than re-implement the today's-appointments list (live query + status
 * mutations + the anchored AppointmentDetailPanel popover), this widget renders
 * the EXISTING overview JSX, which the host (`SalonDashboard`) hands down
 * verbatim through `HomeWidgetContext.renderTodayAppointments`. So the data
 * source, sorting, empty state, and popover wiring are byte-for-byte the same
 * code that shipped before the board — only the surrounding frame is new.
 *
 * Outside a salon host (no context) it renders nothing.
 */

import { useHomeWidgetHost } from "../HomeWidgetContext";
import type { WidgetRenderProps } from "../registry";

export function TodayAppointmentsWidget(_props: WidgetRenderProps) {
  const host = useHomeWidgetHost();
  if (!host) return null;
  return <div className="h-full overflow-y-auto">{host.renderTodayAppointments()}</div>;
}
