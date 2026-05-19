/**
 * 0082 — Owner Telegram pairing flow.
 *
 * Pins:
 *   - Token generation: raw shape + deterministic hash.
 *   - createPairingCode: persists hash, sets expiresAt = now + 7d.
 *   - tryConsumePairingCode happy path: writes web_users.telegram_chat_id,
 *     upserts tenant_roles(role='tenant_owner'), stamps the code.
 *   - Cross-tenant guard rejects a wrong-tenant bot consume.
 *   - Expired / already-consumed / unknown / invalid tokens rejected
 *     with the correct reason strings.
 *   - Detaching the web_user from the tenant between mint + consume
 *     rejects.
 *   - Partial UNIQUE on web_users(telegram_chat_id) is respected —
 *     binding the same TG chat to a second web_user fails fast with
 *     `tg_chat_in_use`.
 *   - getActivePairingCode returns only unconsumed + unexpired rows.
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
} from "../src/services/ownerPairing.js";

function ctx(tenantId = "t_owner_pair") {
  return makeCtx({
    tenantId,
    tenant: { plan: "pro", billingStatus: "active" },
  });
}

async function seedWebUser(c, row) {
  await c.db
    .prepare(
      `INSERT INTO web_users (id, email, password_hash, tenant_id, role, name, email_verified, telegram_chat_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.email ?? `${row.id}@example.com`,
      row.password_hash ?? "",
      row.tenant_id ?? c.tenantId,
      row.role ?? "tenant_owner",
      row.name ?? null,
      row.email_verified ?? 1,
      row.telegram_chat_id ?? null,
      row.created_at ?? Math.floor(Date.now() / 1000),
      row.updated_at ?? Math.floor(Date.now() / 1000),
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
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);

    const recomputed = await hashPairingToken(raw);
    expect(recomputed).toBe(hash);
  });

  it("two consecutive tokens differ (entropy sanity)", async () => {
    const a = await generatePairingToken();
    const b = await generatePairingToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it("hashPairingToken is deterministic across calls", async () => {
    const raw = "fixed-raw-token-value-for-owner";
    const h1 = await hashPairingToken(raw);
    const h2 = await hashPairingToken(raw);
    expect(h1).toBe(h2);
  });

  it("buildDeepLink produces a t.me URL with own_ prefix", () => {
    expect(buildDeepLink("manicbot", "abc")).toBe("https://t.me/manicbot?start=own_abc");
    expect(buildDeepLink("@manicbot", "abc")).toBe("https://t.me/manicbot?start=own_abc");
  });
});

// ─── createPairingCode ─────────────────────────────────────────────────

describe("createPairingCode", () => {
  it("inserts a row keyed by hash with 7-day expiry", async () => {
    const c = ctx();
    await seedWebUser(c, { id: "w_owner1", name: "Kirill" });
    const before = Math.floor(Date.now() / 1000);
    const result = await createPairingCode(c, {
      tenantId: c.tenantId,
      webUserId: "w_owner1",
    });

    expect(result.raw).toBeTypeOf("string");
    expect(result.hash).toHaveLength(64);
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + PAIRING_TOKEN_TTL_SEC - 5);
    expect(result.expiresAt).toBeLessThanOrEqual(before + PAIRING_TOKEN_TTL_SEC + 5);

    const row = await c.db
      .prepare("SELECT * FROM owner_pairing_codes WHERE token_hash = ?")
      .bind(result.hash)
      .first();
    expect(row).toBeTruthy();
    expect(row.tenant_id).toBe(c.tenantId);
    expect(row.web_user_id).toBe("w_owner1");
    expect(row.consumed_at).toBeFalsy();
  });
});

// ─── tryConsumePairingCode ─────────────────────────────────────────────

describe("tryConsumePairingCode", () => {
  it("happy path: sets telegram_chat_id, upserts tenant_roles, stamps code", async () => {
    const c = ctx();
    const TG = 4242;
    await seedWebUser(c, { id: "w_owner1", name: "Kirill" });
    const { raw, hash } = await createPairingCode(c, {
      tenantId: c.tenantId,
      webUserId: "w_owner1",
    });

    const result = await tryConsumePairingCode(c, raw, TG);
    expect(result.ok).toBe(true);
    expect(result.webUserId).toBe("w_owner1");
    expect(result.tenantId).toBe(c.tenantId);
    expect(result.ownerName).toBe("Kirill");

    const wu = await c.db
      .prepare("SELECT telegram_chat_id FROM web_users WHERE id = ?")
      .bind("w_owner1")
      .first();
    expect(wu.telegram_chat_id).toBe(TG);

    const role = await c.db
      .prepare("SELECT role FROM tenant_roles WHERE tenant_id = ? AND chat_id = ?")
      .bind(c.tenantId, TG)
      .first();
    expect(role.role).toBe("tenant_owner");

    const code = await c.db
      .prepare("SELECT consumed_at, consumed_chat_id FROM owner_pairing_codes WHERE token_hash = ?")
      .bind(hash)
      .first();
    expect(code.consumed_at).toBeTruthy();
    expect(code.consumed_chat_id).toBe(TG);
  });

  it("rejects with reason='not_found' when the token doesn't exist", async () => {
    const c = ctx();
    const result = await tryConsumePairingCode(c, "this-token-was-never-minted-x", 100);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("rejects with reason='invalid_token' for empty / short / over-long input", async () => {
    const c = ctx();
    expect((await tryConsumePairingCode(c, "", 100)).reason).toBe("invalid_token");
    expect((await tryConsumePairingCode(c, "short", 100)).reason).toBe("invalid_token");
    expect((await tryConsumePairingCode(c, "x".repeat(200), 100)).reason).toBe("invalid_token");
  });

  it("CROSS-TENANT GUARD: rejects when bot's tenant_id != code's tenant_id", async () => {
    const cA = ctx("t_a");
    const cB = ctx("t_b");
    await seedWebUser(cA, { id: "w_owner_a", tenant_id: "t_a", name: "OwnerA" });
    const { raw } = await createPairingCode(cA, {
      tenantId: "t_a",
      webUserId: "w_owner_a",
    });
    cB.db = cA.db;
    const result = await tryConsumePairingCode(cB, raw, 4242);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_tenant");
  });

  it("rejects with reason='consumed' on a second attempt", async () => {
    const c = ctx();
    await seedWebUser(c, { id: "w_owner1" });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });

    const first = await tryConsumePairingCode(c, raw, 4242);
    expect(first.ok).toBe(true);

    const second = await tryConsumePairingCode(c, raw, 4242);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("consumed");
  });

  it("rejects with reason='expired' once the code's expires_at is in the past", async () => {
    const c = ctx();
    await seedWebUser(c, { id: "w_owner1" });
    const fresh = await createPairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });
    const past = Math.floor(Date.now() / 1000) - 3600;
    await c.db
      .prepare("UPDATE owner_pairing_codes SET expires_at = ? WHERE token_hash = ?")
      .bind(past, fresh.hash)
      .run();

    const result = await tryConsumePairingCode(c, fresh.raw, 4242);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects when the web_user is deleted between mint + consume", async () => {
    const c = ctx();
    await seedWebUser(c, { id: "w_owner1" });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });

    await c.db
      .prepare("DELETE FROM web_users WHERE id = ?")
      .bind("w_owner1")
      .run();

    const result = await tryConsumePairingCode(c, raw, 4242);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("web_user_gone");
  });

  it("rejects when the web_user is moved to a different tenant after mint", async () => {
    const c = ctx();
    await seedWebUser(c, { id: "w_owner1" });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });

    await c.db
      .prepare("UPDATE web_users SET tenant_id = ? WHERE id = ?")
      .bind("t_other_tenant", "w_owner1")
      .run();

    const result = await tryConsumePairingCode(c, raw, 4242);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("web_user_tenant_changed");
  });

  it("rejects with 'tg_chat_in_use' when the TG chat is already bound to another web_user", async () => {
    const c = ctx();
    const TG = 4242;
    await seedWebUser(c, { id: "w_other", telegram_chat_id: TG });
    await seedWebUser(c, { id: "w_owner1" });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });

    const result = await tryConsumePairingCode(c, raw, TG);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("tg_chat_in_use");
  });
});

// ─── getActivePairingCode ─────────────────────────────────────────────

describe("getActivePairingCode", () => {
  it("returns the most recent unconsumed + unexpired code", async () => {
    const c = ctx();
    await seedWebUser(c, { id: "w_owner1" });
    await createPairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });

    const active = await getActivePairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });
    expect(active).toBeTruthy();
    expect(active.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("returns null when the only code is already consumed", async () => {
    const c = ctx();
    await seedWebUser(c, { id: "w_owner1" });
    const { raw } = await createPairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });
    await tryConsumePairingCode(c, raw, 4242);

    const active = await getActivePairingCode(c, { tenantId: c.tenantId, webUserId: "w_owner1" });
    expect(active).toBeFalsy();
  });
});
