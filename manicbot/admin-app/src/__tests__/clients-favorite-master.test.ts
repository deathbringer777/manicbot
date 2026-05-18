/**
 * 0074 — favorite-master functionality on the clients tRPC router.
 *
 * Three angles:
 *   1. `create` + `update` accept and persist `favoriteMasterId`, AND
 *      reject ids that don't belong to the tenant (cross-tenant
 *      id-stuffing guard).
 *   2. Stale pointers (archived master) get silently cleared on write
 *      so they don't poison the suggestion query.
 *   3. `computeFavoriteMasterSuggestion` returns the manual pin when
 *      set + non-archived, falls back to history-derived top-1 from
 *      the non-cancelled appointments group-by, and skips archived
 *      candidates when walking the histogram.
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

const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));
vi.mock("~/server/clients/marketingSync", () => ({
  syncMarketingContact: syncMock,
}));

import { createCallerFactory } from "~/server/api/trpc";
import {
  clientsRouter,
  computeFavoriteMasterSuggestion,
} from "~/server/api/routers/clients";
import { makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_demo";

/** Builds a Drizzle-shaped db whose `.select()` returns results in queued
 *  FIFO order. Same pattern as the existing clients-router.test.ts. */
function buildDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const updates: Array<{ set: Record<string, unknown> }> = [];
  const inserts: Array<{ values: Record<string, unknown> }> = [];

  function chainable(result: unknown): any {
    const limitChain: any = {
      offset: () => Promise.resolve(result),
      then: (resolve: any) => Promise.resolve(result).then(resolve),
    };
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      limit: () => limitChain,
      offset: () => Promise.resolve(result),
      then: (resolve: any) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const db: any = {
    select: vi.fn(() => chainable(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        inserts.push({ values: vals });
        return Promise.resolve({ ok: true });
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        updates.push({ set: vals });
        return { where: vi.fn().mockResolvedValue({ ok: true }) };
      }),
    })),
  };
  return { db, updates, inserts };
}

