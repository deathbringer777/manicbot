import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendBrevoEmail,
  sendBrevoSms,
  checkBrevoHealth,
  isBrevoConfigured,
  isBrevoSmsConfigured,
  parseFromAddress,
} from "~/server/email/brevo";

describe("parseFromAddress", () => {
  it("parses Name <addr> form", () => {
    expect(parseFromAddress("ManicBot <noreply@manicbot.com>")).toEqual({
      name: "ManicBot",
      email: "noreply@manicbot.com",
    });
  });
  it("handles bare address", () => {
    expect(parseFromAddress("noreply@manicbot.com")).toEqual({
      email: "noreply@manicbot.com",
    });
  });
  it("handles empty name", () => {
    expect(parseFromAddress("<noreply@manicbot.com>")).toEqual({
      email: "noreply@manicbot.com",
    });
  });
});

describe("sendBrevoEmail", () => {
  const origKey = process.env.BREVO_API_KEY;
  const origFrom = process.env.BREVO_FROM;

  beforeEach(() => {
    process.env.BREVO_API_KEY = "xkeysib-test";
    process.env.BREVO_FROM = "ManicBot <noreply@manicbot.com>";
  });
  afterEach(() => {
    process.env.BREVO_API_KEY = origKey;
    process.env.BREVO_FROM = origFrom;
    vi.unstubAllGlobals();
  });

  it("returns ok with messageId on 201 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "<202604181200.abc@smtp-relay.mailin.fr>" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await sendBrevoEmail({
      to: "u@example.com",
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(out).toEqual({
      ok: true,
      messageId: "<202604181200.abc@smtp-relay.mailin.fr>",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "api-key": "xkeysib-test" }),
      }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body).toEqual({
      sender: { email: "noreply@manicbot.com", name: "ManicBot" },
      to: [{ email: "u@example.com" }],
      subject: "Hi",
      htmlContent: "<p>x</p>",
    });
  });

  it("passes optional toName and tags through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: "id-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendBrevoEmail({
      to: "u@example.com",
      toName: "Mr U",
      subject: "Hi",
      html: "<p>x</p>",
      tags: ["campaign-1", "welcome"],
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.to).toEqual([{ email: "u@example.com", name: "Mr U" }]);
    expect(body.tags).toEqual(["campaign-1", "welcome"]);
  });

  it("returns error on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ code: "invalid_parameter", message: "Invalid sender" }),
      }),
    );

    const out = await sendBrevoEmail({
      to: "u@example.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(out).toEqual({ ok: false, error: "Invalid sender" });
  });

  it("returns brevo_not_configured when env missing", async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_FROM;
    const out = await sendBrevoEmail({
      to: "u@example.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(out).toEqual({ ok: false, error: "brevo_not_configured" });
  });

  it("returns error on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("boom")),
    );
    const out = await sendBrevoEmail({
      to: "u@example.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(out).toEqual({ ok: false, error: "boom" });
  });
});

describe("sendBrevoSms", () => {
  const origKey = process.env.BREVO_API_KEY;
  const origSender = process.env.BREVO_SMS_SENDER;

  beforeEach(() => {
    process.env.BREVO_API_KEY = "xkeysib-test";
    process.env.BREVO_SMS_SENDER = "ManicBot";
  });
  afterEach(() => {
    process.env.BREVO_API_KEY = origKey;
    process.env.BREVO_SMS_SENDER = origSender;
    vi.unstubAllGlobals();
  });

  it("posts to sms endpoint with transactional default", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ reference: "sms-ref-1", messageId: 12345 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await sendBrevoSms({ to: "+48123456789", text: "hello" });
    expect(out).toEqual({ ok: true, messageId: "12345" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/transactionalSMS/sms",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body).toMatchObject({
      sender: "ManicBot",
      recipient: "+48123456789",
      content: "hello",
      type: "transactional",
    });
  });

  it("returns brevo_sms_not_configured when sender missing", async () => {
    delete process.env.BREVO_SMS_SENDER;
    const out = await sendBrevoSms({ to: "+48123", text: "x" });
    expect(out).toEqual({ ok: false, error: "brevo_sms_not_configured" });
  });
});

describe("checkBrevoHealth", () => {
  const origKey = process.env.BREVO_API_KEY;
  beforeEach(() => {
    process.env.BREVO_API_KEY = "xkeysib-test";
  });
  afterEach(() => {
    process.env.BREVO_API_KEY = origKey;
    vi.unstubAllGlobals();
  });

  it("returns account email on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ email: "acct@manicbot.com", plan: [{ type: "free" }] }),
      }),
    );
    const out = await checkBrevoHealth();
    expect(out).toEqual({ ok: true, email: "acct@manicbot.com", plan: "free" });
  });

  it("returns error on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: "Key not found" }),
      }),
    );
    const out = await checkBrevoHealth();
    expect(out).toEqual({ ok: false, error: "Key not found" });
  });
});

describe("isBrevoConfigured / isBrevoSmsConfigured", () => {
  const origKey = process.env.BREVO_API_KEY;
  const origFrom = process.env.BREVO_FROM;
  const origSender = process.env.BREVO_SMS_SENDER;

  afterEach(() => {
    process.env.BREVO_API_KEY = origKey;
    process.env.BREVO_FROM = origFrom;
    process.env.BREVO_SMS_SENDER = origSender;
  });

  it("email: false without both key and from", () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_FROM;
    expect(isBrevoConfigured()).toBe(false);
  });

  it("email: true when both set", () => {
    process.env.BREVO_API_KEY = "xkeysib-x";
    process.env.BREVO_FROM = "A <a@b.co>";
    expect(isBrevoConfigured()).toBe(true);
  });

  it("sms: true when key + sender set", () => {
    process.env.BREVO_API_KEY = "xkeysib-x";
    process.env.BREVO_SMS_SENDER = "ManicBot";
    expect(isBrevoSmsConfigured()).toBe(true);
  });
});
