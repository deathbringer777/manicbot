/**
 * tRPC tests for the IG diagnostic + lifecycle additions (PR 2):
 *   - salon.sendInstagramTestMessage (Worker call shape, error mapping)
 *   - salon.disconnectChannel (soft mode default keeps the row, hard deletes)
 *   - salon.reactivateChannel (sets active=1)
 *
 * Coverage focuses on what changes vs PR 1: the mode parameter and the new
 * test-send endpoint. Existing assertTenantOwner gating is verified once
 * to pin the auth surface — exhaustive auth-gate testing is already done
 * in the broader assertTenantOwner tests.
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
import { salonRouter } from "~/server/api/routers/salon";
import { createDbMock, makeTenantOwnerCtx, makeUnauthCtx } from "./helpers/db-mock";

const TENANT = "t_demo_channels";

function mockFetchOk(body: Record<string, unknown>, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}
function mockFetchErr(body: Record<string, unknown>, status: number) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("salon — channel diagnostic + lifecycle (PR 2)", () => {
  const createCaller = createCallerFactory(salonRouter);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-18T12:00:00Z").getTime());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── sendInstagramTestMessage ────────────────────────────────────────────

  describe("sendInstagramTestMessage", () => {
    it("rejects unauthenticated callers", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeUnauthCtx(db) as never);
      // salonRouter is tenantOwnerProcedure → assertTenantOwner throws
      // FORBIDDEN for non-owners (incl. anonymous). Code asserted loosely
      // because the same surface protects against UNAUTHORIZED for some
      // routes — what matters is the call is refused.
      await expect(
        caller.sendInstagramTestMessage({ tenantId: TENANT, psid: "17841437" }),
      ).rejects.toMatchObject({ code: /FORBIDDEN|UNAUTHORIZED/ });
    });

    it("FORBIDDEN on cross-tenant", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, "t_other") as never);
      await expect(
        caller.sendInstagramTestMessage({ tenantId: TENANT, psid: "17841437" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("calls Worker /admin/ig-send-test with Bearer + body", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      const fetchSpy = mockFetchOk({
        ok: true, sendRes: { ok: true }, api: "instagram_direct",
      });

      const result = await caller.sendInstagramTestMessage({
        tenantId: TENANT, psid: "17841437", text: "hi",
      });
      expect(result.ok).toBe(true);
      expect(result.api).toBe("instagram_direct");

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe("https://worker.test/admin/ig-send-test");
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer test-admin-key",
      });
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toEqual({ tenantId: TENANT, psid: "17841437", text: "hi" });
    });

    it("maps 404 (no_active_ig_channel) to tRPC NOT_FOUND", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      mockFetchErr({ ok: false, error: "no_active_ig_channel" }, 404);
      await expect(
        caller.sendInstagramTestMessage({ tenantId: TENANT, psid: "17841437" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "no_active_ig_channel" });
    });

    it("surfaces outside_message_window from Worker sendRes verbatim", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      // Worker returns 200 with sendRes.ok=false and a Meta-level reason —
      // the proc should surface the reason as the tRPC error message so the
      // dialog can show the outside-window hint.
      mockFetchOk({ ok: false, sendRes: { ok: false, error: "outside_message_window" } });
      await expect(
        caller.sendInstagramTestMessage({ tenantId: TENANT, psid: "17841437" }),
      ).rejects.toMatchObject({ message: "outside_message_window" });
    });

    it("rejects oversize text via zod (1000 char cap)", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await expect(
        caller.sendInstagramTestMessage({
          tenantId: TENANT,
          psid: "17841437",
          text: "x".repeat(1001),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── disconnectChannel mode toggle ───────────────────────────────────────

  describe("disconnectChannel — soft vs hard mode", () => {
    it("default mode is 'soft' — UPDATE (active=0), not DELETE", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      const result = await caller.disconnectChannel({
        tenantId: TENANT, channelType: "instagram",
      });
      expect(result.mode).toBe("soft");
      // No .delete() call should have run.
      expect(dbMock.deleteCalls).toHaveLength(0);
      // One .update().set({ active: 0 }).
      expect(dbMock.updateCalls).toHaveLength(1);
      expect(dbMock.updateCalls[0]!.values).toMatchObject({ active: 0 });
    });

    it("mode='hard' triggers DELETE, no UPDATE", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      const result = await caller.disconnectChannel({
        tenantId: TENANT, channelType: "instagram", mode: "hard",
      });
      expect(result.mode).toBe("hard");
      expect(dbMock.deleteCalls).toHaveLength(1);
      expect(dbMock.deleteCalls[0]!.whereCalled).toBe(true);
      expect(dbMock.updateCalls).toHaveLength(0);
    });

    it("FORBIDDEN on cross-tenant (auth gate is enforced regardless of mode)", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_other") as never);
      await expect(
        caller.disconnectChannel({ tenantId: TENANT, channelType: "instagram", mode: "hard" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ── reactivateChannel ───────────────────────────────────────────────────

  describe("reactivateChannel", () => {
    it("sets active=1 via UPDATE", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
      await caller.reactivateChannel({ tenantId: TENANT, channelType: "instagram" });
      expect(dbMock.updateCalls).toHaveLength(1);
      expect(dbMock.updateCalls[0]!.values).toMatchObject({ active: 1 });
    });

    it("FORBIDDEN on cross-tenant", async () => {
      const dbMock = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(dbMock.db, "t_other") as never);
      await expect(
        caller.reactivateChannel({ tenantId: TENANT, channelType: "instagram" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
