/**
 * Phase 2 cleanup: orphan-router pin for `webUsersRouter`.
 *
 * webUsers handles credential operations (register / verifyEmail /
 * requestPasswordReset / resetPassword / changePassword / setInitialPassword)
 * AND tenant-scoped UI prefs storage. Pins the auth gates + zod input
 * boundaries for the most security-relevant procedures:
 *   - register: email-shape + min-12 password + role enum + ToS acceptance
 *   - verifyEmail: 6-char code length
 *   - changePassword: protectedProcedure gate
 *   - setMyUiPrefs: tenant-membership scoping + 8KB byte cap
 *   - getMyUiPrefs: cross-tenant IDOR refusal
 *
 * Detailed credential flow happens against real D1 in
 * `web-user-credentials.test.ts` and friends.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { webUsersRouter } from "~/server/api/routers/webUsers";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const callerFactory = createCallerFactory(webUsersRouter);

describe("webUsers.register — input validation (zod boundary)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects malformed email", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.register({
        email: "not-an-email",
        password: "very-long-password-string",
        role: "tenant_owner",
        lang: "en",
        tosAccepted: true,
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects password shorter than 12 chars", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.register({
        email: "user@example.com",
        password: "short",
        role: "tenant_owner",
        lang: "en",
        tosAccepted: true,
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects role outside the {tenant_owner, master} enum", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.register({
        email: "user@example.com",
        password: "valid-long-password",
        // @ts-expect-error — intentionally invalid role
        role: "system_admin",
        lang: "en",
        tosAccepted: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects when tosAccepted is not literal true", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.register({
        email: "user@example.com",
        password: "valid-long-password",
        role: "tenant_owner",
        lang: "en",
        // @ts-expect-error — intentionally false
        tosAccepted: false,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects lang outside the {ru, ua, en, pl} enum", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.register({
        email: "user@example.com",
        password: "valid-long-password",
        role: "tenant_owner",
        // @ts-expect-error — intentionally invalid lang
        lang: "de",
        tosAccepted: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webUsers.verifyEmail — input validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects code of wrong length (not 6 chars)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.verifyEmail({ email: "user@example.com", code: "12345" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.verifyEmail({ email: "user@example.com", code: "1234567" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects malformed email", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.verifyEmail({ email: "bogus", code: "123456" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webUsers.changePassword — protectedProcedure gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.changePassword({
        currentPassword: "x",
        newPassword: "valid-long-password",
        otpCode: "123456",
      } as never),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("webUsers.changePassword — email-OTP gate (sensitive action)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an otpCode (input boundary)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_demo") as never);
    await expect(
      caller.changePassword({
        currentPassword: "current-pw",
        newPassword: "a-valid-long-password",
        // otpCode intentionally omitted
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects when no matching OTP was issued (otp_required)", async () => {
    // Empty DB → the global_otp_codes lookup finds nothing → PRECONDITION_FAILED.
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_demo") as never);
    await expect(
      caller.changePassword({
        currentPassword: "current-pw",
        newPassword: "a-valid-long-password",
        otpCode: "123456",
      } as never),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("source pin: gated via requireOtpConfirmation(action: change_password)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../server/api/routers/webUsers.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /requireOtpConfirmation\(\{[\s\S]*?action:\s*"change_password"/,
    );
  });
});

describe("webUsers email change — single OTP to the current address", () => {
  beforeEach(() => vi.clearAllMocks());

  // Unified with password/role: ONE 6-digit code, issued via the shared
  // global_otp_codes framework and emailed to the CURRENT account address.
  // No separate new-address code, no bespoke emailChangeToken mechanism — the
  // payload binds the code to the requested newEmail so it can't be reused for
  // a different target.
  it("confirmEmailChange requires both newEmail and otpCode (input boundary)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_demo") as never);
    await expect(
      caller.confirmEmailChange({ newEmail: "new@example.com" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("confirmEmailChange passes auth + input and enters the handler (OTP enforced downstream)", async () => {
    // confirmEmailChange runs the IP rate-limit before the OTP check, and the
    // shared db-mock doesn't implement Drizzle's `.run()` (see otp-router.test
    // for the same idiom) — so we can't reach the OTP path through the mock.
    // We assert the call cleared the protected gate + zod boundary and entered
    // the handler. The actual "no OTP → PRECONDITION_FAILED" behavior of the
    // shared requireOtpConfirmation helper is proven by the changePassword test
    // above (no pre-OTP rate-limit), and the source-pin below proves
    // confirmEmailChange routes through that same helper for action change_email.
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_demo") as never);
    try {
      await caller.confirmEmailChange({ newEmail: "new@example.com", otpCode: "123456" } as never);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      expect(code).not.toBe("UNAUTHORIZED");
      expect(code).not.toBe("BAD_REQUEST");
    }
  });

  it("source pin: requestEmailChange issues a change_email OTP to the current email (no legacy sender)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../server/api/routers/webUsers.ts"),
      "utf8",
    );
    expect(src).toMatch(/requestActionOtp\(\{[\s\S]*?action:\s*"change_email"/);
    expect(src).toMatch(/sendActionOtpEmail\(/);
    // The parallel bespoke email-code mechanism is gone — no duplication.
    expect(src).not.toMatch(/sendEmailChangeCodeVerification/);
  });

  it("source pin: confirmEmailChange verifies via requireOtpConfirmation(change_email), not emailChangeToken", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../server/api/routers/webUsers.ts"),
      "utf8",
    );
    expect(src).toMatch(/requireOtpConfirmation\(\{[\s\S]*?action:\s*"change_email"/);
    expect(src).not.toMatch(/emailChangeTokenHash/);
  });
});

describe("webUsers.setMyUiPrefs — auth + tenant scoping + size cap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.setMyUiPrefs({ tenantId: "t_x", prefs: {} } as never),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects cross-tenant writes (tenant_owner of t_a → write to t_b)", async () => {
    // assertTenantMember queries webUsers + tenants; supply mismatched rows.
    const { db } = createDbMock([
      [],
    ]);
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.setMyUiPrefs({ tenantId: "t_b", prefs: { theme: "dark" } } as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects payloads over 8 KB", async () => {
    // First select returns a member row → assertTenantMember passes.
    // Then setMyUiPrefs computes serialized size and refuses.
    const { db } = createDbMock([
      [{ tenantId: "t_a", webUserId: "w_owner" }],
    ]);
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_a") as never);
    const huge = { a: "x".repeat(10000) };
    await expect(
      caller.setMyUiPrefs({ tenantId: "t_a", prefs: huge } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("webUsers.getMyUiPrefs — cross-tenant IDOR refused", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when caller's tenant doesn't match the requested tenantId", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFactory(makeTenantOwnerCtx(db, "t_a") as never);
    await expect(
      caller.getMyUiPrefs({ tenantId: "t_b" } as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("webUsers.list — adminProcedure gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers (UNAUTHORIZED)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(caller.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects masters", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeMasterCtx(db, "t") as never);
    await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects tenant_owners (admin-only)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(caller.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin reaches the procedure (db-mock returns empty list)", async () => {
    const { db } = createDbMock([[]]);
    const caller = callerFactory(makeAdminCtx(db) as never);
    const result = await caller.list();
    expect(Array.isArray(result)).toBe(true);
  });
});
