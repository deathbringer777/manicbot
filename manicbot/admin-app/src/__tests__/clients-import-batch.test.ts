/**
 * clients.importCsv — batch lookup fix (fix #4 P1).
 *
 * The old implementation called findClientByPriority per row, which issued
 * up to 4 sequential SELECTs per CSV row (email, phone, tg, ig). For 5000
 * rows that's up to 20 000 round-trips.
 *
 * The fix batches all unique emails/phones/tg/ig values into 4 IN-queries,
 * builds a lookup map, and matches rows in-memory.
 *
 * This test verifies:
 *   1. For N CSV rows the SELECT count is O(1) not O(N): 4 batch lookups
 *      plus 1 per inserted row (insert + optional marketing update), not
 *      4×N lookups.
 *   2. Existing clients are updated (not re-inserted).
 *   3. New clients are inserted.
 *   4. Results are still correct (created, updated counts).
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
import { clientsRouter } from "~/server/api/routers/clients";
import { makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_demo";

function makeAwaitableChain(result: unknown) {
  const limitChain: any = {
    offset: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    limit: () => limitChain,
    then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function buildDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const selectSpy = vi.fn(() => makeAwaitableChain(queue.shift() ?? []));
  const insertCalls: Array<{ values: Record<string, unknown> }> = [];
  const updateCalls: Array<{ set: Record<string, unknown> }> = [];
  const db: any = {
    select: selectSpy,
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        insertCalls.push({ values: vals });
        const chain: any = {
          onConflictDoUpdate: vi.fn().mockResolvedValue({ ok: true }),
          then: (resolve: any, reject?: any) =>
            Promise.resolve({ ok: true }).then(resolve, reject),
        };
        return chain;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        updateCalls.push({ set: vals });
        return { where: vi.fn(() => Promise.resolve({ ok: true })) };
      }),
    })),
  };
  return { db, selectSpy, insertCalls, updateCalls };
}

describe("clients.importCsv — batch lookup (fix #4)", () => {
  const createCaller = createCallerFactory(clientsRouter);
  beforeEach(() => {
    vi.clearAllMocks();
    syncMock.mockResolvedValue(null);
  });

  it("uses O(1) SELECT queries for N new rows (4 batch lookups, not 4×N)", async () => {
    // CSV with 3 new clients (none match existing)
    const csv = [
      "name,phone,email,telegram,instagram,tags,notes,dob",
      "Alice,+48111111111,alice@test.com,alice_tg,,,,",
      "Bob,+48222222222,bob@test.com,,,,,",
      "Carol,,,carol_tg,carol_ig,,,",
    ].join("\n");

    // 4 batch lookups: emails, phones, tg, ig → all empty (no existing matches)
    const { db, selectSpy, insertCalls } = buildDb([
      [],  // batch email lookup → no existing
      [],  // batch phone lookup → no existing
      [],  // batch tg lookup → no existing
      [],  // batch ig lookup → no existing
    ]);

    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.importCsv({ tenantId: TENANT, csv });

    // 4 batch SELECTs total (not 4 × 3 = 12)
    expect(selectSpy).toHaveBeenCalledTimes(4);
    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(insertCalls).toHaveLength(3);
  });

  it("correctly identifies existing clients via batch lookup and skips or updates them", async () => {
    const csv = [
      "name,phone,email,telegram,instagram,tags,notes,dob",
      // Alice already has a name and phone/email — mergeRowIntoUser only fills
      // empty fields, so no UPDATE is issued (updated=0 for Alice).
      "Alice Old,+48111111111,alice@test.com,alice_new_tg,,,new notes,",
      "New Client,+48999999999,,,,,,",
    ].join("\n");

    const existingClient = {
      tenantId: TENANT, chatId: 42, name: "Alice Old",
      phone: "+48111111111", email: "alice@test.com",
      tgUsername: null,  // null → will be filled from CSV → triggers update
      igUsername: null, tags: null,
      notes: null,       // null → will be filled from CSV → triggers update
      dob: null,
      deletedAt: null,
    };

    // Batch lookups: emails finds Alice, phones finds Alice too
    const { db, selectSpy, insertCalls, updateCalls } = buildDb([
      [existingClient],  // email batch: Alice found
      [existingClient],  // phone batch: Alice found (same row)
      [],                // tg batch: empty (the new handle isn't in DB yet)
      [],                // ig batch: empty
    ]);

    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.importCsv({ tenantId: TENANT, csv });

    // Still only 4 batch SELECTs regardless of row count
    expect(selectSpy).toHaveBeenCalledTimes(4);
    // Alice has empty tgUsername + notes → mergeRowIntoUser fills them → update issued
    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);   // New Client inserted
    expect(insertCalls).toHaveLength(1);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("dry-run does not call SELECT at all for batch lookups", async () => {
    const csv = "name,phone\nAlice,+48111\n";
    const { db, selectSpy } = buildDb([]);
    const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.importCsv({ tenantId: TENANT, csv, dryRun: true });

    expect(selectSpy).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(result.total).toBe(1);
  });
});
