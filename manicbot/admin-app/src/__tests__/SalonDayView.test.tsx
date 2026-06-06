// @vitest-environment happy-dom
/**
 * SalonDayView — single-day hour grid with master columns (per §12.1 of
 * the Booksy comparison plan). Pins the layout contract:
 *
 *   - Full 00:00–24:00 hour scale (Google-Calendar style), scrollable.
 *   - One column per active master + an "Unassigned" column when at least
 *     one appointment has masterId === null.
 *   - Day navigation buttons (prev / today / next) with stable testids.
 *   - Empty state when there are no masters.
 *   - Current-time red line is rendered on today, hidden on other dates.
 *   - Each appointment is positioned absolutely with top derived from
 *     start time against a 00:00 origin (09:00 = 9 × HOUR_HEIGHT, etc.).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, screen, fireEvent } from "@testing-library/react";

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

import { SalonDayView } from "~/components/dashboards/SalonDayView";
import { renderWithLang } from "./helpers/renderWithLang";

const FIXED_NOW = new Date("2026-05-10T13:30:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  // Fresh in-memory localStorage so My Calendars state does not leak between
  // tests. happy-dom's stub is shared across the whole file.
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

const masters = [
  { chatId: 100, name: "Anna" },
  { chatId: 200, name: "Olga" },
  { chatId: 300, name: "Petr" },
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

describe("SalonDayView", () => {
  it("renders one column per active master", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const cols = screen.getAllByTestId("day-view-master-column");
    expect(cols.length).toBe(3);
    expect(cols[0]?.getAttribute("data-master-id")).toBe("100");
    expect(cols[1]?.getAttribute("data-master-id")).toBe("200");
    expect(cols[2]?.getAttribute("data-master-id")).toBe("300");
  });

  it("renders an Unassigned column when an appointment has no masterId", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[apt({ id: 1, masterId: null, time: "11:00" })]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const cols = screen.getAllByTestId("day-view-master-column");
    expect(cols.length).toBe(4);
    expect(cols[3]?.getAttribute("data-master-id")).toBe("-1"); // synthetic id for unassigned
  });

  it("does NOT render an Unassigned column when all appointments are assigned", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[apt({ id: 1, masterId: 100 })]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const cols = screen.getAllByTestId("day-view-master-column");
    expect(cols.length).toBe(3);
    expect(cols.every((c) => c.getAttribute("data-master-id") !== "-1")).toBe(true);
  });

  it("filters appointments to the visible date only", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[
          apt({ id: 1, date: "2026-05-10", time: "10:00", masterId: 100 }),
          apt({ id: 2, date: "2026-05-11", time: "10:00", masterId: 100 }), // out of range
        ]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const events = screen.getAllByTestId("day-view-event");
    expect(events.length).toBe(1);
    expect(events[0]?.getAttribute("data-apt-id")).toBe("1");
  });

  it("positions an appointment block at the correct top offset", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[apt({ id: 1, time: "10:00", duration: 60, masterId: 100 })]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const block = screen.getByTestId("day-view-event");
    // Full 24h grid: 10:00 from a 00:00 origin = 10 hours × 56px = 560px.
    expect(block.style.top).toBe("560px");
    expect(block.style.height).toBe("56px");
  });

  it("renders the current-time line on today", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.queryByTestId("day-view-now-line")).toBeTruthy();
  });

  it("does NOT render the current-time line on a different date", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-12T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.queryByTestId("day-view-now-line")).toBeNull();
  });

  it("shows empty state when no masters are passed in", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={[]}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.getByTestId("day-view-empty")).toBeTruthy();
    expect(screen.queryAllByTestId("day-view-master-column").length).toBe(0);
  });

  it("date navigation buttons trigger setDate with the right delta", () => {
    const setDate = vi.fn();
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={setDate}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const prev = screen.getByTestId("day-view-prev");
    const next = screen.getByTestId("day-view-next");
    const today = screen.getByTestId("day-view-today");
    prev.click();
    expect((setDate.mock.calls[0]?.[0] as Date).toISOString().slice(0, 10)).toBe("2026-05-09");
    next.click();
    expect((setDate.mock.calls[1]?.[0] as Date).toISOString().slice(0, 10)).toBe("2026-05-11");
    today.click();
    expect((setDate.mock.calls[2]?.[0] as Date).toISOString().slice(0, 10)).toBe("2026-05-10");
  });

  it("renders the My Calendars rail with one toggle per master", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.getByTestId("day-view-master-rail")).toBeTruthy();
    const toggles = screen.getAllByTestId("day-view-master-toggle");
    expect(toggles.length).toBe(3);
    // All visible by default
    expect(toggles.every((t) => t.getAttribute("data-visible") === "1")).toBe(true);
  });

  it("clicking a master toggle hides that column from the grid", () => {
    try { localStorage.removeItem("manicbot_day_view_visible_masters"); } catch { /* noop */ }
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[apt({ id: 1, time: "10:00", masterId: 100 })]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.getAllByTestId("day-view-master-column").length).toBe(3);
    const toggles = screen.getAllByTestId("day-view-master-toggle");
    const olga = toggles.find((t) => t.getAttribute("data-master-id") === "200");
    if (olga) fireEvent.click(olga);
    const cols = screen.getAllByTestId("day-view-master-column");
    expect(cols.length).toBe(2);
    expect(cols.find((c) => c.getAttribute("data-master-id") === "200")).toBeUndefined();
  });

  it("Show all button reappears after hiding at least one master", () => {
    try { localStorage.removeItem("manicbot_day_view_visible_masters"); } catch { /* noop */ }
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.queryByTestId("day-view-show-all-masters")).toBeNull();
    const toggles = screen.getAllByTestId("day-view-master-toggle");
    if (toggles[0]) fireEvent.click(toggles[0]);
    expect(screen.getByTestId("day-view-show-all-masters")).toBeTruthy();
  });

  it("renders striped non-working hours overlay for masters with a work window", () => {
    // Anna works Mon–Sat 09:00–19:00, no Sun. Testing on Sun 2026-05-10 →
    // her column is fully closed, so a single hatching block spans the
    // whole body height.
    const annaSundayClosed = [
      { chatId: 100, name: "Anna", workHours: '{"mon":"09:00-19:00","tue":"09:00-19:00","wed":"09:00-19:00","thu":"09:00-19:00","fri":"09:00-19:00","sat":"10:00-18:00"}' },
    ];
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")} // Sunday
        setDate={() => undefined}
        apts={[]}
        masters={annaSundayClosed}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const overlays = screen.getAllByTestId("day-view-non-working");
    // Closed all day → exactly one overlay block.
    expect(overlays.length).toBe(1);
  });

  it("hatches before-open and after-close on the full 24h grid for a working day", () => {
    // Anna works 09:00–18:00 on Mon. On the full 00:00–24:00 grid the night /
    // early-morning + evening hours outside her window are hatched as
    // non-working: a before-open band 00:00–09:00 and an after-close 18:00–24:00.
    const annaMonPartial = [
      { chatId: 100, name: "Anna", workHours: '{"mon":"09:00-18:00"}' },
    ];
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-04T12:00:00")} // Monday
        setDate={() => undefined}
        apts={[]}
        masters={annaMonPartial}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const overlays = screen.getAllByTestId("day-view-non-working") as HTMLElement[];
    // HOUR_HEIGHT=56: before-open 00–09 (top 0, h 9×56=504) +
    // after-close 18–24 (top 18×56=1008, h 6×56=336).
    expect(overlays.length).toBe(2);
    expect(overlays.find((o) => o.style.top === "0px")?.style.height).toBe("504px");
    expect(overlays.find((o) => o.style.top === "1008px")?.style.height).toBe("336px");
  });

  it("positions out-of-hours bookings on the full grid (early-morning + evening)", () => {
    // Bookings at 08:00 and 19:00 — outside Anna's 09:00–18:00 window — are no
    // longer clipped away; they sit at their absolute offsets on the 24h grid.
    const annaMonPartial = [
      { chatId: 100, name: "Anna", workHours: '{"mon":"09:00-18:00"}' },
    ];
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-04T12:00:00")} // Monday
        setDate={() => undefined}
        apts={[
          apt({ id: 1, date: "2026-05-04", time: "08:00", duration: 60, masterId: 100 }),
          apt({ id: 2, date: "2026-05-04", time: "19:00", duration: 60, masterId: 100 }),
        ]}
        masters={annaMonPartial}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const events = screen.getAllByTestId("day-view-event") as HTMLElement[];
    const byId = (id: string) => events.find((e) => e.getAttribute("data-apt-id") === id)!;
    // 08:00 → 8×56=448px; 19:00 → 19×56=1064px.
    expect(byId("1").style.top).toBe("448px");
    expect(byId("2").style.top).toBe("1064px");
  });

  it("positions a 09:00 booking at its absolute offset on the full-day grid", () => {
    const anna9to18 = [
      { chatId: 100, name: "Anna", workHours: '{"mon":"09:00-18:00"}' },
    ];
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-04T12:00:00")} // Monday
        setDate={() => undefined}
        apts={[apt({ id: 1, date: "2026-05-04", time: "09:00", duration: 60, masterId: 100 })]}
        masters={anna9to18}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const ev = screen.getByTestId("day-view-event");
    // Full grid from 00:00 → 09:00 sits at 9×56 = 504px (no longer clipped to top).
    expect(ev.style.top).toBe("504px");
    expect(ev.style.height).toBe("56px");
  });

  it("does NOT render hatching when work_hours is missing or null", () => {
    const noHours = [{ chatId: 100, name: "Anna", workHours: null }];
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-04T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={noHours}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    expect(screen.queryAllByTestId("day-view-non-working").length).toBe(0);
  });

  it("parses the legacy {from, to} global work_hours shape (open 10:00)", () => {
    // Numeric from/to (legacy) → open 10–18. On the full 24h grid the before-open
    // band runs 00:00–10:00, so its height proves the {from,to} shape parsed to a
    // 10:00 start (plus an after-close band 18:00–24:00).
    const legacy = [{ chatId: 100, name: "Anna", workHours: '{"from":10,"to":18}' }];
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-04T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={legacy}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const overlays = screen.getAllByTestId("day-view-non-working") as HTMLElement[];
    // before-open 00–10 (top 0, h 10×56=560) + after-close 18–24 (top 1008, h 336).
    expect(overlays.length).toBe(2);
    const before = overlays.find((o) => o.style.top === "0px");
    expect(before?.style.height).toBe("560px"); // proves open parsed to 10:00
    expect(overlays.find((o) => o.style.top === "1008px")?.style.height).toBe("336px");
  });

  it("groups multiple appointments under the same master column", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[
          apt({ id: 1, time: "09:00", masterId: 100 }),
          apt({ id: 2, time: "11:00", masterId: 100 }),
          apt({ id: 3, time: "10:00", masterId: 200 }),
        ]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    const cols = screen.getAllByTestId("day-view-master-column");
    const annaCol = cols.find((c) => c.getAttribute("data-master-id") === "100");
    const olgaCol = cols.find((c) => c.getAttribute("data-master-id") === "200");
    expect(annaCol?.querySelectorAll("[data-testid='day-view-event']").length).toBe(2);
    expect(olgaCol?.querySelectorAll("[data-testid='day-view-event']").length).toBe(1);
  });
});

