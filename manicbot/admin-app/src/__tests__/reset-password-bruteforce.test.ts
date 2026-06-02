/**
 * #S5-01 — password-reset VERIFY path must apply a per-EMAIL rate limit.
 *
 * resetPassword compares a 6-digit code against the stored hash. It had only a
 * per-IP limit, so an attacker rotating IPs (Tor / proxy farm) could brute the
 * code for ONE target email across its 1h TTL → account takeover. The request
 * side already has a per-email cap (#N6); this pins the same on verify.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rateLimitCalls: Array<{ key: string; action: string }> = [];
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async (_db: unknown, key: string, action: string) => {
    rateLimitCalls.push({ key, action });
    return { allowed: true, remaining: 5 };
  }),
}));
vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { WORKER_PUBLIC_URL: "https://worker.test", ADMIN_KEY: "k", AUTH_SECRET: "s" },
}));
vi.mock("~/server/email/emailService", () => ({
  sendPasswordResetCodeEmail: vi.fn(async () => ({ ok: true })),
  sendVerificationCodeEmail: vi.fn(async () => ({ ok: true })),
  sendEmailChangeCodeVerification: vi.fn(async () => ({ ok: true })),
}));
vi.mock("~/server/email/resend", () => ({ isResendConfigured: () => true }));
vi.mock("~/server/utils/notifyWorker", () => ({ notifyWorker: vi.fn(async () => undefined) }));
vi.mock("~/server/clients/marketingSync", () => ({ syncMarketingContact: vi.fn(async () => null) }));

function emptyDb() {
  const chain: any = { from: () => chain, where: () => chain, limit: () => Promise.resolve([]) };
  return { select: () => chain };
}

describe("resetPassword — per-email brute-force cap (#S5-01)", () => {
  beforeEach(() => { rateLimitCalls.length = 0; });

  it("consults a per-email rate limit (not just per-IP) on the verify path", async () => {
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { webUsersRouter } = await import("~/server/api/routers/webUsers");
    const ctx = { db: emptyDb() as never, webUser: null, headers: new Headers({ "x-forwarded-for": "9.9.9.9" }) };
    const caller = createCallerFactory(webUsersRouter)(ctx as never);

    await expect(
      caller.resetPassword({ email: "Victim@X.io", code: "000000", newPassword: "a".repeat(12) }),
    ).rejects.toThrow();

    const emailLimited = rateLimitCalls.some((c) => c.key === "victim@x.io" && /email/.test(c.action));
    expect(emailLimited).toBe(true);
  });

  it("blocks with TOO_MANY_REQUESTS once the per-email cap is exceeded", async () => {
    const { checkRateLimit } = await import("~/server/auth/rateLimit");
    (checkRateLimit as any).mockImplementation(async (_db: unknown, _key: string, action: string) =>
      /email/.test(action) ? { allowed: false, remaining: 0 } : { allowed: true, remaining: 5 },
    );
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { webUsersRouter } = await import("~/server/api/routers/webUsers");
    const ctx = { db: emptyDb() as never, webUser: null, headers: new Headers({ "x-forwarded-for": "9.9.9.9" }) };
    const caller = createCallerFactory(webUsersRouter)(ctx as never);

    await expect(
      caller.resetPassword({ email: "victim@x.io", code: "111111", newPassword: "a".repeat(12) }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
