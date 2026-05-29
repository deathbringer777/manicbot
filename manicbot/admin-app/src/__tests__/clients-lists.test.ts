/**
 * clients router — list membership surface (shared "Lists" unification).
 *
 * Pins the bridge between Salon Clients (`users`) and the shared marketing
 * lists (`marketing_segments` kind='manual'):
 *
 *   * `list` accepts a `listId` and verifies the segment belongs to the
 *     caller's tenant (FORBIDDEN on a foreign segment) before filtering.
 *   * `addToList` resolves each client's `marketing_contact_id`, lazily
 *     creating the contact via `syncMarketingContact` when missing (and
 *     writing the id back to `users`), then delegates membership to the
 *     shared `addContactsToSegment` helper.
 *   * Clients with no usable channel (sync returns null) are skipped, never
 *     added.
 *   * `removeFromList` resolves links and delegates to the helper.
 *   * Cross-tenant: a foreign `tenantId` (assertTenantOwner) or a foreign
 *     `listId` (segment ownership check) is rejected before any membership
 *     write — no cross-tenant audience leak.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    AUTH_SECRET: "test-secret",
  },
}));

// syncMarketingContact + the shared segment helper are unit-tested elsewhere.
// Here we mock them to observe how the clients router orchestrates them.
const mockSync = vi.fn<(...args: unknown[]) => Promise<number | null>>(async () => 99);
vi.mock("~/server/clients/marketingSync", () => ({
  syncMarketingContact: (...args: unknown[]) => mockSync(...args),
}));

const mockAdd = vi.fn<(...args: unknown[]) => Promise<{ added: number; skipped: number }>>(
  async () => ({ added: 0, skipped: 0 }),
);
const mockRemove = vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(async () => ({ ok: true }));
vi.mock("~/server/marketing/segments", () => ({
  addContactsToSegment: (...args: unknown[]) => mockAdd(...args),
  removeContactsFromSegment: (...args: unknown[]) => mockRemove(...args),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { clientsRouter } from "~/server/api/routers/clients";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(clientsRouter);
const T = "t_a";

describe("clients.list — listId filter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifies the segment belongs to the tenant, then returns members", async () => {
    // selects: 1) segment-tenant verify, 2) rows, 3) count
    const { db } = createDbMock([
      [{ tenantId: T }],
      [{ chatId: 1, name: "Margarita", marketingContactId: 11, lifetimeVisits: 3 }],
      [{ count: 1 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    const out = await caller.list({ tenantId: T, listId: "seg_vip" });
    expect(out.total).toBe(1);
    expect(out.rows).toHaveLength(1);
  });

  it("rejects a listId pointing at another tenant's segment", async () => {
    const { db } = createDbMock([[{ tenantId: "t_other" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    await expect(
      caller.list({ tenantId: T, listId: "seg_foreign" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("404s on an unknown listId", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    await expect(
      caller.list({ tenantId: T, listId: "seg_missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("clients.addToList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses existing marketing_contact_id links and delegates to addContactsToSegment", async () => {
    mockAdd.mockResolvedValueOnce({ added: 2, skipped: 0 });
    // selects: 1) segment verify, 2) users load
    const { db, updateCalls } = createDbMock([
      [{ tenantId: T }],
      [
        { chatId: 1, marketingContactId: 11, name: "A", phone: "+4811", email: null, tgUsername: null, igUsername: null, tags: null },
        { chatId: 2, marketingContactId: 12, name: "B", phone: "+4822", email: null, tgUsername: null, igUsername: null, tags: null },
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    const out = await caller.addToList({ tenantId: T, chatIds: [1, 2], listId: "seg_vip" });

    expect(mockSync).not.toHaveBeenCalled(); // both already linked
    expect(updateCalls).toHaveLength(0);     // no writeback needed
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const args = mockAdd.mock.calls[0]!;
    expect(args[1]).toBe(T);          // tenantId
    expect(args[2]).toBe("seg_vip");  // segmentId
    expect(args[3]).toEqual([11, 12]); // resolved contact ids
    expect(out).toMatchObject({ added: 2, synced: 0 });
  });

  it("lazily syncs a client with no marketing_contact_id and writes the id back", async () => {
    mockSync.mockResolvedValueOnce(77);
    mockAdd.mockResolvedValueOnce({ added: 1, skipped: 0 });
    const { db, updateCalls } = createDbMock([
      [{ tenantId: T }],
      [{ chatId: 5, marketingContactId: null, name: "New", phone: "+4855", email: null, tgUsername: null, igUsername: null, tags: null }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    const out = await caller.addToList({ tenantId: T, chatIds: [5], listId: "seg_vip" });

    expect(mockSync).toHaveBeenCalledTimes(1);
    const syncArgs = mockSync.mock.calls[0]!;
    expect(syncArgs[1]).toBe(T);                       // tenantId
    expect(syncArgs[3]).toBe("salon_clients_manual");  // source
    // The freshly-created contact id is written back onto users.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.values).toMatchObject({ marketingContactId: 77 });
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0]![3]).toEqual([77]);
    expect(out).toMatchObject({ added: 1, synced: 1 });
  });

  it("skips a client with no usable channel (sync returns null) — never added", async () => {
    mockSync.mockResolvedValueOnce(null);
    const { db, updateCalls } = createDbMock([
      [{ tenantId: T }],
      [{ chatId: 9, marketingContactId: null, name: "Ghost", phone: null, email: null, tgUsername: null, igUsername: null, tags: null }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    const out = await caller.addToList({ tenantId: T, chatIds: [9], listId: "seg_vip" });

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(updateCalls).toHaveLength(0);   // nothing to write back
    expect(mockAdd).not.toHaveBeenCalled(); // no resolvable contacts
    expect(out).toMatchObject({ added: 0, synced: 0, skipped: 1 });
  });

  it("rejects a foreign segment before any sync or membership write", async () => {
    const { db } = createDbMock([[{ tenantId: "t_other" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    await expect(
      caller.addToList({ tenantId: T, chatIds: [1], listId: "seg_foreign" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("rejects a foreign tenantId (assertTenantOwner) before touching the DB", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    await expect(
      caller.addToList({ tenantId: "t_b", chatIds: [1], listId: "seg_x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe("clients.removeFromList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves existing links and delegates to removeContactsFromSegment", async () => {
    const { db } = createDbMock([
      [{ tenantId: T }],
      [
        { chatId: 1, marketingContactId: 11 },
        { chatId: 2, marketingContactId: null }, // not linked → nothing to remove
      ],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    const out = await caller.removeFromList({ tenantId: T, chatIds: [1, 2], listId: "seg_vip" });
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove.mock.calls[0]![3]).toEqual([11]);
    expect(out).toEqual({ ok: true });
  });

  it("rejects a foreign segment", async () => {
    const { db } = createDbMock([[{ tenantId: "t_other" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    await expect(
      caller.removeFromList({ tenantId: T, chatIds: [1], listId: "seg_foreign" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
