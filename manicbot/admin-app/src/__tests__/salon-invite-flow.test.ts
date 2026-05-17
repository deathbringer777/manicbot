/**
 * Salon master-invitation flow — backend regression tests.
 *
 * Covers the three behaviours added when fixing the "Invite by email" sender
 * → recipient roundtrip:
 *
 *   1. sendMasterInvitation refuses to invite the caller's own email
 *      (cannot_invite_self) — historically created a useless pending row.
 *   2. sendMasterInvitation for an existing web_user writes an in-app
 *      notification via notifyWebUser so the Bell renders an entry even when
 *      email delivery is slow / spam-foldered.
 *   3. getInvitationContext exposes callerOwnsOtherTenant + callerTenantName
 *      so the accept page can render the dual-role disclaimer when the
 *      recipient already owns a separate non-personal salon.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));

vi.mock("~/server/api/tenantAccess", () => ({
  assertTenantOwner: vi.fn(async () => undefined),
}));

vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: undefined,
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
    UPLOAD_TOKEN_SECRET: undefined,
    META_VERIFY_TOKEN_WA: undefined,
    META_VERIFY_TOKEN_IG: undefined,
  },
}));

vi.mock("~/server/lib/telegramApi", () => ({
  telegramGetMe: vi.fn(),
  telegramSetWebhook: vi.fn(),
  telegramDeleteWebhook: vi.fn(),
}));

vi.mock("~/server/lib/stripe", () => ({
  getOrCreateCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
}));

vi.mock("~/server/lib/uploadToken", () => ({
  signUploadToken: vi.fn().mockResolvedValue("tok.signed"),
}));

// notifyWebUser — spy so we can assert it's called for existing_user.
const notifyWebUserMock = vi.fn(async () => ({ ok: true, id: "n_test" }));
vi.mock("~/server/services/notifyWebUser", () => ({
  notifyWebUser: (...args: unknown[]) => notifyWebUserMock(...(args as Parameters<typeof notifyWebUserMock>)),
}));

// Email senders — silenced so they don't try to contact Resend.
vi.mock("~/server/email/emailService", () => ({
  sendMasterInviteEmail: vi.fn(async () => ({ ok: true })),
  sendMasterInviteExistingUserEmail: vi.fn(async () => ({ ok: true })),
  sendMasterInviteNewUserEmail: vi.fn(async () => ({ ok: true })),
  sendMasterPasswordResetByOwnerEmail: vi.fn(async () => ({ ok: true })),
}));

// Rate-limit always allows in this suite — we test the guard logic, not
// the rate-limit fall-through.
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

// Audit and OTP — no-op so writes don't blow up.
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: vi.fn(() => null),
}));

vi.mock("~/server/auth/otp", () => ({
  requireOtpConfirmation: vi.fn(async () => undefined),
}));

// Token helpers — deterministic so the assertion shape is stable.
vi.mock("~/server/auth/tokens", () => ({
  generateToken: vi.fn(() => "raw_token_value_xx"),
  hashToken: vi.fn(async () => "tokenhash_xx"),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonRouter } from "~/server/api/routers/salon";
import { createDbMock } from "./helpers/db-mock";

const TENANT = "t_demo";

function ownerCallerWithEmail(db: any, email: string, ownerTenantId: string | null = TENANT) {
  return createCallerFactory(salonRouter)({
    db,
    webUser: {
      id: "w_owner_self",
      email,
      tenantId: ownerTenantId,
      webRole: "tenant_owner",
    },
    headers: new Headers(),
  } as never);
}

describe("salonRouter.sendMasterInvitation — self-invite guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses when target email matches caller email (case-insensitive)", async () => {
    const dbMock = createDbMock();
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    await expect(
      caller.sendMasterInvitation({ tenantId: TENANT, email: "OWNER@example.com" }),
    ).rejects.toMatchObject({ message: "cannot_invite_self" });

    // Guard must short-circuit BEFORE the tenant-row lookup — otherwise a
    // misconfigured DB mock could mask the regression.
    expect(dbMock.db.select).not.toHaveBeenCalled();
    expect(dbMock.db.insert).not.toHaveBeenCalled();
  });

  it("trims whitespace before comparing", async () => {
    const dbMock = createDbMock();
    const caller = ownerCallerWithEmail(dbMock.db, "  owner@example.com  ");

    await expect(
      caller.sendMasterInvitation({ tenantId: TENANT, email: "owner@example.com" }),
    ).rejects.toMatchObject({ message: "cannot_invite_self" });
  });

  it("allows when caller email differs from target", async () => {
    // tenant row + existingUser lookup (empty → new_user scenario).
    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "newperson@example.com",
    });
    expect(out.scenario).toBe("new_user");
  });
});

describe("salonRouter.sendMasterInvitation — bell notification for existing_user", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a Bell notification for the invitee on existing_user scenario", async () => {
    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });
    expect(out.scenario).toBe("existing_user");

    // Wait a microtask for the fire-and-forget catch chain to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(notifyWebUserMock).toHaveBeenCalledTimes(1);
    const call = notifyWebUserMock.mock.calls[0]!;
    const [, payload] = call as [unknown, Record<string, unknown>];
    expect(payload).toMatchObject({
      webUserId: "w_invitee",
      kind: "master.invite",
      tenantId: TENANT,
      sourceSlug: "master_invitations",
    });
    // Source id must be the new invitation id — idempotency contract.
    expect(typeof payload.sourceId).toBe("string");
    expect((payload.sourceId as string).length).toBeGreaterThan(0);
    expect(payload.link).toBe(`/invitations/${payload.sourceId}`);
  });

  it("does NOT write a Bell notification for new_user scenario (no web_user to notify)", async () => {
    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [], // no existing user → new_user
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "totallynew@example.com",
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(notifyWebUserMock).not.toHaveBeenCalled();
  });
});

describe("salonRouter.getInvitationContext — dual-role disclaimer detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flags callerOwnsOtherTenant when caller is tenant_owner of a different non-personal salon", async () => {
    // 1) invitation row joined to tenants for salonName
    // 2) inviter web_user lookup
    // 3) caller's own tenant lookup (different id, non-personal)
    const dbMock = createDbMock([
      [{
        id: "inv_1",
        tenantId: "t_inviter",
        email: "invitee@example.com",
        status: "pending",
        scenario: "existing_user",
        tokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
        inviterUserId: "w_inviter",
        tenantName: "Inviter Salon",
      }],
      [{ email: "inviter@example.com" }],
      [{ name: "My Own Salon", isPersonal: 0 }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "invitee@example.com", "t_my_own");

    const ctx = await caller.getInvitationContext({ invitationId: "inv_1" });

    expect(ctx).toMatchObject({
      salonName: "Inviter Salon",
      inviterEmail: "inviter@example.com",
      status: "pending",
      callerOwnsOtherTenant: true,
      callerTenantName: "My Own Salon",
      emailMatch: true,
      expired: false,
    });
  });

  it("does NOT flag dual-role when caller's own tenant is the inviting tenant", async () => {
    const dbMock = createDbMock([
      [{
        id: "inv_2",
        tenantId: "t_same",
        email: "invitee@example.com",
        status: "pending",
        scenario: "existing_user",
        tokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
        inviterUserId: "w_inviter",
        tenantName: "Same Salon",
      }],
      [{ email: "inviter@example.com" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "invitee@example.com", "t_same");

    const ctx = await caller.getInvitationContext({ invitationId: "inv_2" });

    expect(ctx.callerOwnsOtherTenant).toBe(false);
    expect(ctx.callerTenantName).toBeNull();
  });

  it("does NOT flag dual-role when caller's own tenant is personal (master single-human tenant)", async () => {
    const dbMock = createDbMock([
      [{
        id: "inv_3",
        tenantId: "t_inviter",
        email: "invitee@example.com",
        status: "pending",
        scenario: "existing_user",
        tokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
        inviterUserId: "w_inviter",
        tenantName: "Inviter Salon",
      }],
      [{ email: "inviter@example.com" }],
      [{ name: "My Personal", isPersonal: 1 }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "invitee@example.com", "t_personal");

    const ctx = await caller.getInvitationContext({ invitationId: "inv_3" });

    expect(ctx.callerOwnsOtherTenant).toBe(false);
    expect(ctx.callerTenantName).toBeNull();
  });

  it("marks emailMatch=false when caller is signed in under a different email", async () => {
    const dbMock = createDbMock([
      [{
        id: "inv_4",
        tenantId: "t_inviter",
        email: "TARGET@example.com",
        status: "pending",
        scenario: "existing_user",
        tokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
        inviterUserId: "w_inviter",
        tenantName: "Inviter Salon",
      }],
      [{ email: "inviter@example.com" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "different@example.com", null);

    const ctx = await caller.getInvitationContext({ invitationId: "inv_4" });

    expect(ctx.emailMatch).toBe(false);
    // Invitee email is returned (lowercase normalization happens at send-time,
    // not here) so the UI can prompt "sign in as TARGET@example.com".
    expect(ctx.email).toBe("TARGET@example.com");
  });

  it("flags expired=true when tokenExpiresAt is in the past", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const dbMock = createDbMock([
      [{
        id: "inv_5",
        tenantId: "t_inviter",
        email: "invitee@example.com",
        status: "pending",
        scenario: "existing_user",
        tokenExpiresAt: past,
        inviterUserId: "w_inviter",
        tenantName: "Inviter Salon",
      }],
      [{ email: "inviter@example.com" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "invitee@example.com", null);

    const ctx = await caller.getInvitationContext({ invitationId: "inv_5" });

    expect(ctx.expired).toBe(true);
  });
});
