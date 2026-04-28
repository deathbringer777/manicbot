// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { FilterDropdown, type FilterDropdownOption } from "~/components/ui/FilterDropdown";
import { renderWithLang } from "./helpers/renderWithLang";

const OPTIONS: FilterDropdownOption<string>[] = [
  { value: "analytics", label: "Analytics", testId: "opt-analytics" },
  { value: "growth", label: "Growth", testId: "opt-growth" },
  { value: "ai", label: "AI", testId: "opt-ai" },
];

function renderDropdown(
  value: string | null,
  onChange = vi.fn(),
  extra: Partial<React.ComponentProps<typeof FilterDropdown>> = {},
) {
  return renderWithLang(
    <FilterDropdown
      label="Category"
      allLabel="All"
      options={OPTIONS}
      value={value}
      onChange={onChange}
      triggerTestId="dd-trigger"
      {...extra}
    />,
    "en",
  );
}

afterEach(() => cleanup());

describe("FilterDropdown — open/close", () => {
  it("trigger starts closed (aria-expanded=false)", () => {
    renderDropdown(null);
    const btn = screen.getByTestId("dd-trigger");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking trigger opens the menu", () => {
    renderDropdown(null);
    const btn = screen.getByTestId("dd-trigger");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByTestId("dd-menu");
    expect(menu.getAttribute("aria-hidden")).toBe("false");
  });

  it("clicking trigger again closes the menu", () => {
    renderDropdown(null);
    const btn = screen.getByTestId("dd-trigger");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("outside mousedown closes the menu", () => {
    renderDropdown(null);
    fireEvent.click(screen.getByTestId("dd-trigger"));
    fireEvent.mouseDown(document.body);
    expect(screen.getByTestId("dd-trigger").getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes the menu", () => {
    renderDropdown(null);
    const btn = screen.getByTestId("dd-trigger");
    fireEvent.click(btn);
    fireEvent.keyDown(btn.parentElement!, { key: "Escape" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("FilterDropdown — options always in DOM", () => {
  it("options are findable by testId even when menu is closed", () => {
    renderDropdown(null);
    // menu closed — options still in DOM
    expect(screen.getByTestId("opt-analytics")).toBeTruthy();
    expect(screen.getByTestId("opt-growth")).toBeTruthy();
    expect(screen.getByTestId("opt-ai")).toBeTruthy();
  });

  it("menu ul has aria-hidden=true when closed", () => {
    renderDropdown(null);
    expect(screen.getByTestId("dd-menu").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("FilterDropdown — selection", () => {
  it("clicking an option calls onChange with its value", () => {
    const onChange = vi.fn();
    renderDropdown(null, onChange);
    fireEvent.click(screen.getByTestId("opt-analytics"));
    expect(onChange).toHaveBeenCalledWith("analytics");
  });

  it("clicking 'All' calls onChange(null)", () => {
    const onChange = vi.fn();
    renderDropdown("analytics", onChange);
    // open menu first so "All" li is visible; but fireEvent works even on hidden elements
    const allOption = screen.getByTestId("dd-menu").querySelector("li:first-child")!;
    fireEvent.click(allOption);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("selected option has aria-selected=true", () => {
    renderDropdown("growth");
    const opt = screen.getByTestId("opt-growth");
    expect(opt.getAttribute("aria-selected")).toBe("true");
  });

  it("non-selected options have aria-selected=false", () => {
    renderDropdown("growth");
    expect(screen.getByTestId("opt-analytics").getAttribute("aria-selected")).toBe("false");
  });

  it("triggers onChange and closes on Enter when item is active", () => {
    const onChange = vi.fn();
    renderDropdown(null, onChange);
    const container = screen.getByTestId("dd-trigger").parentElement!;
    // Open with ArrowDown (sets activeIndex=0 = "All") then press ArrowDown to move to first option
    fireEvent.keyDown(container, { key: "ArrowDown" });
    // now open, activeIndex=0 ("All")
    fireEvent.keyDown(container, { key: "ArrowDown" });
    // activeIndex=1 (analytics)
    fireEvent.keyDown(container, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("analytics");
    expect(screen.getByTestId("dd-trigger").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("FilterDropdown — keyboard navigation", () => {
  it("ArrowDown cycles through items", () => {
    renderDropdown(null);
    const container = screen.getByTestId("dd-trigger").parentElement!;
    // Open: ArrowDown on trigger
    fireEvent.keyDown(container, { key: "ArrowDown" });
    // activeIndex starts at 0 (All, since value=null)
    // Press ArrowDown → activeIndex=1
    fireEvent.keyDown(container, { key: "ArrowDown" });
    const opt = screen.getByTestId("opt-analytics");
    expect(opt.getAttribute("data-active")).toBe("true");
  });

  it("ArrowUp wraps around to last item", () => {
    renderDropdown(null);
    const container = screen.getByTestId("dd-trigger").parentElement!;
    fireEvent.keyDown(container, { key: "ArrowDown" }); // open, activeIndex=0
    fireEvent.keyDown(container, { key: "ArrowUp" }); // wrap → last = 3 (ai)
    expect(screen.getByTestId("opt-ai").getAttribute("data-active")).toBe("true");
  });

  it("Tab closes the menu", () => {
    renderDropdown(null);
    const container = screen.getByTestId("dd-trigger").parentElement!;
    fireEvent.keyDown(container, { key: "ArrowDown" }); // open
    fireEvent.keyDown(container, { key: "Tab" });
    expect(screen.getByTestId("dd-trigger").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("FilterDropdown — variant styling", () => {
  it("brand variant applies brand classes on active value", () => {
    renderDropdown("analytics", vi.fn(), { variant: "brand" });
    const btn = screen.getByTestId("dd-trigger");
    expect(btn.className).toContain("brand-500");
  });

  it("emerald variant applies emerald classes on active value", () => {
    renderDropdown("analytics", vi.fn(), { variant: "emerald" });
    const btn = screen.getByTestId("dd-trigger");
    expect(btn.className).toContain("emerald-500");
  });

  it("no active value — no variant colour on trigger", () => {
    renderDropdown(null, vi.fn(), { variant: "brand" });
    const btn = screen.getByTestId("dd-trigger");
    // should NOT have active brand background
    expect(btn.className).not.toContain("brand-500/10");
  });
});
