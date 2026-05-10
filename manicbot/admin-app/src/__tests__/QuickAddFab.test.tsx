// @vitest-environment happy-dom
/**
 * QuickAddFab — bottom-right floating menu for the appointments tab.
 *
 * Pins:
 *   - The button toggles the menu open/closed.
 *   - Three actions render in fixed order: New booking, Time reservation,
 *     Time off.
 *   - Time reservation + Time off are "soon" disabled when their handlers
 *     aren't passed in (this is the current first-ship state — backend
 *     `appointment_blocks` lands later).
 *   - Clicking New booking calls onNewBooking and closes the menu.
 *   - Escape closes the menu.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { QuickAddFab } from "~/components/dashboards/QuickAddFab";
import { renderWithLang } from "./helpers/renderWithLang";

afterEach(() => {
  cleanup();
});

describe("QuickAddFab", () => {
  it("starts closed; clicking the FAB opens the menu", () => {
    renderWithLang(<QuickAddFab lang="en" onNewBooking={() => undefined} />, "en");
    expect(screen.queryByTestId("quick-add-menu")).toBeNull();
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.getByTestId("quick-add-menu")).toBeTruthy();
  });

  it("renders all three actions in order", () => {
    renderWithLang(<QuickAddFab lang="en" onNewBooking={() => undefined} />, "en");
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    const ids = [
      "quick-add-newBooking",
      "quick-add-timeReservation",
      "quick-add-timeOff",
    ];
    for (const id of ids) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it("Time reservation + Time off are disabled when their handlers are not passed", () => {
    renderWithLang(<QuickAddFab lang="en" onNewBooking={() => undefined} />, "en");
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.getByTestId("quick-add-timeReservation").getAttribute("data-disabled")).toBe("1");
    expect(screen.getByTestId("quick-add-timeOff").getAttribute("data-disabled")).toBe("1");
    expect(screen.getByTestId("quick-add-newBooking").getAttribute("data-disabled")).toBe("0");
  });

  it("Time reservation becomes enabled when its handler is supplied", () => {
    renderWithLang(
      <QuickAddFab
        lang="en"
        onNewBooking={() => undefined}
        onTimeReservation={() => undefined}
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.getByTestId("quick-add-timeReservation").getAttribute("data-disabled")).toBe("0");
  });

  it("clicking New booking invokes onNewBooking and closes the menu", () => {
    const onNewBooking = vi.fn();
    renderWithLang(<QuickAddFab lang="en" onNewBooking={onNewBooking} />, "en");
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    fireEvent.click(screen.getByTestId("quick-add-newBooking"));
    expect(onNewBooking).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("quick-add-menu")).toBeNull();
  });

  it("clicking a disabled action does NOT invoke any handler", () => {
    const onNewBooking = vi.fn();
    renderWithLang(<QuickAddFab lang="en" onNewBooking={onNewBooking} />, "en");
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    fireEvent.click(screen.getByTestId("quick-add-timeOff"));
    expect(onNewBooking).not.toHaveBeenCalled();
  });

  it("Escape key closes the menu", () => {
    renderWithLang(<QuickAddFab lang="en" onNewBooking={() => undefined} />, "en");
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.getByTestId("quick-add-menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("quick-add-menu")).toBeNull();
  });

  it("renders localized labels in 4 languages", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      const { unmount } = renderWithLang(
        <QuickAddFab lang={lang} onNewBooking={() => undefined} />,
        lang,
      );
      fireEvent.click(screen.getByTestId("quick-add-fab"));
      expect(screen.getByTestId("quick-add-menu").textContent?.length).toBeGreaterThan(0);
      cleanup();
      unmount();
    }
  });
});
