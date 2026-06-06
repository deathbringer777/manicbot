// @vitest-environment happy-dom
/**
 * MultiSelectFilterDropdown — multi-toggle filter popover.
 *
 * Unlike the single-select FilterDropdown, the panel stays open while flipping
 * independent toggles, shows an active-count badge, and offers a Reset.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MultiSelectFilterDropdown } from "~/components/ui/MultiSelectFilterDropdown";

afterEach(cleanup);

const OPTIONS = [
  { value: "a", label: "Alpha", testId: "opt-a" },
  { value: "b", label: "Beta", testId: "opt-b" },
];

function setup(selected: Record<string, boolean> = { a: false, b: false }) {
  const onToggle = vi.fn();
  const onReset = vi.fn();
  render(
    <MultiSelectFilterDropdown
      label="Filters"
      options={OPTIONS}
      selected={selected}
      onToggle={onToggle}
      onReset={onReset}
      resetLabel="Reset"
      triggerTestId="f-trigger"
    />,
  );
  return { onToggle, onReset };
}

describe("MultiSelectFilterDropdown", () => {
  it("is closed until the trigger is clicked", () => {
    setup();
    expect(screen.queryByTestId("opt-a")).toBeNull();
    fireEvent.click(screen.getByTestId("f-trigger"));
    expect(screen.getByTestId("opt-a")).toBeTruthy();
    expect(screen.getByTestId("opt-b")).toBeTruthy();
  });

  it("toggling an option fires onToggle and keeps the panel open", () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByTestId("f-trigger"));
    fireEvent.click(screen.getByTestId("opt-a"));
    expect(onToggle).toHaveBeenCalledWith("a");
    expect(screen.getByTestId("opt-b")).toBeTruthy(); // still open
  });

  it("shows an active-count badge", () => {
    setup({ a: true, b: true });
    expect(screen.getByTestId("f-trigger").textContent).toContain("2");
  });

  it("reset is enabled with active filters and calls onReset", () => {
    const { onReset } = setup({ a: true, b: false });
    fireEvent.click(screen.getByTestId("f-trigger"));
    const reset = screen.getByTestId("f-reset") as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalled();
  });

  it("reset is disabled when nothing is selected", () => {
    setup({ a: false, b: false });
    fireEvent.click(screen.getByTestId("f-trigger"));
    expect((screen.getByTestId("f-reset") as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.click(screen.getByTestId("f-trigger"));
    expect(screen.getByTestId("opt-a")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("opt-a")).toBeNull();
  });
});
