/**
 * C7 — no-show policy enforcement at the booking chokepoint.
 *
 * `evaluateNoShowPolicy` / `getNoShowPolicy` existed but were never wired into
 * any server-side booking path, so a client the salon configured to auto-block
 * after N no-shows could still self-book (via Telegram OR the web widget — both
 * funnel through `saveApt`). This pins the gate:
 *
 *   * A tenant with `autoAction: 'auto_block'` + `afterCount: N` blocks a client
 *     whose `no_show_count >= N` (sentinel BLOCKED_NO_SHOW).
 *   * Below the threshold → booking proceeds.
 *   * Default policy (no tenant_config row ⇒ afterCount 0) never blocks, even
 *     for a client with a no-show history — safe-by-default, zero behaviour
 *     change for tenants who haven't opted in.
 *   * Non-block escalations (require_confirm / require_prepayment) do NOT hard
 *     block at booking time — only `auto_block` does.
 */
import { describe, it, expect } from "vitest";
import { makeCtx } from "./helpers/mock-db.js";
import { saveApt, BLOCKED_NO_SHOW } from "../src/services/appointments.js";

function ctx(tenantId = "t_noshow") {
  return makeCtx({ tenantId, tenant: { plan: "pro", billingStatus: "active" } });
}

async function seedUser(c, chatId, noShowCount) {
  await c.db
    .prepare("INSERT INTO users (tenant_id, chat_id, no_show_count) VALUES (?, ?, ?)")
    .bind(c.tenantId, chatId, noShowCount)
    .run();
}

async function seedPolicy(c, policy) {
  await c.db
    .prepare("INSERT INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)")
    .bind(c.tenantId, "no_show_policy", JSON.stringify(policy))
    .run();
}

const SLOT = { svcId: "classic", date: "2026-09-12", time: "11:00" };
const future = () => Date.now() + 3_600_000;

describe("saveApt — no-show policy gate (C7)", () => {
  it("exposes a frozen BLOCKED_NO_SHOW sentinel", () => {
    expect(BLOCKED_NO_SHOW.blockedNoShow).toBe(true);
    expect(BLOCKED_NO_SHOW).toBe(BLOCKED_NO_SHOW);
  });

  it("blocks a client at/over the auto_block threshold", async () => {
    const c = ctx();
    await seedPolicy(c, { afterCount: 3, autoAction: "auto_block" });
    await seedUser(c, 100, 3);
    const result = await saveApt(c, {
      ...SLOT, chatId: 100, masterId: 7, ts: future(), userName: "X", userPhone: "+1",
    });
    expect(result).toBe(BLOCKED_NO_SHOW);
  });

  it("allows a client BELOW the threshold", async () => {
    const c = ctx("t_noshow_below");
    await seedPolicy(c, { afterCount: 3, autoAction: "auto_block" });
    await seedUser(c, 101, 1);
    const result = await saveApt(c, {
      ...SLOT, chatId: 101, masterId: 7, ts: future(), userName: "X", userPhone: "+1",
    });
    expect(result).not.toBe(BLOCKED_NO_SHOW);
    expect(result?.id).toMatch(/^a/);
  });

  it("does NOT block under the default policy even with a no-show history", async () => {
    const c = ctx("t_noshow_default");
    // No tenant_config row ⇒ default policy (afterCount 0 / autoAction none).
    await seedUser(c, 102, 5);
    const result = await saveApt(c, {
      ...SLOT, chatId: 102, masterId: 7, ts: future(), userName: "X", userPhone: "+1",
    });
    expect(result).not.toBe(BLOCKED_NO_SHOW);
    expect(result?.id).toMatch(/^a/);
  });

  it("does NOT hard-block for non-auto_block escalations (require_confirm)", async () => {
    const c = ctx("t_noshow_confirm");
    await seedPolicy(c, { afterCount: 2, autoAction: "require_confirm" });
    await seedUser(c, 103, 4);
    const result = await saveApt(c, {
      ...SLOT, chatId: 103, masterId: 7, ts: future(), userName: "X", userPhone: "+1",
    });
    expect(result).not.toBe(BLOCKED_NO_SHOW);
    expect(result?.id).toMatch(/^a/);
  });
});
