/**
 * master.peekMyOriginalPassword — master-side "show my password" procedure.
 *
 * Pins five auth/precondition gates that defend the OTP-free convenience
 * path against IDOR + state-confusion bugs. The procedure is a sibling to
 * `salon.peekMasterPassword` (owner-side, OTP-gated) — both decrypt the
 * same `web_users.password_encrypted` blob, but this one trusts the
 * master's web session as the second factor.
 *
 * Pins:
 *   1. happy path — salon-created, email-verified, vaulted blob → returns
 *      the original plaintext password.
 *   2. NOT salon_created (invited / self_registered) → FORBIDDEN, the
 *      salon never had a copy to share.
 *   3. email_verified=0 → PRECONDITION_FAILED so the UI nudges the master
 *      to confirm the address before unlocking the button.
 *   4. password_encrypted IS NULL (BOT_ENCRYPTION_KEY was missing at
 *      account-create time) → PRECONDITION_FAILED so the master is told
 *      to use the standard forgot-password flow instead of seeing a 500.
 *   5. caller resolves to a DIFFERENT master row → FORBIDDEN. This is the
 *      defense-in-depth check inside the procedure (assertCallerIsMaster
 *      already guards the IDOR but the procedure also re-checks the
 *      web_user_id binding).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

const TENANT = "t_master_peek_alpha";
const NOW = 1_780_000_100;
const VALID_KEK = "0123456789abcdef0123456789abcdef";

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
     email_verified INTEGER NOT NULL DEFAULT 0,
     password_encrypted TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     password_changed_at INTEGER NOT NULL DEFAULT 0,
     sessions_invalidated_at INTEGER NOT NULL DEFAULT 0,
     login_attempts INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE UNIQUE INDEX idx_web_user_email ON web_users(email)`,
  `CREATE TABLE masters (
     tenant_id TEXT NOT NULL,
     chat_id INTEGER NOT NULL,
     name TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     added_at INTEGER,
     web_user_id TEXT,
     is_synthetic INTEGER NOT NULL DEFAULT 0,
     origin TEXT NOT NULL DEFAULT 'salon_created',
     archived_at INTEGER,
     telegram_chat_id INTEGER,
     calendar_visibility TEXT NOT NULL DEFAULT 'salon_only',
     calendar_enabled INTEGER NOT NULL DEFAULT 0,
     allow_delegation INTEGER NOT NULL DEFAULT 0,
     public_hidden INTEGER NOT NULL DEFAULT 0,
     on_vacation INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (tenant_id, chat_id)
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

/**
 * Encrypts a string with the same primitive the procedure decrypts. Lets the
 * test seed a realistic `password_encrypted` blob without copy-pasting AES
 * code — we exercise the SAME encrypt+decrypt code path the prod flow uses.
 */
async function vaultPassword(plain: string): Promise<string> {
  const { encryptMasterPassword } = await import("~/server/security/masterPasswordVault");
  const blob = await encryptMasterPassword(plain, VALID_KEK);
  if (!blob) throw new Error("encryptMasterPassword returned null in test setup");
  return blob;
}

async function bootstrap(opts: {
  origin?: "salon_created" | "invited_email" | "self_registered";
  emailVerified?: 0 | 1;
  passwordEncrypted?: string | null;
  webUserId?: string;
  masterChatId?: number;
}) {
  const client = createClient({ url: ":memory:" });
  for (const stmt of BOOTSTRAP_SQL) await client.execute(stmt);
  await client.execute({
    sql: "INSERT INTO tenants (id, name, plan, billing_status, created_at, is_personal) VALUES (?, ?, ?, ?, ?, ?)",
    args: [TENANT, "Peek Salon", "max", "active", NOW, 0],
  });

  const masterChatId = opts.masterChatId ?? 10_500_000_001;
  const webUserId = opts.webUserId ?? "wu_master_peek_self";

  await client.execute({
    sql: `INSERT INTO web_users
            (id, email, password_hash, tenant_id, role, name, email_verified, password_encrypted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      webUserId,
      `peek.${webUserId}@salon.manicbot.local`,
      "hash$dummy",
      TENANT,
      "master",
      "Peek Master",
      opts.emailVerified ?? 1,
      opts.passwordEncrypted ?? null,
      NOW,
      NOW,
    ],
  });
  await client.execute({
    sql: `INSERT INTO masters
            (tenant_id, chat_id, name, active, added_at, web_user_id, is_synthetic, origin)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [TENANT, masterChatId, "Peek Master", 1, NOW, webUserId, 1, opts.origin ?? "salon_created"],
  });
  return { db: drizzle(client, { schema }), webUserId, masterChatId };
}

