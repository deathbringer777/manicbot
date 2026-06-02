// @vitest-environment happy-dom
/**
 * MonthCalendar — shared GCal-style month grid used by every appointment
 * view (system_admin /appointments, tenant_owner SalonDashboard,
 * master schedule). Pins:
 *
 *   - Mon-anchored grid; out-of-month days padded so every cell is a real
 *     date (no empty boxes), out-of-month cells flagged data-in-month=0.
 *   - Today's number marked data-today=1; selected day data-selected=1.
 *   - Up to 3 events per cell + "+N more" overflow.
 *   - Cancelled / no_show events render at reduced opacity (data-status).
 *   - Master color stripe applied when masters are passed in (matches
 *     SalonDayView/Week palette so the same master is the same hue
 *     everywhere).
 *   - prev/next chevrons + "today" button drive setViewDate; selecting
 *     a cell drives setSelectedDay.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { MonthCalendar } from "~/components/calendar/MonthCalendar";
import { renderWithLang } from "./helpers/renderWithLang";

const FIXED_NOW = new Date("2026-05-10T12:00:00");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function apt(overrides: Record<string, any> = {}) {
  return {
    id: "a1",
    date: "2026-05-10",
    time: "10:00",
    status: "confirmed",
    cancelled: 0,
    noShow: 0,
    userName: "Anna",
    chatId: 100,
    svcId: "manicure",
    masterId: 100,
    ...overrides,
  };
}

describe("MonthCalendar", () => {
  it("renders the month label localized", () => {
    renderWithLang(
      <MonthCalendar
        apts={[]}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay={null}
        setSelectedDay={() => undefined}
        lang="ru"
      />,
      "ru",
    );
    expect(screen.getByTestId("month-calendar")).toBeTruthy();
    // "Май 2026" or "май 2026 г." — just the month root
    expect(document.body.textContent?.toLowerCase()).toMatch(/май/);
  });

  it("pads with prev/next month days so every cell is a real date", () => {
    renderWithLang(
      <MonthCalendar
        apts={[]}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay={null}
        setSelectedDay={() => undefined}
        lang="en"
      />,
      "en",
    );
    const cells = screen.getAllByTestId("month-cal-day");
    // 35 or 42 cells (5 or 6 weeks). May 2026 starts on a Friday → 6-week view.
    expect(cells.length % 7).toBe(0);
    // Every cell carries a real ISO date.
    cells.forEach((c) => {
      expect(c.getAttribute("data-day")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    // At least one out-of-month cell exists.
    expect(cells.some((c) => c.getAttribute("data-in-month") === "0")).toBe(true);
  });

  it("marks today and selected cells with the right data attrs", () => {
    renderWithLang(
      <MonthCalendar
        apts={[]}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay="2026-05-15"
        setSelectedDay={() => undefined}
        lang="en"
      />,
      "en",
    );
    const cells = screen.getAllByTestId("month-cal-day");
    const today = cells.find((c) => c.getAttribute("data-day") === "2026-05-10");
    const selected = cells.find((c) => c.getAttribute("data-day") === "2026-05-15");
    expect(today?.getAttribute("data-today")).toBe("1");
    expect(today?.getAttribute("data-selected")).toBe("0");
    expect(selected?.getAttribute("data-today")).toBe("0");
    expect(selected?.getAttribute("data-selected")).toBe("1");
  });

  it("clicking a day calls setSelectedDay with the iso date", () => {
    const setSelectedDay = vi.fn();
    renderWithLang(
      <MonthCalendar
        apts={[]}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay={null}
        setSelectedDay={setSelectedDay}
        lang="en"
      />,
      "en",
    );
    const cells = screen.getAllByTestId("month-cal-day");
    const target = cells.find((c) => c.getAttribute("data-day") === "2026-05-12");
    fireEvent.click(target!);
    expect(setSelectedDay).toHaveBeenCalledWith("2026-05-12");
  });

  it("clicking a selected day toggles it back off", () => {
    const setSelectedDay = vi.fn();
    renderWithLang(
      <MonthCalendar
        apts={[]}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay="2026-05-12"
        setSelectedDay={setSelectedDay}
        lang="en"
      />,
      "en",
    );
    const cells = screen.getAllByTestId("month-cal-day");
    const target = cells.find((c) => c.getAttribute("data-day") === "2026-05-12");
    fireEvent.click(target!);
    expect(setSelectedDay).toHaveBeenCalledWith(null);
  });

  it("prev / next chevrons advance the visible month", () => {
    const setViewDate = vi.fn();
    renderWithLang(
      <MonthCalendar
        apts={[]}
        viewDate={FIXED_NOW}
        setViewDate={setViewDate}
        selectedDay={null}
        setSelectedDay={() => undefined}
        lang="en"
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("month-cal-prev"));
    fireEvent.click(screen.getByTestId("month-cal-next"));
    expect(setViewDate).toHaveBeenCalledTimes(2);
    const prevArg = setViewDate.mock.calls[0]![0] as Date;
    const nextArg = setViewDate.mock.calls[1]![0] as Date;
    expect(prevArg.getMonth()).toBe(3); // April
    expect(nextArg.getMonth()).toBe(5); // June
  });

  it("'today' button resets viewDate to today and clears selectedDay", () => {
    const setViewDate = vi.fn();
    const setSelectedDay = vi.fn();
    renderWithLang(
      <MonthCalendar
        apts={[]}
        viewDate={new Date("2027-01-15")}
        setViewDate={setViewDate}
        selectedDay="2027-01-10"
        setSelectedDay={setSelectedDay}
        lang="en"
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("month-cal-today"));
    expect(setViewDate).toHaveBeenCalledTimes(1);
    expect(setSelectedDay).toHaveBeenCalledWith(null);
  });

  it("renders up to 3 events per cell and overflow indicator for more", () => {
    const apts = [
      apt({ id: 1, time: "09:00" }),
      apt({ id: 2, time: "10:00" }),
      apt({ id: 3, time: "11:00" }),
      apt({ id: 4, time: "12:00" }),
      apt({ id: 5, time: "13:00" }),
    ];
    renderWithLang(
      <MonthCalendar
        apts={apts}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay={null}
        setSelectedDay={() => undefined}
        lang="en"
      />,
      "en",
    );
    const events = screen.getAllByTestId("month-cal-event");
    expect(events.length).toBe(3);
    expect(screen.getByTestId("month-cal-overflow").textContent).toContain("+2");
  });

  it("event row carries status data attribute (cancelled/no_show/etc)", () => {
    renderWithLang(
      <MonthCalendar
        apts={[
          apt({ id: 1, status: "confirmed" }),
          apt({ id: 2, status: "pending", time: "11:00" }),
          apt({ id: 3, cancelled: 1, status: "cancelled", time: "12:00" }),
        ]}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay={null}
        setSelectedDay={() => undefined}
        lang="en"
      />,
      "en",
    );
    const events = screen.getAllByTestId("month-cal-event");
    const byId: Record<string, string | null> = {};
    events.forEach((e) => {
      byId[e.getAttribute("data-apt-id")!] = e.getAttribute("data-status");
    });
    expect(byId["1"]).toBe("confirmed");
    expect(byId["2"]).toBe("pending");
    expect(byId["3"]).toBe("cancelled");
  });

  it("uses master palette color when masters are provided", () => {
    renderWithLang(
      <MonthCalendar
        apts={[apt({ id: 1, masterId: 200 })]}
        masters={[
          { chatId: 100, name: "Anna" }, // idx 0 — MASTER_EVENT_HUES[0] (red)
          { chatId: 200, name: "Olga" }, // idx 1 — MASTER_EVENT_HUES[1] (turquoise)
        ]}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay={null}
        setSelectedDay={() => undefined}
        lang="en"
      />,
      "en",
    );
    const event = screen.getByTestId("month-cal-event");
    // Olga is index 1 → MASTER_EVENT_HUES[1] = #1ea896 (turquoise). Find the
    // master-color stripe span; style carries the hue as hex or rgb.
    const stripe = event.querySelector("span[style*='background']") as HTMLElement | null;
    expect(stripe).toBeTruthy();
    expect(stripe!.getAttribute("style") ?? "").toMatch(/1ea896|30.*168.*150/);
  });

  it("shows a count badge in cells that have appointments", () => {
    renderWithLang(
      <MonthCalendar
        apts={[apt({ id: 1, time: "09:00" }), apt({ id: 2, time: "10:00" })]}
        viewDate={FIXED_NOW}
        setViewDate={() => undefined}
        selectedDay={null}
        setSelectedDay={() => undefined}
        lang="en"
      />,
      "en",
    );
    const cells = screen.getAllByTestId("month-cal-day");
    const may10 = cells.find((c) => c.getAttribute("data-day") === "2026-05-10");
    // Count badge is the second <span> inside the header strip — the first
    // is the day number ("10"), second carries the appointment count ("2").
    const badges = may10!.querySelectorAll("span");
    const counts = Array.from(badges).map((s) => s.textContent?.trim());
    expect(counts).toContain("2");
  });

  describe("onEventClick (chip → detail popover trigger)", () => {
    it("fires onEventClick with the apt + a rect, and does NOT select the day (stopPropagation)", () => {
      const onEventClick = vi.fn();
      const setSelectedDay = vi.fn();
      renderWithLang(
        <MonthCalendar
          apts={[apt({ id: "x1", date: "2026-05-10" })]}
          viewDate={FIXED_NOW}
          setViewDate={() => undefined}
          selectedDay={null}
          setSelectedDay={setSelectedDay}
          lang="en"
          onEventClick={onEventClick}
        />,
        "en",
      );
      const chip = screen.getByTestId("month-cal-event");
      expect(chip.getAttribute("role")).toBe("button");
      fireEvent.click(chip);
      expect(onEventClick).toHaveBeenCalledTimes(1);
      const [aptArg, rectArg] = onEventClick.mock.calls[0]!;
      expect((aptArg as { id: string }).id).toBe("x1");
      expect(rectArg).toEqual(
        expect.objectContaining({
          left: expect.any(Number),
          top: expect.any(Number),
          width: expect.any(Number),
          height: expect.any(Number),
        }),
      );
      // The chip stops propagation so the day-cell select must NOT fire.
      expect(setSelectedDay).not.toHaveBeenCalled();
    });

    it("leaves chips non-interactive (no button role) when onEventClick is omitted", () => {
      renderWithLang(
        <MonthCalendar
          apts={[apt({ id: "x2", date: "2026-05-10" })]}
          viewDate={FIXED_NOW}
          setViewDate={() => undefined}
          selectedDay={null}
          setSelectedDay={() => undefined}
          lang="en"
        />,
        "en",
      );
      expect(screen.getByTestId("month-cal-event").getAttribute("role")).toBeNull();
    });
  });
});
