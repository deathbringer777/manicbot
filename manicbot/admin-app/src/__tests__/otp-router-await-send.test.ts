/**
 * Phase-3 security sweep #1 — `otp.request` must AWAIT the email send.
 *
 * Pre-fix bug (otp.ts:103): `void sendActionOtpEmail(...).catch(log)`. On
 * Cloudflare Pages an un-awaited fetch is torn down the moment the request
 * handler returns its Response — so the OTP code email is frequently never
 * delivered, making archive / reset / peek-master-password unusable with no
 * signal to the UI.
 *
 * Post-fix contract:
 *   1. The mutation does NOT resolve until the send promise settles
 *      (we resolve the send from outside and assert ordering).
 *   2. A send FAILURE is surfaced in the result (`emailSent: false`), not
 *      swallowed. Success surfaces `emailSent: true`.
 *   3. `otpId` + `sentTo` are still returned (existing contract preserved).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted spies. The email service is the unit under test; requestActionOtp
// + checkRateLimit are orthogonal and are stubbed to deterministic values.
const sendSpy = vi.fn();
vi.mock("~/server/email/emailService", () => ({
  sendActionOtpEmail: (...args: unknown[]) => sendSpy(...args),
}));
vi.mock("~/server/auth/otp", () => ({
  requestActionOtp: vi.fn(async () => ({ otpId: "otp_123", code: "654321" })),
}));
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
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
import { otpRouter } from "~/server/api/routers/otp";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const callerFactory = createCallerFactory(otpRouter);

function caller() {
  // One select() call resolves the web_users.lang lookup.
  const { db } = createDbMock([[{ lang: "en" }]]);
  return callerFactory(makeTenantOwnerCtx(db, "t_otp") as never);
}

const INPUT = {
  action: "archive_master" as const,
  payload: { masterId: 1 },
  actionLabel: "Archive master Olga",
};

describe("otp.request — awaits the email send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not resolve the mutation until the send promise settles", async () => {
    // Gate the send: it stays pending until we flip `released`.
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    let sendSettled = false;
    sendSpy.mockImplementation(async () => {
      await gate;
      sendSettled = true;
      return { ok: true } as const;
    });

    const p = caller().request(INPUT as never);

    // Let microtasks drain. If the mutation were fire-and-forget it would
    // resolve here while the send is still pending.
    let resolvedEarly = false;
    void p.then(() => {
      resolvedEarly = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolvedEarly).toBe(false);
    expect(sendSettled).toBe(false);

    // Release the send; now the mutation may resolve.
    release();
    const out = await p;
    expect(sendSettled).toBe(true);
    expect(out.otpId).toBe("otp_123");
    expect(out.sentTo).toBe("owner@test.com");
  });

  it("surfaces a send FAILURE in the result (emailSent: false), not swallowed", async () => {
    sendSpy.mockResolvedValue({ ok: false, error: "resend_500" });
    const out = (await caller().request(INPUT as never)) as {
      otpId: string;
      sentTo: string;
      emailSent: boolean;
    };
    expect(out.emailSent).toBe(false);
    // The id + recipient are still returned so the UI can prompt a retry.
    expect(out.otpId).toBe("otp_123");
    expect(out.sentTo).toBe("owner@test.com");
  });

  it("reports emailSent: true on a successful send", async () => {
    sendSpy.mockResolvedValue({ ok: true });
    const out = (await caller().request(INPUT as never)) as {
      emailSent: boolean;
    };
    expect(out.emailSent).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    // Recipient (1st arg) is the caller's own email, code (2nd) is the issued code.
    expect(sendSpy.mock.calls[0]![0]).toBe("owner@test.com");
    expect(sendSpy.mock.calls[0]![1]).toBe("654321");
  });

  it("a thrown send is caught and surfaced as emailSent: false (does not reject the mutation)", async () => {
    sendSpy.mockRejectedValue(new Error("network down"));
    const out = (await caller().request(INPUT as never)) as { emailSent: boolean };
    expect(out.emailSent).toBe(false);
  });
});