function masterCtx(db: unknown, webUserId: string) {
  return {
    db: db as never,
    webUser: {
      id: webUserId,
      email: "peek@self.test",
      tenantId: TENANT,
      webRole: "master",
    },
    headers: new Headers(),
  };
}

describe("master.peekMyOriginalPassword", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns the original password for a salon-created, verified, vaulted master", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: { BOT_ENCRYPTION_KEY: VALID_KEK, ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test-secret", TELEGRAM_BOT_TOKEN: "0:TEST" },
    }));
    const blob = await vaultPassword("HelloFromSalon99");
    const { db, webUserId, masterChatId } = await bootstrap({ passwordEncrypted: blob });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { masterRouter } = await import("~/server/api/routers/masterRouter");
    const caller = createCallerFactory(masterRouter)(masterCtx(db, webUserId) as never);

    const out = await caller.peekMyOriginalPassword({ tenantId: TENANT, masterId: masterChatId });
    expect(out.password).toBe("HelloFromSalon99");
  });

  it("rejects when origin != 'salon_created' (the salon never held the password)", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: { BOT_ENCRYPTION_KEY: VALID_KEK, ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test-secret", TELEGRAM_BOT_TOKEN: "0:TEST" },
    }));
    const blob = await vaultPassword("Doesn'tMatter");
    const { db, webUserId, masterChatId } = await bootstrap({ origin: "invited_email", passwordEncrypted: blob });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { masterRouter } = await import("~/server/api/routers/masterRouter");
    const caller = createCallerFactory(masterRouter)(masterCtx(db, webUserId) as never);

    await expect(
      caller.peekMyOriginalPassword({ tenantId: TENANT, masterId: masterChatId }),
    ).rejects.toMatchObject({ message: expect.stringContaining("not_owned_by_salon") });
  });

  it("rejects when email is not verified", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: { BOT_ENCRYPTION_KEY: VALID_KEK, ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test-secret", TELEGRAM_BOT_TOKEN: "0:TEST" },
    }));
    const blob = await vaultPassword("Pw");
    const { db, webUserId, masterChatId } = await bootstrap({ emailVerified: 0, passwordEncrypted: blob });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { masterRouter } = await import("~/server/api/routers/masterRouter");
    const caller = createCallerFactory(masterRouter)(masterCtx(db, webUserId) as never);

    await expect(
      caller.peekMyOriginalPassword({ tenantId: TENANT, masterId: masterChatId }),
    ).rejects.toMatchObject({ message: expect.stringContaining("email_not_verified") });
  });

  it("rejects when password_encrypted is NULL (no vaulted copy to decrypt)", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: { BOT_ENCRYPTION_KEY: VALID_KEK, ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test-secret", TELEGRAM_BOT_TOKEN: "0:TEST" },
    }));
    const { db, webUserId, masterChatId } = await bootstrap({ passwordEncrypted: null });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { masterRouter } = await import("~/server/api/routers/masterRouter");
    const caller = createCallerFactory(masterRouter)(masterCtx(db, webUserId) as never);

    await expect(
      caller.peekMyOriginalPassword({ tenantId: TENANT, masterId: masterChatId }),
    ).rejects.toMatchObject({ message: expect.stringContaining("password_not_vaulted") });
  });

  it("rejects when the caller's web_user_id doesn't bind to the target master (IDOR)", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: { BOT_ENCRYPTION_KEY: VALID_KEK, ADMIN_CHAT_ID: "12345", AUTH_SECRET: "test-secret", TELEGRAM_BOT_TOKEN: "0:TEST" },
    }));
    const blob = await vaultPassword("Pw");
    const { db, masterChatId } = await bootstrap({ passwordEncrypted: blob });
    // Stranger session points at the right tenant but a different web user.
    const STRANGER = "wu_stranger_caller";

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { masterRouter } = await import("~/server/api/routers/masterRouter");
    const caller = createCallerFactory(masterRouter)(masterCtx(db, STRANGER) as never);

    await expect(
      caller.peekMyOriginalPassword({ tenantId: TENANT, masterId: masterChatId }),
    ).rejects.toMatchObject({ message: expect.stringContaining("Cannot act on another master's record") });
  });
});
