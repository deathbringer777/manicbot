/**
 * welcomeOnRegister.deliverWelcomeFireAndForget — the synchronous welcome that
 * seeds the new owner's "ManicBot — News & Announcements" channel.
 *
 * Exercised against REAL Drizzle/libsql (in-memory) so the idempotency guard is
 * the genuine UNIQUE index idx_pcd_claim — a mock that ignored the conflict
 * would let a double-welcome through and pass a broken implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({ env: { ADMIN_CHAT_ID: "1", AUTH_SECRET: "test" } }));
vi.mock("~/server/utils/logger", () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const notifySpy = vi.fn(async (..._args: unknown[]) => ({ ok: true, id: "n1" }));
vi.mock("~/server/services/notifyWebUser", () => ({ notifyWebUser: (...a: unknown[]) => notifySpy(...a) }));

import { deliverWelcomeFireAndForget } from "~/server/messenger/welcomeOnRegister";

// Faithful subset of src/db/schema.sql (platform messaging tables) + the two
// UNIQUE indexes that carry the invariants we test (one thread per owner; one
// delivery per campaign/occurrence/recipient/channel).
const BOOTSTRAP_SQL = `
CREATE TABLE platform_threads (
  id TEXT PRIMARY KEY, recipient_web_user_id TEXT NOT NULL, recipient_tenant_id TEXT,
  last_message_at INTEGER, last_message_preview TEXT, last_sender_kind TEXT,
  recipient_last_read_at INTEGER, platform_last_read_at INTEGER,
  archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_platform_threads_recipient ON platform_threads(recipient_web_user_id);
CREATE TABLE platform_thread_messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, sender_kind TEXT NOT NULL,
  sender_web_user_id TEXT NOT NULL, body TEXT NOT NULL, attachments_json TEXT,
  broadcast_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE platform_campaigns (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, body TEXT, bodies_json TEXT,
  audience_filter_json TEXT, channels_json TEXT NOT NULL, schedule_kind TEXT NOT NULL DEFAULT 'now',
  scheduled_at INTEGER, recurrence_json TEXT, template_id TEXT, status TEXT NOT NULL DEFAULT 'draft',
  next_run_at INTEGER, last_run_at INTEGER, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE platform_campaign_deliveries (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, occurrence_key TEXT NOT NULL,
  recipient_web_user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER
);
CREATE UNIQUE INDEX idx_pcd_claim ON platform_campaign_deliveries(campaign_id, occurrence_key, recipient_web_user_id, channel);
CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT, plan TEXT);
CREATE TABLE web_users (id TEXT PRIMARY KEY, name TEXT);
`;

const WELCOME_BODY = JSON.stringify({ center: "Здравствуйте, {salon_name}! Тариф: {plan}. {first_name}, рады вам." });

async function makeDb(opts?: { status?: string; channels?: string }) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(BOOTSTRAP_SQL);
  const db = drizzle(client, { schema });
  await client.execute({
    sql: `INSERT INTO platform_campaigns (id, kind, title, body, bodies_json, channels_json, schedule_kind, status, created_at, updated_at)
          VALUES ('sys_welcome','welcome','Добро пожаловать в ManicBot','Здравствуйте, {salon_name}!', ?, ?, 'now', ?, 0, 0)`,
    args: [WELCOME_BODY, opts?.channels ?? '["center","bell"]', opts?.status ?? "active"],
  });
  await client.execute("INSERT INTO tenants (id, name, plan) VALUES ('t_glow','Glow Studio','pro')");
  await client.execute("INSERT INTO web_users (id, name) VALUES ('w_owner','Anna Petrova')");
  return { db, client };
}

async function rows(client: Client, sql: string) {
  return (await client.execute(sql)).rows;
}

beforeEach(() => vi.clearAllMocks());

describe("deliverWelcomeFireAndForget", () => {
  it("delivers one personalized welcome into the owner's channel", async () => {
    const { db, client } = await makeDb();
    const r = await deliverWelcomeFireAndForget(db, { webUserId: "w_owner", tenantId: "t_glow" });
    expect(r.delivered).toBe(true);

    const msgs = await rows(client, "SELECT * FROM platform_thread_messages");
    expect(msgs).toHaveLength(1);
    const body = String(msgs[0]!.body);
    expect(body).toContain("Glow Studio"); // {salon_name}
    expect(body).toContain("pro"); //          {plan}
    expect(body).toContain("Anna"); //         {first_name}
    expect(body).not.toContain("{salon_name}"); // token actually substituted
    expect(msgs[0]!.sender_kind).toBe("platform");

    // One thread, unread for the recipient (recipient_last_read_at stays null).
    const threads = await rows(client, "SELECT * FROM platform_threads");
    expect(threads).toHaveLength(1);
    expect(threads[0]!.recipient_web_user_id).toBe("w_owner");
    expect(threads[0]!.last_sender_kind).toBe("platform");
    expect(threads[0]!.recipient_last_read_at).toBeNull();
    expect(threads[0]!.last_message_at).not.toBeNull();

    // center + bell both claimed and sent.
    const dels = await rows(client, "SELECT channel, status FROM platform_campaign_deliveries ORDER BY channel");
    expect(dels.map((d) => `${d.channel}:${d.status}`)).toEqual(["bell:sent", "center:sent"]);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0]![1]).toMatchObject({ kind: "platform.campaign", link: "/messages?platform=1" });
  });

  it("is idempotent — a second call never double-welcomes", async () => {
    const { db, client } = await makeDb();
    const r1 = await deliverWelcomeFireAndForget(db, { webUserId: "w_owner", tenantId: "t_glow" });
    const r2 = await deliverWelcomeFireAndForget(db, { webUserId: "w_owner", tenantId: "t_glow" });
    expect(r1.delivered).toBe(true);
    expect(r2.delivered).toBe(false);
    expect(r2.reason).toBe("already_welcomed");
    expect(await rows(client, "SELECT id FROM platform_thread_messages")).toHaveLength(1);
  });

  it("does nothing when the welcome singleton is not active", async () => {
    const { db, client } = await makeDb({ status: "paused" });
    const r = await deliverWelcomeFireAndForget(db, { webUserId: "w_owner", tenantId: "t_glow" });
    expect(r.delivered).toBe(false);
    expect(r.reason).toBe("inactive");
    expect(await rows(client, "SELECT id FROM platform_thread_messages")).toHaveLength(0);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("skips the bell when only the center channel is enabled", async () => {
    const { db, client } = await makeDb({ channels: '["center"]' });
    const r = await deliverWelcomeFireAndForget(db, { webUserId: "w_owner", tenantId: "t_glow" });
    expect(r.delivered).toBe(true);
    expect(notifySpy).not.toHaveBeenCalled();
    expect(await rows(client, "SELECT id FROM platform_thread_messages")).toHaveLength(1);
  });

  it("returns missing_input without touching the db when ids are absent", async () => {
    const { db } = await makeDb();
    const r = await deliverWelcomeFireAndForget(db, { webUserId: "", tenantId: "" });
    expect(r).toEqual({ delivered: false, reason: "missing_input" });
  });
});
