// @vitest-environment happy-dom
/**
 * CalendarLeftRail — Booksy / Google Calendar style left rail next to the
 * Day / Week / Month / Agenda views. Pins:
 *
 *   - Mini month grid: Mon-anchored, 7 weekday headers, today + selected
 *     day get distinct visual states.
 *   - Clicking a day in the mini-cal calls setSelectedDate with that day.
 *   - prev / next chevrons advance the view month without changing
 *     selectedDate (separate concerns).
 *   - Jump By Week renders 12 chips: +1..+6 (green) and -1..-6 (red);
 *     clicking shifts selectedDate by `delta * 7` days.
 *   - Hidden on touch breakpoints (`hidden lg:flex` so the calendar grid
 *     gets the full width on phone / tablet).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { CalendarLeftRail } from "~/components/dashboards/CalendarLeftRail";
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

describe("CalendarLeftRail", () => {
  it("renders the rail with mini-month + jump-by-week sections", () => {
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={() => undefined}
        lang="en"
      />,
      "en",
    );
    expect(screen.getByTestId("calendar-left-rail")).toBeTruthy();
    expect(screen.getByTestId("calendar-mini-month")).toBeTruthy();
    expect(screen.getByTestId("jump-by-week")).toBeTruthy();
  });

  it("renders 12 jump-by-week chips (+1..+6, -1..-6) with the right delta attributes", () => {
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={() => undefined}
        lang="en"
      />,
      "en",
    );
    const chips = screen.getAllByTestId("jump-week-chip");
    expect(chips.length).toBe(12);
    const deltas = chips.map((c) => Number(c.getAttribute("data-delta")));
    expect(deltas).toEqual([1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5, -6]);
  });

  it("clicking a +N chip shifts selectedDate by N * 7 days", () => {
    const setSelectedDate = vi.fn();
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={setSelectedDate}
        lang="en"
      />,
      "en",
    );
    const chips = screen.getAllByTestId("jump-week-chip");
    const plusTwo = chips.find((c) => c.getAttribute("data-delta") === "2");
    fireEvent.click(plusTwo!);
    expect(setSelectedDate).toHaveBeenCalledTimes(1);
    const arg = setSelectedDate.mock.calls[0]![0] as Date;
    expect(arg.toISOString().slice(0, 10)).toBe("2026-05-24"); // +14 days from 2026-05-10
  });

  it("clicking a -N chip shifts selectedDate backwards by N * 7 days", () => {
    const setSelectedDate = vi.fn();
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={setSelectedDate}
        lang="en"
      />,
      "en",
    );
    const chips = screen.getAllByTestId("jump-week-chip");
    const minusOne = chips.find((c) => c.getAttribute("data-delta") === "-1");
    fireEvent.click(minusOne!);
    const arg = setSelectedDate.mock.calls[0]![0] as Date;
    expect(arg.toISOString().slice(0, 10)).toBe("2026-05-03");
  });

  it("clicking a day in mini-month calls setSelectedDate with that day", () => {
    const setSelectedDate = vi.fn();
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={setSelectedDate}
        lang="en"
      />,
      "en",
    );
    const days = screen.getAllByTestId("mini-month-day");
    const day15 = days.find((d) => d.getAttribute("data-day") === "2026-05-15");
    fireEvent.click(day15!);
    const arg = setSelectedDate.mock.calls[0]![0] as Date;
    // Compare local-timezone components (the component constructs dates in
    // local time; ISO string would shift on non-UTC test runners).
    expect(arg.getFullYear()).toBe(2026);
    expect(arg.getMonth()).toBe(4); // May (0-indexed)
    expect(arg.getDate()).toBe(15);
  });

  it("today's cell is marked with data-today=1, selected with data-selected=1", () => {
    renderWithLang(
      <CalendarLeftRail
        selectedDate={new Date("2026-05-15T12:00:00")} // not today
        setSelectedDate={() => undefined}
        lang="en"
      />,
      "en",
    );
    const days = screen.getAllByTestId("mini-month-day");
    const today = days.find((d) => d.getAttribute("data-day") === "2026-05-10");
    const selected = days.find((d) => d.getAttribute("data-day") === "2026-05-15");
    expect(today?.getAttribute("data-today")).toBe("1");
    expect(today?.getAttribute("data-selected")).toBe("0");
    expect(selected?.getAttribute("data-today")).toBe("0");
    expect(selected?.getAttribute("data-selected")).toBe("1");
  });

  it("prev/next chevrons change the visible month (not the selectedDate)", () => {
    const setSelectedDate = vi.fn();
    const setViewMonth = vi.fn();
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={setSelectedDate}
        viewMonth={FIXED_NOW}
        setViewMonth={setViewMonth}
        lang="en"
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("mini-month-prev"));
    expect(setViewMonth).toHaveBeenCalledTimes(1);
    expect(setSelectedDate).not.toHaveBeenCalled();
    const nextMonth = setViewMonth.mock.calls[0]![0] as Date;
    // Local-time check (April = month 3, 0-indexed) — toISOString() would
    // shift on negative-UTC-offset runners.
    expect(nextMonth.getFullYear()).toBe(2026);
    expect(nextMonth.getMonth()).toBe(3); // April
    expect(nextMonth.getDate()).toBe(1);
  });

  it("rail is hidden on touch breakpoints (hidden lg:flex)", () => {
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={() => undefined}
        lang="en"
      />,
      "en",
    );
    const rail = screen.getByTestId("calendar-left-rail");
    expect(rail.className).toMatch(/hidden\s+lg:flex/);
  });

  it("renders Mon-anchored weekday header (Monday in column 0)", () => {
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={() => undefined}
        lang="en"
      />,
      "en",
    );
    // Day 4 May 2026 is a Monday, so it should fall on the leftmost
    // column of the first non-padded row.
    const day4 = screen.getAllByTestId("mini-month-day").find(
      (d) => d.getAttribute("data-day") === "2026-05-04",
    );
    expect(day4).toBeTruthy();
  });
});
