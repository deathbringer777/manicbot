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
import { act, cleanup, screen, fireEvent } from "@testing-library/react";

vi.mock("~/lib/appointments", () => ({
  APT_BORDER: {
    confirmed: "border-l-emerald-500",
    pending: "border-l-amber-500",
    cancelled: "border-l-red-500",
    no_show: "border-l-orange-500",
    done: "border-l-brand-500",
  },
  // AptCard / StatusActionMenu (rendered in the legacy drawer + re-exported
  // by AppointmentDetailPanel) read STATUS_STYLES — must be present or the
  // detail surfaces throw on click.
  STATUS_STYLES: {
    confirmed: "bg-emerald-500/15",
    pending: "bg-amber-500/15",
    cancelled: "bg-red-500/15",
    rejected: "bg-red-500/15",
    no_show: "bg-orange-500/15",
    done: "bg-brand-500/15",
  },
  STATUS_LABELS: {
    confirmed: "Confirmed",
    pending: "Pending",
    cancelled: "Cancelled",
    no_show: "No-show",
    done: "Done",
  },
}));

// AppointmentDetailPanel (rendered when tenantId + services are passed) uses
// tRPC mutations + the client modal. Stub both so the Week-view drawer-routing
// contract can be asserted without their data layers (each is covered by its
// own test file).
vi.mock("~/trpc/react", () => ({
  api: {
    appointments: { update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    salon: {
      confirmAppointment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      markDone: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      markNoShow: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      cancelAppointment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock("~/components/salon/tabs/clients/ClientDetailModal", () => ({
  ClientDetailModal: () => <div data-testid="client-detail-modal-stub" />,
}));

import { SalonWeekView } from "~/components/dashboards/SalonWeekView";
import { renderWithLang } from "./helpers/renderWithLang";

const services = [
  { svcId: "manicure", names: '{"en":"Manicure"}', duration: 60, price: 120 },
];

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

  describe("appointment click → detail surface", () => {
    it("opens the rich AppointmentDetailPanel when tenantId + services are provided", () => {
      renderWithLang(
        <SalonWeekView
          date={new Date("2026-05-10T12:00:00")}
          setDate={() => undefined}
          apts={[apt({ id: 7 })]}
          masters={masters}
          isLoading={false}
          lang="en"
          tenantId="t_demo"
          services={services}
        />,
        "en",
      );
      fireEvent.click(screen.getByTestId("week-view-event"));
      // The panel exposes the «Профиль клиента» button (chatId present) —
      // that's our proof the rich panel rendered, not the AptCard drawer.
      expect(screen.getByTestId("panel-open-client")).toBeTruthy();
      expect(screen.queryByTestId("week-view-selected")).toBeNull();
    });

    it("falls back to the legacy AptCard drawer when tenantId/services are absent (God-Mode page)", () => {
      renderWithLang(
        <SalonWeekView
          date={new Date("2026-05-10T12:00:00")}
          setDate={() => undefined}
          apts={[apt({ id: 7 })]}
          masters={masters}
          isLoading={false}
          lang="en"
        />,
        "en",
      );
      fireEvent.click(screen.getByTestId("week-view-event"));
      expect(screen.getByTestId("week-view-selected")).toBeTruthy();
      expect(screen.queryByTestId("panel-open-client")).toBeNull();
    });
  });

  // ── Non-working hours overlay (salon «Godziny pracy») ──────────────────
  // Salon-level hours shade the week grid with the same gray diagonal gradient
  // used for time-off blocks. Geometry mirrors SalonDayView's per-master tint.
  describe("non-working hours overlay", () => {
    // Mon–Sat 09:00–20:00, Sunday off — matches the «Godziny pracy» screen.
    const workHours = {
      mon: { open: "09:00", close: "20:00" },
      tue: { open: "09:00", close: "20:00" },
      wed: { open: "09:00", close: "20:00" },
      thu: { open: "09:00", close: "20:00" },
      fri: { open: "09:00", close: "20:00" },
      sat: { open: "09:00", close: "20:00" },
      sun: null,
    };

    function colByDay(iso: string): HTMLElement {
      const col = screen
        .getAllByTestId("week-view-day-column")
        .find((c) => c.getAttribute("data-day") === iso);
      if (!col) throw new Error(`no column for ${iso}`);
      return col;
    }

    it("renders no overlay when workHours is omitted (God-Mode / per-master callers)", () => {
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
      expect(screen.queryAllByTestId("week-view-non-working").length).toBe(0);
    });

    it("shades a day off (Sunday) with a single full-height band", () => {
      renderWithLang(
        <SalonWeekView
          date={new Date("2026-05-10T12:00:00")} // week Mon 05-04 … Sun 05-10
          setDate={() => undefined}
          apts={[]}
          masters={masters}
          isLoading={false}
          lang="en"
          workHours={workHours}
        />,
        "en",
      );
      const bands = colByDay("2026-05-10").querySelectorAll(
        "[data-testid='week-view-non-working']",
      );
      expect(bands.length).toBe(1);
      // HOUR_HEIGHT(48) × TOTAL_HOURS(14) = 672px full-height band.
      expect((bands[0] as HTMLElement).style.height).toBe("672px");
      expect(bands[0]!.getAttribute("style")).toContain("repeating-linear-gradient");
    });

    it("shades before-open + after-close on a working day (09:00–20:00 in 08:00–22:00)", () => {
      renderWithLang(
        <SalonWeekView
          date={new Date("2026-05-10T12:00:00")}
          setDate={() => undefined}
          apts={[]}
          masters={masters}
          isLoading={false}
          lang="en"
          workHours={workHours}
        />,
        "en",
      );
      const bands = Array.from(
        colByDay("2026-05-04").querySelectorAll("[data-testid='week-view-non-working']"),
      ) as HTMLElement[];
      expect(bands.length).toBe(2);
      // Before 09:00 → from 08:00, 1h = 48px tall, anchored at top 0.
      const before = bands.find((b) => b.style.top === "0px");
      expect(before?.style.height).toBe("48px");
      // After 20:00 → top = 12h = 576px, height = 672 − 576 = 96px.
      const after = bands.find((b) => b.style.top === "576px");
      expect(after?.style.height).toBe("96px");
    });

    it("shades the whole column when the salon is closed that weekday", () => {
      renderWithLang(
        <SalonWeekView
          date={new Date("2026-05-10T12:00:00")}
          setDate={() => undefined}
          apts={[]}
          masters={masters}
          isLoading={false}
          lang="en"
          workHours={{ ...workHours, mon: null }}
        />,
        "en",
      );
      const bands = colByDay("2026-05-04").querySelectorAll(
        "[data-testid='week-view-non-working']",
      );
      expect(bands.length).toBe(1);
      expect((bands[0] as HTMLElement).style.height).toBe("672px");
    });
  });
});

describe("SalonWeekView — layout & navigation", () => {
  it("renders the calendar as one monolithic card with the empty state below it", () => {
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
    const root = screen.getByTestId("salon-week-view");
    const card = screen.getByTestId("week-view-card");
    const empty = screen.getByTestId("week-view-empty");
    // The 7-day grid lives INSIDE the monolithic card…
    expect(card.querySelectorAll("[data-testid='week-view-day-column']").length).toBe(7);
    // …and the empty state is a sibling rendered AFTER the card, not nested in it.
    expect(card.contains(empty)).toBe(false);
    const kids = Array.from(root.children);
    expect(kids.indexOf(empty)).toBeGreaterThan(kids.indexOf(card));
  });

  it("styles the week nav buttons with the brand-purple tint", () => {
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
    for (const id of ["week-view-prev", "week-view-today", "week-view-next"]) {
      expect(screen.getByTestId(id).className).toContain("brand-500/10");
    }
  });
});

describe("SalonWeekView — Google-Calendar popovers", () => {
  it("clicking an event opens the anchored detail popover (not a below-grid card)", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[apt({ id: 7 })]}
        masters={masters}
        isLoading={false}
        lang="en"
        tenantId="t_demo"
        services={services}
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("week-view-event"));
    expect(screen.getByTestId("appointment-detail-popover")).toBeTruthy();
    expect(screen.queryByTestId("week-view-selected")).toBeNull();
  });

  it("dragging an empty slot shows the quick-create card and defers the full form until «Создать»", () => {
    const onCreateAt = vi.fn();
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="ru"
        tenantId="t_demo"
        services={services}
        onCreateAt={onCreateAt}
      />,
      "ru",
    );
    // A pointer-down + pointer-up with no movement = a click-create on the
    // empty grid. The OLD behaviour fired onCreateAt immediately (full-screen
    // modal → «фон не видно»); now it must defer behind the quick-create card.
    const layer = screen.getAllByTestId("week-view-drag-layer")[0]!;
    fireEvent.pointerDown(layer, { button: 0, pointerId: 1, clientX: 50, clientY: 30 });
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 30, bubbles: true }),
      );
    });
    expect(screen.getByTestId("create-slot-popover")).toBeTruthy();
    expect(onCreateAt).not.toHaveBeenCalled();
    // GCal parity: the dragged slot stays painted while the card is open.
    expect(screen.getAllByTestId("week-view-draft-slot").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("create-slot-create"));
    expect(onCreateAt).toHaveBeenCalledTimes(1);
    expect(onCreateAt.mock.calls[0]![0]).toEqual(expect.objectContaining({ modifier: "none" }));
  });
});

