// @vitest-environment happy-dom
/**
 * QuickAddFab extraItems — plugin-injected menu items.
 *
 * Pins:
 *  - extraItems render BELOW the built-in 3 actions with a separator.
 *  - Each extra item has its own data-testid (`quick-add-{id}`).
 *  - Clicking an extra item invokes its onClick handler and closes the menu.
 *  - No extra items rendered when `extraItems` is omitted or empty (does
 *    not change the existing built-in-only layout).
 *  - Multiple plugins can inject side-by-side (we test 2 items at once).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { Bell, Repeat } from "lucide-react";
import { QuickAddFab } from "~/components/dashboards/QuickAddFab";
import { renderWithLang } from "./helpers/renderWithLang";

afterEach(() => {
  cleanup();
});

describe("QuickAddFab.extraItems", () => {
  it("does NOT render any extra items when prop is omitted", () => {
    renderWithLang(<QuickAddFab lang="en" onNewBooking={() => undefined} />, "en");
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.queryByTestId("quick-add-reminder")).toBeNull();
    expect(screen.queryByTestId("quick-add-routine")).toBeNull();
  });

  it("does NOT render extra items when prop is an empty array", () => {
    renderWithLang(
      <QuickAddFab lang="en" onNewBooking={() => undefined} extraItems={[]} />,
      "en",
    );
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.queryByTestId("quick-add-reminder")).toBeNull();
  });

  it("renders one extra item with its own id + label", () => {
    renderWithLang(
      <QuickAddFab
        lang="en"
        onNewBooking={() => undefined}
        extraItems={[{
          id: "reminder",
          icon: Bell,
          label: "Add reminder",
          description: "Self / staff ping",
          onClick: () => undefined,
        }]}
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    const btn = screen.getByTestId("quick-add-reminder");
    expect(btn).toBeTruthy();
    expect(btn.textContent ?? "").toContain("Add reminder");
  });

  it("renders multiple extra items side-by-side (different plugins)", () => {
    renderWithLang(
      <QuickAddFab
        lang="en"
        onNewBooking={() => undefined}
        extraItems={[
          { id: "reminder", icon: Bell, label: "Reminder", description: "x", onClick: () => undefined },
          { id: "routine", icon: Repeat, label: "Routine", description: "y", onClick: () => undefined },
        ]}
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.getByTestId("quick-add-reminder")).toBeTruthy();
    expect(screen.getByTestId("quick-add-routine")).toBeTruthy();
  });

  it("clicking an extra item fires its onClick + closes the menu", () => {
    const handler = vi.fn();
    renderWithLang(
      <QuickAddFab
        lang="en"
        onNewBooking={() => undefined}
        extraItems={[{
          id: "reminder",
          icon: Bell,
          label: "Reminder",
          description: "x",
          onClick: handler,
        }]}
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    expect(screen.getByTestId("quick-add-menu")).toBeTruthy();
    fireEvent.click(screen.getByTestId("quick-add-reminder"));
    expect(handler).toHaveBeenCalledTimes(1);
    // Menu should be gone after the click.
    expect(screen.queryByTestId("quick-add-menu")).toBeNull();
  });

  it("still renders the 3 built-in actions when extra items are present", () => {
    renderWithLang(
      <QuickAddFab
        lang="en"
        onNewBooking={() => undefined}
        onTimeReservation={() => undefined}
        onTimeOff={() => undefined}
        extraItems={[{
          id: "reminder",
          icon: Bell,
          label: "Reminder",
          description: "x",
          onClick: () => undefined,
        }]}
      />,
      "en",
    );
    fireEvent.click(screen.getByTestId("quick-add-fab"));
    for (const id of ["quick-add-newBooking", "quick-add-timeReservation", "quick-add-timeOff", "quick-add-reminder"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });
});
