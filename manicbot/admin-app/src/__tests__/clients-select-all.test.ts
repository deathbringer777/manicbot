/**
 * clients.listMatchingIds — "select all matching" id fetch.
 *
 * The Clients tab's Gmail-style "select all N matching" needs the full id set
 * for the CURRENT filter/search/list scope (not just the loaded page). This
 * procedure returns `{ chatIds, capped }` and shares the exact WHERE-builder
 * with `clients.list`, so the selected set always matches the visible set.
 *
 * Pins:
 *   * Returns the chatIds of every matching row (no filters).
 *   * Honors the listId ownership check — FORBIDDEN on a foreign segment,
 *     NOT_FOUND on an unknown one (same contract as `list`).
 *   * `capped=false` for a normal result set.
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
vi.mock("~/server/clients/marketingSync", () => ({
  syncMarketingContact: vi.fn().mockResolvedValue(99),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { clientsRouter } from "~/server/api/routers/clients";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(clientsRouter);
const T = "t_a";

describe("clients.listMatchingIds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the chatIds of every matching row (no filters/list)", async () => {
    // Only one select: the chatId scan (no listId → no segment verify).
    const { db } = createDbMock([
      [{ chatId: 1 }, { chatId: 2 }, { chatId: 3 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    const out = await caller.listMatchingIds({ tenantId: T });
    expect(out.chatIds).toEqual([1, 2, 3]);
    expect(out.capped).toBe(false);
  });

  it("passes search/filters through and still returns ids", async () => {
    const { db } = createDbMock([[{ chatId: 7 }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    const out = await caller.listMatchingIds({
      tenantId: T,
      search: "anna",
      filters: { hasPhone: true },
    });
    expect(out.chatIds).toEqual([7]);
  });

  it("verifies segment ownership then returns members for a listId", async () => {
    // selects: 1) segment-tenant verify, 2) chatId scan
    const { db } = createDbMock([
      [{ tenantId: T }],
      [{ chatId: 5 }, { chatId: 6 }],
    ]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    const out = await caller.listMatchingIds({ tenantId: T, listId: "seg_vip" });
    expect(out.chatIds).toEqual([5, 6]);
  });

  it("rejects a listId pointing at another tenant's segment", async () => {
    const { db } = createDbMock([[{ tenantId: "t_other" }]]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    await expect(
      caller.listMatchingIds({ tenantId: T, listId: "seg_foreign" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("404s on an unknown listId", async () => {
    const { db } = createDbMock([[]]);
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    await expect(
      caller.listMatchingIds({ tenantId: T, listId: "seg_missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a foreign tenantId before touching the DB", async () => {
    const { db } = createDbMock();
    const caller = createCaller(makeTenantOwnerCtx(db, T) as never);
    await expect(
      caller.listMatchingIds({ tenantId: "t_b" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
