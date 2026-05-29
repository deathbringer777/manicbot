/**
 * segments helper — shared manual-list membership ops (server/marketing/segments.ts).
 *
 * This is the single seam both the Marketing module (marketingTenant router)
 * and the Salon Clients tab (clients router) call to add/remove contacts to a
 * `kind='manual'` segment. The CALLER verifies the segment's tenant ownership
 * (FORBIDDEN); this helper enforces the *contact*-tenant guard and keeps the
 * denormalized `contactCount` in sync.
 *
 * Pins:
 *   * Only contacts that belong to the tenant are added — foreign ids are
 *     silently dropped (no cross-tenant audience leak).
 *   * Adding an already-member contact is a no-op (dedup).
 *   * `contactCount` is recomputed from the live member rows after every op.
 *   * Empty input is a no-op (no count write churn).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDbMock } from "./helpers/db-mock";
import {
  addContactsToSegment,
  removeContactsFromSegment,
} from "~/server/marketing/segments";

const T = 1_700_000_000;

describe("addContactsToSegment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds new members, skips existing ones, and recomputes contactCount", async () => {
    // select queue (in order the helper issues them):
    //   1. allowed-contacts lookup (both belong to tenant)
    //   2. exists-check for id 1  → not a member
    //   3. exists-check for id 2  → already a member
    //   4. recount               → 1 live member
    const { db, insertCalls, updateCalls } = createDbMock([
      [{ id: 1 }, { id: 2 }],
      [],
      [{ s: "seg_x" }],
      [{ count: 1 }],
    ]);

    const res = await addContactsToSegment(db, "t_a", "seg_x", [1, 2], T);

    expect(res).toEqual({ added: 1, skipped: 1 });
    // Only the non-member contact got inserted.
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.values).toMatchObject({
      segmentId: "seg_x",
      contactId: 1,
      addedAt: T,
    });
    // Denormalized count refreshed from the live rows.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.values).toMatchObject({ contactCount: 1, updatedAt: T });
  });

  it("silently drops contact ids that belong to a different tenant", async () => {
    // allowed lookup returns only id 1 — id 99 is foreign and never inserted.
    const { db, insertCalls } = createDbMock([
      [{ id: 1 }],
      [], // exists-check for id 1
      [{ count: 1 }], // recount
    ]);

    const res = await addContactsToSegment(db, "t_a", "seg_x", [1, 99], T);

    expect(res.added).toBe(1);
    expect(res.skipped).toBe(1); // the foreign id counts as skipped
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.values.contactId).toBe(1);
  });

  it("is a no-op for empty input (no membership or count writes)", async () => {
    const { db, insertCalls, updateCalls } = createDbMock([]);
    const res = await addContactsToSegment(db, "t_a", "seg_x", [], T);
    expect(res).toEqual({ added: 0, skipped: 0 });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("removeContactsFromSegment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes each (segment,contact) pair and recomputes contactCount", async () => {
    const { db, deleteCalls, updateCalls } = createDbMock([
      [{ count: 0 }], // recount after deletes
    ]);

    const res = await removeContactsFromSegment(db, "t_a", "seg_x", [1, 2], T);

    expect(res).toEqual({ ok: true });
    // One delete per contact id, each scoped via .where(...).
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls.every((c) => c.whereCalled)).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.values).toMatchObject({ contactCount: 0, updatedAt: T });
  });

  it("is a no-op for empty input", async () => {
    const { db, deleteCalls, updateCalls } = createDbMock([]);
    const res = await removeContactsFromSegment(db, "t_a", "seg_x", [], T);
    expect(res).toEqual({ ok: true });
    expect(deleteCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});
