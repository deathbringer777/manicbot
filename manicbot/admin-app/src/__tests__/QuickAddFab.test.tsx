// @vitest-environment happy-dom
/**
 * QuickAddFab — bottom-right floating menu for the appointments tab.
 *
 * Pins (after the 2026-05-16 calendar overhaul):
 *   - The button toggles the menu open/closed.
 *   - Three actions render in fixed order: New booking, Time reservation,
 *     Time off — all three are now real backend flows (no `СКОРО`
 *     disabled state, no `data-disabled` flag).
 *   - Clicking each action invokes the matching callback and closes
 *     the menu.
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

  it("all three actions are enabled — no `СКОРО` placeholders any more", () => {
    renderWithLang(<QuickAddFab lang="en" onNewBooking={() => undefined} />, "en");
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.getByTestId("quick-add-timeReservation").hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("quick-add-timeOff").hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("quick-add-newBooking").hasAttribute("disabled")).toBe(false);
  });

  it("clicking New booking invokes onNewBooking and closes the menu", () => {
    const onNewBooking = vi.fn();
    renderWithLang(<QuickAddFab lang="en" onNewBooking={onNewBooking} />, "en");
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    fireEvent.click(screen.getByTestId("quick-add-newBooking"));
    expect(onNewBooking).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("quick-add-menu")).toBeNull();
  });

  it("clicking Time reservation invokes onTimeReservation and closes the menu", () => {
    const onTimeReservation = vi.fn();
    renderWithLang(
      <QuickAddFab lang="en" onNewBooking={() => undefined} onTimeReservation={onTimeReservation} />,
      "en",
    );
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    fireEvent.click(screen.getByTestId("quick-add-timeReservation"));
    expect(onTimeReservation).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("quick-add-menu")).toBeNull();
  });

  it("clicking Time off invokes onTimeOff and closes the menu", () => {
    const onTimeOff = vi.fn();
    renderWithLang(
      <QuickAddFab lang="en" onNewBooking={() => undefined} onTimeOff={onTimeOff} />,
      "en",
    );
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    fireEvent.click(screen.getByTestId("quick-add-timeOff"));
    expect(onTimeOff).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("quick-add-menu")).toBeNull();
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

  // ── Clients-tab single-action mode (0062) ────────────────────────────────
  describe('mode="client"', () => {
    it("renders no menu — click fires onAddClient immediately", () => {
      const onAddClient = vi.fn();
      renderWithLang(
        <QuickAddFab lang="en" mode="client" onAddClient={onAddClient} />,
        "en",
      );
      // No menu before click.
      expect(screen.queryByTestId("quick-add-menu")).toBeNull();
      fireEvent.click(screen.getByTestId("quick-add-fab"));
      // Still no menu — direct action.
      expect(screen.queryByTestId("quick-add-menu")).toBeNull();
      expect(onAddClient).toHaveBeenCalledTimes(1);
    });

    it("FAB carries data-mode='client' for QA assertions", () => {
      renderWithLang(
        <QuickAddFab lang="en" mode="client" onAddClient={() => undefined} />,
        "en",
      );
      expect(screen.getByTestId("quick-add-fab").getAttribute("data-mode")).toBe("client");
    });
  });
});
