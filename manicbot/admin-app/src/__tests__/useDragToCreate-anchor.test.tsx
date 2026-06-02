// @vitest-environment happy-dom
/**
 * useDragToCreate — anchor-rect contract. The geometry helpers are pinned in
 * useDragToCreate.test.ts; here we pin the NEW behaviour that powers the
 * quick-create popover: `onCommit` must carry a viewport `anchorRect` for the
 * resolved slot (column rect + slot offset) so the caller can anchor the card
 * exactly where the user released. A regression here would make the create
 * popover render at the wrong place (or fall back to the old full-screen modal
 * feel).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragToCreate } from "~/lib/calendar/useDragToCreate";

const HH = 48;
const HS = 8;
const HE = 22;

function makeColumn(top: number, left: number, width: number) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + (HE - HS) * HH,
      left,
      right: left + width,
      width,
      height: (HE - HS) * HH,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useDragToCreate — onCommit anchorRect", () => {
  it("emits the slot's viewport rect (column rect + minutesToY offset) on a click-create", () => {
    const onCommit = vi.fn();
    const col = makeColumn(100, 20, 200); // top=100, left=20, width=200

    const { result } = renderHook(() =>
      useDragToCreate({ hourHeight: HH, hourStart: HS, hourEnd: HE, onCommit }),
    );

    // clientY 196 → 196 - col.top(100) = 96px → 96/48 = 2h past 08:00 = 10:00.
    act(() => {
      result.current.bind.onPointerDown({
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
        clientX: 50,
        clientY: 196,
        shiftKey: false,
        altKey: false,
        currentTarget: col,
        target: col,
        preventDefault: vi.fn(),
      } as any);
    });

    // Same Y → below the 6px click threshold → 1-hour slot create.
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 196, bubbles: true }),
      );
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const g = onCommit.mock.calls[0]![0] as {
      startMin: number;
      durationMin: number;
      anchorRect?: { left: number; top: number; width: number; height: number };
    };
    expect(g.startMin).toBe(600); // 10:00
    expect(g.durationMin).toBe(60);
    // top = col.top(100) + minutesToY(600) = 100 + 96 = 196; height = 1h = 48.
    expect(g.anchorRect).toEqual({ left: 20, top: 196, width: 200, height: 48 });
  });
});
