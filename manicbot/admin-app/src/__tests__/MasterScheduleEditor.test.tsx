// @vitest-environment happy-dom
/**
 * MasterScheduleEditor — per-master per-day schedule + one optional break.
 *
 * Contract pinned:
 *   * One row per weekday (Mon..Sun), keyed by data-testid.
 *   * Default (no stored value) hydrates Mon–Sat 09:00–18:00, Sunday off.
 *   * Toggling a day off persists null for that day.
 *   * "Add break" reveals break start/end selects; the break is saved.
 *   * "Remove break" drops the break on save.
 *   * close <= open disables Save and flags the offending row.
 *   * disabled mode hides Save.
 *   * onSave emits the serialized {"days":{…}} string.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import { MasterScheduleEditor } from "~/components/salon/MasterScheduleEditor";
import { serializeMasterSchedule, WEEKDAY_KEYS, type MasterScheduleState } from "~/lib/workHours";

function renderEditor(opts: { workHours?: unknown; workDays?: unknown; disabled?: boolean } = {}) {
  const onSave = vi.fn();
  render(
    <LangContext.Provider value={{ lang: "ru", setLang: () => {} }}>
      <MasterScheduleEditor
        workHours={opts.workHours ?? null}
        workDays={opts.workDays ?? null}
        saving={false}
        disabled={opts.disabled}
        lang="ru"
        onSave={onSave}
      />
    </LangContext.Provider>,
  );
  return { onSave };
}

function lastSavedDays(onSave: ReturnType<typeof vi.fn>) {
  const arg = String(onSave.mock.calls.at(-1)![0]);
  return (JSON.parse(arg) as { days: Record<string, unknown> }).days;
}

afterEach(cleanup);

describe("MasterScheduleEditor", () => {
  it("renders a row for each weekday", () => {
    renderEditor();
    for (const d of WEEKDAY_KEYS) {
      expect(screen.getByTestId(`master-schedule-row-${d}`)).toBeTruthy();
    }
  });

  it("shows day-off (no time select) for the default Sunday", () => {
    renderEditor();
    const sun = screen.getByTestId("master-schedule-row-sun");
    expect(within(sun).queryByTestId("master-schedule-open-sun-trigger")).toBeNull();
  });

  it("saves the default as per-day JSON (Mon–Sat 09–18, Sun off)", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByTestId("master-schedule-save"));
    const days = lastSavedDays(onSave);
    expect(days.mon).toEqual({ open: "09:00", close: "18:00" });
    expect(days.sun).toBeNull();
  });

  it("toggling a day off persists null for that day", () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByTestId("master-schedule-toggle-mon"));
    fireEvent.click(screen.getByTestId("master-schedule-save"));
    expect(lastSavedDays(onSave).mon).toBeNull();
  });

  it("adding a break reveals break selects and includes it on save", () => {
    const { onSave } = renderEditor();
    const mon = screen.getByTestId("master-schedule-row-mon");
    fireEvent.click(within(mon).getByTestId("master-schedule-addbreak-mon"));
    expect(within(mon).getByTestId("master-schedule-break-start-mon-trigger")).toBeTruthy();
    fireEvent.click(screen.getByTestId("master-schedule-save"));
    expect(lastSavedDays(onSave).mon).toEqual({
      open: "09:00",
      close: "18:00",
      break: { start: "13:00", end: "14:00" },
    });
  });

  it("removing a break drops it on save", () => {
    const initial: MasterScheduleState = {
      mon: { open: "09:00", close: "18:00", break: { start: "13:00", end: "14:00" } },
      tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    };
    const { onSave } = renderEditor({ workHours: serializeMasterSchedule(initial) });
    fireEvent.click(screen.getByTestId("master-schedule-rmbreak-mon"));
    fireEvent.click(screen.getByTestId("master-schedule-save"));
    expect(lastSavedDays(onSave).mon).toEqual({ open: "09:00", close: "18:00" });
  });

  it("disables Save and flags the row when close <= open", () => {
    const initial: MasterScheduleState = {
      mon: { open: "18:00", close: "09:00" },
      tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    };
    renderEditor({ workHours: serializeMasterSchedule(initial) });
    expect((screen.getByTestId("master-schedule-save") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("master-schedule-row-error-mon")).toBeTruthy();
  });

  it("hydrates a legacy {from,to} + workDays master into per-day rows", () => {
    const { onSave } = renderEditor({ workHours: '{"from":14,"to":16}', workDays: "[1,3]" });
    fireEvent.click(screen.getByTestId("master-schedule-save"));
    const days = lastSavedDays(onSave);
    expect(days.mon).toEqual({ open: "14:00", close: "16:00" });
    expect(days.wed).toEqual({ open: "14:00", close: "16:00" });
    expect(days.tue).toBeNull();
  });

  it("read-only mode hides Save", () => {
    renderEditor({ disabled: true });
    expect(screen.queryByTestId("master-schedule-save")).toBeNull();
  });
});