describe("SalonWeekView — blocks share lanes with appointments", () => {
  it("renders a reservation block side-by-side with an overlapping appointment", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[apt({ id: 1, date: "2026-05-10", time: "10:00", duration: 60 })]}
        masters={masters}
        isLoading={false}
        lang="en"
        tenantId="t_demo"
        services={services}
        blocks={[
          { id: "b1", date: "2026-05-10", time: "10:00", durationMin: 60, masterId: 100, type: "reservation" },
        ]}
      />,
      "en",
    );
    const event = screen.getByTestId("week-view-event");
    const block = screen.getByTestId("week-view-block");
    // Two items overlap → 2 lanes → each (100-4)/2 = 48% wide.
    expect(event.style.width).toBe("calc(48% - 2px)");
    expect(block.style.width).toBe("calc(48% - 2px)");
    // Distinct lanes: one at the left edge, the other offset by 48%.
    const lefts = [event.style.left, block.style.left].sort();
    expect(lefts).toEqual(["calc(0% + 2px)", "calc(48% + 2px)"]);
  });

  it("keeps a multi-day time_off band full-width (not laned)", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
        tenantId="t_demo"
        services={services}
        blocks={[
          { id: "v1", date: "2026-05-04", endDate: "2026-05-12", time: "00:00", durationMin: 1440, masterId: 100, type: "time_off" },
        ]}
      />,
      "en",
    );
    const band = screen.getAllByTestId("week-view-block")[0]!;
    // Full-width band uses numeric left/right insets, not lane calc geometry.
    expect(band.style.left).toBe("4px");
    expect(band.style.right).toBe("4px");
    expect(band.style.width).toBe("");
  });
});

describe("SalonWeekView — header switcher slot", () => {
  it("renders headerRight (the view switcher) inside the calendar card header", () => {
    renderWithLang(
      <SalonWeekView
        date={new Date("2026-05-10T12:00:00")}
        setDate={() => undefined}
        apts={[]}
        masters={masters}
        isLoading={false}
        lang="en"
        headerRight={<div data-testid="hr-sentinel">switch</div>}
      />,
      "en",
    );
    const card = screen.getByTestId("week-view-card");
    // The switcher must live INSIDE the calendar card header (right of the
    // date nav), not on a separate row above the grid.
    expect(card.querySelector("[data-testid='hr-sentinel']")).toBeTruthy();
  });
});
