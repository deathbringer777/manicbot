/**
 * overlapLanes — Google-Calendar-style side-by-side layout for overlapping
 * calendar items within a single column (one day, or one master/unassigned
 * column).
 *
 * Each item is placed into the first free "lane" (sub-column). Items that
 * transitively overlap form a connected cluster; every item in a cluster is
 * divided by the SAME lane count so they render as equal-width columns sitting
 * next to each other — exactly how Google Calendar splits a busy time slot.
 * Items that don't overlap anyone keep the full width (lanes = 1).
 *
 * Introduced for the "allow overlapping bookings on one shared calendar"
 * feature: with no per-master columns, two bookings at the same time would
 * otherwise stack on top of each other and hide one another.
 */

export interface LaneItem {
  id: string | number;
  /** Start offset in minutes from midnight. */
  startMin: number;
  /** End offset in minutes from midnight. Clamped to be > startMin. */
  endMin: number;
}

export interface LanePlacement {
  /** 0-based column index within the item's overlap cluster. */
  lane: number;
  /** Total columns the cluster is divided into (>= 1). */
  lanes: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  // Touching edges (a ends exactly when b starts) do NOT overlap.
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Compute a lane placement for every item. Returns a Map keyed by item id.
 * Pure and deterministic: items are processed in (startMin, endMin, id) order.
 */
export function computeLanes(items: ReadonlyArray<LaneItem>): Map<LaneItem["id"], LanePlacement> {
  const result = new Map<LaneItem["id"], LanePlacement>();
  if (items.length === 0) return result;

  // Normalize: clamp degenerate/zero-length items so they still occupy a lane.
  const sorted = items
    .map((it) => ({
      id: it.id,
      startMin: it.startMin,
      endMin: Math.max(it.endMin, it.startMin + 1),
    }))
    .sort((a, b) =>
      a.startMin - b.startMin ||
      a.endMin - b.endMin ||
      String(a.id).localeCompare(String(b.id)),
    );

  // Walk left-to-right, grouping into connected clusters. A cluster stays open
  // while the next item starts before the cluster's running max end-time.
  let cluster: Array<{ id: LaneItem["id"]; startMin: number; endMin: number; lane: number }> = [];
  let clusterMaxEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const lanes = cluster.reduce((mx, c) => Math.max(mx, c.lane + 1), 1);
    for (const c of cluster) result.set(c.id, { lane: c.lane, lanes });
    cluster = [];
    clusterMaxEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterMaxEnd) {
      // No overlap with anything still open → close the previous cluster.
      flush();
    }
    // First free lane: lowest index not occupied by an item this one overlaps.
    const taken = new Set<number>();
    for (const c of cluster) {
      if (overlaps(item.startMin, item.endMin, c.startMin, c.endMin)) taken.add(c.lane);
    }
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    cluster.push({ id: item.id, startMin: item.startMin, endMin: item.endMin, lane });
    clusterMaxEnd = Math.max(clusterMaxEnd, item.endMin);
  }
  flush();

  return result;
}