describe("SalonDayView — navigation styling", () => {
  it("styles the day nav buttons with the brand-purple tint", () => {
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
      />,
      "en",
    );
    for (const id of ["day-view-prev", "day-view-today", "day-view-next"]) {
      expect(screen.getByTestId(id).className).toContain("brand-500/10");
    }
  });
});

describe("SalonDayView — quick-create popover", () => {
  it("dragging an empty slot shows the quick-create card and defers the full form until «Создать»", () => {
    const onCreateAt = vi.fn();
    renderWithLang(
      <SalonDayView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="ru"
        onCreateAt={onCreateAt}
      />,
      "ru",
    );
    const layer = screen.getAllByTestId("day-view-drag-layer")[0]!;
    fireEvent.pointerDown(layer, { button: 0, pointerId: 1, clientX: 50, clientY: 30 });
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 30, bubbles: true }),
      );
    });
    // The card intercepts; the parent's onCreateAt (which opens the full
    // ManualBookingModal) fires only after «Создать».
    expect(screen.getByTestId("create-slot-popover")).toBeTruthy();
    expect(onCreateAt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("create-slot-create"));
    expect(onCreateAt).toHaveBeenCalledTimes(1);
    expect(onCreateAt.mock.calls[0]![0]).toEqual(expect.objectContaining({ modifier: "none" }));
  });
});
