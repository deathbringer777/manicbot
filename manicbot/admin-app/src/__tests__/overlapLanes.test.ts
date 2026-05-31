import { describe, it, expect } from "vitest";
import { computeLanes, type LaneItem } from "~/lib/calendar/overlapLanes";

const h = (hours: number, mins = 0) => hours * 60 + mins;

describe("computeLanes", () => {
  it("returns an empty map for no items", () => {
    expect(computeLanes([]).size).toBe(0);
  });

  it("gives a lone item the full width (lanes = 1)", () => {
    const items: LaneItem[] = [{ id: "a", startMin: h(14), endMin: h(15) }];
    const m = computeLanes(items);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 1 });
  });

  it("keeps back-to-back, non-overlapping items at full width each", () => {
    // 09:00–10:00 then 10:00–11:00 — touching edges do NOT overlap.
    const m = computeLanes([
      { id: "a", startMin: h(9), endMin: h(10) },
      { id: "b", startMin: h(10), endMin: h(11) },
    ]);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(m.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("splits two identical slots into two side-by-side lanes", () => {
    const m = computeLanes([
      { id: "a", startMin: h(14), endMin: h(15) },
      { id: "b", startMin: h(14), endMin: h(15) },
    ]);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(m.get("b")).toEqual({ lane: 1, lanes: 2 });
  });

  it("splits three mutually-overlapping slots into three lanes", () => {
    const m = computeLanes([
      { id: "a", startMin: h(14), endMin: h(15) },
      { id: "b", startMin: h(14), endMin: h(15) },
      { id: "c", startMin: h(14), endMin: h(15) },
    ]);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 3 });
    expect(m.get("b")).toEqual({ lane: 1, lanes: 3 });
    expect(m.get("c")).toEqual({ lane: 2, lanes: 3 });
  });

  it("reuses a freed lane within a connected cluster (Google-style packing)", () => {
    // A 14:00–15:00, B 14:30–15:30, C 15:00–16:00.
    // A∩B and B∩C overlap, A∩C do NOT (15:00 touches). Cluster {A,B,C}, 2 lanes.
    // C can reuse A's lane 0 since A has ended by 15:00.
    const m = computeLanes([
      { id: "a", startMin: h(14), endMin: h(15) },
      { id: "b", startMin: h(14, 30), endMin: h(15, 30) },
      { id: "c", startMin: h(15), endMin: h(16) },
    ]);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(m.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(m.get("c")).toEqual({ lane: 0, lanes: 2 });
  });

  it("treats separate clusters independently", () => {
    // Cluster 1: two overlapping at 09:00. Cluster 2: one lone at 12:00.
    const m = computeLanes([
      { id: "a", startMin: h(9), endMin: h(10) },
      { id: "b", startMin: h(9), endMin: h(10) },
      { id: "c", startMin: h(12), endMin: h(13) },
    ]);
    expect(m.get("a")!.lanes).toBe(2);
    expect(m.get("b")!.lanes).toBe(2);
    expect(m.get("c")).toEqual({ lane: 0, lanes: 1 });
  });

  it("clamps zero-length items so they still occupy a lane", () => {
    const m = computeLanes([
      { id: "a", startMin: h(14), endMin: h(14) },
      { id: "b", startMin: h(14), endMin: h(14) },
    ]);
    expect(m.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(m.get("b")).toEqual({ lane: 1, lanes: 2 });
  });
});
