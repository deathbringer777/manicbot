// @vitest-environment happy-dom
/**
 * Touch-guard tests for the calendar drag hooks + useCoarsePointer.
 *
 * On touch / coarse-pointer devices the Google-Calendar-style drag gestures
 * (create / move / resize) are disabled so a finger scrolls the grid natively,
 * and `bind.style.touchAction` flips from "none" to "pan-x pan-y". Desktop
 * (isTouch=false, the default) must keep firing the gestures exactly as before.
 *
 * happy-dom has no layout engine and no elementsFromPoint, so we stub
 * getBoundingClientRect / pointer-capture / elementsFromPoint per the same
 * pattern as useDragToMove.test.tsx. touchAction is asserted via the hook's
 * RETURN value (not the rendered inline style), since happy-dom strips inline
 * styles containing env()/max().
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragToCreate } from "~/lib/calendar/useDragToCreate";
import { useDragToMove, type MoveCommit } from "~/lib/calendar/useDragToMove";
import { useDragToResize, type ResizeCommit } from "~/lib/calendar/useDragToResize";
import { useCoarsePointer } from "~/lib/useCoarsePointer";

const HH = 48;
const HS = 8;
const HE = 22;

function rect(top: number, left: number, w = 200, h = 1000): DOMRect {
  return {
    top, bottom: top + h, left, right: left + w, width: w, height: h, x: left, y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubGeometry(el: HTMLElement, top: number, left: number, w = 200, h = 1000) {
  el.getBoundingClientRect = () => rect(top, left, w, h);
  (el as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
  (el as HTMLElement & { releasePointerCapture: (id: number) => void }).releasePointerCapture = () => {};
}

function makeLayer(top = 100, left = 0) {
  const el = document.createElement("div");
  stubGeometry(el, top, left);
  document.body.appendChild(el);
  return el;
}

function makeColumn(date: string, masterId: number | null, top = 100, left = 0) {
  const el = document.createElement("div");
  el.dataset.day = date;
  if (masterId != null) el.dataset.masterId = String(masterId);
  stubGeometry(el, top, left);
  document.body.appendChild(el);
  return el;
}

function makeChild(parent: HTMLElement, topInCol: number, height = 48) {
  const el = document.createElement("button");
  const p = parent.getBoundingClientRect();
  stubGeometry(el, p.top + topInCol, p.left, p.width, height);
  parent.appendChild(el);
  return el;
}

function pointer(
  over: HTMLElement,
  clientX: number,
  clientY: number,
  pointerType: "mouse" | "touch" = "mouse",
) {
  return {
    button: 0,
    pointerType,
    pointerId: 1,
    clientX,
    clientY,
    shiftKey: false,
    altKey: false,
    currentTarget: over,
    target: over,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLElement>;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useDragToCreate — touch guard", () => {
  it("desktop (default): touchAction='none' and a click commits a slot", () => {
    const onCommit = vi.fn();
    const layer = makeLayer();
    const { result } = renderHook(() =>
      useDragToCreate({ hourHeight: HH, hourStart: HS, hourEnd: HE, onCommit }),
    );
    expect(result.current.bind.style.touchAction).toBe("none");

    act(() => {
      result.current.bind.onPointerDown(
        pointer(layer, 50, 200) as unknown as React.PointerEvent<HTMLDivElement>,
      );
    });
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 200, bubbles: true }),
      );
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("touch: touchAction='pan-x pan-y' and no slot is created on a drag", () => {
    const onCommit = vi.fn();
    const layer = makeLayer();
    const { result } = renderHook(() =>
      useDragToCreate({ hourHeight: HH, hourStart: HS, hourEnd: HE, isTouch: true, onCommit }),
    );
    expect(result.current.bind.style.touchAction).toBe("pan-x pan-y");

    act(() => {
      result.current.bind.onPointerDown(
        pointer(layer, 50, 200, "touch") as unknown as React.PointerEvent<HTMLDivElement>,
      );
    });
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 260, bubbles: true }),
      );
    });

    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("useDragToMove — touch guard", () => {
  it("desktop (default): bindBlock touchAction='none'", () => {
    const onCommit = vi.fn() as unknown as (c: MoveCommit) => void;
    const { result } = renderHook(() =>
      useDragToMove({ hourHeight: HH, hourStart: HS, hourEnd: HE, onCommit }),
    );
    const bind = result.current.bindBlock({
      appointmentId: "apt_1", date: "2026-05-20", masterId: 100, time: "10:00", durationMin: 60,
    });
    expect(bind.style.touchAction).toBe("none");
  });

  it("touch: touchAction='pan-x pan-y' and a drag does NOT reschedule", () => {
    const onCommit = vi.fn() as unknown as (c: MoveCommit) => void;
    const col = makeColumn("2026-05-20", 100);
    const block = makeChild(col, 96);
    (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint =
      () => [col];

    const { result } = renderHook(() =>
      useDragToMove({ hourHeight: HH, hourStart: HS, hourEnd: HE, isTouch: true, onCommit }),
    );
    const bind = result.current.bindBlock({
      appointmentId: "apt_1", date: "2026-05-20", masterId: 100, time: "10:00", durationMin: 60,
    });
    expect(bind.style.touchAction).toBe("pan-x pan-y");

    act(() => { bind.onPointerDown(pointer(block, 50, 220, "touch")); });
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 320, bubbles: true }),
      );
    });

    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("useDragToResize — touch guard", () => {
  it("desktop (default): bindHandle touchAction='none'", () => {
    const onResize = vi.fn() as unknown as (c: ResizeCommit) => void;
    const { result } = renderHook(() =>
      useDragToResize({ hourHeight: HH, hourStart: HS, hourEnd: HE, onResize }),
    );
    const bind = result.current.bindHandle({
      itemId: "apt_1", date: "2026-05-20", masterId: 100, time: "10:00", durationMin: 60,
    });
    expect(bind.style.touchAction).toBe("none");
  });

  it("touch: touchAction='pan-x pan-y' and a drag does NOT resize", () => {
    const onResize = vi.fn() as unknown as (c: ResizeCommit) => void;
    const col = makeColumn("2026-05-20", 100);
    const handle = makeChild(col, 140);

    const { result } = renderHook(() =>
      useDragToResize({ hourHeight: HH, hourStart: HS, hourEnd: HE, isTouch: true, onResize }),
    );
    const bind = result.current.bindHandle({
      itemId: "apt_1", date: "2026-05-20", masterId: 100, time: "10:00", durationMin: 60,
    });
    expect(bind.style.touchAction).toBe("pan-x pan-y");

    act(() => { bind.onPointerDown(pointer(handle, 50, 240, "touch")); });
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 340, bubbles: true }),
      );
    });

    expect(onResize).not.toHaveBeenCalled();
  });
});

describe("useCoarsePointer", () => {
  function stubMatchMedia(matches: boolean) {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  }

  it("returns true when (hover:none) and (pointer:coarse) matches", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
  });

  it("returns false when the query does not match", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(false);
  });
});
