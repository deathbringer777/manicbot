"use client";

/**
 * HomeWidgetContext — the bridge between the salon dashboard host
 * (`SalonDashboard`) and the two *interactive* widgets that need handlers the
 * frozen `WidgetRenderProps` deliberately doesn't carry.
 *
 * WHY a context rather than fatter render-props: `today_appointments` reuses the
 * EXISTING overview JSX verbatim — that JSX depends on the host's live query,
 * status mutations, and the anchored `AppointmentDetailPanel` popover state.
 * Rewriting it inside a pure widget would be a regression risk (the #1 thing we
 * must NOT break). Instead the host keeps that JSX in its own scope and hands it
 * down as a render slot; `quick_actions` likewise reuses the host's existing
 * modal-open handlers and tab navigation. Pure/standalone widgets (KPIs,
 * heatmap, top lists, activity) ignore this context entirely.
 *
 * The context is optional: when absent (e.g. the board's render smoke-test),
 * the interactive widgets degrade to a thin placeholder instead of throwing.
 */

import { createContext, useContext, type ReactNode } from "react";

export interface HomeWidgetHostApi {
  /**
   * Renders the host's today's-appointments block (the existing overview JSX,
   * extracted unchanged). The widget just slots it in so the surrounding
   * frame/grid is the only new wrapper.
   */
  renderTodayAppointments: () => ReactNode;
  /** Open the manual-booking modal (existing host handler). */
  onNewBooking: () => void;
  /** Open the create-client modal (existing host handler). */
  onAddClient: () => void;
  /** Navigate to the services tab/section (existing host navigation). */
  onAddService: () => void;
  /** Navigate to the appointments calendar (existing host navigation). */
  onOpenCalendar: () => void;
}

const HomeWidgetContext = createContext<HomeWidgetHostApi | null>(null);

export function HomeWidgetHostProvider({
  value,
  children,
}: {
  value: HomeWidgetHostApi;
  children: ReactNode;
}) {
  return <HomeWidgetContext.Provider value={value}>{children}</HomeWidgetContext.Provider>;
}

/** Host API, or `null` when the board is mounted outside a salon host. */
export function useHomeWidgetHost(): HomeWidgetHostApi | null {
  return useContext(HomeWidgetContext);
}
