/**
 * Regression: appointment name-resolution subqueries MUST stay correlated to
 * the appointment's own tenant + key. REAL SQL (in-memory libsql) so the
 * generated correlation is genuinely exercised.
 *
 * Bug (cross-tenant leak): the `appointmentNames.ts` correlated subqueries
 * interpolated bare columns (`${services.tenantId} = ${appointments.tenantId}`),
 * which Drizzle compiled UNQUALIFIED to `where "tenant_id" = "tenant_id"` — a
 * tautology. The subquery degraded to `select … from services limit 1` and
 * returned the globally-FIRST row regardless of tenant/svc_id, so EVERY
 * appointment showed some other salon's first service name, and rows with a
 * NULL `user_name` snapshot showed another salon's client name/phone.
 *
 * The existing `appointments-resolve-names.test.ts` masked this because its
 * correct row was also the first-inserted (lowest rowid). These cases insert a
 * DECOY tenant FIRST with deliberately-wrong names, then assert each row still
 * resolves to ITS OWN tenant's data. They fail on the pre-fix unqualified SQL.
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
const CLIENT_CHAT = -100; // synthetic manual-client id, reused across tenants on purpose

const BOOTSTRAP_SQL: string[] = [
  `CREATE TABLE appointments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, svc_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, duration INTEGER, ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', master_id INTEGER, user_name TEXT, user_phone TEXT, user_tg TEXT, confirmed_by INTEGER, counter_time TEXT, counter_comment TEXT, reject_comment TEXT, cancel_reason TEXT, cancelled INTEGER NOT NULL DEFAULT 0, cancelled_by TEXT, cancelled_at INTEGER, no_show INTEGER DEFAULT 0, no_show_by TEXT, rem_h24 INTEGER NOT NULL DEFAULT 0, rem_h2 INTEGER NOT NULL DEFAULT 0, google_event_id TEXT, google_calendar_id TEXT, google_integration_id TEXT, sync_retries INTEGER DEFAULT 0, sync_retry_after INTEGER, sync_last_error TEXT, review_requested INTEGER DEFAULT 0, visit_confirmed_at INTEGER, visit_confirmed_by TEXT, review_requested_at INTEGER, followup_24h_sent_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE users (tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT, tg_username TEXT, tg_lang TEXT, phone TEXT, registered_at INTEGER, tos_accepted_at INTEGER, first_source TEXT, first_campaign TEXT, first_medium TEXT, first_touch_at INTEGER, dob TEXT, email TEXT, ig_username TEXT, notes TEXT, tags TEXT, marketing_contact_id INTEGER, email_opt_in INTEGER, email_prompt_last_at INTEGER, email_prompt_count INTEGER NOT NULL DEFAULT 0, is_blocked_global INTEGER NOT NULL DEFAULT 0, blocked_global_reason TEXT, blocked_global_at INTEGER, updated_at INTEGER, deleted_at INTEGER, lifetime_visits INTEGER NOT NULL DEFAULT 0, last_visit_at INTEGER, no_show_count INTEGER NOT NULL DEFAULT 0, avatar_emoji TEXT, avatar_url TEXT, avatar_r2_key TEXT, favorite_master_id INTEGER)`,
  `CREATE TABLE services (tenant_id TEXT NOT NULL, svc_id TEXT NOT NULL, emoji TEXT, duration INTEGER NOT NULL, price REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0, names TEXT, description TEXT, photos TEXT, promo TEXT, sort_order INTEGER NOT NULL DEFAULT 0, category TEXT, industry_specific_props TEXT)`,
];

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  for (const stmt of BOOTSTRAP_SQL) await client.execute(stmt);
  const db = drizzle(client, { schema });

  // DECOY tenant inserted FIRST (lowest rowid). A broken, uncorrelated
  // `… limit 1` returns THESE rows for every appointment. Same svc_ids +
  // same chat_id as the real tenant, but deliberately-wrong names.
  await db.insert(schema.services).values({ tenantId: "t_decoy", svcId: "design", duration: 1, price: 1, names: JSON.stringify({ ru: "Классический маникюр" }), sortOrder: 0 });
  await db.insert(schema.services).values({ tenantId: "t_decoy", svcId: "french", duration: 1, price: 1, names: JSON.stringify({ ru: "Классический маникюр" }), sortOrder: 1 });
  await db.insert(schema.users).values({ tenantId: "t_decoy", chatId: CLIENT_CHAT, name: "LeakClient", phone: "+48000LEAK", registeredAt: NOW });

  // Real tenant — prod-like multi-service catalog.
  await db.insert(schema.services).values({ tenantId: "t_a", svcId: "design", duration: 45, price: 80, names: JSON.stringify({ ru: "Дизайн (per nail)" }), sortOrder: 0 });
  await db.insert(schema.services).values({ tenantId: "t_a", svcId: "french", duration: 60, price: 150, names: JSON.stringify({ ru: "Френч" }), sortOrder: 1 });
  await db.insert(schema.users).values({ tenantId: "t_a", chatId: CLIENT_CHAT, name: "Анна", phone: "+48111", registeredAt: NOW });

  // Two bookings on different services; the second one stores a NULL name
  // snapshot (existing-client manual booking) so client-name resolution is
  // exercised too.
  await db.insert(schema.appointments).values({ id: "a_design", tenantId: "t_a", chatId: CLIENT_CHAT, svcId: "design", date: "2026-05-31", time: "12:00", ts: NOW, status: "confirmed", masterId: null, userName: "Snapshotted", userPhone: null, cancelled: 0, noShow: 0, remH24: 0, remH2: 0, createdAt: NOW });
  await db.insert(schema.appointments).values({ id: "a_french", tenantId: "t_a", chatId: CLIENT_CHAT, svcId: "french", date: "2026-05-31", time: "13:00", ts: NOW + 1, status: "confirmed", masterId: null, userName: null, userPhone: null, cancelled: 0, noShow: 0, remH24: 0, remH2: 0, createdAt: NOW });
  return db;
}

function ownerCtx(db: unknown, tenantId: string) {
  return { db: db as never, webUser: { id: "w_owner", email: "o@x.io", tenantId, webRole: "tenant_owner" }, headers: new Headers() };
}
function adminCtx(db: unknown) {
  return { db: db as never, webUser: { id: "w_admin", email: "a@x.io", tenantId: null, webRole: "system_admin" }, headers: new Headers() };
}

describe("appointmentNames: subqueries stay correlated to the appointment's tenant + key", () => {
  it("salon.getAppointments resolves each row to ITS OWN service (no cross-tenant constant)", async () => {
    const db = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db, "t_a") as never);

    const rows = await caller.getAppointments({ tenantId: "t_a" });
    const svcByApt = Object.fromEntries(rows.map((r) => [r.id, r.serviceName]));
    expect(svcByApt["a_design"]).toBe("Дизайн (per nail)");
    expect(svcByApt["a_french"]).toBe("Френч");
    // Never the decoy tenant's first-row name.
    expect(svcByApt["a_design"]).not.toBe("Классический маникюр");
    expect(svcByApt["a_french"]).not.toBe("Классический маникюр");
  });

  it("resolves client name/phone from the appointment's own tenant on a NULL snapshot", async () => {
    const db = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db, "t_a") as never);

    const rows = await caller.getAppointments({ tenantId: "t_a" });
    const french = rows.find((r) => r.id === "a_french")!;
    // NULL snapshot → resolved from users; must be t_a's "Анна", NOT t_decoy's "LeakClient".
    expect(french.userName).toBe("Анна");
    expect(french.userName).not.toBe("LeakClient");
    expect(french.userPhone).toBe("+48111");
    expect(french.userPhone).not.toBe("+48000LEAK");
  });

  it("appointments.getAll (God Mode) resolves per-tenant without leak", async () => {
    const db = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { appointmentsRouter } = await import("~/server/api/routers/appointments");
    const caller = createCallerFactory(appointmentsRouter)(adminCtx(db) as never);

    const res = await caller.getAll({ tenantId: "t_a" });
    const rows = res.appointments as Array<Record<string, unknown>>;
    const design = rows.find((r) => r.id === "a_design")!;
    expect(design.serviceName).toBe("Дизайн (per nail)");
    expect(design.serviceName).not.toBe("Классический маникюр");
  });
});
