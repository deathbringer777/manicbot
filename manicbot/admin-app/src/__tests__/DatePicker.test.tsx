// @vitest-environment happy-dom
/**
 * DatePicker — brand-styled replacement for native `<input type="date">`.
 *
 * Pins the contract that callers (MasterDetailModal Urlop, and future
 * date callers) rely on:
 *   - Trigger toggles the popover.
 *   - Popover renders 7 weekday headers, Mon-first (matches CLDR ru/ua/pl/en-GB
 *     and the iOS calendar screenshot the design references).
 *   - The visible month is initialized from `value` (or today when empty).
 *   - Day cells carry `data-iso="YYYY-MM-DD"`; clicking fires onChange.
 *   - Selected and today flags surface on the right cells.
 *   - `min` / `max` disable out-of-range cells.
 *   - Next-month / prev-month buttons step the grid.
 *   - Outside click and Escape close the popover.
 *   - Clear button (visible only when value is set) emits empty string.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DatePicker } from "~/components/ui/DatePicker";

function setup(props: Partial<React.ComponentProps<typeof DatePicker>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <DatePicker
      value=""
      onChange={onChange}
      lang="ru"
      placeholder="Выберите дату"
      testIdPrefix="dp"
      {...props}
    />,
  );
  return { ...utils, onChange };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DatePicker", () => {
  it("renders the trigger with the placeholder when value is empty", () => {
    setup();
    const trigger = screen.getByTestId("dp-trigger");
    expect(trigger.getAttribute("data-open")).toBe("0");
    expect(trigger.textContent).toContain("Выберите дату");
  });

  it("opens the popover on trigger click", () => {
    setup();
    fireEvent.click(screen.getByTestId("dp-trigger"));
    expect(screen.getByTestId("dp-popover")).toBeTruthy();
    expect(screen.getByTestId("dp-trigger").getAttribute("data-open")).toBe("1");
  });

  it("Escape closes the popover", () => {
    setup();
    fireEvent.click(screen.getByTestId("dp-trigger"));
    expect(screen.queryByTestId("dp-popover")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("dp-popover")).toBeNull();
  });

  it("renders 7 weekday headers (Mon-first)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    setup();
    fireEvent.click(screen.getByTestId("dp-trigger"));
    // The first weekday cell should be Monday in any locale.
    // For ru locale `weekday: "short"` returns "пн" / "ПН" after upper.
    const heads = screen
      .getByTestId("dp-popover")
      .querySelectorAll("div.grid.grid-cols-7")[0]!.children;
    expect(heads.length).toBe(7);
    // First label should be Mon-equivalent; ru "пн" → "ПН".
    expect((heads[0] as HTMLElement).textContent?.toUpperCase()).toMatch(/^(ПН|MON|PON|MO)$/);
  });

  it("emits onChange with the clicked day's ISO string", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    const { onChange } = setup();
    fireEvent.click(screen.getByTestId("dp-trigger"));
    const may20 = document.querySelector(
      '[data-testid="dp"] [data-iso="2026-05-20"]',
    ) as HTMLElement | null;
    expect(may20).toBeTruthy();
    fireEvent.click(may20!);
    expect(onChange).toHaveBeenCalledWith("2026-05-20");
    // Popover should close after picking a day.
    expect(screen.queryByTestId("dp-popover")).toBeNull();
  });

  it("steps the month forward / backward with the arrow buttons", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    setup();
    fireEvent.click(screen.getByTestId("dp-trigger"));

    fireEvent.click(screen.getByTestId("dp-next-month"));
    // After one forward step, June 30 2026 must exist as an in-month cell.
    const jun30 = document.querySelector(
      '[data-testid="dp"] [data-iso="2026-06-30"][data-in-month="1"]',
    );
    expect(jun30).toBeTruthy();

    fireEvent.click(screen.getByTestId("dp-prev-month"));
    fireEvent.click(screen.getByTestId("dp-prev-month"));
    // Two backward steps from May → April. April 15 2026 should be in-month.
    const apr15 = document.querySelector(
      '[data-testid="dp"] [data-iso="2026-04-15"][data-in-month="1"]',
    );
    expect(apr15).toBeTruthy();
  });

  it("marks today's cell with data-today=1", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    setup();
    fireEvent.click(screen.getByTestId("dp-trigger"));
    const today = document.querySelector(
      '[data-testid="dp"] [data-today="1"]',
    ) as HTMLElement | null;
    expect(today).toBeTruthy();
    expect(today!.getAttribute("data-iso")).toBe("2026-05-15");
  });

  it("marks the value's cell with data-selected=1", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    setup({ value: "2026-05-20" });
    fireEvent.click(screen.getByTestId("dp-trigger"));
    const cell = document.querySelector(
      '[data-testid="dp"] [data-selected="1"]',
    ) as HTMLElement | null;
    expect(cell).toBeTruthy();
    expect(cell!.getAttribute("data-iso")).toBe("2026-05-20");
  });

  it("`max` disables cells past the cap", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    const { onChange } = setup({ max: "2026-05-20" });
    fireEvent.click(screen.getByTestId("dp-trigger"));
    const may25 = document.querySelector(
      '[data-testid="dp"] [data-iso="2026-05-25"]',
    ) as HTMLButtonElement | null;
    expect(may25).toBeTruthy();
    expect(may25!.disabled).toBe(true);
    fireEvent.click(may25!);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("`min` disables cells before the floor", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    const { onChange } = setup({ min: "2026-05-10" });
    fireEvent.click(screen.getByTestId("dp-trigger"));
    const may05 = document.querySelector(
      '[data-testid="dp"] [data-iso="2026-05-05"]',
    ) as HTMLButtonElement | null;
    expect(may05).toBeTruthy();
    expect(may05!.disabled).toBe(true);
    fireEvent.click(may05!);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Clear button emits empty string and is hidden when value is empty", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    const { onChange, rerender } = setup({ value: "2026-05-20" });
    fireEvent.click(screen.getByTestId("dp-trigger"));
    const clear = screen.getByTestId("dp-clear");
    expect(clear).toBeTruthy();
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith("");

    // After empty rerender, Clear should be absent.
    rerender(
      <DatePicker
        value=""
        onChange={onChange}
        lang="ru"
        placeholder="x"
        testIdPrefix="dp"
      />,
    );
    fireEvent.click(screen.getByTestId("dp-trigger"));
    expect(screen.queryByTestId("dp-clear")).toBeNull();
  });

  it("Today button auto-picks today when within min/max", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    const { onChange } = setup();
    fireEvent.click(screen.getByTestId("dp-trigger"));
    fireEvent.click(screen.getByTestId("dp-today"));
    expect(onChange).toHaveBeenCalledWith("2026-05-15");
  });

  it("Today button does NOT auto-pick when today is outside min/max", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T10:00:00Z"));
    const { onChange } = setup({ min: "2026-06-01" });
    fireEvent.click(screen.getByTestId("dp-trigger"));
    fireEvent.click(screen.getByTestId("dp-today"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled prop blocks trigger interaction", () => {
    setup({ disabled: true });
    fireEvent.click(screen.getByTestId("dp-trigger"));
    expect(screen.queryByTestId("dp-popover")).toBeNull();
  });
});
