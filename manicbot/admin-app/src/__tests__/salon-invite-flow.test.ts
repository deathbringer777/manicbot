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
// Return type is the union `NotifyWebUserResult`, not the narrowed
// happy-path literal — otherwise `mockResolvedValueOnce({ ok: false, id: null, ... })`
// in the PR-B bell-failure tests below fails TS inference.
type MockNotifyResult = {
  ok: boolean;
  id: string | null;
  deduped?: boolean;
  skippedByPrefs?: boolean;
  error?: string;
};
const notifyWebUserMock = vi.fn(
  async (): Promise<MockNotifyResult> => ({ ok: true, id: "n_test" }),
);
vi.mock("~/server/services/notifyWebUser", () => ({
  notifyWebUser: (...args: unknown[]) => notifyWebUserMock(...(args as Parameters<typeof notifyWebUserMock>)),
}));

// captureError — spy so we can assert the transport-failure path writes
// an error_events row. Real impl is exercised by its own unit test.
const captureErrorMock = vi.fn(async () => ({ ok: true, id: 1 }));
vi.mock("~/server/utils/captureError", () => ({
  captureError: (...args: unknown[]) => captureErrorMock(...(args as Parameters<typeof captureErrorMock>)),
}));

// Email senders — silenced so they don't try to contact Resend. Per-test
// overrides via `.mockResolvedValueOnce` simulate transport failures.
type EmailResult = { ok: true } | { ok: false; error: string };
const sendMasterInviteExistingUserEmailMock = vi.fn(async (): Promise<EmailResult> => ({ ok: true }));
const sendMasterInviteNewUserEmailMock = vi.fn(async (): Promise<EmailResult> => ({ ok: true }));
vi.mock("~/server/email/emailService", () => ({
  sendMasterInviteEmail: vi.fn(async () => ({ ok: true })),
  sendMasterInviteExistingUserEmail: (...args: unknown[]) =>
    sendMasterInviteExistingUserEmailMock(...(args as Parameters<typeof sendMasterInviteExistingUserEmailMock>)),
  sendMasterInviteNewUserEmail: (...args: unknown[]) =>
    sendMasterInviteNewUserEmailMock(...(args as Parameters<typeof sendMasterInviteNewUserEmailMock>)),
  sendMasterPasswordResetCredentialsToOwnerEmail: vi.fn(async () => ({ ok: true })),
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
    const [, payload] = call as unknown as [unknown, Record<string, unknown>];
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

describe("salonRouter.sendMasterInvitation — email transport visibility (PR-A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMasterInviteExistingUserEmailMock.mockResolvedValue({ ok: true });
    sendMasterInviteNewUserEmailMock.mockResolvedValue({ ok: true });
  });

  it("returns emailQueued=true and does NOT call captureError on existing_user happy path", async () => {
    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });

    expect(out).toMatchObject({
      scenario: "existing_user",
      emailQueued: true,
    });
    expect(out.transportError).toBeUndefined();
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("returns emailQueued=true on new_user happy path", async () => {
    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [], // no existing user → new_user
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "newperson@example.com",
    });

    expect(out).toMatchObject({
      scenario: "new_user",
      emailQueued: true,
    });
    expect(out.transportError).toBeUndefined();
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("returns emailQueued=false + transportError + calls captureError when existing_user transport fails (resend_not_configured)", async () => {
    sendMasterInviteExistingUserEmailMock.mockResolvedValueOnce({
      ok: false,
      error: "resend_not_configured",
    });

    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });

    // The invitation row is still created (idempotent). Email failure is
    // surfaced via the return value so the UI can render a yellow chip
    // instead of the misleading green toast.
    expect(out).toMatchObject({
      scenario: "existing_user",
      emailQueued: false,
      transportError: "resend_not_configured",
    });
    expect(typeof out.invitationId).toBe("string");

    // Bell row still lands — the in-app path is independent of email.
    expect(notifyWebUserMock).toHaveBeenCalledTimes(1);

    // error_events row written so operators see the misconfig in /errors.
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [, capturePayload] = captureErrorMock.mock.calls[0]! as unknown as [
      unknown,
      { errorType: string; severity: string; tenantId: string | null; context: Record<string, unknown> },
    ];
    expect(capturePayload.errorType).toBe("email.transport_failed");
    expect(capturePayload.severity).toBe("error");
    expect(capturePayload.tenantId).toBe(TENANT);
    expect(capturePayload.context).toMatchObject({
      recipient: "invitee@example.com",
      scenario: "existing_user",
      reason: "resend_not_configured",
    });
  });

  it("returns emailQueued=false + transportError + calls captureError when new_user transport fails", async () => {
    sendMasterInviteNewUserEmailMock.mockResolvedValueOnce({
      ok: false,
      error: "resend_http_500",
    });

    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [], // no existing user → new_user
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "newperson@example.com",
    });

    expect(out).toMatchObject({
      scenario: "new_user",
      emailQueued: false,
      transportError: "resend_http_500",
    });
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [, capturePayload] = captureErrorMock.mock.calls[0]! as unknown as [
      unknown,
      { errorType: string; context: Record<string, unknown> },
    ];
    expect(capturePayload.errorType).toBe("email.transport_failed");
    expect(capturePayload.context).toMatchObject({
      recipient: "newperson@example.com",
      scenario: "new_user",
      reason: "resend_http_500",
    });
  });

  it("captureError failure does NOT break the mutation (best-effort sidecar)", async () => {
    sendMasterInviteExistingUserEmailMock.mockResolvedValueOnce({
      ok: false,
      error: "resend_not_configured",
    });
    captureErrorMock.mockRejectedValueOnce(new Error("D1 unavailable"));

    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    // Mutation must still succeed — captureError is sidecar, must never throw upstream.
    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });

    expect(out).toMatchObject({
      scenario: "existing_user",
      emailQueued: false,
      transportError: "resend_not_configured",
    });
  });
});

