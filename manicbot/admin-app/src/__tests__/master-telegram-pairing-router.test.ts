/**
 * 0072 — Master Telegram pairing tRPC surface.
 *
 * Pins:
 *   - Pure tokenLogic.ts helpers (generatePairingToken, hashPairingToken,
 *     buildDeepLink) match the Worker-side `services/masterPairing.js`
 *     exactly so the bot can recompute the hash.
 *   - `master.requestPairingCode`: master-role-only, OWN master row only,
 *     refuses archived masters, refuses when the tenant has no bot.
 *   - `master.unpairTelegram`: same auth posture as above.
 *   - `salon.createMasterPairingCode`: tenant owner can mint for any
 *     unarchived master in their tenant. Same bot-missing precondition.
 *   - `salon.setMasterTelegramChatId`: owner-only manual override with
 *     collision pre-check (partial UNIQUE on (tenant_id, telegram_chat_id)).
 *   - `salon.listMasterPairingStates`: returns expected shape.
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

// Stub audit writes so we don't need a real DB.
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: () => "127.0.0.1",
}));

// Stub OTP path used by other salon procedures — unrelated to our subject.
vi.mock("~/server/auth/otp", () => ({
  requireOtpConfirmation: vi.fn(async () => undefined),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { masterRouter } from "~/server/api/routers/masterRouter";
import { salonRouter } from "~/server/api/routers/salon";
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
} from "~/server/api/masterPairing/tokenLogic";

const TENANT = "t_pair_test";
const MASTER_SYN = 10_000_000_001;
const REAL_TG = 4242;

const masterCaller = createCallerFactory(masterRouter);
const salonCaller = createCallerFactory(salonRouter);

// ─── tokenLogic.ts — pure helpers ─────────────────────────────────────────

describe("tokenLogic (admin-app mirror of Worker masterPairing)", () => {
  it("generatePairingToken produces a consistent raw + hash pair", async () => {
    const { raw, hash } = await generatePairingToken();
    expect(raw).toBeTypeOf("string");
    expect(raw.length).toBeGreaterThan(16);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    expect(await hashPairingToken(raw)).toBe(hash);
  });

  it("hashPairingToken is deterministic", async () => {
    const a = await hashPairingToken("known-input");
    const b = await hashPairingToken("known-input");
    expect(a).toBe(b);
  });

  it("buildDeepLink strips leading @ from the bot username", () => {
    expect(buildDeepLink("manicbot", "X")).toBe("https://t.me/manicbot?start=mst_X");
    expect(buildDeepLink("@manicbot", "X")).toBe("https://t.me/manicbot?start=mst_X");
  });
});

// ─── master.requestPairingCode ────────────────────────────────────────────

describe("master.requestPairingCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers (masterProcedure → FORBIDDEN)", async () => {
    // `masterProcedure` itself maps no-webUser → FORBIDDEN ("Master access required").
    // Either FORBIDDEN or UNAUTHORIZED is an acceptable closed-door — we just
    // pin that an unauthenticated user CANNOT mint a token.
    const { db } = createDbMock();
    const caller = masterCaller(makeUnauthCtx(db) as never);
    await expect(
      caller.requestPairingCode({ tenantId: TENANT, masterId: MASTER_SYN }),
    ).rejects.toThrow();
  });

  it("FORBIDDEN when caller is tenant_owner (not the master themselves)", async () => {
    const { db } = createDbMock();
    const caller = masterCaller(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.requestPairingCode({ tenantId: TENANT, masterId: MASTER_SYN }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("FORBIDDEN when master tries to mint a code for ANOTHER master's row (IDOR)", async () => {
    // assertCallerIsMaster pulls the caller's own master row by web_user_id.
    // We seed a row pinned to w_master but targeting a different chat_id.
    const dbMock = createDbMock([
      [{ chatId: MASTER_SYN }], // own row, chat_id matches input — happy
    ]);
    // Now target a DIFFERENT chat_id (10_000_000_999).
    const dbMock2 = createDbMock([
      [{ chatId: MASTER_SYN }], // own row says chat_id = MASTER_SYN
    ]);
    const caller = masterCaller(makeMasterCtx(dbMock2.db, TENANT) as never);
    await expect(
      caller.requestPairingCode({ tenantId: TENANT, masterId: 10_000_000_999 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("PRECONDITION_FAILED when no active bot is connected to the tenant", async () => {
    const dbMock = createDbMock([
      [{ chatId: MASTER_SYN }],          // assertCallerIsMaster ownership lookup
      [{ archivedAt: null }],            // master row read inside requestPairingCode
      [],                                // bot lookup → empty
    ]);
    const caller = masterCaller(makeMasterCtx(dbMock.db, TENANT) as never);
    await expect(
      caller.requestPairingCode({ tenantId: TENANT, masterId: MASTER_SYN }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("happy path: mints a code, persists hash, returns deep-link + expiresAt", async () => {
    const dbMock = createDbMock([
      [{ chatId: MASTER_SYN }],                        // IDOR ownership lookup
      [{ archivedAt: null }],                           // master row
      [{ botUsername: "manicbot" }],                    // bot lookup
    ]);
    const caller = masterCaller(makeMasterCtx(dbMock.db, TENANT) as never);
    const result = await caller.requestPairingCode({
      tenantId: TENANT,
      masterId: MASTER_SYN,
    });
    expect(result.deepLink).toMatch(/^https:\/\/t\.me\/manicbot\?start=mst_/);
    expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // The insert must include token_hash + tenant + master_chat_id.
    const insert = dbMock.insertCalls[0];
    expect(insert).toBeDefined();
    expect(insert!.values.tenantId).toBe(TENANT);
    expect(insert!.values.masterChatId).toBe(MASTER_SYN);
    expect(insert!.values.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(insert!.values.consumedAt).toBeUndefined(); // not set on create
  });

  it("FORBIDDEN when master row is archived", async () => {
    const dbMock = createDbMock([
      [{ chatId: MASTER_SYN }],                        // IDOR ownership
      [{ archivedAt: Math.floor(Date.now() / 1000) }],  // archived master row
    ]);
    const caller = masterCaller(makeMasterCtx(dbMock.db, TENANT) as never);
    await expect(
      caller.requestPairingCode({ tenantId: TENANT, masterId: MASTER_SYN }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── master.unpairTelegram ────────────────────────────────────────────────

describe("master.unpairTelegram", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FORBIDDEN when caller is tenant_owner (owner uses salon.setMasterTelegramChatId)", async () => {
    const { db } = createDbMock();
    const caller = masterCaller(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.unpairTelegram({ tenantId: TENANT, masterId: MASTER_SYN }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("master can unpair their OWN row — sets telegram_chat_id = null", async () => {
    const dbMock = createDbMock([
      [{ chatId: MASTER_SYN }],   // IDOR ownership lookup
    ]);
    const caller = masterCaller(makeMasterCtx(dbMock.db, TENANT) as never);
    const result = await caller.unpairTelegram({ tenantId: TENANT, masterId: MASTER_SYN });
    expect(result.success).toBe(true);

    // The mutation logged the update — `dbMock.updateCalls` captures the SET clause.
    expect(dbMock.updateCalls.length).toBeGreaterThan(0);
    const u = dbMock.updateCalls[0]!;
    expect(u.values.telegramChatId).toBeNull();
  });
});

// ─── salon.createMasterPairingCode ────────────────────────────────────────

describe("salon.createMasterPairingCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FORBIDDEN when caller is a master (use master.requestPairingCode)", async () => {
    const { db } = createDbMock();
    const caller = salonCaller(makeMasterCtx(db, TENANT) as never);
    await expect(
      caller.createMasterPairingCode({ tenantId: TENANT, masterChatId: MASTER_SYN }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("NOT_FOUND when master doesn't exist in the tenant", async () => {
    const dbMock = createDbMock([
      [], // master lookup → empty
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    await expect(
      caller.createMasterPairingCode({ tenantId: TENANT, masterChatId: MASTER_SYN }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("PRECONDITION_FAILED when tenant has no active bot", async () => {
    const dbMock = createDbMock([
      [{ archivedAt: null }],   // master row
      [],                       // bot lookup → empty
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    await expect(
      caller.createMasterPairingCode({ tenantId: TENANT, masterChatId: MASTER_SYN }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("happy path: owner mints a code for any master in the tenant", async () => {
    const dbMock = createDbMock([
      [{ archivedAt: null }],                  // master row
      [{ botUsername: "manicbot" }],            // bot lookup
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const result = await caller.createMasterPairingCode({
      tenantId: TENANT,
      masterChatId: MASTER_SYN,
    });
    expect(result.deepLink).toMatch(/^https:\/\/t\.me\/manicbot\?start=mst_/);
    expect(dbMock.insertCalls[0]!.values.tenantId).toBe(TENANT);
  });
});

// ─── salon.setMasterTelegramChatId ────────────────────────────────────────

describe("salon.setMasterTelegramChatId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FORBIDDEN when caller is a master", async () => {
    const { db } = createDbMock();
    const caller = salonCaller(makeMasterCtx(db, TENANT) as never);
    await expect(
      caller.setMasterTelegramChatId({
        tenantId: TENANT,
        masterChatId: MASTER_SYN,
        telegramChatId: REAL_TG,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner can clear the binding (telegramChatId = null)", async () => {
    const dbMock = createDbMock([
      [{ archivedAt: null }],   // master row
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const result = await caller.setMasterTelegramChatId({
      tenantId: TENANT,
      masterChatId: MASTER_SYN,
      telegramChatId: null,
    });
    expect(result.success).toBe(true);
    expect(dbMock.updateCalls[0]!.values.telegramChatId).toBeNull();
  });

  it("CONFLICT when the same TG chat is already paired to another master in the tenant", async () => {
    const dbMock = createDbMock([
      [{ archivedAt: null }],          // master row
      [{ chatId: 10_000_000_002 }],     // collision lookup — finds another master with same TG
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    await expect(
      caller.setMasterTelegramChatId({
        tenantId: TENANT,
        masterChatId: MASTER_SYN,
        telegramChatId: REAL_TG,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("happy path: owner sets a new telegramChatId", async () => {
    const dbMock = createDbMock([
      [{ archivedAt: null }],   // master row
      [],                       // collision lookup → empty
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const result = await caller.setMasterTelegramChatId({
      tenantId: TENANT,
      masterChatId: MASTER_SYN,
      telegramChatId: REAL_TG,
    });
    expect(result.success).toBe(true);
    expect(dbMock.updateCalls[0]!.values.telegramChatId).toBe(REAL_TG);
  });
});

// ─── salon.listMasterPairingStates ────────────────────────────────────────

describe("salon.listMasterPairingStates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the masters[] + botUsername shape", async () => {
    const dbMock = createDbMock([
      [
        {
          chatId: MASTER_SYN,
          name: "Anna",
          isSynthetic: 1,
          origin: "salon_created",
          archivedAt: null,
          telegramChatId: null,
        },
        {
          chatId: 10_000_000_002,
          name: "Boris",
          isSynthetic: 1,
          origin: "invited_email",
          archivedAt: null,
          telegramChatId: 9999,
        },
      ],
      [
        // Active code for Anna only
        { masterChatId: MASTER_SYN, expiresAt: Math.floor(Date.now() / 1000) + 86400 },
      ],
      [{ botUsername: "manicbot" }],
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const result = await caller.listMasterPairingStates({ tenantId: TENANT });

    expect(result.botUsername).toBe("manicbot");
    expect(result.masters).toHaveLength(2);
    const anna = result.masters.find((m) => m.chatId === MASTER_SYN);
    expect(anna).toBeDefined();
    expect(anna!.isSynthetic).toBe(true);
    expect(anna!.telegramChatId).toBeNull();
    expect(anna!.hasActiveCode).toBe(true);

    const boris = result.masters.find((m) => m.chatId === 10_000_000_002);
    expect(boris!.telegramChatId).toBe(9999);
    expect(boris!.hasActiveCode).toBe(false);
  });
});

// ─── salon.getMasterPairingState (single-master, used by MasterDetailModal) ─

describe("salon.getMasterPairingState", () => {
  beforeEach(() => vi.clearAllMocks());

  it("NOT_FOUND when the master doesn't exist in this tenant", async () => {
    const dbMock = createDbMock([
      [], // master lookup → empty
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    await expect(
      caller.getMasterPairingState({ tenantId: TENANT, masterChatId: 999 }),
    ).rejects.toThrow(/master_not_found/i);
  });

  it("happy path: returns single-master state + botUsername with hasActiveCode=false when no pending code", async () => {
    const dbMock = createDbMock([
      [{
        chatId: MASTER_SYN,
        isSynthetic: 1,
        origin: "salon_created",
        archivedAt: null,
        telegramChatId: null,
      }],
      [], // no active codes
      [{ botUsername: "manicbot" }],
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const result = await caller.getMasterPairingState({ tenantId: TENANT, masterChatId: MASTER_SYN });

    expect(result.chatId).toBe(MASTER_SYN);
    expect(result.isSynthetic).toBe(true);
    expect(result.origin).toBe("salon_created");
    expect(result.archived).toBe(false);
    expect(result.telegramChatId).toBeNull();
    expect(result.hasActiveCode).toBe(false);
    expect(result.activeCodeExpiresAt).toBeNull();
    expect(result.botUsername).toBe("manicbot");
  });

  it("surfaces hasActiveCode=true + activeCodeExpiresAt when a pending code exists", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 5 * 86400;
    const dbMock = createDbMock([
      [{
        chatId: MASTER_SYN,
        isSynthetic: 1,
        origin: "salon_created",
        archivedAt: null,
        telegramChatId: null,
      }],
      [{ expiresAt }],
      [{ botUsername: "manicbot" }],
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const result = await caller.getMasterPairingState({ tenantId: TENANT, masterChatId: MASTER_SYN });
    expect(result.hasActiveCode).toBe(true);
    expect(result.activeCodeExpiresAt).toBe(expiresAt);
  });

  it("returns botUsername=null when the tenant has no active bot", async () => {
    const dbMock = createDbMock([
      [{
        chatId: MASTER_SYN,
        isSynthetic: 1,
        origin: "salon_created",
        archivedAt: null,
        telegramChatId: null,
      }],
      [],
      [], // no bot
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const result = await caller.getMasterPairingState({ tenantId: TENANT, masterChatId: MASTER_SYN });
    expect(result.botUsername).toBeNull();
  });

  it("surfaces archived=true when archivedAt is set (UI dims out actions)", async () => {
    const dbMock = createDbMock([
      [{
        chatId: MASTER_SYN,
        isSynthetic: 1,
        origin: "salon_created",
        archivedAt: 1234567890,
        telegramChatId: null,
      }],
      [],
      [{ botUsername: "manicbot" }],
    ]);
    const caller = salonCaller(makeTenantOwnerCtx(dbMock.db, TENANT) as never);
    const result = await caller.getMasterPairingState({ tenantId: TENANT, masterChatId: MASTER_SYN });
    expect(result.archived).toBe(true);
  });
});
