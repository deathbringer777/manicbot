/**
 * God Mode "Bots" page backend — adminBotsRouter.
 *
 * Pins:
 *   - both procedures are adminProcedure (system_admin-only): unauth → UNAUTHORIZED,
 *     tenant_owner → FORBIDDEN.
 *   - list proxies GET /admin/bots-status (Bearer ADMIN_KEY) and parses `bots`.
 *   - resetWebhook proxies GET /admin/reset-webhooks, with ?botId= when supplied
 *     and without it for "fix all".
 *   - the bot token is never present in the proxied payload (Worker returns
 *     webhook metadata only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    ADMIN_KEY: "admin-key-with-at-least-thirty-two-characters-xx",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { adminBotsRouter } from "~/server/api/routers/adminBots";
import { createDbMock, makeAdminCtx, makeTenantOwnerCtx, makeUnauthCtx } from "./helpers/db-mock";

const callerFactory = createCallerFactory(adminBotsRouter);

const SAMPLE_STATUS = {
  ok: true,
  count: 1,
  bots: [
    {
      botId: "100",
      tenantId: "t_a",
      username: "a_bot",
      active: true,
      webhook: { ok: true, set: false, url: "", pending: 2, lastErrorDate: null, lastErrorMessage: null },
    },
  ],
};

describe("adminBots — role gates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("list rejects unauthenticated (UNAUTHORIZED)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("list rejects tenant_owner (FORBIDDEN)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("resetWebhook rejects tenant_owner (FORBIDDEN)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(caller.resetWebhook({ botId: "100" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("adminBots — proxy behaviour", () => {
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      const body = String(url).includes("/admin/reset-webhooks")
        ? { ok: true, count: 1, results: [{ botId: "100", ok: true }] }
        : SAMPLE_STATUS;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("list calls Worker /admin/bots-status with Bearer ADMIN_KEY and returns parsed bots", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeAdminCtx(db) as never);
    const rows = await caller.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.botId).toBe("100");
    expect(rows[0]!.webhook.set).toBe(false);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe("https://worker.test.local/admin/bots-status");
    const auth = new Headers(fetchCalls[0]!.init?.headers).get("authorization");
    expect(auth).toBe("Bearer admin-key-with-at-least-thirty-two-characters-xx");
    // never leak a token in the proxied payload
    expect(JSON.stringify(rows)).not.toMatch(/:[A-Za-z0-9_-]{30,}/);
  });

  it("resetWebhook with botId hits ?botId=", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeAdminCtx(db) as never);
    const r = await caller.resetWebhook({ botId: "100" });
    expect(r.ok).toBe(true);
    expect(fetchCalls[0]!.url).toBe("https://worker.test.local/admin/reset-webhooks?botId=100");
  });

  it("resetWebhook without botId re-registers all", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeAdminCtx(db) as never);
    const r = await caller.resetWebhook({});
    expect(r.ok).toBe(true);
    expect(fetchCalls[0]!.url).toBe("https://worker.test.local/admin/reset-webhooks");
  });
});
