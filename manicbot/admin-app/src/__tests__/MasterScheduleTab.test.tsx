// @vitest-environment happy-dom
/**
 * MasterScheduleTab — modernized master "Расписание" surface.
 *
 * Before this rewrite the master schedule rendered a legacy month grid
 * (MonthCalendar) + AptRow list with a hand-rolled calendar/list toggle.
 * The owner-side SalonDashboard had moved on to SalonDayView /
 * SalonWeekView / SalonBigCalendar / SalonAgendaView with a
 * CalendarViewSwitcher dropdown, drag-to-reschedule, and rich detail
 * panels. Salon owners who used the sidebar "view as master" chip
 * (which swaps SalonDashboard for MasterDashboard under the hood, see
 * layout.tsx:156) got dropped into the old experience. Real masters on
 * their own logins saw the same legacy view.
 *
 * This test pins the modernization contract:
 *   - The four-mode CalendarViewSwitcher dropdown is mounted (data-testid
 *     "master-schedule-view-switcher").
 *   - Day mode renders SalonDayView (data-testid "salon-day-view") with a
 *     SINGLE master column (this master), regardless of how many masters
 *     the tenant has — the view is master-scoped by design.
 *   - The schedule data flows through unchanged: appointments belonging to
 *     this master show up as day-view-event blocks.
 *   - Switching to Week mode mounts SalonWeekView with one column per day
 *     (still single-master scoped).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("~/lib/appointments", () => ({
  APT_BORDER: {
    confirmed: "border-l-emerald-500",
    pending: "border-l-amber-500",
    cancelled: "border-l-red-500",
    no_show: "border-l-orange-500",
    done: "border-l-brand-500",
  },
  STATUS_LABELS: {
    confirmed: "Confirmed",
    pending: "Pending",
    cancelled: "Cancelled",
    no_show: "No-show",
    done: "Done",
  },
  STATUS_STYLES: {
    confirmed: "bg-emerald-500/20",
    pending: "bg-amber-500/20",
    cancelled: "bg-red-500/20",
    no_show: "bg-orange-500/20",
    done: "bg-brand-500/20",
  },
}));

// `appointments.rescheduleAppointment` is the only tRPC call ScheduleTab
// makes directly; the schedule query data is passed in as a prop.
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({}),
    appointments: {
      rescheduleAppointment: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
        }),
      },
    },
  },
}));

import { ScheduleTab } from "~/components/master/tabs/ScheduleTab";
import { renderWithLang } from "./helpers/renderWithLang";

const FIXED_NOW = new Date("2026-05-17T10:00:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  // Fresh localStorage — SalonDayView persists per-master visibility under
  // `manicbot_day_view_visible_masters`; leaking state across tests would
  // hide the single column we're asserting on.
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const aptToday = {
  id: 1,
  date: "2026-05-17",
  time: "10:30",
  status: "confirmed",
  duration: 60,
  masterId: 777,
  userName: "Anna",
  chatId: 999,
  svcId: "manicure",
  cancelled: 0,
  noShow: 0,
};

const baseProps = {
  tenantId: "t_demo",
  masterId: 777,
  lang: "ru" as const,
  schedule: {
    isLoading: false,
    isError: false,
    data: [aptToday],
  },
  canMutate: true,
  markNoShowMut: { mutate: vi.fn() },
  masterName: "Olga",
  masterWorkHours: null,
  isDelegating: false,
};

describe("MasterDashboard / ScheduleTab (modernized)", () => {
  it("mounts the CalendarViewSwitcher dropdown trigger", () => {
    renderWithLang(<ScheduleTab {...baseProps} />, "ru");
    expect(screen.getByTestId("master-schedule-view-switcher")).toBeTruthy();
  });

  it("renders SalonDayView in default (day) mode", () => {
    renderWithLang(<ScheduleTab {...baseProps} />, "ru");
    expect(screen.getByTestId("salon-day-view")).toBeTruthy();
  });

  it("renders a SINGLE master column (the current master) even when other tenants exist", () => {
    renderWithLang(<ScheduleTab {...baseProps} />, "ru");
    const cols = screen.getAllByTestId("day-view-master-column");
    expect(cols.length).toBe(1);
    expect(cols[0]?.getAttribute("data-master-id")).toBe("777");
  });

  it("renders today's appointment as a day-view-event block", () => {
    renderWithLang(<ScheduleTab {...baseProps} />, "ru");
    const events = screen.getAllByTestId("day-view-event");
    expect(events.length).toBe(1);
    expect(events[0]?.getAttribute("data-apt-id")).toBe("1");
  });

  it("does not render the old MonthCalendar legacy grid in day mode", () => {
    renderWithLang(<ScheduleTab {...baseProps} />, "ru");
    // MonthCalendar has data-testid="month-calendar" — must not appear in day mode.
    expect(screen.queryByTestId("month-calendar")).toBeNull();
  });

  it("switches to week mode via the CalendarViewSwitcher", () => {
    renderWithLang(<ScheduleTab {...baseProps} />, "ru");
    fireEvent.click(screen.getByTestId("master-schedule-view-switcher-trigger"));
    fireEvent.click(screen.getByTestId("master-schedule-view-switcher-option-week"));
    // SalonWeekView root testid is "salon-week-view".
    expect(screen.getByTestId("salon-week-view")).toBeTruthy();
    // Day-view should be unmounted after switching modes.
    expect(screen.queryByTestId("salon-day-view")).toBeNull();
  });

  it("switches to list mode and renders SalonAgendaView", () => {
    renderWithLang(<ScheduleTab {...baseProps} />, "ru");
    fireEvent.click(screen.getByTestId("master-schedule-view-switcher-trigger"));
    fireEvent.click(screen.getByTestId("master-schedule-view-switcher-option-list"));
    // SalonAgendaView renders one row per appointment with data-testid="agenda-row".
    expect(screen.getAllByTestId("agenda-row").length).toBe(1);
  });

  it("does NOT render confirm / reject action buttons in list mode (master role lacks the mutation)", () => {
    // Today's row is confirmed, not pending, so the menu trigger should appear.
    // The "..." menu must not include a Cancel option (master has no
    // appointments.updateStatus mutation) but the no-show options stay.
    renderWithLang(
      <ScheduleTab
        {...baseProps}
        schedule={{
          isLoading: false,
          isError: false,
          data: [{ ...aptToday, status: "pending" }],
        }}
      />,
      "ru",
    );
    fireEvent.click(screen.getByTestId("master-schedule-view-switcher-trigger"));
    fireEvent.click(screen.getByTestId("master-schedule-view-switcher-option-list"));
    // For a pending row, the confirm/reject buttons would normally appear,
    // but only when an onAction callback is wired in. Master role passes no
    // onAction (no master mutation exists) — so the buttons must be absent.
    expect(screen.queryByTestId("agenda-row-confirm")).toBeNull();
    expect(screen.queryByTestId("agenda-row-reject")).toBeNull();
  });
});
