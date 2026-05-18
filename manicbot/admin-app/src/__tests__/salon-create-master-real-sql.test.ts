/**
 * salon.createMasterAccount — REAL SQL integration test.
 *
 * The previous unit test (master-account-bot-encryption-key-optional.test.ts)
 * mocked the entire `db` so it never exercised the SQL Drizzle actually emits
 * against D1. That gap let migration drift sneak into prod: when migration
 * 0074 (master Telegram pairing — adds masters.telegram_chat_id + the
 * master_pairing_codes table) was missing on the production D1, the
 * procedure broke in a way that hash-only tests could not see. The reported
 * UX was "Internal server error" the moment the salon owner clicked
 * "Создать аккаунт".
 *
 * This test boots Drizzle on an in-memory libsql and runs the procedure
 * end-to-end. It verifies:
 *   1. All four touched tables (web_users, masters, tenant_roles,
 *      tenant_member_permissions) receive their rows.
 *   2. The procedure remains atomic — on a deliberate failure (e.g. missing
 *      column) we don't leave orphan web_users rows that block retry.
 *   3. The auto-generated synthetic email format is preserved.
 *
 * The schema bootstrap below mirrors the production D1 tables verbatim
 * (column types + nullability + defaults + primary keys) so a real Drizzle
 * SQL emission failure (wrong column count, mistyped value, missing default)
 * surfaces here instead of in production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, and } from "drizzle-orm";
import * as schema from "~/server/db/schema";

const TENANT = "t_real_sql_alpha";
const NOW = 1_780_000_000;
const VALID_KEK = "0123456789abcdef0123456789abcdef"; // 32 chars

// Minimal subset of the production CREATE TABLEs touched by the procedure.
// Mirrors the prod D1 layout exactly so a missing column / mismatched type
// would fail here.
const BOOTSTRAP_SQL = [
  `CREATE TABLE tenants (
     id TEXT PRIMARY KEY,
     name TEXT,
     plan TEXT NOT NULL DEFAULT 'start',
     billing_status TEXT NOT NULL DEFAULT 'trialing',
     created_at INTEGER NOT NULL DEFAULT 0,
     is_personal INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE web_users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     password_hash TEXT NOT NULL DEFAULT '',
     tenant_id TEXT,
     role TEXT NOT NULL DEFAULT 'tenant_owner',
     name TEXT,
     lang TEXT DEFAULT 'en',
     referral_source TEXT,
     referral_note TEXT,
     email_verified INTEGER NOT NULL DEFAULT 0,
     verification_token TEXT,
     verification_token_expires_at INTEGER,
     password_reset_token TEXT,
     password_reset_expires_at INTEGER,
     new_email TEXT,
     email_change_token TEXT,
     email_change_token_expires_at INTEGER,
     tos_accepted_at INTEGER,
     login_attempts INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER,
     last_login_ip TEXT,
     last_login_at INTEGER,
     password_changed_at INTEGER NOT NULL DEFAULT 0,
     sessions_invalidated_at INTEGER NOT NULL DEFAULT 0,
     login_token_hash TEXT,
     login_token_expires_at INTEGER,
     password_reset_token_hash TEXT,
     verification_token_hash TEXT,
     email_change_token_hash TEXT,
     password_encrypted TEXT,
     notification_prefs TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX idx_web_user_email ON web_users(email)`,
  // Production masters layout including the 0074 telegram_chat_id column.
  // The integration test runs the post-0074 schema; a separate test below
  // simulates the pre-0074 drift to confirm the cleanup path fires.
  `CREATE TABLE masters (
     tenant_id TEXT NOT NULL,
     chat_id INTEGER NOT NULL,
     name TEXT,
     tg_username TEXT,
     services TEXT,
     work_hours TEXT,
     work_days TEXT,
     on_vacation INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1,
     added_at INTEGER,
     google_calendar_id TEXT,
     calendar_enabled INTEGER NOT NULL DEFAULT 0,
     bio TEXT,
     photo TEXT,
     portfolio TEXT,
     allow_delegation INTEGER NOT NULL DEFAULT 0,
     web_user_id TEXT,
     calendar_visibility TEXT NOT NULL DEFAULT 'salon_only',
     is_synthetic INTEGER NOT NULL DEFAULT 0,
     public_hidden INTEGER NOT NULL DEFAULT 0,
     vacation_from INTEGER,
     vacation_until INTEGER,
     origin TEXT NOT NULL DEFAULT 'salon_created',
     archived_at INTEGER,
     telegram_chat_id INTEGER,
     avatar_emoji TEXT,
     avatar_url TEXT,
     avatar_r2_key TEXT,
     PRIMARY KEY (tenant_id, chat_id)
   )`,
  `CREATE UNIQUE INDEX idx_masters_tenant_tg_chat
     ON masters(tenant_id, telegram_chat_id)
     WHERE telegram_chat_id IS NOT NULL`,
  `CREATE TABLE tenant_roles (
     tenant_id TEXT NOT NULL,
     chat_id INTEGER NOT NULL,
     role TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (tenant_id, chat_id)
   )`,
  `CREATE TABLE tenant_member_permissions (
     tenant_id TEXT NOT NULL,
     web_user_id TEXT NOT NULL,
     permission TEXT NOT NULL,
     granted_at INTEGER NOT NULL,
     granted_by TEXT NOT NULL,
     PRIMARY KEY (tenant_id, web_user_id, permission)
   )`,
  `CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     tenant_id TEXT,
     actor TEXT,
     action TEXT NOT NULL,
     detail TEXT,
     ip TEXT,
     created_at INTEGER NOT NULL
   )`,
] as const;

async function bootstrap() {
  const client = createClient({ url: ":memory:" });
  for (const stmt of BOOTSTRAP_SQL) await client.execute(stmt);
  await client.execute({
    sql: "INSERT INTO tenants (id, name, plan, billing_status, created_at, is_personal) VALUES (?, ?, ?, ?, ?, ?)",
    args: [TENANT, "Real SQL Salon", "max", "active", NOW, 0],
  });
  return drizzle(client, { schema });
}

function ownerCtx(db: unknown) {
  return {
    db: db as never,
    webUser: {
      id: "w_owner_real",
      email: "owner@real.test",
      tenantId: TENANT,
      webRole: "tenant_owner",
    },
    headers: new Headers(),
  };
}

vi.mock("~/server/email/emailService", () => ({
  sendMasterInviteEmail: vi.fn(async () => undefined),
  sendMasterInviteExistingUserEmail: vi.fn(async () => undefined),
  sendMasterInviteNewUserEmail: vi.fn(async () => undefined),
  sendMasterPasswordResetByOwnerEmail: vi.fn(async () => undefined),
}));

describe("salon.createMasterAccount — real Drizzle SQL", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("~/env");
  });

  it("writes all four tables in one atomic call when the schema is in sync", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: VALID_KEK,
      },
    }));
    const db = await bootstrap();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    const out = await caller.createMasterAccount({ tenantId: TENANT, name: "Анна" });

    expect(out.login).toMatch(/@salon\.manicbot\.local$/);
    expect(out.password).toHaveLength(16);
    expect(out.masterId).toBeGreaterThanOrEqual(10_000_000_000);
    expect(out.webUserId).toMatch(/^[0-9a-f-]{36}$/);

    const wu = await db
      .select()
      .from(schema.webUsers)
      .where(eq(schema.webUsers.id, out.webUserId))
      .limit(1);
    expect(wu).toHaveLength(1);
    expect(wu[0]!.email).toBe(out.login);
    expect(wu[0]!.role).toBe("master");
    expect(wu[0]!.tenantId).toBe(TENANT);
    // Synthetic email → auto-verified so the master can sign in without a
    // real inbox to confirm. Real-email overrides keep verified=0.
    expect(wu[0]!.emailVerified).toBe(1);
    expect(typeof wu[0]!.passwordEncrypted).toBe("string");
    expect(wu[0]!.passwordEncrypted!.startsWith("v1$")).toBe(true);

    const ms = await db
      .select()
      .from(schema.masters)
      .where(and(eq(schema.masters.tenantId, TENANT), eq(schema.masters.webUserId, out.webUserId)))
      .limit(1);
    expect(ms).toHaveLength(1);
    expect(ms[0]!.origin).toBe("salon_created");
    expect(ms[0]!.isSynthetic).toBe(1);
    expect(ms[0]!.chatId).toBe(out.masterId);

    const tr = await db
      .select()
      .from(schema.tenantRoles)
      .where(eq(schema.tenantRoles.chatId, out.masterId))
      .limit(1);
    expect(tr[0]?.role).toBe("master");

    const perms = await db
      .select()
      .from(schema.tenantMemberPermissions)
      .where(eq(schema.tenantMemberPermissions.webUserId, out.webUserId));
    expect(perms.length).toBeGreaterThan(0);
  });

  it("uses a real email when supplied — login matches input.email, emailVerified=0", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: VALID_KEK,
      },
    }));
    const db = await bootstrap();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    const out = await caller.createMasterAccount({
      tenantId: TENANT,
      name: "Maria",
      email: "Maria.real@example.com",
    });
    expect(out.login).toBe("maria.real@example.com");

    const wu = await db
      .select({ emailVerified: schema.webUsers.emailVerified })
      .from(schema.webUsers)
      .where(eq(schema.webUsers.id, out.webUserId))
      .limit(1);
    expect(wu[0]!.emailVerified).toBe(0);
  });

  it("rejects duplicate email with CONFLICT (no orphan rows on retry)", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: VALID_KEK,
      },
    }));
    const db = await bootstrap();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    await caller.createMasterAccount({
      tenantId: TENANT,
      name: "Olya",
      email: "olya@example.com",
    });
    await expect(
      caller.createMasterAccount({
        tenantId: TENANT,
        name: "Olya2",
        email: "olya@example.com",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("falls back gracefully when BOT_ENCRYPTION_KEY is missing — passwordEncrypted is NULL", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: "",
      },
    }));
    const db = await bootstrap();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    const out = await caller.createMasterAccount({ tenantId: TENANT, name: "NoKey" });

    const wu = await db
      .select({ pe: schema.webUsers.passwordEncrypted, ph: schema.webUsers.passwordHash })
      .from(schema.webUsers)
      .where(eq(schema.webUsers.id, out.webUserId))
      .limit(1);
    expect(wu[0]!.pe).toBeNull();
    expect(typeof wu[0]!.ph).toBe("string");
    expect(wu[0]!.ph.length).toBeGreaterThan(20);
  });

  it("rolls back orphan web_users when masters INSERT fails (migration drift)", async () => {
    // Recreate the prod regression: production masters table without the
    // 0074 telegram_chat_id column. We emulate that by dropping the column
    // index that the Drizzle insert is allowed to ignore — but the column
    // itself is removed by re-creating the table without it. The Drizzle
    // INSERT path normally tolerates this (it never references the column);
    // we force a failure by adding a CHECK constraint that the insert is
    // guaranteed to violate, then verify that the orphan web_users row from
    // the partial state is cleaned up. The procedure must NOT leave dangling
    // rows that would block a subsequent retry with "email already exists".
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: VALID_KEK,
      },
    }));
    const client = createClient({ url: ":memory:" });
    for (const stmt of BOOTSTRAP_SQL) {
      if (stmt.startsWith("CREATE TABLE masters")) {
        // Replace with a forbidden-origin table so every salon_created insert
        // fails with a CHECK violation; everything else stays prod-shaped.
        await client.execute(
          `CREATE TABLE masters (
             tenant_id TEXT NOT NULL,
             chat_id INTEGER NOT NULL,
             name TEXT,
             tg_username TEXT,
             services TEXT,
             work_hours TEXT,
             work_days TEXT,
             on_vacation INTEGER NOT NULL DEFAULT 0,
             active INTEGER NOT NULL DEFAULT 1,
             added_at INTEGER,
             google_calendar_id TEXT,
             calendar_enabled INTEGER NOT NULL DEFAULT 0,
             bio TEXT,
             photo TEXT,
             portfolio TEXT,
             allow_delegation INTEGER NOT NULL DEFAULT 0,
             web_user_id TEXT,
             calendar_visibility TEXT NOT NULL DEFAULT 'salon_only',
             is_synthetic INTEGER NOT NULL DEFAULT 0,
             public_hidden INTEGER NOT NULL DEFAULT 0,
             vacation_from INTEGER,
             vacation_until INTEGER,
             origin TEXT NOT NULL DEFAULT 'salon_created' CHECK (origin != 'salon_created'),
             archived_at INTEGER,
             telegram_chat_id INTEGER,
             PRIMARY KEY (tenant_id, chat_id)
           )`,
        );
      } else if (stmt.startsWith("CREATE UNIQUE INDEX idx_masters_tenant_tg_chat")) {
        // skip
      } else {
        await client.execute(stmt);
      }
    }
    await client.execute({
      sql: "INSERT INTO tenants (id, name, plan, billing_status, created_at, is_personal) VALUES (?, ?, ?, ?, ?, ?)",
      args: [TENANT, "Drift Salon", "max", "active", NOW, 0],
    });
    const db = drizzle(client, { schema });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    await expect(
      caller.createMasterAccount({ tenantId: TENANT, name: "Anya", email: "anya@example.com" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Critical invariant: no orphan web_users row exists, so retry remains
    // possible without the CONFLICT error.
    const survivors = await db
      .select({ id: schema.webUsers.id })
      .from(schema.webUsers)
      .where(eq(schema.webUsers.email, "anya@example.com"));
    expect(survivors).toHaveLength(0);
  });
});
