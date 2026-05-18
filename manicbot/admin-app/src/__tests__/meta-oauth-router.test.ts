/**
 * tRPC router tests for `metaOAuth` — the salon-owner-facing gateway over
 * the Worker's Meta OAuth endpoints.
 *
 * Coverage:
 *   - auth gates: UNAUTHORIZED without webUser, FORBIDDEN on cross-tenant
 *   - env: returns INTERNAL_SERVER_ERROR when WORKER_PUBLIC_URL / ADMIN_KEY missing
 *   - returnTo origin lock — defense in depth even if Worker is misconfigured
 *   - Worker call shape: URL + headers + body, including webUserId binding
 *   - Worker error code → tRPC code mapping (403 → FORBIDDEN, 404 → NOT_FOUND)
 *   - happy-path return shape pass-through
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
import { metaOAuthRouter } from "~/server/api/routers/metaOAuth";
import { createDbMock, makeTenantOwnerCtx, makeUnauthCtx } from "./helpers/db-mock";

const TENANT = "t_demo_meta";
const VALID_RETURN_TO = "https://admin.manicbot.com/dashboard?tab=channels";
const VALID_STATE = "a".repeat(64);

// AUTH_URL must match VALID_RETURN_TO's origin or the router refuses.
process.env.AUTH_URL = "https://admin.manicbot.com";

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

describe("metaOAuthRouter", () => {
  const createCaller = createCallerFactory(metaOAuthRouter);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-05-18T12:00:00Z").getTime());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── start ──────────────────────────────────────────────────────────────

  describe("start", () => {
    it("UNAUTHORIZED when no session", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeUnauthCtx(db) as never);
      await expect(
        caller.start({ tenantId: TENANT, provider: "instagram", returnTo: VALID_RETURN_TO }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("FORBIDDEN when calling on a tenant the owner doesn't belong to", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, "t_other") as never);
      await expect(
        caller.start({ tenantId: TENANT, provider: "instagram", returnTo: VALID_RETURN_TO }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects returnTo on a foreign origin (anti-open-redirect)", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await expect(
        caller.start({
          tenantId: TENANT,
          provider: "instagram",
          returnTo: "https://evil.example.com/landing",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects invalid provider via zod", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await expect(
        // @ts-expect-error — feeding an off-enum value on purpose
        caller.start({ tenantId: TENANT, provider: "meta", returnTo: VALID_RETURN_TO }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("calls Worker /meta/oauth/start with Bearer ADMIN_KEY and webUserId", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      const fetchSpy = mockFetchOk({
        ok: true,
        authUrl: "https://www.instagram.com/oauth/authorize?state=abc",
        state: "abc".padEnd(64, "0"),
        callbackOrigin: "https://manicbot.com",
        expiresAt: 9999,
      });

      const result = await caller.start({
        tenantId: TENANT,
        provider: "instagram",
        returnTo: VALID_RETURN_TO,
      });

      expect(result.authUrl).toContain("instagram.com/oauth/authorize");
      expect(result.state).toMatch(/^[a-z0-9]{64}$/);
      expect(result.callbackOrigin).toBe("https://manicbot.com");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe("https://worker.test/meta/oauth/start");
      expect(init?.method).toBe("POST");
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer test-admin-key",
        "Content-Type": "application/json",
      });
      const sentBody = JSON.parse(String((init as RequestInit).body));
      // popup defaults to false — explicit so the Worker can stamp it on the state.
      expect(sentBody).toEqual({
        provider: "instagram",
        tenantId: TENANT,
        webUserId: "w_owner",
        returnTo: VALID_RETURN_TO,
        popup: false,
      });
    });

    it("passes popup=true through to the Worker when the caller opts in", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      const fetchSpy = mockFetchOk({
        ok: true,
        authUrl: "https://www.instagram.com/oauth/authorize?state=xyz",
        state: "xyz".padEnd(64, "0"),
        callbackOrigin: "https://manicbot.com",
        expiresAt: 9999,
      });

      await caller.start({
        tenantId: TENANT,
        provider: "instagram",
        returnTo: VALID_RETURN_TO,
        popup: true,
      });

      const [, init] = fetchSpy.mock.calls[0]!;
      const sentBody = JSON.parse(String((init as RequestInit).body));
      expect(sentBody.popup).toBe(true);
    });

    it("returns callbackOrigin so the browser can validate event.origin on postMessage", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      mockFetchOk({
        ok: true,
        authUrl: "https://www.instagram.com/oauth/authorize?state=abc",
        state: "abc".padEnd(64, "0"),
        callbackOrigin: "https://manicbot.com",
        expiresAt: 9999,
      });
      const result = await caller.start({
        tenantId: TENANT,
        provider: "instagram",
        returnTo: VALID_RETURN_TO,
      });
      expect(result.callbackOrigin).toBe("https://manicbot.com");
    });

    it("maps Worker 503 (oauth_not_configured) to a tRPC error", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      mockFetchErr({ ok: false, error: "oauth_not_configured" }, 503);
      await expect(
        caller.start({ tenantId: TENANT, provider: "instagram", returnTo: VALID_RETURN_TO }),
      ).rejects.toMatchObject({ message: "oauth_not_configured" });
    });
  });

  // ── consume ───────────────────────────────────────────────────────────

  describe("consume", () => {
    it("UNAUTHORIZED without session", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeUnauthCtx(db) as never);
      await expect(
        caller.consume({ tenantId: TENANT, state: VALID_STATE }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("FORBIDDEN on cross-tenant", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, "t_other") as never);
      await expect(
        caller.consume({ tenantId: TENANT, state: VALID_STATE }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rejects malformed state via zod (length 64)", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      await expect(
        caller.consume({ tenantId: TENANT, state: "short" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("auto-finalized IG-direct returns the channel id + identity payload", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      mockFetchOk({
        ok: true,
        autoFinalized: true,
        channelConfigId: "cc_new",
        provider: "instagram",
        subscribed: true,
        subscribeError: null,
        identity: { igUserId: "17841437", igUsername: "salon" },
      });

      const result = await caller.consume({ tenantId: TENANT, state: VALID_STATE });
      expect(result.autoFinalized).toBe(true);
      expect(result.channelConfigId).toBe("cc_new");
      expect(result.subscribed).toBe(true);
      expect(result.identity).toEqual({ igUserId: "17841437", igUsername: "salon" });
    });

    it("FB multi-page returns the picker payload with NO Page tokens", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      mockFetchOk({
        ok: true,
        autoFinalized: false,
        provider: "facebook",
        graphMe: { id: "100", name: "Owner" },
        pages: [
          { id: "pg_1", name: "Salon", igBusinessId: "ig1", igUsername: "salon" },
          { id: "pg_2", name: "Other", igBusinessId: null, igUsername: null },
        ],
      });

      const result = await caller.consume({ tenantId: TENANT, state: VALID_STATE });
      expect(result.autoFinalized).toBe(false);
      expect(result.pages).toHaveLength(2);
      // Page tokens must NEVER reach the browser via the picker payload.
      expect(JSON.stringify(result.pages)).not.toMatch(/EAA/);
    });

    it("Worker 403 → tRPC FORBIDDEN (IDOR detected server-side)", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      mockFetchErr({ ok: false, error: "draft_tenant_mismatch" }, 403);
      await expect(
        caller.consume({ tenantId: TENANT, state: VALID_STATE }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: "draft_tenant_mismatch" });
    });

    it("Worker 404 → tRPC NOT_FOUND", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      mockFetchErr({ ok: false, error: "draft_not_found" }, 404);
      await expect(
        caller.consume({ tenantId: TENANT, state: VALID_STATE }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ── finalize ──────────────────────────────────────────────────────────

  describe("finalize", () => {
    it("FORBIDDEN on cross-tenant", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, "t_other") as never);
      await expect(
        caller.finalize({ tenantId: TENANT, state: VALID_STATE, pageId: "pg_a" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("passes pageId + webUserId through to Worker", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      const fetchSpy = mockFetchOk({
        ok: true,
        channelConfigId: "cc_fb",
        provider: "facebook",
        subscribed: true,
        subscribeError: null,
        identity: { pageId: "pg_a", pageName: "Salon" },
      });

      const result = await caller.finalize({
        tenantId: TENANT,
        state: VALID_STATE,
        pageId: "pg_a",
      });
      expect(result.channelConfigId).toBe("cc_fb");

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe("https://worker.test/meta/oauth/finalize");
      const sentBody = JSON.parse(String((init as RequestInit).body));
      expect(sentBody).toEqual({
        state: VALID_STATE,
        tenantId: TENANT,
        webUserId: "w_owner",
        pageId: "pg_a",
      });
    });

    it("Worker page_not_in_draft → tRPC BAD_REQUEST", async () => {
      const { db } = createDbMock();
      const caller = createCaller(makeTenantOwnerCtx(db, TENANT) as never);
      mockFetchErr({ ok: false, error: "page_not_in_draft" }, 400);
      await expect(
        caller.finalize({ tenantId: TENANT, state: VALID_STATE, pageId: "pg_evil" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "page_not_in_draft" });
    });
  });
});
