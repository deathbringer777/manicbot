/**
 * 0062 — Client-block enforcement in saveApt().
 *
 * Pins:
 *   * A `users.is_blocked_global = 1` row blocks ANY master in the tenant.
 *   * A `master_client_blocks` row blocks ONLY the (master, client) combo —
 *     other masters in the same tenant remain bookable.
 *   * Unrelated clients still book normally — the block is scoped.
 *   * KV legacy path (no D1) is unaffected (blocks tables don't exist).
 */
import { describe, it, expect } from "vitest";
import { makeCtx } from "./helpers/mock-db.js";
import {
  saveApt,
  checkBookingBlock,
  BLOCKED_GLOBAL,
  BLOCKED_FOR_MASTER,
} from "../src/services/appointments.js";

function ctx(tenantId = "t_block") {
  return makeCtx({
    tenantId,
    tenant: { plan: "pro", billingStatus: "active" },
  });
}

async function seedUsers(c, rows) {
  for (const row of rows) {
    await c.db
      .prepare(
        "INSERT INTO users (tenant_id, chat_id, name, phone, is_blocked_global) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(c.tenantId, row.chat_id, row.name ?? null, row.phone ?? null, row.is_blocked_global ?? 0)
      .run();
  }
}

async function seedBlocks(c, rows) {
  for (const row of rows) {
    await c.db
      .prepare(
        "INSERT INTO master_client_blocks (tenant_id, master_chat_id, client_chat_id, reason, blocked_by, blocked_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        c.tenantId,
        row.master_chat_id,
        row.client_chat_id,
        row.reason ?? null,
        row.blocked_by ?? row.master_chat_id,
        row.blocked_at ?? Math.floor(Date.now() / 1000),
      )
      .run();
  }
}

describe("checkBookingBlock", () => {
  it("returns null for an unknown client (no rows in users)", async () => {
    const c = ctx();
    const result = await checkBookingBlock(c, 1, 7);
    expect(result).toBeNull();
  });

  it("returns BLOCKED_GLOBAL when users.is_blocked_global=1", async () => {
    const c = ctx();
    await seedUsers(c, [{ chat_id: 42, is_blocked_global: 1 }]);
    const result = await checkBookingBlock(c, 42, 7);
    expect(result).toBe(BLOCKED_GLOBAL);
  });

  it("returns BLOCKED_FOR_MASTER when master_client_blocks row exists", async () => {
    const c = ctx();
    await seedUsers(c, [{ chat_id: 42, is_blocked_global: 0 }]);
    await seedBlocks(c, [{ master_chat_id: 7, client_chat_id: 42 }]);
    const result = await checkBookingBlock(c, 42, 7);
    expect(result).toBe(BLOCKED_FOR_MASTER);
  });

  it("returns null when block is for a DIFFERENT master", async () => {
    const c = ctx();
    await seedUsers(c, [{ chat_id: 42, is_blocked_global: 0 }]);
    await seedBlocks(c, [{ master_chat_id: 7, client_chat_id: 42 }]);
    // Same client, different master — bookable.
    const result = await checkBookingBlock(c, 42, 99);
    expect(result).toBeNull();
  });
});

describe("saveApt — block enforcement", () => {
  it("returns BLOCKED_GLOBAL when client is globally blocked", async () => {
    const c = ctx();
    await seedUsers(c, [{ chat_id: 100, is_blocked_global: 1 }]);
    const result = await saveApt(c, {
      svcId: "classic",
      date: "2026-09-12",
      time: "11:00",
      chatId: 100,
      masterId: 7,
      ts: Date.now() + 3_600_000,
      userName: "X",
      userPhone: "+1",
    });
    expect(result).toBe(BLOCKED_GLOBAL);
  });

  it("returns BLOCKED_FOR_MASTER for per-master block", async () => {
    const c = ctx();
    await seedUsers(c, [{ chat_id: 200, is_blocked_global: 0 }]);
    await seedBlocks(c, [{ master_chat_id: 7, client_chat_id: 200 }]);
    const result = await saveApt(c, {
      svcId: "classic",
      date: "2026-09-12",
      time: "11:00",
      chatId: 200,
      masterId: 7,
      ts: Date.now() + 3_600_000,
      userName: "X",
      userPhone: "+1",
    });
    expect(result).toBe(BLOCKED_FOR_MASTER);
  });

  it("allows the same client to book a DIFFERENT master in the tenant", async () => {
    const c = ctx();
    await seedUsers(c, [{ chat_id: 300, is_blocked_global: 0 }]);
    await seedBlocks(c, [{ master_chat_id: 7, client_chat_id: 300 }]);
    const result = await saveApt(c, {
      svcId: "classic",
      date: "2026-09-12",
      time: "11:00",
      chatId: 300,
      masterId: 99, // different master
      ts: Date.now() + 3_600_000,
      userName: "X",
      userPhone: "+1",
    });
    expect(result).not.toBe(BLOCKED_FOR_MASTER);
    expect(result).not.toBe(BLOCKED_GLOBAL);
    expect(result?.id).toMatch(/^a/);
  });
});
