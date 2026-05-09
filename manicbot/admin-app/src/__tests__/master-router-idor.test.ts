/**
 * #P0-4 — assertCallerIsMaster used to fall back to a count-based heuristic
 * for personal-tenant masters (exactly one row → assume that row is the
 * caller). After migration 0046 backfills web_user_id, the fallback was
 * deleted in masterRouter.ts; this test pins the new behaviour:
 *
 *   1. caller bound to their own row → allowed.
 *   2. caller targets another master in the same tenant → FORBIDDEN.
 *   3. caller's row not yet bound (web_user_id NULL) → FORBIDDEN, no fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { masterRouter } from "~/server/api/routers/masterRouter";
import { createDbMock, makeMasterCtx } from "./helpers/db-mock";

describe("masterRouter IDOR guard (#P0-4)", () => {
  const createCaller = createCallerFactory(masterRouter);

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("master bound to chatId 100 can update their own delegation", async () => {
    // assertCallerIsMaster issues one SELECT against masters where
    // webUserId = caller and limit 1. We seed [{ chatId: 100 }].
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_personal_alice");
    const caller = createCaller(ctx as never);
    const r = await caller.updateDelegation({
      tenantId: "t_personal_alice",
      masterId: 100,
      allowDelegation: 1,
    });
    expect(r).toEqual({ success: true });
  });

  it("master cannot update another master's delegation in the same tenant", async () => {
    // boundRow exists (chatId=100) but the input targets chatId=200 — IDOR.
    const { db } = createDbMock([[{ chatId: 100 }]]);
    const ctx = makeMasterCtx(db, "t_personal_alice");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateDelegation({
        tenantId: "t_personal_alice",
        masterId: 200,
        allowDelegation: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("master without a web_user_id binding gets FORBIDDEN (no count fallback)", async () => {
    // Empty result for the master-bound query → boundRow undefined.
    // Pre-#P0-4 the code dropped into a personal-tenant count check; now
    // it must reject outright. (Migration 0046 backfills these rows; any
    // remainders need manual ops attention.)
    const { db } = createDbMock([[]]);
    const ctx = makeMasterCtx(db, "t_legacy");
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateDelegation({
        tenantId: "t_legacy",
        masterId: 1,
        allowDelegation: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects role mismatch before touching the DB", async () => {
    // tenant_owner shouldn't be allowed to call updateDelegation at all —
    // it's master-only by design.
    const { db } = createDbMock([]);
    const ctx = {
      db,
      webUser: {
        id: "w_owner",
        email: "owner@test.com",
        tenantId: "t_x",
        webRole: "tenant_owner",
      },
      headers: new Headers(),
    };
    const caller = createCaller(ctx as never);
    await expect(
      caller.updateDelegation({ tenantId: "t_x", masterId: 1, allowDelegation: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── Read-side IDOR coverage (regression for the data-leak surface) ──────
  //
  // Each procedure follows the same shape: assertCallerIsMaster issues one
  // SELECT against masters; on success the data query runs.
  //   - mismatch (boundRow.chatId !== input.masterId)  → FORBIDDEN, no data fetch
  //   - missing binding (web_user_id NULL)             → FORBIDDEN, no data fetch
  //   - matching binding                               → returns data

  describe("getMySchedule", () => {
    it("master can read their own schedule", async () => {
      const { db } = createDbMock([[{ chatId: 100 }], [{ id: 1, masterId: 100 }]]);
      const ctx = makeMasterCtx(db, "t_personal_alice");
      const caller = createCaller(ctx as never);
      const r = await caller.getMySchedule({ tenantId: "t_personal_alice", masterId: 100 });
      expect(r).toEqual([{ id: 1, masterId: 100 }]);
    });

    it("master CANNOT read another master's schedule (within-tenant IDOR)", async () => {
      const { db } = createDbMock([[{ chatId: 100 }]]);
      const ctx = makeMasterCtx(db, "t_personal_alice");
      const caller = createCaller(ctx as never);
      await expect(
        caller.getMySchedule({ tenantId: "t_personal_alice", masterId: 200 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("master without web_user_id binding gets FORBIDDEN", async () => {
      const { db } = createDbMock([[]]);
      const ctx = makeMasterCtx(db, "t_legacy");
      const caller = createCaller(ctx as never);
      await expect(
        caller.getMySchedule({ tenantId: "t_legacy", masterId: 1 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("getMyAppointments", () => {
    it("master can read their own appointment history", async () => {
      const { db } = createDbMock([[{ chatId: 100 }], [{ id: 1, masterId: 100 }]]);
      const ctx = makeMasterCtx(db, "t_personal_alice");
      const caller = createCaller(ctx as never);
      const r = await caller.getMyAppointments({ tenantId: "t_personal_alice", masterId: 100 });
      expect(r).toEqual([{ id: 1, masterId: 100 }]);
    });

    it("master CANNOT read another master's appointment history", async () => {
      const { db } = createDbMock([[{ chatId: 100 }]]);
      const ctx = makeMasterCtx(db, "t_personal_alice");
      const caller = createCaller(ctx as never);
      await expect(
        caller.getMyAppointments({ tenantId: "t_personal_alice", masterId: 200 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("getMyEarnings", () => {
    it("master can read their own earnings", async () => {
      // 3 selects: bound row, appointments, services
      const { db } = createDbMock([
        [{ chatId: 100 }],
        [{ id: 1, svcId: "svc1", status: "confirmed" }],
        [{ svcId: "svc1", price: 50 }],
      ]);
      const ctx = makeMasterCtx(db, "t_personal_alice");
      const caller = createCaller(ctx as never);
      const r = await caller.getMyEarnings({ tenantId: "t_personal_alice", masterId: 100 });
      expect(r).toEqual({ total: 50, count: 1 });
    });

    it("master CANNOT read another master's earnings", async () => {
      const { db } = createDbMock([[{ chatId: 100 }]]);
      const ctx = makeMasterCtx(db, "t_personal_alice");
      const caller = createCaller(ctx as never);
      await expect(
        caller.getMyEarnings({ tenantId: "t_personal_alice", masterId: 200 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("getMyClients", () => {
    it("master CANNOT read another master's client list", async () => {
      const { db } = createDbMock([[{ chatId: 100 }]]);
      const ctx = makeMasterCtx(db, "t_personal_alice");
      const caller = createCaller(ctx as never);
      await expect(
        caller.getMyClients({ tenantId: "t_personal_alice", masterId: 200 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── tenant_owner / system_admin bypass (by design) ───────────────────────
  // These roles legitimately need cross-master visibility within their tenant.

  describe("tenant_owner cross-master read (legitimate)", () => {
    it("tenant_owner reads any master's schedule in their own tenant", async () => {
      // assertCallerIsMaster short-circuits for tenant_owner — no boundRow query.
      // Only the data query runs.
      const { db } = createDbMock([[{ id: 1, masterId: 200 }]]);
      const ctx = {
        db,
        webUser: {
          id: "w_owner",
          email: "owner@test.com",
          tenantId: "t_personal_alice",
          webRole: "tenant_owner",
        },
        headers: new Headers(),
      };
      const caller = createCaller(ctx as never);
      const r = await caller.getMySchedule({ tenantId: "t_personal_alice", masterId: 200 });
      expect(r).toEqual([{ id: 1, masterId: 200 }]);
    });
  });
});
