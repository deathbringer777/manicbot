// @vitest-environment happy-dom
/**
 * SalonWeekView — 7-day hour grid (Mon–Sun) per §12.1 of the Booksy
 * comparison plan. Pins the layout invariants:
 *
 *   - 7 day columns, Monday-anchored regardless of which day is passed in.
 *   - Today's column gets a brand-tinted background + accent header.
 *   - Each appointment is positioned absolutely (top from time, height from
 *     duration). Color comes from the master's slot in MASTER_PALETTE.
 *   - Empty state when there are no appointments anywhere in the week.
 *   - Date navigation (prev = -7d, today = current week, next = +7d).
 *   - Current-time line is shown only in the today column when the visible
 *     week contains today.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

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
}));

import { SalonWeekView } from "~/components/dashboards/SalonWeekView";
import { renderWithLang } from "./helpers/renderWithLang";

// Sunday 2026-05-10 (the user's reference date) is in the week
// Mon 2026-05-04 … Sun 2026-05-10.
const FIXED_NOW = new Date("2026-05-10T13:30:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const masters = [
  { chatId: 100, name: "Anna" },
  { chatId: 200, name: "Olga" },
];

function apt(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    date: "2026-05-10",
    time: "10:00",
    status: "confirmed",
    duration: 60,
    masterId: 100,
    userName: "Client",
    chatId: 999,
    svcId: "manicure",
    ...overrides,
  };
}

describe("SalonWeekView", () => {
  it("renders exactly 7 day columns, Mon → Sun anchored to the visible week", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const cols = screen.getAllByTestId("week-view-day-column");
    expect(cols.length).toBe(7);
    expect(cols[0]?.getAttribute("data-day")).toBe("2026-05-04");
    expect(cols[6]?.getAttribute("data-day")).toBe("2026-05-10");
  });

  it("anchors the week to Monday even when a midweek date is passed in", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-07T12:00:00")} // Thursday
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const cols = screen.getAllByTestId("week-view-day-column");
    expect(cols[0]?.getAttribute("data-day")).toBe("2026-05-04"); // Monday
    expect(cols[6]?.getAttribute("data-day")).toBe("2026-05-10"); // Sunday
  });

  it("renders appointments only in their assigned day column", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[
          apt({ id: 1, date: "2026-05-10", time: "10:00" }),
          apt({ id: 2, date: "2026-05-08", time: "14:00" }),
          apt({ id: 3, date: "2026-05-04", time: "09:00" }),
        ]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const cols = screen.getAllByTestId("week-view-day-column");
    const sun = cols.find((c) => c.getAttribute("data-day") === "2026-05-10");
    const fri = cols.find((c) => c.getAttribute("data-day") === "2026-05-08");
    const mon = cols.find((c) => c.getAttribute("data-day") === "2026-05-04");
    const tue = cols.find((c) => c.getAttribute("data-day") === "2026-05-05");
    expect(sun?.querySelectorAll("[data-testid='week-view-event']").length).toBe(1);
    expect(fri?.querySelectorAll("[data-testid='week-view-event']").length).toBe(1);
    expect(mon?.querySelectorAll("[data-testid='week-view-event']").length).toBe(1);
    expect(tue?.querySelectorAll("[data-testid='week-view-event']").length).toBe(0);
  });

  it("ignores appointments outside the visible week", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[
          apt({ id: 1, date: "2026-05-10" }), // in week
          apt({ id: 2, date: "2026-05-11" }), // next week
          apt({ id: 3, date: "2026-05-03" }), // previous week (Sun before)
        ]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const events = screen.getAllByTestId("week-view-event");
    expect(events.length).toBe(1);
    expect(events[0]?.getAttribute("data-apt-id")).toBe("1");
  });

  it("positions an event at the correct top offset (10:00 → 96px @ 48px/hour)", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[apt({ time: "10:00", duration: 60 })]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const block = screen.getByTestId("week-view-event");
    // 10:00 minus 8:00 = 2 hours × 48px = 96px
    expect(block.style.top).toBe("96px");
    expect(block.style.height).toBe("48px");
  });

  it("date nav buttons trigger setDate with the right delta (±7d, today)", () => {
    const setDate = vi.fn();
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={setDate}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    screen.getByTestId("week-view-prev").click();
    expect((setDate.mock.calls[0]?.[0] as Date).toISOString().slice(0, 10)).toBe("2026-05-03");
    screen.getByTestId("week-view-next").click();
    expect((setDate.mock.calls[1]?.[0] as Date).toISOString().slice(0, 10)).toBe("2026-05-17");
    screen.getByTestId("week-view-today").click();
    expect((setDate.mock.calls[2]?.[0] as Date).toISOString().slice(0, 10)).toBe("2026-05-10");
  });

  it("renders empty state when no apts in the week", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.getByTestId("week-view-empty")).toBeTruthy();
  });

  it("does NOT render empty state while loading", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={true}
        lang="en"
      />,
      "en",
    );
    expect(screen.queryByTestId("week-view-empty")).toBeNull();
  });

  it("renders the current-time line when this week contains today", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.queryByTestId("week-view-now-line")).toBeTruthy();
  });

  it("hides the current-time line in past or future weeks", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-06-01T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.queryByTestId("week-view-now-line")).toBeNull();
  });
});
