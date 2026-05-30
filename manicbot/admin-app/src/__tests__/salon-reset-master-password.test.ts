/**
 * salon.resetMasterPassword — owner-recipient routing.
 *
 * Pre-fix bug: the new password was emailed to the master's `web_users.email`.
 * For `origin='salon_created'` accounts that's the synthetic
 * `*.salon.manicbot.local` mailbox (no one accepts mail there), so the new
 * password disappeared and the master could not log in.
 *
 * Post-fix contract:
 *   1. Recipient = `ctx.webUser.email` (the SALON OWNER who triggered the
 *      reset), not the master's stored email.
 *   2. Email template carries the master's name + their LOGIN email
 *      (synthetic) so the owner knows what to hand to the master.
 *   3. `emailSentTo` in the response is the owner's masked address.
 *   4. Audit log notes "emailed to owner, not master".
 *   5. Existing precondition refusals are unchanged
 *      (`not_owned_by_salon`, `master_has_no_web_user`).
 *
 * Built on the same libsql in-memory pattern as
 * salon-peek-bootstrap-master-password.test.ts so the SQL — including the
 * (joined) lookup of master name + lang — is exercised for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

// Hoisted mocks — OTP is orthogonal to the routing we're pinning here; the
// audit log write side effect is not under test. Email service is replaced
// with a spy so we can pin the recipient.
vi.mock("~/server/auth/otp", () => ({
  requireOtpConfirmation: vi.fn(async () => undefined),
}));
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: () => "127.0.0.1",
}));

// Hoisted shared spy so individual tests can read the calls. Vitest hoists
// vi.mock factories above any `import`, so the spy must be declared inline
// in the factory and exposed via dynamic import later.
vi.mock("~/server/email/emailService", () => {
  const sendMasterPasswordResetCredentialsToOwnerEmail = vi.fn(async () => ({
    ok: true,
  }));
  const sendMasterInviteEmail = vi.fn(async () => undefined);
  return {
    sendMasterPasswordResetCredentialsToOwnerEmail,
    sendMasterInviteEmail,
    // Defensive: the old function name should NOT exist on the module after
    // the rename. If we leave a stub here, a forgotten import in salon.ts
    // would silently pass — by NOT exporting it, an old-name import would
    // throw at module-init time (caught by typecheck).
  };
});

const TENANT = "t_salon_reset_owner";
const NOW = 1_715_000_000;
const VALID_KEK = "0123456789abcdef0123456789abcdef"; // 32 chars
const MASTER_CHAT_ID = 10_900_000_001;
const MASTER_WEB_USER = "wu_master_reset";
const OWNER_WEB_USER = "wu_owner_reset";
const OWNER_EMAIL = "owner@real.com";
const MASTER_SYNTHETIC_EMAIL = "olga.09di@salon.manicbot.local";
const MASTER_NAME = "Ольга";
const SALON_NAME = "Bella Nails";

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

interface BootstrapOpts {
  origin?: "salon_created" | "self_registered" | "invited_email" | "invited_telegram";
  webUserId?: string | null;
  ownerLang?: string;
}

async function bootstrap(opts: BootstrapOpts = {}) {
  const origin = opts.origin ?? "salon_created";
  const webUserId = opts.webUserId === undefined ? MASTER_WEB_USER : opts.webUserId;
  const ownerLang = opts.ownerLang ?? "ru";
  const client: Client = createClient({ url: ":memory:" });
  for (const stmt of BOOTSTRAP_SQL) await client.execute(stmt);
  await client.execute({
    sql: "INSERT INTO tenants (id, name, plan, billing_status, created_at, is_personal) VALUES (?, ?, ?, ?, ?, ?)",
    args: [TENANT, SALON_NAME, "max", "active", NOW, 0],
  });
  // Owner — the OTP caller, also the email recipient post-fix.
  await client.execute({
    sql: `INSERT INTO web_users
            (id, email, password_hash, tenant_id, role, email_verified, lang, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [OWNER_WEB_USER, OWNER_EMAIL, "owner$hash", TENANT, "tenant_owner", 1, ownerLang, NOW, NOW],
  });
  await client.execute({
    sql: `INSERT INTO tenant_roles (tenant_id, web_user_id, role, created_at) VALUES (?, ?, ?, ?)`,
    args: [TENANT, OWNER_WEB_USER, "tenant_owner", NOW],
  });
  // Master row + optional linked web_user (synthetic email).
  if (webUserId) {
    await client.execute({
      sql: `INSERT INTO web_users
              (id, email, password_hash, tenant_id, role, email_verified, lang, password_encrypted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        webUserId,
        MASTER_SYNTHETIC_EMAIL,
        "stale$hash",
        TENANT,
        "master",
        1,
        // Master lang stored but intentionally DIFFERENT from owner so the test
        // can pin that the email uses the OWNER's lang, not the master's.
        "en",
        null,
        NOW,
        NOW,
      ],
    });
  }
  await client.execute({
    sql: `INSERT INTO masters
            (tenant_id, chat_id, name, active, added_at, web_user_id, is_synthetic, origin)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [TENANT, MASTER_CHAT_ID, MASTER_NAME, 1, NOW, webUserId, 1, origin],
  });
  return { db: drizzle(client, { schema }), client };
}

function ownerCtx(db: unknown) {
  return {
    db: db as never,
    webUser: {
      id: OWNER_WEB_USER,
      email: OWNER_EMAIL,
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

function applyMocks() {
  vi.resetModules();
  vi.doMock("~/env", () => ({
    env: { ...COMMON_ENV, BOT_ENCRYPTION_KEY: VALID_KEK },
  }));
}

describe("salon.resetMasterPassword — routes new password to OWNER, not master synthetic mailbox", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("happy path — recipient is OWNER email, payload carries master name + master login", async () => {
    applyMocks();
    const { db } = await bootstrap();

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const emailService = await import("~/server/email/emailService");
    const sendSpy =
      emailService.sendMasterPasswordResetCredentialsToOwnerEmail as ReturnType<
        typeof vi.fn
      >;

    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);
    const out = await caller.resetMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    });

    expect(out.ok).toBe(true);
    // emailSentTo is the OWNER's masked email, NOT the master's synthetic.
    expect(out.emailSentTo).toMatch(/^o\*\*\*[^.]*@real\.com$|o\*\*\*r@real\.com/);
    expect(out.emailSentTo).not.toContain("salon.manicbot.local");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const call = sendSpy.mock.calls[0]!;
    // Recipient (1st arg) = OWNER, not master.
    expect(call[0]).toBe(OWNER_EMAIL);
    expect(call[0]).not.toBe(MASTER_SYNTHETIC_EMAIL);
    // Master name carried for the email body.
    expect(call[1]).toBe(MASTER_NAME);
    // Master LOGIN (synthetic email) carried so the owner can hand it to the master.
    expect(call[2]).toBe(MASTER_SYNTHETIC_EMAIL);
    // New password is a non-empty string.
    expect(typeof call[3]).toBe("string");
    expect((call[3] as string).length).toBeGreaterThanOrEqual(12);
    // Salon name carried.
    expect(call[4]).toBe(SALON_NAME);
    // Lang = OWNER's lang ("ru" from bootstrap), NOT master's ("en").
    expect(call[5]).toBe("ru");
  });

  it("uses owner's lang ('pl'), not the master's stored lang", async () => {
    applyMocks();
    const { db } = await bootstrap({ ownerLang: "pl" });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const emailService = await import("~/server/email/emailService");
    const sendSpy =
      emailService.sendMasterPasswordResetCredentialsToOwnerEmail as ReturnType<
        typeof vi.fn
      >;

    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);
    await caller.resetMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    });

    expect(sendSpy.mock.calls[0]![5]).toBe("pl");
  });

  it("writes a fresh password_hash + password_encrypted to the master web_user (login keeps working)", async () => {
    applyMocks();
    const { db, client } = await bootstrap();

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);

    await caller.resetMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    });

    const row = await client.execute({
      sql: "SELECT password_hash, password_encrypted, password_changed_at FROM web_users WHERE id = ?",
      args: [MASTER_WEB_USER],
    });
    // Hash rotated (was 'stale$hash').
    expect(row.rows[0]!.password_hash).not.toBe("stale$hash");
    expect((row.rows[0]!.password_hash as string).length).toBeGreaterThan(20);
    // Vault populated.
    const blob = row.rows[0]!.password_encrypted as string;
    expect(typeof blob).toBe("string");
    expect(blob.startsWith("v1$")).toBe(true);
    // JWT invalidated.
    expect(row.rows[0]!.password_changed_at).toBe(NOW);
  });

  it("refuses when master.origin is not 'salon_created' (account belongs to the master)", async () => {
    applyMocks();
    const { db } = await bootstrap({ origin: "self_registered" });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const emailService = await import("~/server/email/emailService");
    const sendSpy =
      emailService.sendMasterPasswordResetCredentialsToOwnerEmail as ReturnType<
        typeof vi.fn
      >;

    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);
    await expect(
      caller.resetMasterPassword({
        tenantId: TENANT,
        masterChatId: MASTER_CHAT_ID,
        otpCode: "000000",
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("not_owned_by_salon") });
    // Nothing should be sent on the refused path.
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("refuses when master.webUserId is NULL (no linked auth identity)", async () => {
    applyMocks();
    const { db } = await bootstrap({ webUserId: null });

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const emailService = await import("~/server/email/emailService");
    const sendSpy =
      emailService.sendMasterPasswordResetCredentialsToOwnerEmail as ReturnType<
        typeof vi.fn
      >;

    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);
    await expect(
      caller.resetMasterPassword({
        tenantId: TENANT,
        masterChatId: MASTER_CHAT_ID,
        otpCode: "000000",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("master_has_no_web_user"),
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("#2 — AWAITS the send and surfaces emailSent: true on success", async () => {
    applyMocks();
    const { db } = await bootstrap();

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");

    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);
    const out = (await caller.resetMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    })) as { ok: boolean; emailSentTo: string; emailSent: boolean };

    // The default emailService mock resolves { ok: true }.
    expect(out.ok).toBe(true);
    expect(out.emailSent).toBe(true);
  });

  it("#2 — surfaces emailSent: false + transportError when the send fails (rotation kept)", async () => {
    applyMocks();
    const { db, client } = await bootstrap();

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const emailService = await import("~/server/email/emailService");
    const sendSpy =
      emailService.sendMasterPasswordResetCredentialsToOwnerEmail as ReturnType<
        typeof vi.fn
      >;
    // Force a transport failure on this run.
    sendSpy.mockResolvedValueOnce({ ok: false, error: "resend_500" });

    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);
    const out = (await caller.resetMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    })) as {
      ok: boolean;
      emailSentTo: string;
      emailSent: boolean;
      transportError?: string | null;
    };

    // Mutation still resolves ok=true — the password WAS rotated; only the
    // delivery failed. The UI must be told so the owner can re-issue.
    expect(out.ok).toBe(true);
    expect(out.emailSent).toBe(false);
    expect(out.transportError).toBe("resend_500");

    // The rotation must have happened regardless of the email outcome.
    const row = await client.execute({
      sql: "SELECT password_hash, password_changed_at FROM web_users WHERE id = ?",
      args: [MASTER_WEB_USER],
    });
    expect(row.rows[0]!.password_hash).not.toBe("stale$hash");
    expect(row.rows[0]!.password_changed_at).toBe(NOW);
  });

  it("audit log note reflects owner-routed delivery (not master)", async () => {
    applyMocks();
    const { db } = await bootstrap();

    const { createCallerFactory } = await import("~/server/api/trpc");
    const { salonRouter } = await import("~/server/api/routers/salon");
    const audit = await import("~/server/security/audit");
    const writeSpy = audit.writeAudit as ReturnType<typeof vi.fn>;

    const caller = createCallerFactory(salonRouter)(ownerCtx(db) as never);
    await caller.resetMasterPassword({
      tenantId: TENANT,
      masterChatId: MASTER_CHAT_ID,
      otpCode: "000000",
    });

    expect(writeSpy).toHaveBeenCalled();
    const auditCall = writeSpy.mock.calls.find(
      (c) => (c[1] as { action: string }).action === "tenant.master.password.reset",
    );
    expect(auditCall).toBeTruthy();
    const detail = (auditCall![1] as { detail: string }).detail;
    expect(detail).toMatch(/owner/i);
  });
});
