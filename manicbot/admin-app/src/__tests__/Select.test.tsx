// @vitest-environment happy-dom
/**
 * Select — brand-styled custom dropdown.
 *
 * Pins the post-2026-05-16 contract (native <select> elements were
 * replaced with this component everywhere in the booking dialogs to
 * stop them rendering at the OS layer with system colors). The
 * regression we're guarding against: a reintroduced <select> in
 * ManualBookingModal / TimeReservationDialog / TimeOffDialog would
 * make this test go red because the test ids the dialogs assume
 * (`mb-master`, `block-master`, etc.) live on a custom-Select trigger.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Select } from "~/components/ui/Select";

afterEach(() => cleanup());

describe("Select", () => {
  const OPTIONS = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta", sublabel: "60 min · 100" },
    { value: "c", label: "Gamma" },
  ];

  it("renders the trigger with the current label", () => {
    render(<Select value="b" onChange={() => {}} options={OPTIONS} />);
    const trigger = screen.getByTestId("select-trigger");
    expect(trigger.getAttribute("data-value")).toBe("b");
    expect(trigger.textContent).toContain("Beta");
  });

  it("falls back to placeholder when value is empty", () => {
    render(<Select value="" onChange={() => {}} options={OPTIONS} placeholder="— pick —" />);
    expect(screen.getByTestId("select-trigger").textContent).toContain("— pick —");
  });

  it("opens the menu on click and renders all options + sublabels", () => {
    render(<Select value="" onChange={() => {}} options={OPTIONS} />);
    fireEvent.click(screen.getByTestId("select-trigger"));
    const menu = screen.getByTestId("select-menu");
    expect(menu).toBeTruthy();
    const opts = screen.getAllByTestId("select-option");
    expect(opts).toHaveLength(3);
    expect(menu.textContent).toContain("Beta");
    expect(menu.textContent).toContain("60 min · 100");
  });

  it("picks an option, calls onChange, closes the menu", () => {
    const onChange = vi.fn();
    render(<Select value="a" onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByTestId("select-trigger"));
    const beta = screen.getAllByTestId("select-option").find((b) => b.getAttribute("data-value") === "b");
    expect(beta).toBeDefined();
    fireEvent.click(beta!);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByTestId("select-menu")).toBeNull();
  });

  it("marks the active option with data-active=1", () => {
    render(<Select value="c" onChange={() => {}} options={OPTIONS} />);
    fireEvent.click(screen.getByTestId("select-trigger"));
    const opts = screen.getAllByTestId("select-option");
    const active = opts.find((o) => o.getAttribute("data-value") === "c");
    expect(active?.getAttribute("data-active")).toBe("1");
    const inactive = opts.find((o) => o.getAttribute("data-value") === "a");
    expect(inactive?.getAttribute("data-active")).toBe("0");
  });

  it("escape closes the menu", () => {
    render(<Select value="" onChange={() => {}} options={OPTIONS} />);
    fireEvent.click(screen.getByTestId("select-trigger"));
    expect(screen.getByTestId("select-menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("select-menu")).toBeNull();
  });

  it("disabled trigger does not open the menu", () => {
    render(<Select value="" onChange={() => {}} options={OPTIONS} disabled />);
    fireEvent.click(screen.getByTestId("select-trigger"));
    expect(screen.queryByTestId("select-menu")).toBeNull();
  });

  it("custom testIdPrefix scopes both the trigger and the menu", () => {
    render(<Select value="" onChange={() => {}} options={OPTIONS} testIdPrefix="mb-master" />);
    expect(screen.getByTestId("mb-master-trigger")).toBeTruthy();
    fireEvent.click(screen.getByTestId("mb-master-trigger"));
    expect(screen.getByTestId("mb-master-menu")).toBeTruthy();
  });
});
