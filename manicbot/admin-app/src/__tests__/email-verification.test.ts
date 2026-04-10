/**
 * Comprehensive tests for the email verification flow.
 * Pure logic — no D1 dependency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verificationCodeEmailHtml, getEmailCopy } from "~/server/email/templates";
import { sendVerificationCodeEmail } from "~/server/email/emailService";

// ── generateVerificationCode logic ────────────────────────────────────────────

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

describe("generateVerificationCode", () => {
  it("returns a string of exactly 6 characters", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateVerificationCode()).toHaveLength(6);
    }
  });

  it("contains only digit characters", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it("is always >= 100000", () => {
    for (let i = 0; i < 50; i++) {
      expect(Number(generateVerificationCode())).toBeGreaterThanOrEqual(100000);
    }
  });

  it("is always <= 999999", () => {
    for (let i = 0; i < 50; i++) {
      expect(Number(generateVerificationCode())).toBeLessThanOrEqual(999999);
    }
  });

  it("generates unique codes most of the time (not constant)", () => {
    const codes = new Set(Array.from({ length: 100 }, generateVerificationCode));
    // With 100 samples from a 900k range, we should easily get 90+ unique values
    expect(codes.size).toBeGreaterThan(90);
  });
});

// ── Constant-time XOR comparison logic ───────────────────────────────────────

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

describe("constant-time code comparison", () => {
  it("returns true for identical codes", () => {
    expect(constantTimeEquals("123456", "123456")).toBe(true);
  });

  it("returns false for different codes", () => {
    expect(constantTimeEquals("123456", "654321")).toBe(false);
  });

  it("returns false when one digit differs", () => {
    expect(constantTimeEquals("123456", "123457")).toBe(false);
  });

  it("returns false for length mismatch", () => {
    expect(constantTimeEquals("123456", "12345")).toBe(false);
    expect(constantTimeEquals("12345", "123456")).toBe(false);
  });

  it("returns false for empty vs code", () => {
    expect(constantTimeEquals("", "123456")).toBe(false);
    expect(constantTimeEquals("123456", "")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEquals("", "")).toBe(true);
  });
});

// ── Token expiration logic ────────────────────────────────────────────────────

function isTokenExpired(expiresAt: number | null, nowSeconds: number): boolean {
  if (!expiresAt) return false; // no expiry set → not expired
  return nowSeconds > expiresAt;
}

describe("token expiration", () => {
  const now = Math.floor(Date.now() / 1000);

  it("is not expired when expiresAt is in the future", () => {
    const expiresAt = now + 900; // 15 min from now
    expect(isTokenExpired(expiresAt, now)).toBe(false);
  });

  it("is expired when expiresAt is in the past", () => {
    const expiresAt = now - 1;
    expect(isTokenExpired(expiresAt, now)).toBe(true);
  });

  it("is expired exactly when now === expiresAt + 1", () => {
    const expiresAt = now - 1;
    expect(isTokenExpired(expiresAt, expiresAt + 1)).toBe(true);
  });

  it("is not expired when expiresAt === now", () => {
    // boundary: now > expiresAt is false when they are equal
    expect(isTokenExpired(now, now)).toBe(false);
  });

  it("is not expired when expiresAt is null", () => {
    expect(isTokenExpired(null, now)).toBe(false);
  });
});

// ── In-memory rate limiter logic ──────────────────────────────────────────────

function makeRateLimiter(max: number, windowMs: number) {
  const map = new Map<string, { count: number; resetAt: number }>();
  return function check(key: string, nowMs = Date.now()): boolean {
    const entry = map.get(key);
    if (!entry || nowMs > entry.resetAt) {
      map.set(key, { count: 1, resetAt: nowMs + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}

describe("rate limiter", () => {
  it("allows first request", () => {
    const rl = makeRateLimiter(3, 600_000);
    expect(rl("user@example.com")).toBe(true);
  });

  it("allows up to max requests", () => {
    const rl = makeRateLimiter(3, 600_000);
    expect(rl("a@b.com")).toBe(true);
    expect(rl("a@b.com")).toBe(true);
    expect(rl("a@b.com")).toBe(true);
  });

  it("blocks the (max+1)th request", () => {
    const rl = makeRateLimiter(3, 600_000);
    rl("a@b.com");
    rl("a@b.com");
    rl("a@b.com");
    expect(rl("a@b.com")).toBe(false);
  });

  it("resets after the window expires", () => {
    const rl = makeRateLimiter(3, 1000);
    const t0 = Date.now();
    rl("a@b.com", t0);
    rl("a@b.com", t0);
    rl("a@b.com", t0);
    // Still blocked at t0 + 999
    expect(rl("a@b.com", t0 + 999)).toBe(false);
    // Allowed again at t0 + 1001 (after window reset)
    expect(rl("a@b.com", t0 + 1001)).toBe(true);
  });

  it("different keys are tracked independently", () => {
    const rl = makeRateLimiter(1, 600_000);
    expect(rl("a@b.com")).toBe(true);
    expect(rl("c@d.com")).toBe(true); // different key, not blocked
    expect(rl("a@b.com")).toBe(false); // same key, now blocked
  });
});

// ── Email templates ───────────────────────────────────────────────────────────

describe("verificationCodeEmailHtml", () => {
  it("includes the full code in the output as a single block", () => {
    const html = verificationCodeEmailHtml("847291", "en");
    expect(html).toContain("847291");
  });

  it("renders for all 4 supported languages without throwing", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(() => verificationCodeEmailHtml("123456", lang)).not.toThrow();
    }
  });

  it("returns a non-empty HTML string", () => {
    const html = verificationCodeEmailHtml("999999", "ru");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(50);
    expect(html).toContain("<");
  });

  it("includes ManicBot branding", () => {
    const html = verificationCodeEmailHtml("123456", "en");
    expect(html.toLowerCase()).toContain("manicbot");
  });
});

describe("getEmailCopy — verificationCode subjects", () => {
  it("ru subject contains ManicBot", () => {
    expect(getEmailCopy("ru").verificationCode.subject).toContain("ManicBot");
  });

  it("ua subject contains ManicBot", () => {
    expect(getEmailCopy("ua").verificationCode.subject).toContain("ManicBot");
  });

  it("en subject contains ManicBot", () => {
    expect(getEmailCopy("en").verificationCode.subject).toContain("ManicBot");
  });

  it("pl subject contains ManicBot", () => {
    expect(getEmailCopy("pl").verificationCode.subject).toContain("ManicBot");
  });

  it("all 4 subjects are non-empty strings", () => {
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      const subject = getEmailCopy(lang).verificationCode.subject;
      expect(typeof subject).toBe("string");
      expect(subject.length).toBeGreaterThan(5);
    }
  });
});

// ── sendVerificationCodeEmail (Resend integration) ───────────────────────────

describe("sendVerificationCodeEmail", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "ManicBot <noreply@manicbot.com>";
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey;
    process.env.RESEND_FROM = originalFrom;
    vi.unstubAllGlobals();
  });

  it("calls Resend with correct subject for 'en'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "msg_1" }) }),
    );
    const result = await sendVerificationCodeEmail("user@example.com", "123456", "en");
    expect(result).toEqual({ ok: true });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.subject).toContain("ManicBot");
    expect(body.html).toContain("123456");
    expect(body.to).toEqual(["user@example.com"]);
  });

  it("calls Resend with correct subject for 'ru'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "msg_2" }) }),
    );
    const result = await sendVerificationCodeEmail("user@example.com", "654321", "ru");
    expect(result).toEqual({ ok: true });
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as string);
    expect(body.subject).toMatch(/ManicBot/);
    expect(body.html).toContain("654321");
  });

  it("returns ok:false when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const result = await sendVerificationCodeEmail("u@example.com", "111111", "en");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe("resend_not_configured");
  });

  it("returns ok:false when Resend returns HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ message: "domain not verified" }),
      }),
    );
    const result = await sendVerificationCodeEmail("u@example.com", "222222", "en");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toBe("domain not verified");
  });
});

// ── Full verification flow simulation ────────────────────────────────────────

describe("full email verification flow (pure logic)", () => {
  interface FakeUser {
    emailVerified: number;
    verificationToken: string | null;
    verificationTokenExpiresAt: number | null;
  }

  function simulateResend(user: FakeUser, code: string, nowSeconds: number): FakeUser {
    const expiresAt = nowSeconds + 15 * 60;
    return { ...user, verificationToken: code, verificationTokenExpiresAt: expiresAt };
  }

  function simulateVerify(
    user: FakeUser,
    inputCode: string,
    nowSeconds: number,
  ): { ok: boolean; error?: string } {
    if (user.emailVerified) return { ok: true }; // already verified
    if (!user.verificationToken) return { ok: false, error: "no_code_pending" };
    if (user.verificationTokenExpiresAt && nowSeconds > user.verificationTokenExpiresAt) {
      return { ok: false, error: "code_expired" };
    }
    if (!constantTimeEquals(user.verificationToken, inputCode)) {
      return { ok: false, error: "invalid_code" };
    }
    return { ok: true };
  }

  const now = Math.floor(Date.now() / 1000);

  it("correct code verifies successfully", () => {
    let user: FakeUser = { emailVerified: 0, verificationToken: null, verificationTokenExpiresAt: null };
    user = simulateResend(user, "481620", now);
    expect(simulateVerify(user, "481620", now)).toEqual({ ok: true });
  });

  it("wrong code is rejected", () => {
    let user: FakeUser = { emailVerified: 0, verificationToken: null, verificationTokenExpiresAt: null };
    user = simulateResend(user, "481620", now);
    const result = simulateVerify(user, "000000", now);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_code");
  });

  it("expired code is rejected", () => {
    let user: FakeUser = { emailVerified: 0, verificationToken: null, verificationTokenExpiresAt: null };
    user = simulateResend(user, "481620", now - 1000); // set as if issued 1000s ago
    const result = simulateVerify(user, "481620", now);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("code_expired");
  });

  it("already-verified user always passes", () => {
    const user: FakeUser = { emailVerified: 1, verificationToken: null, verificationTokenExpiresAt: null };
    expect(simulateVerify(user, "anycode", now)).toEqual({ ok: true });
  });

  it("no code pending is rejected", () => {
    const user: FakeUser = { emailVerified: 0, verificationToken: null, verificationTokenExpiresAt: null };
    const result = simulateVerify(user, "481620", now);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_code_pending");
  });

  it("resending before expiry replaces the old code", () => {
    let user: FakeUser = { emailVerified: 0, verificationToken: null, verificationTokenExpiresAt: null };
    user = simulateResend(user, "111111", now);
    user = simulateResend(user, "222222", now + 1);
    // Old code should no longer work
    expect(simulateVerify(user, "111111", now + 1).ok).toBe(false);
    // New code works
    expect(simulateVerify(user, "222222", now + 1)).toEqual({ ok: true });
  });
});
