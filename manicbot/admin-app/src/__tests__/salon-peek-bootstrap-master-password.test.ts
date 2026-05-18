/**
 * salon.peekMasterPassword — bootstrap-on-empty-vault path.
 *
 * Pre-change: salon-created masters whose `password_encrypted` blob was NULL
 * (account predates migration 0066, or BOT_ENCRYPTION_KEY was missing on Pages
 * env at create-time) had a permanently disabled "Show password" button. The
 * only escape was salon.resetMasterPassword, which emails the new credential
 * to the master and never reveals it to the owner.
 *
 * Post-change: when the vault is empty AND BOT_ENCRYPTION_KEY is configured,
 * peekMasterPassword generates a fresh password, hashes + encrypts both
 * columns in a single UPDATE (bumping passwordChangedAt to invalidate the
 * master's active JWT, same as a manual reset), and returns the new plaintext
 * to the salon owner with `bootstrapped: true`. A subsequent peek decrypts
 * the freshly-stored blob and returns the SAME password (no rotation on
 * second peek).
 *
 * If the encryption key is missing we still refuse: vault-less storage has
 * no recovery path and "show me a fresh password we then forget" is worse UX
 * than "configure the env var, then try again".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

// Top-level mocks are hoisted by vitest, so they apply even after a per-test
// vi.resetModules() + re-import. The OTP gate is orthogonal to the bootstrap
// behavior we are pinning here; the audit logger is fired but its write side
// effect is not under test.
vi.mock("~/server/auth/otp", () => ({
  requireOtpConfirmation: vi.fn(async () => undefined),
}));
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: () => "127.0.0.1",
}));

const TENANT = "t_salon_peek_bootstrap";
const NOW = 1_790_000_000;
const VALID_KEK = "0123456789abcdef0123456789abcdef"; // 32 chars
const MASTER_CHAT_ID = 10_700_000_001;
const MASTER_WEB_USER = "wu_master_bootstrap";
const OWNER_WEB_USER = "wu_owner_bootstrap";

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
     login_attempts INTEGER NOT NULL DEFAULT 0,
     lang TEXT
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
  `CREATE TABLE tenant_roles (
     tenant_id TEXT NOT NULL,
     web_user_id TEXT NOT NULL,
     role TEXT NOT NULL,
     created_at INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (tenant_id, web_user_id)
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

async function bootstrap(opts: { vaultBlob?: string | null } = {}) {
  const client: Client = createClient({ url: ":memory:" });
  for (const stmt of BOOTSTRAP_SQL) await client.execute(stmt);
  await client.execute({
    sql: "INSERT INTO tenants (id, name, plan, billing_status, created_at, is_personal) VALUES (?, ?, ?, ?, ?, ?)",
    args: [TENANT, "Bootstrap Salon", "max", "active", NOW, 0],
  });
  // Owner — the OTP caller.
  await client.execute({
    sql: `INSERT INTO web_users
            (id, email, password_hash, tenant_id, role, email_verified, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [OWNER_WEB_USER, "owner@bootstrap.test", "hash$dummy", TENANT, "tenant_owner", 1, NOW, NOW],
  });
  await client.execute({
    sql: `INSERT INTO tenant_roles (tenant_id, web_user_id, role, created_at) VALUES (?, ?, ?, ?)`,
    args: [TENANT, OWNER_WEB_USER, "tenant_owner", NOW],
  });
  // Master — vault may or may not be populated.
  await client.execute({
    sql: `INSERT INTO web_users
            (id, email, password_hash, tenant_id, role, email_verified, password_encrypted, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      MASTER_WEB_USER,
      "master@bootstrap.test",
      "stale$hash",
      TENANT,
      "master",
      1,
      opts.vaultBlob ?? null,
      NOW,
      NOW,
    ],
  });
  await client.execute({
    sql: `INSERT INTO masters
            (tenant_id, chat_id, name, active, added_at, web_user_id, is_synthetic, origin)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [TENANT, MASTER_CHAT_ID, "ffdfdf", 1, NOW, MASTER_WEB_USER, 1, "salon_created"],
  });
  return { db: drizzle(client, { schema }), client };
}

function ownerCtx(db: unknown) {
  return {
    db: db as never,
    webUser: {
      id: OWNER_WEB_USER,
      email: "owner@bootstrap.test",
      tenantId: TENANT,
      webRole: "tenant_owner",
    },
    headers: new Headers(),
  };
}

const COMMON_ENV = {
  ADMIN_CHAT_ID: "12345",
  AUTH_SECRET: "test-secret",
  TELEGRAM_BOT_TOKEN: "0:TEST",
  WORKER_PUBLIC_URL: "https://worker.test",
  ADMIN_KEY: "test-admin-key",
} as const;

/**
 * Pre-test setup helper — vi.resetModules() clears any prior per-test
 * vi.doMock("~/env", ...) registration, so we must re-apply it after the
 * reset. The OTP + audit mocks are top-level vi.mock (hoisted) so they
 * survive resets automatically.
 */
