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
 *   - Hidden on touch breakpoints (`hidden lg:flex` so the calendar grid
 *     gets the full width on phone / tablet).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, screen, fireEvent, within } from "@testing-library/react";
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
  it("renders the rail with the mini-month section", () => {
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
  });

  it("does NOT render the legacy Jump By Week chips block", () => {
    renderWithLang(
      <CalendarLeftRail
        selectedDate={FIXED_NOW}
        setSelectedDate={() => undefined}
        lang="en"
      />,
      "en",
    );
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

  // ── Status filter dropdown (FilterDropdown, single-select) ────────
  // 2026-05-26: was a Set-based multi-toggle list; replaced with a
  // single-select dropdown. Auto-confirm rail section was removed
  // entirely — the settings live in /settings?section=salon now.
  describe("Status filter dropdown", () => {
    it("renders the filters card when setStatusFilter is supplied", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          statusFilter={null}
          setStatusFilter={() => undefined}
        />,
        "en",
      );
      expect(screen.getByTestId("rail-filters")).toBeTruthy();
      expect(screen.getByTestId("rail-status-filter")).toBeTruthy();
      expect(screen.getByTestId("rail-status-filter-trigger")).toBeTruthy();
    });

    it("trigger shows the selected status label when one is chosen", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          statusFilter="confirmed"
          setStatusFilter={() => undefined}
        />,
        "en",
      );
      const trigger = screen.getByTestId("rail-status-filter-trigger");
      expect(trigger.textContent).toContain("Confirmed");
    });

    it("selecting a status calls setStatusFilter with that key", () => {
      const setStatusFilter = vi.fn();
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          statusFilter={null}
          setStatusFilter={setStatusFilter}
        />,
        "en",
      );
      fireEvent.click(screen.getByTestId("rail-status-filter-trigger"));
      fireEvent.click(screen.getByTestId("rail-status-filter-option-pending"));
      expect(setStatusFilter).toHaveBeenCalledWith("pending");
    });

    it("selecting the 'All' option calls setStatusFilter(null)", () => {
      const setStatusFilter = vi.fn();
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          statusFilter="pending"
          setStatusFilter={setStatusFilter}
        />,
        "en",
      );
      fireEvent.click(screen.getByTestId("rail-status-filter-trigger"));
      // FilterDropdown renders the "all" row as the first <li> inside the listbox.
      const menu = screen.getByRole("listbox");
      const items = within(menu).getAllByRole("option");
      fireEvent.click(items[0]!);
      expect(setStatusFilter).toHaveBeenCalledWith(null);
    });

    it("does NOT render filters card when no filter handler is supplied", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-filters")).toBeNull();
    });
  });

  // ── Service filter dropdown (FilterDropdown, single-select) ───────
  describe("Service filter dropdown", () => {
    const services = [
      { svcId: "manicure_classic", name: "Classic manicure", count: 3 },
      { svcId: "gel_polish", name: "Gel polish", count: 5 },
      { svcId: "pedicure_spa", name: "Pedicure spa" },
    ];

    it("renders the service dropdown when services + setServiceFilter passed", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          services={services}
          serviceFilter={null}
          setServiceFilter={() => undefined}
        />,
        "en",
      );
      expect(screen.getByTestId("rail-service-filter")).toBeTruthy();
      expect(screen.getByTestId("rail-service-filter-trigger")).toBeTruthy();
    });

    it("does NOT render when services list is empty", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          services={[]}
          serviceFilter={null}
          setServiceFilter={() => undefined}
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-service-filter")).toBeNull();
    });

    it("selecting a service calls setServiceFilter with the svcId", () => {
      const setServiceFilter = vi.fn();
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          services={services}
          serviceFilter={null}
          setServiceFilter={setServiceFilter}
        />,
        "en",
      );
      fireEvent.click(screen.getByTestId("rail-service-filter-trigger"));
      fireEvent.click(screen.getByTestId("rail-service-filter-option-gel_polish"));
      expect(setServiceFilter).toHaveBeenCalledWith("gel_polish");
    });

    it("rendered label includes the count suffix when count > 0", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          services={services}
          serviceFilter={null}
          setServiceFilter={() => undefined}
        />,
        "en",
      );
      fireEvent.click(screen.getByTestId("rail-service-filter-trigger"));
      const gel = screen.getByTestId("rail-service-filter-option-gel_polish");
      expect(gel.textContent).toContain("Gel polish");
      expect(gel.textContent).toContain("(5)");
    });
  });

  // ── Removed: Auto-confirm section ────────────────────────────────
  // The rail no longer renders an auto-confirm panel. It moved to
  // /settings?section=salon (MySalonSection → AutoConfirmSettings).
  describe("Auto-confirm section (removed)", () => {
    it("does NOT render the auto-confirm panel anywhere on the rail", () => {
      renderWithLang(
        <CalendarLeftRail
          selectedDate={FIXED_NOW}
          setSelectedDate={() => undefined}
          lang="en"
          statusFilter={null}
          setStatusFilter={() => undefined}
        />,
        "en",
      );
      expect(screen.queryByTestId("rail-auto-confirm")).toBeNull();
      expect(screen.queryByTestId("rail-auto-confirm-toggle")).toBeNull();
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
