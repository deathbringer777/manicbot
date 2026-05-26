/**
 * Smart grouping helper — pinned behavior so future tweaks can't break
 * the bell layout silently.
 */
import { describe, it, expect } from "vitest";
import { groupNotifications, type Groupable } from "~/lib/notifications/grouping";

function row(
  id: string,
  kind: string,
  createdAt: number,
  sourceSlug: string | null = null,
): Groupable {
  return { id, kind, createdAt, sourceSlug };
}

// Anchored "now" for deterministic timestamps.
const NOW = 1_700_000_000;

describe("groupNotifications — bucket logic", () => {
  it("collapses 3+ consecutive same-(kind, sourceSlug) rows within 2h", async () => {
    const rows = [
      row("a", "messenger.message", NOW - 60, "thread"),
      row("b", "messenger.message", NOW - 120, "thread"),
      row("c", "messenger.message", NOW - 180, "thread"),
    ];
    const out = groupNotifications(rows);
    expect(out).toHaveLength(1);
    const item = out[0]!;
    expect(item.type).toBe("group");
    if (item.type === "group") {
      expect(item.count).toBe(3);
      expect(item.representative.id).toBe("a"); // newest is the rep
      expect(item.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    }
  });

  it("does NOT collapse 2 same-kind rows (below groupMin)", () => {
    const rows = [
      row("a", "messenger.message", NOW - 60, "thread"),
      row("b", "messenger.message", NOW - 120, "thread"),
    ];
    const out = groupNotifications(rows);
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.type === "single")).toBe(true);
  });

  it("does NOT collapse 3 same-kind rows when spread beyond 2h window", () => {
    const rows = [
      row("a", "messenger.message", NOW, "thread"),
      row("b", "messenger.message", NOW - 60 * 60, "thread"),
      // Oldest is 3h before newest → window broken.
      row("c", "messenger.message", NOW - 3 * 60 * 60, "thread"),
    ];
    const out = groupNotifications(rows);
    expect(out).toHaveLength(3);
    expect(out.every((i) => i.type === "single")).toBe(true);
  });

  it("groups exactly at the 2h boundary (inclusive)", () => {
    const rows = [
      row("a", "appointment.created", NOW, "appointment"),
      row("b", "appointment.created", NOW - 60 * 60, "appointment"),
      row("c", "appointment.created", NOW - 2 * 60 * 60, "appointment"),
    ];
    const out = groupNotifications(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("group");
  });

  it("does NOT cross kinds — three messenger.message + one support.reply breaks the run", () => {
    const rows = [
      row("a", "messenger.message", NOW - 60, "thread"),
      row("b", "support.reply", NOW - 90, "ticket"),
      row("c", "messenger.message", NOW - 120, "thread"),
      row("d", "messenger.message", NOW - 180, "thread"),
      row("e", "messenger.message", NOW - 240, "thread"),
    ];
    const out = groupNotifications(rows);
    // [single a] [single b] [group c,d,e]
    expect(out).toHaveLength(3);
    expect(out[0]!.type).toBe("single");
    expect(out[1]!.type).toBe("single");
    expect(out[2]!.type).toBe("group");
    if (out[2]!.type === "group") {
      expect(out[2]!.count).toBe(3);
      expect(out[2]!.representative.id).toBe("c");
    }
  });

  it("does NOT cross sourceSlug — same kind but different sourceSlug stays separate", () => {
    const rows = [
      row("a", "appointment.created", NOW, "appointment"),
      row("b", "appointment.created", NOW - 60, "appointment"),
      row("c", "appointment.created", NOW - 120, null),
      row("d", "appointment.created", NOW - 180, null),
    ];
    const out = groupNotifications(rows);
    // Two pairs, neither reaching groupMin=3 → all singles.
    expect(out).toHaveLength(4);
    expect(out.every((i) => i.type === "single")).toBe(true);
  });

  it("treats null and undefined sourceSlug as the same bucket", () => {
    const rows: Groupable[] = [
      { id: "a", kind: "client.new", createdAt: NOW, sourceSlug: null },
      { id: "b", kind: "client.new", createdAt: NOW - 60, sourceSlug: undefined },
      { id: "c", kind: "client.new", createdAt: NOW - 120 },
    ];
    const out = groupNotifications(rows);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("group");
  });

  it("respects custom groupMin", () => {
    const rows = [
      row("a", "appointment.created", NOW, "appointment"),
      row("b", "appointment.created", NOW - 60, "appointment"),
    ];
    // groupMin=2 → collapses at 2.
    const out = groupNotifications(rows, { groupMin: 2 });
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("group");
  });

  it("respects custom windowSec", () => {
    const rows = [
      row("a", "appointment.created", NOW, "appointment"),
      row("b", "appointment.created", NOW - 30 * 60, "appointment"),
      row("c", "appointment.created", NOW - 90 * 60, "appointment"),
    ];
    // windowSec=60min → 90min-span breaks the window.
    const out = groupNotifications(rows, { windowSec: 60 * 60 });
    expect(out).toHaveLength(3);
    expect(out.every((i) => i.type === "single")).toBe(true);
  });

  it("empty input → empty output", () => {
    expect(groupNotifications([])).toEqual([]);
  });

  it("preserves newest-first ordering across groups + singles", () => {
    const rows = [
      row("a", "messenger.message", NOW - 60, "thread"),
      row("b", "messenger.message", NOW - 120, "thread"),
      row("c", "messenger.message", NOW - 180, "thread"),
      row("d", "support.reply", NOW - 200, "ticket"),
      row("e", "appointment.created", NOW - 300, "appointment"),
    ];
    const out = groupNotifications(rows);
    // [group(a,b,c), single(d), single(e)]
    expect(out).toHaveLength(3);
    expect(out[0]!.type).toBe("group");
    if (out[0]!.type === "group") expect(out[0]!.representative.id).toBe("a");
    expect(out[1]!.type).toBe("single");
    if (out[1]!.type === "single") expect(out[1]!.row.id).toBe("d");
    expect(out[2]!.type).toBe("single");
    if (out[2]!.type === "single") expect(out[2]!.row.id).toBe("e");
  });
});
