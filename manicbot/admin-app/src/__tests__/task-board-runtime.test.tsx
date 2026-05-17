// @vitest-environment happy-dom
/**
 * Tests for TaskBoardRuntime — the 3-column Kanban plugin runtime.
 *
 * Covers:
 *   1. `computeMovedTasks` pure helper — every move/no-op branch (the real
 *      reorder algorithm lives here, the component is glue).
 *   2. Component integration — drag a card and drop on another column's
 *      insertion-point drop zones; verify the rendered order changes and
 *      localStorage is updated. Also verifies the ◀/▶ buttons still work
 *      and the column-level fallback drop appends to the end.
 *
 * Touch / mobile DnD is not covered — HTML5 native DnD doesn't fire on
 * mobile browsers, that's why the ◀/▶ buttons exist as a fallback.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import TaskBoardRuntime, {
  computeMovedTasks,
  type Task,
  type Column,
} from "~/components/plugins/runtimes/TaskBoardRuntime";
import { renderWithLang } from "./helpers/renderWithLang";

// ── Reliable localStorage stub (happy-dom's native impl is incomplete; same
//    pattern as plugins-pinned.test.tsx) ────────────────────────────────────
const _lsStore: Record<string, string> = {};
const _mockLocalStorage = {
  getItem: (key: string) => _lsStore[key] ?? null,
  setItem: (key: string, value: string) => { _lsStore[key] = String(value); },
  removeItem: (key: string) => { delete _lsStore[key]; },
  clear: () => { Object.keys(_lsStore).forEach((k) => delete _lsStore[k]); },
  get length() { return Object.keys(_lsStore).length; },
  key: (n: number) => Object.keys(_lsStore)[n] ?? null,
};
beforeAll(() => { vi.stubGlobal("localStorage", _mockLocalStorage); });

const INSTALL_ID = "inst_task_board_test";
const STORAGE_KEY = `manicbot_plugin_task_board_${INSTALL_ID}`;

function seedStorage(tasks: Task[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function readStorage(): Task[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Task[]) : [];
}

function task(id: string, col: Column, title?: string): Task {
  return { id, title: title ?? id.toUpperCase(), column: col, createdAt: 1000 };
}

/**
 * happy-dom doesn't implement DataTransfer; jsdom-style polyfill works here
 * because the component only uses setData / getData / effectAllowed /
 * dropEffect — none of the spec-heavy bits.
 */
function makeDataTransfer() {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => { store.set(k, v); },
    getData: (k: string) => store.get(k) ?? "",
    effectAllowed: "" as string,
    dropEffect: "" as string,
    types: [] as string[],
  };
}

function fireDragSequence(
  source: HTMLElement,
  target: HTMLElement,
  taskId: string,
) {
  const dt = makeDataTransfer();
  fireEvent.dragStart(source, { dataTransfer: dt });
  // The component reads getData("text/plain") on drop; we pre-populate it
  // from the dragStart handler. Double-set for safety in case happy-dom
  // doesn't propagate the handler's setData call through fireEvent.
  dt.setData("text/plain", taskId);
  fireEvent.dragOver(target, { dataTransfer: dt });
  fireEvent.drop(target, { dataTransfer: dt });
  fireEvent.dragEnd(source, { dataTransfer: dt });
}

// ────────────────────────────────────────────────────────────────────────────
// Pure helper — computeMovedTasks
// ────────────────────────────────────────────────────────────────────────────

