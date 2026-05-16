// @vitest-environment happy-dom
/**
 * CalendarViewSwitcher — Google Calendar–parity dropdown that replaced
 * the inline 5-pill bar in the 2026-05-16 calendar overhaul.
 *
 * Pins:
 *   - 4 options (no «Агенда»).
 *   - Trigger shows the current mode.
 *   - Picking an option calls `setMode` and closes the menu.
 *   - normalizeViewMode() collapses the legacy "agenda" key onto "list"
 *     and falls back to "week" for unknown values.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { CalendarViewSwitcher, normalizeViewMode } from "~/components/dashboards/CalendarViewSwitcher";
import { renderWithLang } from "./helpers/renderWithLang";

afterEach(() => cleanup());

describe("CalendarViewSwitcher", () => {
  it("renders the trigger with the current mode label", () => {
    renderWithLang(<CalendarViewSwitcher mode="week" setMode={() => undefined} lang="en" />, "en");
    const trigger = screen.getByTestId("apt-view-switcher-trigger");
    expect(trigger.getAttribute("data-current")).toBe("week");
    expect(trigger.textContent).toContain("Week");
  });

  it("clicking the trigger opens the menu with all 4 options", () => {
    renderWithLang(<CalendarViewSwitcher mode="week" setMode={() => undefined} lang="en" />, "en");
    fireEvent.click(screen.getByTestId("apt-view-switcher-trigger"));
    const menu = screen.getByTestId("apt-view-switcher-menu");
    expect(menu).toBeTruthy();
    expect(screen.getByTestId("apt-view-switcher-option-day")).toBeTruthy();
    expect(screen.getByTestId("apt-view-switcher-option-week")).toBeTruthy();
    expect(screen.getByTestId("apt-view-switcher-option-calendar")).toBeTruthy();
    expect(screen.getByTestId("apt-view-switcher-option-list")).toBeTruthy();
    // «Агенда» mode dropped — never render this option.
    expect(screen.queryByTestId("apt-view-switcher-option-agenda")).toBeNull();
  });

  it("picking an option calls setMode and closes the menu", () => {
    const setMode = vi.fn();
    renderWithLang(<CalendarViewSwitcher mode="week" setMode={setMode} lang="en" />, "en");
    fireEvent.click(screen.getByTestId("apt-view-switcher-trigger"));
    fireEvent.click(screen.getByTestId("apt-view-switcher-option-day"));
    expect(setMode).toHaveBeenCalledWith("day");
    expect(screen.queryByTestId("apt-view-switcher-menu")).toBeNull();
  });

  it("active option is marked with data-active=1", () => {
    renderWithLang(<CalendarViewSwitcher mode="calendar" setMode={() => undefined} lang="en" />, "en");
    fireEvent.click(screen.getByTestId("apt-view-switcher-trigger"));
    expect(screen.getByTestId("apt-view-switcher-option-calendar").getAttribute("data-active")).toBe("1");
    expect(screen.getByTestId("apt-view-switcher-option-week").getAttribute("data-active")).toBe("0");
  });

  it("custom testIdPrefix lets two switchers coexist on a page", () => {
    renderWithLang(
      <CalendarViewSwitcher mode="day" setMode={() => undefined} lang="en" testIdPrefix="salon-apt" />,
      "en",
    );
    expect(screen.getByTestId("salon-apt-view-switcher-trigger")).toBeTruthy();
  });
});

describe("normalizeViewMode", () => {
  it("passes through current 4 modes unchanged", () => {
    for (const m of ["day", "week", "calendar", "list"] as const) {
      expect(normalizeViewMode(m)).toBe(m);
    }
  });

  it("collapses the legacy 'agenda' value onto 'list'", () => {
    expect(normalizeViewMode("agenda")).toBe("list");
  });

  it("falls back to 'week' for unknown / nullish values", () => {
    expect(normalizeViewMode(undefined)).toBe("week");
    expect(normalizeViewMode(null)).toBe("week");
    expect(normalizeViewMode("garbage")).toBe("week");
  });
});
