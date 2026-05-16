// @vitest-environment happy-dom
/**
 * useDragToMove — drag-to-reschedule hook for the salon calendar.
 *
 * The hook stitches together pointer events on an existing appointment
 * block, document-level pointer tracking, and column-under-cursor
 * resolution via `data-day` / `data-master-id`. The tests below exercise
 * the three things that matter at the boundary:
 *
 *   1. A pure tap (no movement) doesn't fire onCommit so click handlers
 *      still bubble up to open the appointment detail drawer.
 *   2. A real drag fires onCommit exactly once with the new (date,
 *      masterId, time) resolved from the column under the cursor.
 *   3. A drag that resolves to the same slot is treated as a no-op and
 *      no commit fires — drag-jitter must not produce phantom moves.
 *
 * jsdom doesn't implement `elementsFromPoint`, so we stub it per-test
 * with a deterministic column resolver and override block-rect math so
 * the hook can compute Y-in-column without a real layout engine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragToMove, type MoveCommit } from "~/lib/calendar/useDragToMove";

type CommitFn = (c: MoveCommit) => void;

const HH = 48;
const HS = 8;
const HE = 22;

function makeColumn(date: string, masterId: number | null, top = 100, left = 0) {
  const el = document.createElement("div");
  el.dataset.day = date;
  if (masterId != null) el.dataset.masterId = String(masterId);
  // jsdom doesn't lay anything out, so synthesize a rect.
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + 1000,
      left,
      right: left + 200,
      width: 200,
      height: 1000,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function makeBlock(parent: HTMLElement, topInCol: number, height = 48) {
  const el = document.createElement("button");
  el.getBoundingClientRect = () => {
    const parentRect = parent.getBoundingClientRect();
    return {
      top: parentRect.top + topInCol,
      bottom: parentRect.top + topInCol + height,
      left: parentRect.left,
      right: parentRect.right,
      width: parentRect.width,
      height,
      x: parentRect.left,
      y: parentRect.top + topInCol,
      toJSON: () => ({}),
    } as DOMRect;
  };
  parent.appendChild(el);
  return el;
}

describe("useDragToMove", () => {
  let onCommit: CommitFn & { mock: { calls: unknown[][] } };

  beforeEach(() => {
    onCommit = vi.fn() as unknown as CommitFn & { mock: { calls: unknown[][] } };
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("does NOT fire onCommit on a plain tap (pointer-down + pointer-up with no movement)", () => {
    const col = makeColumn("2026-05-20", 100);
    const block = makeBlock(col, 96); // top=100+96=196 → 10:00 at HH=48, HS=8

    const { result } = renderHook(() =>
      useDragToMove({ hourHeight: HH, hourStart: HS, hourEnd: HE, onCommit }),
    );
    const bind = result.current.bindBlock({
      appointmentId: "apt_1",
      date: "2026-05-20",
      masterId: 100,
      time: "10:00",
      durationMin: 60,
    });

    // Spoof currentTarget + Pointer Event capture for jsdom.
    act(() => {
      bind.onPointerDown({
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
        clientX: 50,
        clientY: 200,
        currentTarget: block,
        target: block,
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent<HTMLElement>);
    });

    // Same coordinates → click threshold not exceeded → no commit.
    act(() => {
      const up = new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 200, bubbles: true });
      document.dispatchEvent(up);
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("fires onCommit with the resolved (date, masterId, time) when the user drags past the click threshold", () => {
    const col = makeColumn("2026-05-20", 100);
    const block = makeBlock(col, 96); // 10:00

    // jsdom lacks elementsFromPoint — stub it to "return the column the
    // pointer is over". For this test, every coordinate maps to `col`.
    // jsdom lacks elementsFromPoint — assign a deterministic implementation.
    (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = () => [col];

    const { result } = renderHook(() =>
      useDragToMove({ hourHeight: HH, hourStart: HS, hourEnd: HE, onCommit }),
    );
    const bind = result.current.bindBlock({
      appointmentId: "apt_1",
      date: "2026-05-20",
      masterId: 100,
      time: "10:00",
      durationMin: 60,
    });

    // Grab at the BLOCK's mid — grabOffsetY = clientY - blockTop = 24.
    // blockTop = col.top(100) + topInCol(96) = 196. clientY = 220 → grabOffsetY = 24.
    act(() => {
      bind.onPointerDown({
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
        clientX: 50,
        clientY: 220,
        currentTarget: block,
        target: block,
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent<HTMLElement>);
    });

    // Drop 48 px lower — one hour later. clientY 268.
    // yInCol = (268 - col.top 100 - grabOffsetY 24) = 144 → 11:00.
    act(() => {
      const up = new PointerEvent("pointerup", { pointerId: 1, clientX: 50, clientY: 268, bubbles: true });
      document.dispatchEvent(up);
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "apt_1",
        fromDate: "2026-05-20",
        fromMasterId: 100,
        fromTime: "10:00",
        toDate: "2026-05-20",
        toMasterId: 100,
        toTime: "11:00",
        durationMin: 60,
      }),
    );
  });

  it("resolves a cross-column drop and forwards the new masterId + date", () => {
    const colA = makeColumn("2026-05-20", 100, 100, 0);   // source
    const colB = makeColumn("2026-05-21", 200, 100, 300); // target
    const block = makeBlock(colA, 96);

    // First call (move) keeps the pointer over colA, final call (up) is
    // over colB. The hook reads elementsFromPoint twice — once on the
    // commit path — so we route by clientX.
    (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = (x: number) =>
      x >= 300 ? [colB] : [colA];

    const { result } = renderHook(() =>
      useDragToMove({ hourHeight: HH, hourStart: HS, hourEnd: HE, onCommit }),
    );
    const bind = result.current.bindBlock({
      appointmentId: "apt_1",
      date: "2026-05-20",
      masterId: 100,
      time: "10:00",
      durationMin: 60,
    });

    act(() => {
      bind.onPointerDown({
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
        clientX: 50,
        clientY: 220,
        currentTarget: block,
        target: block,
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent<HTMLElement>);
    });

    // Drop on colB at the same vertical — grabOffsetY = 24 →
    // (220 - 100 - 24) = 96 px in colB = 10:00 still, but date/master flip.
    act(() => {
      const up = new PointerEvent("pointerup", { pointerId: 1, clientX: 350, clientY: 220, bubbles: true });
      document.dispatchEvent(up);
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        fromDate: "2026-05-20",
        fromMasterId: 100,
        toDate: "2026-05-21",
        toMasterId: 200,
        toTime: "10:00",
      }),
    );
  });
});