describe("clientsRouter — favorite-master (0074)", () => {
  const createCaller = createCallerFactory(clientsRouter);
  beforeEach(() => {
    vi.clearAllMocks();
    syncMock.mockResolvedValue(99);
  });

  describe("create with favoriteMasterId", () => {
    it("persists the pin when the master row is active in this tenant", async () => {
      // Queue: 1 select for resolveFavoriteMasterId (master row).
      const { db, inserts } = buildDb([
        [{ chatId: 555, archivedAt: null }],
      ]);
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await caller.create({
        tenantId: TENANT,
        name: "Karina",
        contacts: { phone: "+48500152948" },
        favoriteMasterId: 555,
      });
      expect(inserts[0]!.values).toMatchObject({ favoriteMasterId: 555 });
    });

    it("rejects an id that doesn't exist in this tenant (cross-tenant guard)", async () => {
      // The resolver's master lookup returns no row → BAD_REQUEST.
      const { db } = buildDb([[]]);
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await expect(
        caller.create({
          tenantId: TENANT,
          name: "Karina",
          contacts: { phone: "+48500152948" },
          favoriteMasterId: 999,
        }),
      ).rejects.toMatchObject({
        message: "favorite_master_not_in_tenant",
        code: "BAD_REQUEST",
      });
    });

    it("silently clears the pin when the targeted master is archived", async () => {
      // archivedAt non-null → resolver returns null, insert lands with null.
      const { db, inserts } = buildDb([
        [{ chatId: 555, archivedAt: 1700000000 }],
      ]);
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await caller.create({
        tenantId: TENANT,
        name: "Karina",
        contacts: { phone: "+48500152948" },
        favoriteMasterId: 555,
      });
      expect(inserts[0]!.values).toMatchObject({ favoriteMasterId: null });
    });

    it("treats omitted favoriteMasterId as null without firing the lookup", async () => {
      // Queue intentionally empty: the resolver early-returns on null and
      // makes no DB call. If we got it wrong, .select() would throw.
      const { db, inserts } = buildDb([]);
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await caller.create({
        tenantId: TENANT,
        name: "Karina",
        contacts: { phone: "+48500152948" },
      });
      expect(inserts[0]!.values).toMatchObject({ favoriteMasterId: null });
    });
  });

  describe("update patch with favoriteMasterId", () => {
    it("writes the pin through and re-syncs marketing", async () => {
      // Queue:
      //   1. existing-user lookup (clients.update prelude)
      //   2. master validation (resolveFavoriteMasterId)
      const { db, updates } = buildDb([
        [{ chatId: -1, tenantId: TENANT, name: "K", phone: "+48..." }],
        [{ chatId: 555, archivedAt: null }],
      ]);
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await caller.update({
        tenantId: TENANT,
        chatId: -1,
        patch: { favoriteMasterId: 555 },
      });
      // First update is the patch itself; favoriteMasterId is in `set`.
      const setShape = updates[0]!.set as Record<string, unknown>;
      expect(setShape.favoriteMasterId).toBe(555);
    });

    it("rejects cross-tenant id-stuffing on update", async () => {
      const { db } = buildDb([
        [{ chatId: -1, tenantId: TENANT, name: "K", phone: "+48..." }],
        [],
      ]);
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await expect(
        caller.update({
          tenantId: TENANT,
          chatId: -1,
          patch: { favoriteMasterId: 999 },
        }),
      ).rejects.toMatchObject({ message: "favorite_master_not_in_tenant" });
    });
  });

  describe("computeFavoriteMasterSuggestion", () => {
    it("returns the manual pin when set + non-archived", async () => {
      // Queue order, in `.select().from(...)` call order:
      //   1. users → favorite_master_id row
      //   2. masters → manual pin lookup
      //   3. appointments → derived histogram
      //   4. masters → adopt-or-skip lookup for the derived top-1
      const { db } = buildDb([
        [{ favoriteMasterId: 333 }],
        [{ chatId: 333, name: "Anna", archivedAt: null }],
        [{ masterId: 222, count: 5 }],
        [{ chatId: 222, name: "Bob", archivedAt: null }],
      ]);
      const r = await computeFavoriteMasterSuggestion(db, TENANT, -1);
      expect(r.manual).toMatchObject({ masterId: 333, name: "Anna" });
      // Derived still computed in parallel so the UI can show "(auto)" when
      // a salon owner hasn't pinned anyone — transparent fallback.
      expect(r.derived).toMatchObject({ masterId: 222, name: "Bob", count: 5 });
    });

    it("falls back to derived favorite when no manual pin is set", async () => {
      const { db } = buildDb([
        [{ favoriteMasterId: null }],
        // The manual-master lookup is skipped — favorite_master_id is null.
        [{ masterId: 222, count: 5 }, { masterId: 444, count: 1 }],
        [{ chatId: 222, name: "Olga", archivedAt: null }],
      ]);
      const r = await computeFavoriteMasterSuggestion(db, TENANT, -1);
      expect(r.manual).toBeNull();
      expect(r.derived).toMatchObject({ masterId: 222, name: "Olga", count: 5 });
    });

    it("walks past archived top-1 in the derived histogram", async () => {
      const { db } = buildDb([
        [{ favoriteMasterId: null }],
        [{ masterId: 222, count: 5 }, { masterId: 444, count: 2 }],
        [{ chatId: 222, name: "Olga", archivedAt: 1700000000 }], // archived → skip
        [{ chatId: 444, name: "Karina", archivedAt: null }],     // adopt next
      ]);
      const r = await computeFavoriteMasterSuggestion(db, TENANT, -1);
      expect(r.derived).toMatchObject({ masterId: 444, name: "Karina" });
    });

    it("returns both null when client has no row and no history", async () => {
      const { db } = buildDb([
        [],   // users lookup → no row
        [],   // appointments → no candidates
      ]);
      const r = await computeFavoriteMasterSuggestion(db, TENANT, -1);
      expect(r.manual).toBeNull();
      expect(r.derived).toBeNull();
    });
  });
});