describe("computeMovedTasks (pure helper)", () => {
  it("moves a card to a different column at end (beforeId = null)", () => {
    const tasks = [task("a", "todo"), task("b", "doing"), task("c", "doing")];
    const updated = computeMovedTasks(tasks, "a", "doing", null);
    expect(updated).not.toBeNull();
    expect(updated!.map((t) => `${t.id}:${t.column}`)).toEqual([
      "b:doing",
      "c:doing",
      "a:doing",
    ]);
  });

  it("moves a card to a different column before a specific card", () => {
    const tasks = [task("a", "todo"), task("b", "doing"), task("c", "doing")];
    const updated = computeMovedTasks(tasks, "a", "doing", "c");
    expect(updated).not.toBeNull();
    // a now lives in doing, sandwiched between b and c
    const doingOrder = updated!.filter((t) => t.column === "doing").map((t) => t.id);
    expect(doingOrder).toEqual(["b", "a", "c"]);
  });

  it("reorders within the same column (move B before A)", () => {
    const tasks = [task("a", "todo"), task("b", "todo"), task("c", "todo")];
    const updated = computeMovedTasks(tasks, "b", "todo", "a");
    expect(updated).not.toBeNull();
    expect(updated!.map((t) => t.id)).toEqual(["b", "a", "c"]);
  });

  it("reorders within the same column (move A to end)", () => {
    const tasks = [task("a", "todo"), task("b", "todo"), task("c", "todo")];
    const updated = computeMovedTasks(tasks, "a", "todo", null);
    expect(updated).not.toBeNull();
    expect(updated!.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("returns null when dropping a card on itself", () => {
    const tasks = [task("a", "todo"), task("b", "todo")];
    expect(computeMovedTasks(tasks, "a", "todo", "a")).toBeNull();
  });

  it("returns null when dropping a card on the slot it already occupies (before the next sibling)", () => {
    const tasks = [task("a", "todo"), task("b", "todo"), task("c", "todo")];
    // A is already immediately before B — dragging A onto the zone "before B"
    // would yield the same array; helper must report no-op.
    expect(computeMovedTasks(tasks, "a", "todo", "b")).toBeNull();
  });

  it("returns null when dropping the last card in a column at the end of that column", () => {
    const tasks = [task("a", "todo"), task("b", "todo")];
    // B is already at the end of todo — moving B "to end of todo" is a no-op.
    expect(computeMovedTasks(tasks, "b", "todo", null)).toBeNull();
  });

  it("returns null when dragging a card that doesn't exist", () => {
    const tasks = [task("a", "todo")];
    expect(computeMovedTasks(tasks, "ghost", "doing", null)).toBeNull();
  });

  it("falls back to append when beforeId points to a missing task", () => {
    const tasks = [task("a", "todo"), task("b", "doing")];
    const updated = computeMovedTasks(tasks, "a", "doing", "missing");
    expect(updated).not.toBeNull();
    expect(updated!.map((t) => `${t.id}:${t.column}`)).toEqual([
      "b:doing",
      "a:doing",
    ]);
  });

  it("moves a card into an empty column", () => {
    const tasks = [task("a", "todo")];
    const updated = computeMovedTasks(tasks, "a", "done", null);
    expect(updated).not.toBeNull();
    expect(updated!.map((t) => `${t.id}:${t.column}`)).toEqual(["a:done"]);
  });

  it("preserves the relative order of cards in untouched columns", () => {
    const tasks = [
      task("a", "todo"),
      task("x", "done"),
      task("b", "doing"),
      task("y", "done"),
      task("c", "doing"),
    ];
    const updated = computeMovedTasks(tasks, "b", "todo", null);
    expect(updated).not.toBeNull();
    const doneOrder = updated!.filter((t) => t.column === "done").map((t) => t.id);
    const todoOrder = updated!.filter((t) => t.column === "todo").map((t) => t.id);
    const doingOrder = updated!.filter((t) => t.column === "doing").map((t) => t.id);
    expect(doneOrder).toEqual(["x", "y"]);
    expect(todoOrder).toEqual(["a", "b"]);
    expect(doingOrder).toEqual(["c"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Component — TaskBoardRuntime
// ────────────────────────────────────────────────────────────────────────────

describe("TaskBoardRuntime (component)", () => {
  beforeEach(() => {
    _mockLocalStorage.clear();
  });
  afterEach(() => {
    cleanup();
    _mockLocalStorage.clear();
  });

  it("hydrates seeded tasks from localStorage", () => {
    seedStorage([task("a", "todo", "Buy paint")]);
    renderWithLang(<TaskBoardRuntime installationId={INSTALL_ID} slug="task-board" />);
    expect(screen.getByText("Buy paint")).toBeTruthy();
  });

  it("drag a card to another column via drop zone — moves and persists", () => {
    seedStorage([
      task("a", "todo", "Task A"),
      task("b", "doing", "Task B"),
    ]);
    renderWithLang(<TaskBoardRuntime installationId={INSTALL_ID} slug="task-board" />);

    const card = screen.getByText("Task A").closest("[data-task-id]") as HTMLElement;
    // Drop on the "end of doing" zone, which exists because doing has 1 card.
    const dropZone = screen.getByTestId("task-board-drop-zone-doing-end");
    fireDragSequence(card, dropZone, "a");

    // A is now the last card in the doing column
    const doingCol = screen.getByTestId("task-board-col-doing");
    const doingCards = within(doingCol).getAllByTestId("task-board-card");
    expect(doingCards.map((el) => el.getAttribute("data-task-id"))).toEqual(["b", "a"]);

    const stored = readStorage();
    expect(stored.find((t) => t.id === "a")?.column).toBe("doing");
    expect(stored.map((t) => `${t.id}:${t.column}`)).toEqual(["b:doing", "a:doing"]);
  });

  it("drag a card before another card via insertion-point zone — places it there", () => {
    seedStorage([
      task("a", "todo", "Task A"),
      task("b", "doing", "Task B"),
      task("c", "doing", "Task C"),
    ]);
    renderWithLang(<TaskBoardRuntime installationId={INSTALL_ID} slug="task-board" />);

    const card = screen.getByText("Task A").closest("[data-task-id]") as HTMLElement;
    // Insertion zone "before C" — A should land between B and C
    const dropZone = screen.getByTestId("task-board-drop-zone-doing-c");
    fireDragSequence(card, dropZone, "a");

    const doingCol = screen.getByTestId("task-board-col-doing");
    const doingCards = within(doingCol).getAllByTestId("task-board-card");
    expect(doingCards.map((el) => el.getAttribute("data-task-id"))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("reorders cards within the same column (swap)", () => {
    seedStorage([
      task("a", "todo", "Task A"),
      task("b", "todo", "Task B"),
      task("c", "todo", "Task C"),
    ]);
    renderWithLang(<TaskBoardRuntime installationId={INSTALL_ID} slug="task-board" />);

    // Drag C and drop it before A → new order C, A, B
    const card = screen.getByText("Task C").closest("[data-task-id]") as HTMLElement;
    const dropZone = screen.getByTestId("task-board-drop-zone-todo-a");
    fireDragSequence(card, dropZone, "c");

    const todoCol = screen.getByTestId("task-board-col-todo");
    const order = within(todoCol)
      .getAllByTestId("task-board-card")
      .map((el) => el.getAttribute("data-task-id"));
    expect(order).toEqual(["c", "a", "b"]);
  });

  it("column-level drop (dead space) appends to end of the target column", () => {
    seedStorage([
      task("a", "todo", "Task A"),
      task("b", "doing", "Task B"),
    ]);
    renderWithLang(<TaskBoardRuntime installationId={INSTALL_ID} slug="task-board" />);

    const card = screen.getByText("Task A").closest("[data-task-id]") as HTMLElement;
    const doneCol = screen.getByTestId("task-board-col-done");
    fireDragSequence(card, doneCol, "a");

    const doneCards = within(doneCol).getAllByTestId("task-board-card");
    expect(doneCards.map((el) => el.getAttribute("data-task-id"))).toEqual(["a"]);
    expect(readStorage().find((t) => t.id === "a")?.column).toBe("done");
  });

  it("◀ / ▶ buttons still work as a non-drag fallback", () => {
    seedStorage([task("a", "todo", "Task A")]);
    renderWithLang(<TaskBoardRuntime installationId={INSTALL_ID} slug="task-board" />);

    // Move A right (todo → doing)
    const moveRight = screen.getByTestId("task-board-move-right");
    fireEvent.click(moveRight);
    expect(readStorage().find((t) => t.id === "a")?.column).toBe("doing");

    // Then move A right again (doing → done) — re-query because the button
    // re-renders in the new column
    const moveRight2 = screen.getByTestId("task-board-move-right");
    fireEvent.click(moveRight2);
    expect(readStorage().find((t) => t.id === "a")?.column).toBe("done");
  });

  it("renders the correct number of drop zones (cards + 1) per column", () => {
    seedStorage([
      task("a", "todo"),
      task("b", "todo"),
      task("c", "todo"),
    ]);
    renderWithLang(<TaskBoardRuntime installationId={INSTALL_ID} slug="task-board" />);

    // 3 cards in todo → 4 drop zones: before-a, before-b, before-c, end
    expect(screen.getByTestId("task-board-drop-zone-todo-a")).toBeTruthy();
    expect(screen.getByTestId("task-board-drop-zone-todo-b")).toBeTruthy();
    expect(screen.getByTestId("task-board-drop-zone-todo-c")).toBeTruthy();
    expect(screen.getByTestId("task-board-drop-zone-todo-end")).toBeTruthy();
    // Empty columns → 1 drop zone each (the "end" zone)
    expect(screen.getByTestId("task-board-drop-zone-doing-end")).toBeTruthy();
    expect(screen.getByTestId("task-board-drop-zone-done-end")).toBeTruthy();
  });
});
