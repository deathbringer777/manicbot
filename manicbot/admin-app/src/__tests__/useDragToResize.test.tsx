// @vitest-environment happy-dom
/**
 * useDragToResize — drag the bottom edge to change a block/appointment's
 * duration (the start stays put). Mirrors useDragToMove's geometry tests.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragToResize } from "~/lib/calendar/useDragToResize";

const HH = 48; // px per hour
const HS = 8; // first visible hour
const HE = 22; // last visible hour

// jsdom/happy-dom don't lay out — synthesize a column rect at top=100.
function makeColumn(date: string, masterId: number | null, top = 100): HTMLElement {
  const col = document.createElement("div");
  col.dataset.day = date;
  if (masterId != null) col.dataset.masterId = String(masterId);
  col.getBoundingClientRect = () =>
    ({ top, bottom: top + 1000, left: 0, right: 200, width: 200, height: 1000, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(col);
  return col;
}
function makeHandle(col: HTMLElement): HTMLElement {
  const handle = document.createElement("div");
  col.appendChild(handle);
  return handle;
}
function down(handle: HTMLElement, clientY: number) {
  return {
    button: 0,
    pointerType: "mouse",
    pointerId: 1,
    clientX: 50,
    clientY,
    currentTarget: handle,
    target: handle,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLElement>;
}

afterEach(() => {
  document.body.innerHTML = "";
});

// Block at 10:00 (startMin 600): top in col = ((600-480)/60)*48 = 96,
// so the bottom edge of a 60-min block sits at colTop(100)+96+48 = 244.
const baseBind = {
  itemId: "b1",
  kind: "block" as const,
  date: "2026-05-20",
  masterId: 100,
  time: "10:00",
  durationMin: 60,
};

describe("useDragToResize", () => {
  it("does NOT fire onResize when the handle is tapped without moving", () => {
    const onResize = vi.fn();
    const handle = makeHandle(makeColumn("2026-05-20", 100));
    const { result } = renderHook(() =>
      useDragToResize({ hourHeight: HH, hourStart: HS, hourEnd: HE, onResize }),
    );
    const bind = result.current.bindHandle(baseBind);

    act(() => bind.onPointerDown(down(handle, 244)));
    act(() => {
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 244, bubbles: true }));
    });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("fires onResize with the new snapped duration when the bottom edge is dragged down", () => {
    const onResize = vi.fn();
    const handle = makeHandle(makeColumn("2026-05-20", 100));
    const { result } = renderHook(() =>
      useDragToResize({ hourHeight: HH, hourStart: HS, hourEnd: HE, onResize }),
    );
    const bind = result.current.bindHandle(baseBind);

    act(() => bind.onPointerDown(down(handle, 244)));
    // Drag the bottom down 48px → 12:00 → duration 120.
    act(() => {
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 292, bubbles: true }));
    });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        itemId: "b1",
        kind: "block",
        date: "2026-05-20",
        masterId: 100,
        time: "10:00",
        fromDurationMin: 60,
        durationMin: 120,
      }),
    );
  });

  it("clamps to the minimum duration when dragged above the start", () => {
    const onResize = vi.fn();
    const handle = makeHandle(makeColumn("2026-05-20", 100));
    const { result } = renderHook(() =>
      useDragToResize({ hourHeight: HH, hourStart: HS, hourEnd: HE, minDurationMin: 15, onResize }),
    );
    const bind = result.current.bindHandle(baseBind);

    act(() => bind.onPointerDown(down(handle, 244)));
    // Drag way above the start → clamps to the 15-min floor.
    act(() => {
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 120, bubbles: true }));
    });
    expect(onResize.mock.calls[0]![0].durationMin).toBe(15);
  });

  it("Escape cancels the resize without committing", () => {
    const onResize = vi.fn();
    const handle = makeHandle(makeColumn("2026-05-20", 100));
    const { result } = renderHook(() =>
      useDragToResize({ hourHeight: HH, hourStart: HS, hourEnd: HE, onResize }),
    );
    const bind = result.current.bindHandle(baseBind);

    act(() => bind.onPointerDown(down(handle, 244)));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    act(() => {
      document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 292, bubbles: true }));
    });
    expect(onResize).not.toHaveBeenCalled();
  });
});
