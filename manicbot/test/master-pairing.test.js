/**
 * 0072 — Master Telegram pairing flow.
 *
 * Pins:
 *   - Token generation: raw token has the expected shape; hash is deterministic.
 *   - createPairingCode: persists hash, sets expiresAt to now + 7 days.
 *   - tryConsumePairingCode happy path: writes `telegram_chat_id` on the
 *     master row and stamps `consumed_at` + `consumed_chat_id` on the code.
 *   - Cross-tenant guard: a code minted for tenant A cannot be consumed
 *     by tenant B's bot, even if the raw token leaks.
 *   - Expired code rejected.
 *   - Already-consumed code rejected (idempotent — second attempt fails).
 *   - Master archived between mint + consume → rejected.
 *   - Partial UNIQUE on (tenant_id, telegram_chat_id) is respected:
 *     binding the same TG chat to a second master in the same tenant fails.
 *   - getActivePairingCode returns only unconsumed + unexpired codes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { makeCtx } from "./helpers/mock-db.js";
import {
  generatePairingToken,
  hashPairingToken,
  buildDeepLink,
  createPairingCode,
  tryConsumePairingCode,
  getActivePairingCode,
  PAIRING_TOKEN_TTL_SEC,
} from "../src/services/masterPairing.js";

function ctx(tenantId = "t_pair") {
  return makeCtx({
    tenantId,
    tenant: { plan: "pro", billingStatus: "active" },
  });
}

async function seedMaster(c, row) {
  await c.db
    .prepare(
      `INSERT INTO masters (tenant_id, chat_id, name, is_synthetic, origin, archived_at, telegram_chat_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      c.tenantId,
      row.chat_id,
      row.name ?? null,
      row.is_synthetic ?? 1,
      row.origin ?? "salon_created",
      row.archived_at ?? null,
      row.telegram_chat_id ?? null,
    )
    .run();
}

// ─── Pure helpers ─────────────────────────────────────────────────────

describe("generatePairingToken + hashPairingToken (pure)", () => {
  it("generates a token whose raw + hash relationship is consistent", async () => {
    const { raw, hash } = await generatePairingToken();
    expect(raw).toBeTypeOf("string");
    expect(raw.length).toBeGreaterThan(16);
    expect(raw.length).toBeLessThan(64);
    expect(hash).toHaveLength(64); // SHA-256 hex
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);

    const recomputed = await hashPairingToken(raw);
    expect(recomputed).toBe(hash);
  });

  it("two consecutive tokens are different (entropy sanity check)", async () => {
    const a = await generatePairingToken();
    const b = await generatePairingToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it("hashPairingToken is deterministic across calls", async () => {
    const raw = "fixed-raw-token-value";
    const h1 = await hashPairingToken(raw);
    const h2 = await hashPairingToken(raw);
    expect(h1).toBe(h2);
  });

  it("buildDeepLink produces a valid t.me URL with mst_ prefix", () => {
    expect(buildDeepLink("manicbot", "abc")).toBe("https://t.me/manicbot?start=mst_abc");
    expect(buildDeepLink("@manicbot", "abc")).toBe("https://t.me/manicbot?start=mst_abc");
  });
});

// ─── createPairingCode ─────────────────────────────────────────────────

describe("createPairingCode", () => {
  it("inserts a row keyed by hash with 7-day expiry", async () => {
    const c = ctx();
    await seedMaster(c, { chat_id: 10_000_000_001, name: "Анна" });
    const before = Math.floor(Date.now() / 1000);
    const result = await createPairingCode(c, {
      tenantId: c.tenantId,
      masterChatId: 10_000_000_001,
      createdByWebUserId: "w_owner",
    });

    expect(result.raw).toBeTypeOf("string");
    expect(result.hash).toHaveLength(64);
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + PAIRING_TOKEN_TTL_SEC - 5);
    expect(result.expiresAt).toBeLessThanOrEqual(before + PAIRING_TOKEN_TTL_SEC + 5);

    const row = await c.db
      .prepare("SELECT * FROM master_pairing_codes WHERE token_hash = ?")
      .bind(result.hash)
      .first();
    expect(row).toBeTruthy();
    expect(row.tenant_id).toBe(c.tenantId);
    expect(row.master_chat_id).toBe(10_000_000_001);
    expect(row.created_by_web_user_id).toBe("w_owner");
    expect(row.consumed_at).toBeFalsy();
  });
});

// ─── tryConsumePairingCode ─────────────────────────────────────────────

describe("tryConsumePairingCode", () => {
  it("happy path: writes telegram_chat_id on the master and stamps the code", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    const TG = 4242;
    await seedMaster(c, { chat_id: SYN, name: "Анна" });

    const { raw, hash } = await createPairingCode(c, {
      tenantId: c.tenantId,
      masterChatId: SYN,
      createdByWebUserId: "w_owner",
    });

    const result = await tryConsumePairingCode(c, raw, TG);
    expect(result.ok).toBe(true);
    expect(result.masterChatId).toBe(SYN);
    expect(result.masterName).toBe("Анна");

    const master = await c.db
      .prepare("SELECT telegram_chat_id FROM masters WHERE tenant_id = ? AND chat_id = ?")
      .bind(c.tenantId, SYN)
      .first();
    expect(master.telegram_chat_id).toBe(TG);

    const code = await c.db
      .prepare("SELECT consumed_at, consumed_chat_id FROM master_pairing_codes WHERE token_hash = ?")
      .bind(hash)
      .first();
    expect(code.consumed_at).toBeTruthy();
    expect(code.consumed_chat_id).toBe(TG);
  });

  it("rejects with reason='not_found' when the token doesn't exist", async () => {
    const c = ctx();
    const result = await tryConsumePairingCode(c, "this-token-was-never-minted", 100);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("rejects with reason='invalid_token' for short / non-string / over-long input", async () => {
    const c = ctx();
    expect((await tryConsumePairingCode(c, "", 100)).reason).toBe("invalid_token");
    expect((await tryConsumePairingCode(c, "short", 100)).reason).toBe("invalid_token");
    expect((await tryConsumePairingCode(c, "x".repeat(200), 100)).reason).toBe("invalid_token");
  });

  it("CROSS-TENANT GUARD: rejects when bot's tenant_id != code's tenant_id", async () => {
    // Code minted by tenant A. User opens tenant B's bot — must be rejected
    // even though the raw token matches.
    const cA = ctx("t_a");
    const cB = ctx("t_b");
    await seedMaster(cA, { chat_id: 10_000_000_001 });
    const { raw } = await createPairingCode(cA, {
      tenantId: "t_a",
      masterChatId: 10_000_000_001,
    });

    // Share the same DB between tenants — both ctxs point at the same Map
    // because makeCtx shares state. We need to attempt consume with
    // ctx.tenantId = t_b but the code row in t_a.
    cB.db = cA.db;
    const result = await tryConsumePairingCode(cB, raw, 4242);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_tenant");
  });

  it("rejects with reason='consumed' on a second attempt (idempotent)", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    await seedMaster(c, { chat_id: SYN });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });

    const first = await tryConsumePairingCode(c, raw, 4242);
    expect(first.ok).toBe(true);

    const second = await tryConsumePairingCode(c, raw, 4242);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("consumed");
  });

  it("rejects with reason='expired' for a code past its expiry", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    await seedMaster(c, { chat_id: SYN });
    const { hash } = await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });

    // Re-write the expiry to 1 hour ago.
    const past = Math.floor(Date.now() / 1000) - 3600;
    await c.db
      .prepare("UPDATE master_pairing_codes SET expires_at = ? WHERE token_hash = ?")
      .bind(past, hash)
      .run();

    // We still need the raw — but we threw it away. Mint a fresh one and
    // simulate the expiry by editing the row, but for the consume call we
    // need to know the raw. Easier: mint, but lookup the hash.
    // Actually re-create: generate token, edit expiry, attempt consume.
    const fresh = await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });
    await c.db
      .prepare("UPDATE master_pairing_codes SET expires_at = ? WHERE token_hash = ?")
      .bind(past, fresh.hash)
      .run();

    const result = await tryConsumePairingCode(c, fresh.raw, 4242);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects when the master has been archived after mint", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    await seedMaster(c, { chat_id: SYN });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });

    // Salon owner archives the master between mint + consume.
    await c.db
      .prepare("UPDATE masters SET archived_at = ? WHERE tenant_id = ? AND chat_id = ?")
      .bind(Math.floor(Date.now() / 1000), c.tenantId, SYN)
      .run();

    const result = await tryConsumePairingCode(c, raw, 4242);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("master_archived");
  });

  it("rejects when the master row is gone entirely", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    await seedMaster(c, { chat_id: SYN });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });

    // Hard-delete the master between mint + consume.
    await c.db
      .prepare("DELETE FROM masters WHERE tenant_id = ? AND chat_id = ?")
      .bind(c.tenantId, SYN)
      .run();

    const result = await tryConsumePairingCode(c, raw, 4242);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("master_gone");
  });

  it("rejects with reason='tg_chat_in_use' when the same TG chat is already paired to another master", async () => {
    const c = ctx();
    const SYN_A = 10_000_000_001;
    const SYN_B = 10_000_000_002;
    const TG = 4242;
    // Master A is already paired to TG=4242.
    await seedMaster(c, { chat_id: SYN_A, name: "Anna", telegram_chat_id: TG });
    // Master B mints a code and tries to pair to the same TG.
    await seedMaster(c, { chat_id: SYN_B, name: "Boris" });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN_B });

    const result = await tryConsumePairingCode(c, raw, TG);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tg_chat_in_use");
  });
});

// ─── getActivePairingCode ─────────────────────────────────────────────

describe("getActivePairingCode", () => {
  it("returns the most recent unconsumed + unexpired code", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    await seedMaster(c, { chat_id: SYN });
    await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });

    const active = await getActivePairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });
    expect(active).toBeTruthy();
    expect(active.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("returns null when the only code is already consumed", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    await seedMaster(c, { chat_id: SYN });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });
    await tryConsumePairingCode(c, raw, 4242);

    const active = await getActivePairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });
    expect(active).toBeNull();
  });

  it("returns null when the only code has expired", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    await seedMaster(c, { chat_id: SYN });
    const { hash } = await createPairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });
    await c.db
      .prepare("UPDATE master_pairing_codes SET expires_at = ? WHERE token_hash = ?")
      .bind(Math.floor(Date.now() / 1000) - 3600, hash)
      .run();

    const active = await getActivePairingCode(c, { tenantId: c.tenantId, masterChatId: SYN });
    expect(active).toBeNull();
  });
});
