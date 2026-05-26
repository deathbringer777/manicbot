/**
 * Smart grouping for the bell + /notifications full-history feed.
 *
 * Collapses bursts of same-kind notifications into a single "N events"
 * row, FB/VK-style. Pure function, no React, no fetch — safe to call
 * on every render of the bell / list.
 *
 * Grouping contract (pinned in grouping.test.ts):
 *   - Rows are assumed to arrive newest-first (matches `notifications.list`
 *     orderBy createdAt DESC).
 *   - A "burst" is ≥3 consecutive rows sharing the same (kind, sourceSlug)
 *     and falling within a 2-hour window measured from the newest member
 *     to the oldest member of the burst.
 *   - The representative (visually rendered) row is always the NEWEST of
 *     the burst — that's the one whose body/link/avatar the user most
 *     likely wants to see first.
 *   - "Consecutive" means consecutive in the rendered order. A row with
 *     a different kind in the middle breaks the burst — so two
 *     `messenger.message` rows, then a `support.reply`, then three more
 *     `messenger.message` rows yields a single 3-row group at the bottom
 *     and three ungrouped rows above. This matches FB's actual behavior:
 *     they group only continuous runs, not every same-kind row in the feed.
 *   - When `sourceSlug` is null/undefined, the row groups by kind alone.
 *
 * Why 2 hours: lower than that and we'd ungroup the "five bookings during
 * the morning rush" case; higher and a quiet salon would see "12 events"
 * for what's actually a week's worth of activity. Tune via the `windowSec`
 * option if a category needs different cadence (no current need).
 */

const DEFAULT_GROUP_MIN = 3;
const DEFAULT_WINDOW_SEC = 2 * 60 * 60; // 2h

export interface Groupable {
  /** Stable row id from D1. */
  id: string;
  /** e.g. "messenger.message", "appointment.created". */
  kind: string;
  /** Caller-supplied source bucket, e.g. "thread" / "appointment". May be null. */
  sourceSlug?: string | null;
  /** Caller-supplied source id; not used for grouping (use sourceSlug instead). */
  sourceId?: string | null;
  /** Unix seconds. */
  createdAt: number;
  /** Any extra fields are preserved verbatim on the representative row. */
  [k: string]: unknown;
}

export interface GroupingOptions {
  /** Minimum number of consecutive same-(kind, sourceSlug) rows to collapse. Default 3. */
  groupMin?: number;
  /** Time window in seconds — newest - oldest must be ≤ this for the group to form. Default 7200. */
  windowSec?: number;
}

export type GroupedItem<T extends Groupable> =
  | { type: "single"; row: T }
  | {
      type: "group";
      /** Newest row in the burst — what the UI renders by default. */
      representative: T;
      /** All rows in the burst (newest-first). Length === count. */
      rows: T[];
      /** Convenience: rows.length. */
      count: number;
    };

function sameBucket(a: Groupable, b: Groupable): boolean {
  if (a.kind !== b.kind) return false;
  const aSlug = a.sourceSlug ?? null;
  const bSlug = b.sourceSlug ?? null;
  return aSlug === bSlug;
}

/**
 * Group consecutive same-(kind, sourceSlug) bursts in `rows`.
 *
 * Input is expected newest-first (D1 ORDER BY createdAt DESC); the
 * output preserves that order. A burst that doesn't meet `groupMin`
 * passes through as N `single` items. A burst that meets the
 * threshold but spans more than `windowSec` between its newest and
 * oldest members ALSO passes through as singles — we don't want to
 * collapse "yesterday's morning rush" with "today's morning rush"
 * into one row.
 */
export function groupNotifications<T extends Groupable>(
  rows: readonly T[],
  options: GroupingOptions = {},
): Array<GroupedItem<T>> {
  const groupMin = options.groupMin ?? DEFAULT_GROUP_MIN;
  const windowSec = options.windowSec ?? DEFAULT_WINDOW_SEC;

  if (rows.length === 0) return [];

  const out: Array<GroupedItem<T>> = [];
  let i = 0;
  while (i < rows.length) {
    // Find the largest consecutive run starting at i that all share
    // (kind, sourceSlug). Stop at the first row that diverges OR at
    // the array end.
    let j = i + 1;
    while (j < rows.length && sameBucket(rows[i]!, rows[j]!)) j++;
    const run = rows.slice(i, j);

    // Window check: the newest is run[0] (input is sorted newest-first)
    // and the oldest is run[run.length - 1]. If they're > windowSec apart,
    // emit each as a single — we don't want stale collapses.
    if (run.length >= groupMin) {
      const newest = run[0]!.createdAt;
      const oldest = run[run.length - 1]!.createdAt;
      if (newest - oldest <= windowSec) {
        out.push({
          type: "group",
          representative: run[0]!,
          rows: run,
          count: run.length,
        });
        i = j;
        continue;
      }
    }

    // Otherwise emit each row of this run as a single.
    for (const row of run) out.push({ type: "single", row });
    i = j;
  }
  return out;
}
