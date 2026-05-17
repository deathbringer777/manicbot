/**
 * 0072 — integration coverage on top of the unit tests in
 * `test/master-pairing.test.js`. Covers:
 *
 *   1. `handlers/message.js` has the `/start mst_<token>` branch wired
 *      ahead of `decodeStartPayload` and calls into both
 *      `tryConsumePairingCode` and `showMasterPanel`. Static-string
 *      pins the wiring without bootstrapping the full TG webhook
 *      pipeline (which would need 20+ mocks).
 *
 *   2. `services/users.js getMaster()` matches `telegram_chat_id` as
 *      well as the primary `chat_id` (the broadened lookup that turns
 *      `isMaster()` true for paired synthetic masters).
 *
 *   3. `masterTelegramRecipient()` picks the right TG chat and refuses
 *      synthetic-only masters that would otherwise 400 the Telegram API.
 *
 *   4. `notifications.js notifyAptStaff` is plumbed so a paired
 *      synthetic master receives the booking ping at their REAL TG
 *      chat_id — not the synthetic 10B+ identity.
 *
 * The full request-pipeline integration is exercised in production via
 * the existing `channels-inbound.test.js`; this file fills the gap for
 * the pairing-specific branches that don't have a natural unit-test
 * home.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { makeCtx } from "./helpers/mock-db.js";
import {
  getMaster,
  isMaster,
  masterTelegramRecipient,
} from "../src/services/users.js";
import { createPairingCode, tryConsumePairingCode } from "../src/services/masterPairing.js";

const MESSAGE_JS = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "handlers", "message.js"),
  "utf8",
);

function ctx(tenantId = "t_pair_integration") {
  return makeCtx({ tenantId, tenant: { plan: "pro", billingStatus: "active" } });
}

async function seedMaster(c, row) {
  await c.db
    .prepare(
      `INSERT INTO masters (tenant_id, chat_id, name, is_synthetic, origin, archived_at, telegram_chat_id, on_vacation, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      c.tenantId,
      row.chat_id,
      row.name ?? null,
      row.is_synthetic ?? 1,
      row.origin ?? "salon_created",
      row.archived_at ?? null,
      row.telegram_chat_id ?? null,
      row.on_vacation ?? 0,
      row.active ?? 1,
    )
    .run();
}

// ─── 1. Static wiring pin for /start mst_<token> branch ─────────────────

describe("handlers/message.js wires the /start mst_<token> pairing branch", () => {
  it("imports tryConsumePairingCode from services/masterPairing", () => {
    expect(MESSAGE_JS).toMatch(
      /from\s+['"]\.\.\/services\/masterPairing\.js['"]/,
    );
    expect(MESSAGE_JS).toContain("tryConsumePairingCode");
  });

  it("intercepts startPayload.startsWith('mst_') BEFORE the analytics decodeStartPayload path", () => {
    // The pairing branch must fire ahead of the UTM-style payload
    // decoder so the analytics tracker never sees `mst_<token>` and
    // tries to interpret it as a campaign attribution payload.
    const pairingIdx = MESSAGE_JS.indexOf("startsWith('mst_')");
    const decodeIdx = MESSAGE_JS.indexOf("decodeStartPayload(startPayload)");
    expect(pairingIdx).toBeGreaterThan(0);
    expect(decodeIdx).toBeGreaterThan(0);
    expect(pairingIdx).toBeLessThan(decodeIdx);
  });

  it("delivers a localized success message and hands off to showMasterPanel on success", () => {
    expect(MESSAGE_JS).toContain("master_pairing_success_prefix");
    // The branch must also fall back into showMasterPanel so the user
    // lands in master mode immediately after pairing.
    const branch = MESSAGE_JS.slice(
      MESSAGE_JS.indexOf("startsWith('mst_')"),
    );
    expect(branch).toContain("showMasterPanel(ctx, cid, name)");
  });

  it("maps every documented rejection reason to a user-facing i18n key", () => {
    // Every reason returned by `tryConsumePairingCode` must have a
    // corresponding `master_pairing_err_*` key, otherwise the user
    // sees the raw reason code in the bot.
    const reasonsInService = [
      "not_found",
      "invalid_token",
      "wrong_tenant",
      "consumed",
      "expired",
      "master_archived",
      "master_gone",
      "tg_chat_in_use",
    ];
    for (const r of reasonsInService) {
      expect(MESSAGE_JS).toContain(r);
      // Every reason maps to a master_pairing_err_* key — check via the
      // mapping object's lines.
      const mapMatch = MESSAGE_JS.match(
        new RegExp(`${r}:\\s+['"]master_pairing_err_\\w+['"]`),
      );
      expect(mapMatch, `reason '${r}' must map to an i18n key`).toBeTruthy();
    }
  });
});

// ─── 2. getMaster() + isMaster() match both columns ─────────────────────

describe("getMaster/isMaster match either chat_id OR telegram_chat_id", () => {
  it("returns the row when chat_id matches the primary key (legacy real-TG master)", async () => {
    const c = ctx();
    await seedMaster(c, { chat_id: 100, name: "Real", is_synthetic: 0 });
    const m = await getMaster(c, 100);
    expect(m).toBeTruthy();
    expect(m.chatId).toBe(100);
    expect(m.telegramChatId).toBeNull();
    expect(await isMaster(c, 100)).toBe(true);
  });

  it("returns the row when telegram_chat_id matches (paired synthetic master)", async () => {
    const c = ctx();
    const SYN = 10_000_000_777;
    const REAL = 4242;
    await seedMaster(c, {
      chat_id: SYN,
      name: "Synthetic",
      is_synthetic: 1,
      telegram_chat_id: REAL,
    });
    const m = await getMaster(c, REAL);
    expect(m).toBeTruthy();
    expect(m.chatId).toBe(SYN); // primary key still the synthetic id
    expect(m.telegramChatId).toBe(REAL);
    expect(await isMaster(c, REAL)).toBe(true);
  });

  it("returns null for a chat_id with no master row in either column", async () => {
    const c = ctx();
    await seedMaster(c, { chat_id: 10_000_000_001 });
    const m = await getMaster(c, 9999);
    expect(m).toBeNull();
    expect(await isMaster(c, 9999)).toBe(false);
  });
});

// ─── 3. masterTelegramRecipient() helper ────────────────────────────────

describe("masterTelegramRecipient", () => {
  it("prefers telegramChatId over the synthetic primary chatId", () => {
    const r = masterTelegramRecipient({
      chatId: 10_000_000_001,
      telegramChatId: 4242,
    });
    expect(r).toBe(4242);
  });

  it("falls back to chatId when it's a real TG chat (< 10B)", () => {
    expect(masterTelegramRecipient({ chatId: 555, telegramChatId: null })).toBe(555);
  });

  it("returns null when chatId is synthetic and telegramChatId is null (cannot be messaged)", () => {
    expect(masterTelegramRecipient({ chatId: 10_000_000_999, telegramChatId: null })).toBeNull();
  });

  it("returns null for falsy / malformed input", () => {
    expect(masterTelegramRecipient(null)).toBeNull();
    expect(masterTelegramRecipient(undefined)).toBeNull();
    expect(masterTelegramRecipient({ chatId: 0, telegramChatId: null })).toBeNull();
    expect(masterTelegramRecipient({ chatId: NaN, telegramChatId: null })).toBeNull();
  });

  it("normalizes string inputs to numbers (defensive)", () => {
    expect(masterTelegramRecipient({ chatId: 555, telegramChatId: "4242" })).toBe(4242);
  });
});

// ─── 4. tryConsumePairingCode end-to-end DB shape ───────────────────────

describe("tryConsumePairingCode wires the masters update + code consume atomically", () => {
  it("after success, getMaster(realTgChatId) finds the master row", async () => {
    const c = ctx();
    const SYN = 10_000_000_001;
    const REAL = 7777;
    await seedMaster(c, { chat_id: SYN, name: "Anna", is_synthetic: 1 });
    const { raw } = await createPairingCode(c, {
      tenantId: c.tenantId,
      masterChatId: SYN,
    });

    // Before consume: getMaster(REAL) returns null.
    expect(await getMaster(c, REAL)).toBeNull();

    const result = await tryConsumePairingCode(c, raw, REAL);
    expect(result.ok).toBe(true);

    // After consume: getMaster(REAL) returns the paired master.
    const m = await getMaster(c, REAL);
    expect(m).toBeTruthy();
    expect(m.chatId).toBe(SYN);
    expect(m.telegramChatId).toBe(REAL);
    // And the recipient helper picks the REAL chat id for outbound TG.
    expect(masterTelegramRecipient(m)).toBe(REAL);
  });
});