function applyMocks(botEncryptionKey: string) {
  vi.resetModules();
  vi.doMock("~/env", () => ({
    env: { ...COMMON_ENV, BOT_ENCRYPTION_KEY: botEncryptionKey },
  }));
}

describe("salon.peekMasterPassword — bootstrap-on-empty-vault", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("~/env");
  });

  it("with vault populated, returns the original password and does NOT mutate (no bootstrap)", async () => {
    applyMocks(VALID_KEK);
    const { encryptMasterPassword } = await import("~/server/security/masterPasswordVault");
    const blob = await encryptMasterPassword("OriginalSalonPw_1", VALID_KEK);
    expect(blob).toBeTruthy();
    const { db, client } = await bootstrap({ vaultBlob: blob! });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    const out = await caller.peekMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    });
    expect(out.password).toBe("OriginalSalonPw_1");
    expect(out.bootstrapped).not.toBe(true);

    // Vault must NOT have rotated.
    const row = await client.execute({
      sql: "SELECT password_encrypted, password_hash, password_changed_at FROM web_users WHERE id = ?",
      args: [MASTER_WEB_USER],
    });
    expect(row.rows[0]!.password_encrypted).toBe(blob);
    expect(row.rows[0]!.password_hash).toBe("stale$hash");
    expect(row.rows[0]!.password_changed_at).toBe(0);
  });

  it("with vault empty AND BOT_ENCRYPTION_KEY configured, bootstraps a fresh password and returns it", async () => {
    applyMocks(VALID_KEK);
    const { db, client } = await bootstrap({ vaultBlob: null });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    const out = await caller.peekMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    });

    // 1) Brand-new plaintext returned + flagged as bootstrapped.
    expect(typeof out.password).toBe("string");
    expect((out.password as string).length).toBeGreaterThanOrEqual(12);
    expect(out.bootstrapped).toBe(true);

    // 2) Vault is now populated with a v1$-prefixed blob.
    const row = await client.execute({
      sql: "SELECT password_encrypted, password_hash, password_changed_at FROM web_users WHERE id = ?",
      args: [MASTER_WEB_USER],
    });
    const blob = row.rows[0]!.password_encrypted as string;
    expect(typeof blob).toBe("string");
    expect(blob.startsWith("v1$")).toBe(true);

    // 3) Hash rotated AND passwordChangedAt set (invalidates active JWTs).
    expect(row.rows[0]!.password_hash).not.toBe("stale$hash");
    expect((row.rows[0]!.password_hash as string).length).toBeGreaterThan(20);
    expect(row.rows[0]!.password_changed_at).toBe(NOW);

    // 4) The vaulted blob decrypts back to the returned plaintext.
    const { decryptMasterPassword } = await import("~/server/security/masterPasswordVault");
    const decrypted = await decryptMasterPassword(blob, VALID_KEK);
    expect(decrypted).toBe(out.password);
  });

  it("second peek after bootstrap returns the SAME password (read-only path)", async () => {
    applyMocks(VALID_KEK);
    const { db } = await bootstrap({ vaultBlob: null });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    const first = await caller.peekMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    });
    const second = await caller.peekMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    });
    expect(second.password).toBe(first.password);
    expect(first.bootstrapped).toBe(true);
    expect(second.bootstrapped).not.toBe(true);
  });

  it("with vault empty AND BOT_ENCRYPTION_KEY missing, refuses with password_not_vaulted (cannot persist)", async () => {
    applyMocks("");
    const { db } = await bootstrap({ vaultBlob: null });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    await expect(
      caller.peekMasterPassword({
        tenantId: TENANT,
        masterChatId: MASTER_CHAT_ID,
        otpCode: "000000",
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("password_not_vaulted") });
  });
});
