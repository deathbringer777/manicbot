/**
 * 0082 — Owner Telegram pairing tRPC surface.
 *
 * Pins:
 *   - Pure tokenLogic helpers match the Worker-side `services/ownerPairing.js`
 *     (deterministic SHA-256, own_ deep-link prefix).
 *   - `ownerPairing.getMyPairingState`: tenant_owner-only, returns the
 *     caller's own state (IDOR-impossible — uses ctx.webUser.id).
 *   - `ownerPairing.requestPairingCode`: tenant_owner-only, refuses
 *     wrong tenant + missing bot.
 *   - `ownerPairing.unpair`: clears telegram_chat_id + removes
 *     tenant_roles row for the previously-paired chat_id.
 *   - Defense-in-depth: system_admin previewing a tenant cannot pair
 *     their personal Telegram into the customer's salon.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { ownerPairingRouter } from "~/server/api/routers/ownerPairing";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";
import {
  generatePairingToken,
  hashPairingToken,
  buildDeepLink,
} from "~/server/api/ownerPairing/tokenLogic";

const TENANT = "t_owner_pair_test";
const REAL_TG = 4242;

const ownerCaller = createCallerFactory(ownerPairingRouter);

// ─── tokenLogic.ts — pure helpers ─────────────────────────────────────────

describe("tokenLogic (admin-app mirror of Worker ownerPairing)", () => {
  it("generatePairingToken produces a consistent raw + hash pair", async () => {
    const { raw, hash } = await generatePairingToken();
    expect(raw).toBeTypeOf("string");
    expect(raw.length).toBeGreaterThan(16);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    expect(await hashPairingToken(raw)).toBe(hash);
  });

  it("hashPairingToken is deterministic", async () => {
    const a = await hashPairingToken("known-owner-input");
    const b = await hashPairingToken("known-owner-input");
    expect(a).toBe(b);
  });

  it("buildDeepLink strips leading @ from the bot username and uses own_ prefix", () => {
    expect(buildDeepLink("manicbot", "X")).toBe("https://t.me/manicbot?start=own_X");
    expect(buildDeepLink("@manicbot", "X")).toBe("https://t.me/manicbot?start=own_X");
  });
});

// ─── ownerPairing.requestPairingCode ──────────────────────────────────────

describe("ownerPairing.requestPairingCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = ownerCaller(makeUnauthCtx(db) as never);
    await expect(caller.requestPairingCode({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects master role (tenant_owner-only)", async () => {
    const { db } = createDbMock();
    const caller = ownerCaller(makeMasterCtx(db, TENANT) as never);
    await expect(caller.requestPairingCode({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a tenant_owner who is on a DIFFERENT tenant", async () => {
    const { db } = createDbMock();
    const caller = ownerCaller(makeTenantOwnerCtx(db, "t_someone_else") as never);
    await expect(caller.requestPairingCode({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects system_admin previewing a tenant — only the real owner can pair", async () => {
    // Defense-in-depth: sysadmin should NEVER be able to bind their personal
    // Telegram into a customer's tenant. They have their own bot/tenant for
    // testing.
    const { db } = createDbMock();
    const caller = ownerCaller(makeAdminCtx(db) as never);
    await expect(caller.requestPairingCode({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects PRECONDITION_FAILED when the salon has no active bot", async () => {
    const { db } = createDbMock([
      [],  // bots select returns no rows
    ]);
    const caller = ownerCaller(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(caller.requestPairingCode({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("mints a code, persists hash, returns deep-link and expires_at", async () => {
    const { db, insertCalls } = createDbMock([
      [{ botUsername: "test_salon_bot" }],
    ]);
    const caller = ownerCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const before = Math.floor(Date.now() / 1000);
    const result = await caller.requestPairingCode({ tenantId: TENANT } as never);

    expect(result.deepLink).toMatch(/^https:\/\/t\.me\/test_salon_bot\?start=own_/);
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 7 * 24 * 3600 - 5);
    expect(result.expiresAt).toBeLessThanOrEqual(before + 7 * 24 * 3600 + 5);

    expect(insertCalls.length).toBe(1);
    const persisted = insertCalls[0]!.values;
    expect(persisted.tenantId).toBe(TENANT);
    expect(persisted.webUserId).toBe("w_owner");
    expect(persisted.tokenHash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(persisted.tokenHash as string)).toBe(true);
    expect(persisted.consumedAt).toBeFalsy();
  });
});

// ─── ownerPairing.getMyPairingState ────────────────────────────────────────

describe("ownerPairing.getMyPairingState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paired state for the caller's own web_user", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { db } = createDbMock([
      [{ telegramChatId: REAL_TG, name: "Kirill" }],          // web_users
      [{ expiresAt: now + 100_000 }],                          // active code
      [{ botUsername: "test_salon_bot" }],                     // bots
    ]);
    const caller = ownerCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.getMyPairingState({ tenantId: TENANT } as never);

    expect(result.telegramChatId).toBe(REAL_TG);
    expect(result.ownerName).toBe("Kirill");
    expect(result.hasActiveCode).toBe(true);
    expect(result.activeCodeExpiresAt).toBeGreaterThan(now);
    expect(result.botUsername).toBe("test_salon_bot");
  });

  it("returns unpaired + no-code shape when the owner has never paired", async () => {
    const { db } = createDbMock([
      [{ telegramChatId: null, name: "Kirill" }],
      [],                                                       // no active code
      [{ botUsername: "test_salon_bot" }],
    ]);
    const caller = ownerCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.getMyPairingState({ tenantId: TENANT } as never);
    expect(result.telegramChatId).toBeNull();
    expect(result.hasActiveCode).toBe(false);
    expect(result.activeCodeExpiresAt).toBeNull();
    expect(result.botUsername).toBe("test_salon_bot");
  });

  it("rejects cross-tenant peek attempts", async () => {
    const { db } = createDbMock();
    const caller = ownerCaller(makeTenantOwnerCtx(db, "t_other_tenant") as never);
    await expect(caller.getMyPairingState({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── ownerPairing.unpair ──────────────────────────────────────────────────

describe("ownerPairing.unpair", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears telegram_chat_id and removes the tenant_roles row when previously paired", async () => {
    const { db, updateCalls, deleteCalls } = createDbMock([
      [{ telegramChatId: REAL_TG }],
    ]);
    const caller = ownerCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.unpair({ tenantId: TENANT } as never);
    expect(result.ok).toBe(true);

    // web_users update set telegram_chat_id = null
    expect(updateCalls.length).toBeGreaterThan(0);
    const wuUpdate = updateCalls[0]!.values;
    expect(wuUpdate.telegramChatId).toBeNull();

    // tenant_roles delete fired (where was called).
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0]!.whereCalled).toBe(true);
  });

  it("clears web_users.telegram_chat_id even when nothing was previously bound (no-op delete)", async () => {
    const { db, updateCalls, deleteCalls } = createDbMock([
      [{ telegramChatId: null }],
    ]);
    const caller = ownerCaller(makeTenantOwnerCtx(db, TENANT) as never);
    const result = await caller.unpair({ tenantId: TENANT } as never);
    expect(result.ok).toBe(true);
    expect(updateCalls.length).toBeGreaterThan(0);
    // No previous TG chat → we don't touch tenant_roles.
    expect(deleteCalls.length).toBe(0);
  });

  it("rejects when the caller is on a different tenant", async () => {
    const { db } = createDbMock();
    const caller = ownerCaller(makeTenantOwnerCtx(db, "t_other") as never);
    await expect(caller.unpair({ tenantId: TENANT } as never))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
