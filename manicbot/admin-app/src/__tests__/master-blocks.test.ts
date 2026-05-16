/**
 * master_client_blocks procedures on the masterRouter.
 *
 * Pins:
 *   * blockClient inserts a row + bumps `onConflictDoNothing` on duplicate
 *   * blockClient rejects when the client doesn't exist in this tenant
 *   * unblockClient deletes the row
 *   * listMyBlockedClients returns rows with the client's name/phone joined
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

import { createCallerFactory } from "~/server/api/trpc";
import { masterRouter } from "~/server/api/routers/masterRouter";
import { makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_demo";
const MASTER = 555;

function chainable(result: unknown) {
  const limitChain: any = {
    offset: () => Promise.resolve(result),
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  };
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    limit: () => limitChain,
    offset: () => Promise.resolve(result),
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function buildDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const inserts: any[] = [];
  const deletes: any[] = [];
  const db: any = {
    select: vi.fn(() => chainable(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((vals: any) => {
        inserts.push(vals);
        return {
          onConflictDoNothing: vi.fn().mockResolvedValue({ ok: true }),
          then: (r: any) => Promise.resolve({ ok: true }).then(r),
        };
      }),
    })),
    delete: vi.fn(() => {
      const call: any = { whereArgs: null };
      deletes.push(call);
      return {
        where: vi.fn(async (args: any) => {
          call.whereArgs = args;
          return { ok: true };
        }),
      };
    }),
  };
  return { db, inserts, deletes };
}

function makeCtx(db: any) {
  // Owner-level cast allows assertCallerIsMaster to short-circuit (owner
  // override branch). The procedures don't restrict callers beyond that.
  return makeTenantOwnerCtx(db, TENANT);
}

describe("masterRouter.blockClient / unblockClient / listMyBlockedClients", () => {
  const createCaller = createCallerFactory(masterRouter);

  beforeEach(() => vi.clearAllMocks());

  it("blockClient inserts a row when the client exists", async () => {
    // Two selects: 1) tenants for assertCallerIsMaster owner-path — empty,
    // skipped (owner path doesn't query masters), 2) users existence check.
    const clientExists = [{ chatId: 99 }];
    const { db, inserts } = buildDb([clientExists]);
    const caller = createCaller(makeCtx(db) as never);
    const r = await caller.blockClient({
      tenantId: TENANT,
      masterId: MASTER,
      clientChatId: 99,
      reason: "no-show twice",
    });
    expect(r.ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tenantId: TENANT,
      masterChatId: MASTER,
      clientChatId: 99,
      reason: "no-show twice",
    });
    expect(inserts[0].blockedAt).toBeGreaterThan(0);
  });

  it("blockClient rejects when client doesn't exist", async () => {
    const { db, inserts } = buildDb([[]]); // client lookup miss
    const caller = createCaller(makeCtx(db) as never);
    await expect(
      caller.blockClient({ tenantId: TENANT, masterId: MASTER, clientChatId: 999 }),
    ).rejects.toMatchObject({ message: "client_not_found" });
    expect(inserts).toHaveLength(0);
  });

  it("unblockClient deletes the row without verifying client existence", async () => {
    const { db, deletes } = buildDb([]);
    const caller = createCaller(makeCtx(db) as never);
    const r = await caller.unblockClient({
      tenantId: TENANT,
      masterId: MASTER,
      clientChatId: 99,
    });
    expect(r.ok).toBe(true);
    expect(deletes).toHaveLength(1);
  });

  it("listMyBlockedClients returns the join with client name/phone", async () => {
    const rows = [
      { clientChatId: 1, reason: "abuse", blockedAt: 1700000000, clientName: "X", clientPhone: "+48000" },
    ];
    const { db } = buildDb([rows]);
    const caller = createCaller(makeCtx(db) as never);
    const r = await caller.listMyBlockedClients({ tenantId: TENANT, masterId: MASTER });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ clientChatId: 1, clientName: "X" });
  });
});
