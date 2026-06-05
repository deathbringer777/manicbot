/**
 * Appointment read queries must resolve the displayed client + service NAME,
 * not raw ids. REAL SQL (in-memory libsql) so the LEFT JOINs are genuinely
 * exercised.
 *
 * Bug: a manual booking of an EXISTING client stores `user_name = NULL` on the
 * appointment row (createManual only snapshots the name for NEW clients), and
 * the row only ever stores `svc_id` — never a service name. The calendar then
 * rendered `#<chatId>` and the raw `svc_...` id.
 *
 * Contract verified here:
 *   - `salon.getAppointments` and `appointments.getAll` LEFT JOIN `users` and
 *     `services` and return `userName` (coalesced from users.name when the
 *     snapshot is null) + a resolved `serviceName`.
 *   - The joins are tenant-scoped: a second tenant owning the SAME chatId /
 *     svcId must not leak its name into the first tenant's rows.
 */
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));
vi.mock("~/server/utils/notifyWorker", () => ({ notifyWorker: vi.fn(async () => undefined) }));
vi.mock("~/server/clients/marketingSync", () => ({ syncMarketingContact: vi.fn(async () => null) }));
vi.mock("~/server/lib/telegramApi", () => ({
  telegramGetMe: vi.fn(), telegramSetWebhook: vi.fn(), telegramDeleteWebhook: vi.fn(),
}));
vi.mock("~/server/lib/stripe", () => ({
  getOrCreateCustomer: vi.fn(), createCheckoutSession: vi.fn(), createBillingPortalSession: vi.fn(),
}));
vi.mock("~/server/lib/uploadToken", () => ({ signUploadToken: vi.fn().mockResolvedValue("tok") }));

const NOW = 1_780_000_000;
const MANUAL_CHAT = -1_780_142_566; // synthetic negative id minted for manual clients

const BOOTSTRAP_SQL: string[] = [
  `CREATE TABLE appointments (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, svc_id TEXT NOT NULL,
    date TEXT NOT NULL, time TEXT NOT NULL, duration INTEGER, ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    master_id INTEGER, user_name TEXT, user_phone TEXT, user_tg TEXT, confirmed_by INTEGER,
    counter_time TEXT, counter_comment TEXT, reject_comment TEXT, cancel_reason TEXT,
    cancelled INTEGER NOT NULL DEFAULT 0, cancelled_by TEXT, cancelled_at INTEGER,
    no_show INTEGER DEFAULT 0, no_show_by TEXT, rem_h24 INTEGER NOT NULL DEFAULT 0,
    rem_h2 INTEGER NOT NULL DEFAULT 0, google_event_id TEXT, google_calendar_id TEXT,
    google_integration_id TEXT, sync_retries INTEGER DEFAULT 0, sync_retry_after INTEGER,
    sync_last_error TEXT, review_requested INTEGER DEFAULT 0, visit_confirmed_at INTEGER,
    visit_confirmed_by TEXT, review_requested_at INTEGER, followup_24h_sent_at INTEGER, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE users (
    tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT, tg_username TEXT, tg_lang TEXT,
    phone TEXT, registered_at INTEGER, tos_accepted_at INTEGER, first_source TEXT, first_campaign TEXT,
    first_medium TEXT, first_touch_at INTEGER, dob TEXT, email TEXT, ig_username TEXT, notes TEXT,
    tags TEXT, marketing_contact_id INTEGER, is_blocked_global INTEGER NOT NULL DEFAULT 0,
    blocked_global_reason TEXT, blocked_global_at INTEGER, updated_at INTEGER, deleted_at INTEGER,
    lifetime_visits INTEGER NOT NULL DEFAULT 0, last_visit_at INTEGER, avatar_emoji TEXT,
    avatar_url TEXT, avatar_r2_key TEXT, favorite_master_id INTEGER
  )`,
  `CREATE TABLE services (
    tenant_id TEXT NOT NULL, svc_id TEXT NOT NULL, emoji TEXT, duration INTEGER NOT NULL,
    price REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0,
    names TEXT, description TEXT, photos TEXT, promo TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
    category TEXT, industry_specific_props TEXT
  )`,
];

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  for (const stmt of BOOTSTRAP_SQL) await client.execute(stmt);
  const db = drizzle(client, { schema });

  // Tenant A — the booking under test: existing manual client, name only in
  // `users`, NULL snapshot on the appointment; service name is a JSON blob.
  await db.insert(schema.services).values({
    tenantId: "t_a", svcId: "svc_1776678542391", duration: 60, price: 80,
    names: JSON.stringify({ ru: "Маникюр", en: "Manicure" }), sortOrder: 0,
  });
  await db.insert(schema.users).values({
    tenantId: "t_a", chatId: MANUAL_CHAT, name: "Анна", phone: "+48111", registeredAt: NOW,
  });
  await db.insert(schema.appointments).values({
    id: "a_1", tenantId: "t_a", chatId: MANUAL_CHAT, svcId: "svc_1776678542391",
    date: "2026-05-30", time: "14:00", ts: NOW, status: "confirmed", masterId: null,
    userName: null, userPhone: null, cancelled: 0, noShow: 0, remH24: 0, remH2: 0, createdAt: NOW,
  });

  // Tenant B — SAME chatId + svcId, different names. Must NOT leak into A.
  await db.insert(schema.services).values({
    tenantId: "t_b", svcId: "svc_1776678542391", duration: 30, price: 50, names: "LeakService",
  });
  await db.insert(schema.users).values({
    tenantId: "t_b", chatId: MANUAL_CHAT, name: "LeakClient", registeredAt: NOW,
  });
  return db;
}

function ownerCtx(db: unknown, tenantId: string) {
  return {
    db: db as never,
    webUser: { id: "w_owner", email: "o@x.io", tenantId, webRole: "tenant_owner" },
    headers: new Headers(),
  };
}
function adminCtx(db: unknown) {
  return {
    db: db as never,
    webUser: { id: "w_admin", email: "a@x.io", tenantId: null, webRole: "system_admin" },
    headers: new Headers(),
  };
}

describe("appointment read queries resolve client + service names", () => {
  it("salon.getAppointments coalesces userName from users and resolves serviceName", async () => {
    const db = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db, "t_a") as never);

    const rows = await caller.getAppointments({ tenantId: "t_a" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userName).toBe("Анна");
    expect(rows[0]!.serviceName).toBe("Маникюр");
    // Raw fields are preserved for the rest of the UI.
    expect(rows[0]!.svcId).toBe("svc_1776678542391");
    expect(rows[0]!.chatId).toBe(MANUAL_CHAT);
  });

  it("appointments.getAll (God Mode) resolves names without cross-tenant leak", async () => {
    const db = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { appointmentsRouter } = await import("~/server/api/routers/appointments");
    const caller = createCallerFactory(appointmentsRouter)(adminCtx(db) as never);

    const res = await caller.getAll({ tenantId: "t_a" });
    expect(res.appointments).toHaveLength(1);
    const row = res.appointments[0] as Record<string, unknown>;
    expect(row.userName).toBe("Анна");
    expect(row.serviceName).toBe("Маникюр");
    // Tenant B owns the same chatId/svcId with different names — must not bleed.
    expect(row.userName).not.toBe("LeakClient");
    expect(row.serviceName).not.toBe("LeakService");
  });
});
