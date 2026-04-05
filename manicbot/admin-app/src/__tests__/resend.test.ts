import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendResendEmail, isResendConfigured } from "~/server/email/resend";

describe("sendResendEmail", () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "Test <onboarding@resend.dev>";
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey;
    process.env.RESEND_FROM = originalFrom;
    vi.unstubAllGlobals();
  });

  it("returns ok on 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "msg_1" }),
      }),
    );

    const out = await sendResendEmail({
      to: "u@example.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(out).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
        }),
      }),
    );
  });

  it("returns error on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ message: "Invalid from" }),
      }),
    );

    const out = await sendResendEmail({
      to: "u@example.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(out).toEqual({ ok: false, error: "Invalid from" });
  });

  it("returns resend_not_configured when env missing", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    const out = await sendResendEmail({
      to: "u@example.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(out).toEqual({ ok: false, error: "resend_not_configured" });
  });
});

describe("isResendConfigured", () => {
  const k = process.env.RESEND_API_KEY;
  const f = process.env.RESEND_FROM;

  afterEach(() => {
    process.env.RESEND_API_KEY = k;
    process.env.RESEND_FROM = f;
  });

  it("is false without both key and from", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    expect(isResendConfigured()).toBe(false);
  });

  it("is true when both key and from are set", () => {
    process.env.RESEND_API_KEY = "re_x";
    process.env.RESEND_FROM = "A <a@b.co>";
    expect(isResendConfigured()).toBe(true);
  });
});
