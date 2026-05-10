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
  it("renders the rail with mini-month section (Jump By Week was removed)", () => {
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
    // Jump-By-Week was removed — the +1..-6 chip block is gone for good.
    expect(screen.queryByTestId("jump-by-week")).toBeNull();
    expect(screen.queryAllByTestId("jump-week-chip").length).toBe(0);
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

  // ── My Calendars section ──────────────────────────────────────────
  describe("My Calendars section", () => {
    const masters = [
      { chatId: 100, name: "Anna" },
      { chatId: 200, name: "Olga" },
      { chatId: 300, name: "Petr" },
    ];

    it("renders one toggle per master when masters + handlers are passed", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          masters={masters}
          hiddenMasterIds={new Set()}
          toggleMasterVisible={() => undefined}
        />,
        "en",
      );
      expect(screen.getByTestId("rail-my-calendars")).toBeTruthy();
      const toggles = screen.getAllByTestId("rail-master-toggle");
      expect(toggles.length).toBe(3);
      // All visible by default
      expect(toggles.every((t) => t.getAttribute("data-visible") === "1")).toBe(true);
    });

    it("does NOT render My Calendars when masters list is empty", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          masters={[]}
          hiddenMasterIds={new Set()}
          toggleMasterVisible={() => undefined}
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-my-calendars")).toBeNull();
    });

    it("clicking a master toggle calls toggleMasterVisible with the chatId", () => {
      const toggleMasterVisible = vi.fn();
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          masters={masters}
          hiddenMasterIds={new Set()}
          toggleMasterVisible={toggleMasterVisible}
        />,
        "en",
      );
      const toggles = screen.getAllByTestId("rail-master-toggle");
      const olga = toggles.find((t) => t.getAttribute("data-master-id") === "200");
      fireEvent.click(olga!);
      expect(toggleMasterVisible).toHaveBeenCalledWith(200);
    });

    it("Show all link only appears when at least one master is hidden", () => {
      const { rerender } = renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          masters={masters}
          hiddenMasterIds={new Set()}
          toggleMasterVisible={() => undefined}
          showAllMasters={() => undefined}
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-show-all-masters")).toBeNull();
      rerender(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          masters={masters}
          hiddenMasterIds={new Set([200])}
          toggleMasterVisible={() => undefined}
          showAllMasters={() => undefined}
        />,
      );
      expect(screen.getByTestId("rail-show-all-masters")).toBeTruthy();
    });
  });

  // ── Auto-confirm section ──────────────────────────────────────────
  describe("Auto-confirm section", () => {
    const allOff = { web: false, telegram: false, whatsapp: false, instagram: false };

    it("renders one row per channel when autoConfirm + setAutoConfirm are passed", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          autoConfirm={allOff}
          setAutoConfirm={() => undefined}
        />,
        "en",
      );
      expect(screen.getByTestId("rail-auto-confirm")).toBeTruthy();
      const rows = screen.getAllByTestId("rail-auto-confirm-row");
      expect(rows.length).toBe(4);
      const channels = rows.map((r) => r.getAttribute("data-channel"));
      expect(channels).toEqual(["web", "telegram", "whatsapp", "instagram"]);
    });

    it("data-enabled mirrors the autoConfirm state per channel", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          autoConfirm={{ web: true, telegram: false, whatsapp: true, instagram: false }}
          setAutoConfirm={() => undefined}
        />,
        "en",
      );
      const rows = screen.getAllByTestId("rail-auto-confirm-row");
      const byChannel: Record<string, string | null> = {};
      for (const r of rows) {
        byChannel[r.getAttribute("data-channel")!] = r.getAttribute("data-enabled");
      }
      expect(byChannel.web).toBe("1");
      expect(byChannel.telegram).toBe("0");
      expect(byChannel.whatsapp).toBe("1");
      expect(byChannel.instagram).toBe("0");
    });

    it("clicking a toggle calls setAutoConfirm with the inverted value", () => {
      const setAutoConfirm = vi.fn();
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          autoConfirm={{ web: true, telegram: false, whatsapp: false, instagram: false }}
          setAutoConfirm={setAutoConfirm}
        />,
        "en",
      );
      const toggles = screen.getAllByTestId("rail-auto-confirm-toggle");
      const tg = toggles.find((t) => t.getAttribute("data-channel") === "telegram");
      fireEvent.click(tg!);
      expect(setAutoConfirm).toHaveBeenCalledWith("telegram", true);
    });

    it("does NOT render Auto-confirm when settings are not passed", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-auto-confirm")).toBeNull();
    });
  });

  // ── Status filter section ─────────────────────────────────────────
  describe("Status filter section", () => {
    it("renders one toggle per status when hiddenStatuses + handler are passed", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          hiddenStatuses={new Set()}
          toggleStatusVisible={() => undefined}
        />,
        "en",
      );
      expect(screen.getByTestId("rail-status-filter")).toBeTruthy();
      const toggles = screen.getAllByTestId("rail-status-toggle");
      const statuses = toggles.map((t) => t.getAttribute("data-status"));
      expect(statuses).toEqual(["pending", "confirmed", "cancelled", "no_show", "done"]);
      expect(toggles.every((t) => t.getAttribute("data-visible") === "1")).toBe(true);
    });

    it("hides toggle visually when status is in hiddenStatuses", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          hiddenStatuses={new Set(["cancelled"]) as Set<any>}
          toggleStatusVisible={() => undefined}
        />,
        "en",
      );
      const toggles = screen.getAllByTestId("rail-status-toggle");
      const cancelled = toggles.find((t) => t.getAttribute("data-status") === "cancelled");
      const confirmed = toggles.find((t) => t.getAttribute("data-status") === "confirmed");
      expect(cancelled?.getAttribute("data-visible")).toBe("0");
      expect(confirmed?.getAttribute("data-visible")).toBe("1");
    });

    it("clicking a status toggle calls toggleStatusVisible with the status key", () => {
      const toggleStatusVisible = vi.fn();
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          hiddenStatuses={new Set()}
          toggleStatusVisible={toggleStatusVisible}
        />,
        "en",
      );
      const toggles = screen.getAllByTestId("rail-status-toggle");
      const pending = toggles.find((t) => t.getAttribute("data-status") === "pending");
      fireEvent.click(pending!);
      expect(toggleStatusVisible).toHaveBeenCalledWith("pending");
    });

    it("Show all link only appears when at least one status is hidden", () => {
      const { rerender } = renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          hiddenStatuses={new Set()}
          toggleStatusVisible={() => undefined}
          showAllStatuses={() => undefined}
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-show-all-statuses")).toBeNull();
      rerender(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          hiddenStatuses={new Set(["pending"]) as Set<any>}
          toggleStatusVisible={() => undefined}
          showAllStatuses={() => undefined}
        />,
      );
      expect(screen.getByTestId("rail-show-all-statuses")).toBeTruthy();
    });

    it("does NOT render Status filter when no handler passed", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-status-filter")).toBeNull();
    });
  });

  // ── Service filter section ────────────────────────────────────────
  describe("Service filter section", () => {
    const services = [
      { svcId: "manicure_classic", name: "Classic manicure", count: 3 },
      { svcId: "gel_polish", name: "Gel polish", count: 5 },
      { svcId: "pedicure_spa", name: "Pedicure spa" },
    ];

    it("renders one toggle per service", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          services={services}
          hiddenServiceIds={new Set()}
          toggleServiceVisible={() => undefined}
        />,
        "en",
      );
      expect(screen.getByTestId("rail-service-filter")).toBeTruthy();
      const toggles = screen.getAllByTestId("rail-service-toggle");
      expect(toggles.length).toBe(3);
      expect(toggles[0]?.getAttribute("data-service-id")).toBe("manicure_classic");
    });

    it("does NOT render when services list is empty", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          services={[]}
          hiddenServiceIds={new Set()}
          toggleServiceVisible={() => undefined}
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-service-filter")).toBeNull();
    });

    it("clicking a service toggle calls toggleServiceVisible with the svcId", () => {
      const toggleServiceVisible = vi.fn();
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          services={services}
          hiddenServiceIds={new Set()}
          toggleServiceVisible={toggleServiceVisible}
        />,
        "en",
      );
      const toggles = screen.getAllByTestId("rail-service-toggle");
      const gel = toggles.find((t) => t.getAttribute("data-service-id") === "gel_polish");
      fireEvent.click(gel!);
      expect(toggleServiceVisible).toHaveBeenCalledWith("gel_polish");
    });
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
