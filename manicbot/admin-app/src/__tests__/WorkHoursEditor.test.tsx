// @vitest-environment happy-dom
/**
 * WorkHoursEditor — per-weekday schedule editor.
 *
 * Contract pinned:
 *   * One row per weekday (Mon..Sun), keyed by data-testid.
 *   * A null day renders "Выходной" and no time selects.
 *   * A working day renders open/close Selects reflecting the current value.
 *   * Toggling off emits `null` for that day; toggling on restores 09:00–18:00.
 *   * close <= open surfaces an inline validation hint.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { WorkHoursEditor } from "~/components/salon/WorkHoursEditor";
import { DEFAULT_WORK_HOURS, WEEKDAY_KEYS, type WorkHoursState } from "~/lib/workHours";

function renderEditor(value: WorkHoursState = DEFAULT_WORK_HOURS) {
  const onChange = vi.fn();
  render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <WorkHoursEditor value={value} onChange={onChange} />
    </LangContext.Provider>,
  );
  return { onChange };
}

afterEach(cleanup);

describe("WorkHoursEditor", () => {
  it("renders a row for each weekday", () => {
    renderEditor();
    for (const d of WEEKDAY_KEYS) {
      expect(screen.getByTestId(`workhours-row-${d}`)).toBeTruthy();
    }
  });

  it("shows the day-off label and no time selects for a null day", () => {
    renderEditor(); // Sunday is null in the default
    const sun = screen.getByTestId("workhours-row-sun");
    expect(within(sun).getByText("Выходной")).toBeTruthy();
    expect(within(sun).queryByTestId("workhours-open-sun-trigger")).toBeNull();
  });

  it("renders open/close selects with the current values for a working day", () => {
    renderEditor();
    const mon = screen.getByTestId("workhours-row-mon");
    expect(within(mon).getByTestId("workhours-open-mon-trigger").getAttribute("data-value")).toBe("09:00");
    expect(within(mon).getByTestId("workhours-close-mon-trigger").getAttribute("data-value")).toBe("18:00");
  });

  it("toggling a working day off emits null for that day", () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByTestId("workhours-toggle-mon"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mon: null }));
  });

  it("toggling an off day back on restores 09:00–18:00", () => {
    const { onChange } = renderEditor();
    fireEvent.click(screen.getByTestId("workhours-toggle-sun"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sun: { open: "09:00", close: "18:00" } }),
    );
  });

  it("flags an invalid range where close <= open", () => {
    renderEditor({ ...DEFAULT_WORK_HOURS, mon: { open: "18:00", close: "09:00" } });
    const mon = screen.getByTestId("workhours-row-mon");
    expect(within(mon).getByText(/позже открытия/)).toBeTruthy();
  });
});