describe("salonRouter.sendMasterInvitation — bell-write visibility (PR-B)", () => {
  // Mirror of the email-transport visibility block above. The bell write
  // is the in-app counterpart of the email send. Pre-PR-B it was
  // `void notifyWebUser(...).catch(log)` — a returned `{ok:false}` was
  // silently swallowed because `.catch()` only catches throws. On
  // Cloudflare Pages the underlying D1 binding is torn down with the
  // request context, so fire-and-forget writes that race past the
  // response are dropped. The fix awaits the write and surfaces the
  // verdict via `bellQueued / bellSkippedByPrefs / bellError`, mirroring
  // the existing `emailQueued / transportError` shape.
  beforeEach(() => {
    vi.clearAllMocks();
    sendMasterInviteExistingUserEmailMock.mockResolvedValue({ ok: true });
    sendMasterInviteNewUserEmailMock.mockResolvedValue({ ok: true });
    notifyWebUserMock.mockResolvedValue({ ok: true, id: "n_test" });
  });

  it("returns bellQueued=true and does NOT call captureError on the happy path", async () => {
    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });

    expect(out).toMatchObject({
      scenario: "existing_user",
      bellQueued: true,
    });
    expect(out.bellError).toBeUndefined();
    expect(out.bellSkippedByPrefs).toBeFalsy();
    // No captureError calls of either kind (email or bell).
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("returns bellQueued=false + bellError + calls captureError when notifyWebUser fails", async () => {
    notifyWebUserMock.mockResolvedValueOnce({
      ok: false,
      id: null,
      error: "db_insert_failed",
    });

    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });

    expect(out).toMatchObject({
      scenario: "existing_user",
      bellQueued: false,
      bellError: "db_insert_failed",
    });
    // Invitation row is still created — the bell failure must not roll back
    // the user-visible operation, only flag the in-app delivery as broken.
    expect(typeof out.invitationId).toBe("string");

    // captureError fires so the silent-fail blind spot is closed.
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    const [, capturePayload] = captureErrorMock.mock.calls[0]! as unknown as [
      unknown,
      { errorType: string; severity: string; tenantId: string | null; context: Record<string, unknown> },
    ];
    expect(capturePayload.errorType).toBe("notify.bell_write_failed");
    expect(capturePayload.severity).toBe("error");
    expect(capturePayload.tenantId).toBe(TENANT);
    expect(capturePayload.context).toMatchObject({
      webUserId: "w_invitee",
      kind: "master.invite",
      reason: "db_insert_failed",
    });
  });

  it("returns bellQueued=true + bellSkippedByPrefs=true when the invitee opted out (no captureError)", async () => {
    notifyWebUserMock.mockResolvedValueOnce({
      ok: true,
      id: null,
      skippedByPrefs: true,
    });

    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });

    expect(out).toMatchObject({
      scenario: "existing_user",
      bellQueued: true,
      bellSkippedByPrefs: true,
    });
    // Opt-out is a legitimate user choice, not an error. No captureError.
    expect(captureErrorMock).not.toHaveBeenCalled();
  });

  it("captureError failure does NOT break the mutation (best-effort sidecar)", async () => {
    notifyWebUserMock.mockResolvedValueOnce({
      ok: false,
      id: null,
      error: "db_insert_failed",
    });
    captureErrorMock.mockRejectedValueOnce(new Error("D1 unavailable"));

    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    const out = await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });

    expect(out).toMatchObject({
      scenario: "existing_user",
      bellQueued: false,
      bellError: "db_insert_failed",
    });
  });

  it("awaits notifyWebUser before returning (no fire-and-forget on the D1 binding)", async () => {
    // Regression pin: the underlying bug was `void notifyWebUser(...)` —
    // on Cloudflare Pages the request context (and the D1 binding) is
    // torn down with the response, so any in-flight insert races and
    // fails silently. The contract here is that the write is COMPLETE
    // by the time the mutation resolves.
    let resolvedBeforeReturn = false;
    notifyWebUserMock.mockImplementationOnce(async () => {
      // Simulate ~one D1 roundtrip; if the mutation didn't await us, we
      // would set this AFTER the mutation already resolved.
      await new Promise((r) => setTimeout(r, 5));
      resolvedBeforeReturn = true;
      return { ok: true, id: "n_test" };
    });

    const dbMock = createDbMock([
      [{ name: "Demo Salon", isPersonal: 0 }],
      [{ id: "w_invitee", lang: "ru" }],
    ]);
    const caller = ownerCallerWithEmail(dbMock.db, "owner@example.com");

    await caller.sendMasterInvitation({
      tenantId: TENANT,
      email: "invitee@example.com",
    });

    expect(resolvedBeforeReturn).toBe(true);
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
