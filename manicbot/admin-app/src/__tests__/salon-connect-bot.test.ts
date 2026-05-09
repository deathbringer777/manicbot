/**
 * #H3 — `salon.connectBot` must persist an encrypted bot token to D1
 * `bots.token_encrypted` so the Worker can decrypt it via getBotToken.
 *
 * Pre-fix: the mutation inserted only { botId, tenantId, botUsername,
 * webhookSecret, active }. Worker.getBotToken reads token_encrypted, found
 * NULL, logged an error, and the bot silently failed every webhook.
 *
 * This test pins the new behaviour:
 *   1. With BOT_ENCRYPTION_KEY set: insert includes tokenEncrypted = "v1$..."
 *   2. Without BOT_ENCRYPTION_KEY: mutation refuses (fail-closed)
 *   3. Existing bot for tenant blocks reconnection (CONFLICT)
 *   4. Bot already owned by another tenant blocks (CONFLICT)
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
    BOT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

vi.mock("~/server/lib/telegramApi", () => ({
  telegramGetMe: vi.fn(async () => ({ id: 7777777777, username: "testbot", first_name: "Test" })),
  telegramSetWebhook: vi.fn(async () => undefined),
  telegramDeleteWebhook: vi.fn(async () => undefined),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

describe("salon.connectBot — H3 encrypted token persistence", () => {
  const createCaller = createCallerFactory(salonRouter);
  const validToken = "7777777777:VALIDtokenfromBotFather_aaaaaaaaaa";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes tokenEncrypted (`v1$...`) into the bots insert", async () => {
    // assertTenantOwner short-circuits for tenant_owner (no DB call).
    // Then connectBot does:
    //   1. SELECT existing bot for tenant → empty
    //   2. SELECT bot_id collision → empty
    // Then the insert.
    const { db, insertCalls } = createDbMock([
      [], // no existing bot for tenant
      [], // bot_id not claimed
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alice");
    const caller = createCaller(ctx as never);

    const r = await caller.connectBot({ tenantId: "t_alice", token: validToken });
    expect(r.botId).toBe("7777777777");

    expect(insertCalls.length).toBe(1);
    const inserted = insertCalls[0]!.values as Record<string, unknown>;
    expect(typeof inserted.tokenEncrypted).toBe("string");
    expect((inserted.tokenEncrypted as string).startsWith("v1$")).toBe(true);
    expect(inserted.botId).toBe("7777777777");
    expect(inserted.tenantId).toBe("t_alice");
    expect(inserted.webhookSecret).toBeTruthy();
  });

  it("rejects existing bot for the tenant (CONFLICT)", async () => {
    const { db } = createDbMock([
      [{ botId: "1111111111" }], // existing bot row
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alice");
    const caller = createCaller(ctx as never);
    await expect(
      caller.connectBot({ tenantId: "t_alice", token: validToken }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects bot already owned by another tenant (CONFLICT)", async () => {
    const { db } = createDbMock([
      [],                              // no existing bot for tenant
      [{ tenantId: "t_someone_else" }], // bot_id collision
    ]);
    const ctx = makeTenantOwnerCtx(db, "t_alice");
    const caller = createCaller(ctx as never);
    await expect(
      caller.connectBot({ tenantId: "t_alice", token: validToken }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses to register when BOT_ENCRYPTION_KEY is unset (fail-closed)", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: "", // unset
      },
    }));
    const { salonRouter: salonRouterNoKey } = await import("~/server/api/routers/salon");
    const factory = createCallerFactory(salonRouterNoKey);
    const { db } = createDbMock([[{ tenantId: "t_alice" }]]);
    const ctx = makeTenantOwnerCtx(db, "t_alice");
    const caller = factory(ctx as never);
    await expect(
      caller.connectBot({ tenantId: "t_alice", token: validToken }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
