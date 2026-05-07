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
});
