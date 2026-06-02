import { describe, it, expect } from "vitest";
import { computeColumnLanes, laneKey } from "~/lib/calendar/laneItems";

describe("computeColumnLanes — appointments + blocks share lanes", () => {
  it("lanes an appointment and a block at the same time side-by-side", () => {
    const m = computeColumnLanes(
      [{ id: 1, time: "14:00", duration: 60 }],
      [{ id: "b1", time: "14:00", durationMin: 60 }],
    );
    // Same window → cluster of 2 lanes. "apt:1" sorts before "block:b1".
    expect(m.get(laneKey("apt", 1))).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(laneKey("block", "b1"))).toEqual({ lane: 1, lanes: 2 });
  });

  it("lanes two overlapping reservation blocks instead of stacking them", () => {
    const m = computeColumnLanes(
      [],
      [
        { id: "b1", time: "14:00", durationMin: 60 },
        { id: "b2", time: "14:30", durationMin: 60 },
      ],
    );
    expect(m.get(laneKey("block", "b1"))).toEqual({ lane: 0, lanes: 2 });
    expect(m.get(laneKey("block", "b2"))).toEqual({ lane: 1, lanes: 2 });
  });

  it("keeps a lone block full-width (lanes = 1)", () => {
    const m = computeColumnLanes([], [{ id: "b1", time: "10:00", durationMin: 30 }]);
    expect(m.get(laneKey("block", "b1"))).toEqual({ lane: 0, lanes: 1 });
  });

  it("does not let a numeric apt id collide with a string block id", () => {
    // apt id 1 and block id "1" must be distinct lane keys.
    const m = computeColumnLanes(
      [{ id: 1, time: "09:00", duration: 60 }],
      [{ id: "1", time: "12:00", durationMin: 60 }],
    );
    expect(m.get(laneKey("apt", 1))).toEqual({ lane: 0, lanes: 1 });
    expect(m.get(laneKey("block", "1"))).toEqual({ lane: 0, lanes: 1 });
    expect(m.size).toBe(2);
  });

  it("defaults a null appointment duration to 60 minutes for overlap math", () => {
    const m = computeColumnLanes(
      [{ id: 1, time: "14:00", duration: null }],
      [{ id: "b1", time: "14:30", durationMin: 30 }],
    );
    // 14:00–15:00 (default 60) overlaps 14:30–15:00 → 2 lanes.
    expect(m.get(laneKey("apt", 1))!.lanes).toBe(2);
    expect(m.get(laneKey("block", "b1"))!.lanes).toBe(2);
  });
});
