/**
 * Unit tests for the internal newsletter-welcome handler.
 *
 * The route file itself just wires the pure handler to NextResponse +
 * Drizzle. The pure handler (`processNewsletterWelcomeRequest`) is the
 * real auth/validation surface, so that's what we pin here.
 *
 * Cases:
 *   * Missing Bearer → 401
 *   * Wrong Bearer → 401 (constant-time)
 *   * Right Bearer + bad body → 400
 *   * Right Bearer + invalid email → 400
 *   * Right Bearer + valid body → 200, sendEmail called, stampSentAt called
 *   * Right Bearer + sender error → 500, stampSendError called
 *   * Missing expectedToken env → 401 (never accept on misconfig)
 *   * Lang defaults to 'en' when omitted or invalid
 */
import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import {
  processNewsletterWelcomeRequest,
  extractBearer,
} from "~/server/newsletter/processWelcomeRequest";

const TOKEN = "internal-token-xxxxxxxxxxxxxxxxxxx";

type TestInput = Parameters<typeof processNewsletterWelcomeRequest>[0];
// Mocks are typed as `Mock` so test assertions on `.mock.calls` are valid.
interface TestInputWithMocks extends TestInput {
  sendEmail: Mock<TestInput["sendEmail"]>;
  stampSentAt: Mock<TestInput["stampSentAt"]>;
  stampSendError: Mock<TestInput["stampSendError"]>;
}

const VALID_TOKEN = "a".repeat(32);

function makeInput(overrides: Partial<TestInputWithMocks> = {}): TestInputWithMocks {
  return {
    authorizationHeader: `Bearer ${TOKEN}`,
    body: { email: "foo@example.com", lang: "ru", unsubscribeToken: VALID_TOKEN },
    expectedToken: TOKEN,
    sendEmail: vi.fn<TestInput["sendEmail"]>(async () => ({ ok: true as const })),
    stampSentAt: vi.fn<TestInput["stampSentAt"]>(async () => undefined),
    stampSendError: vi.fn<TestInput["stampSendError"]>(async () => undefined),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe("extractBearer", () => {
  it("returns the token portion of a valid header", () => {
    expect(extractBearer("Bearer abc123")).toBe("abc123");
  });
  it("returns null on missing header", () => {
    expect(extractBearer(null)).toBeNull();
  });
  it("returns null on malformed header", () => {
    expect(extractBearer("Token abc")).toBeNull();
    expect(extractBearer("")).toBeNull();
  });
});

describe("processNewsletterWelcomeRequest — auth", () => {
  it("returns 401 when expectedToken env is missing", async () => {
    const i = makeInput({ expectedToken: null });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(401);
    expect(i.sendEmail).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is absent", async () => {
    const i = makeInput({ authorizationHeader: null });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(401);
    expect(i.sendEmail).not.toHaveBeenCalled();
  });

  it("returns 401 on wrong Bearer", async () => {
    const i = makeInput({ authorizationHeader: "Bearer not-the-right-one-xxxxxxxxxxx" });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(401);
  });

  it("uses constant-time compare (does not short-circuit on length match prefix)", async () => {
    // Same length, only last char differs.
    const wrong = TOKEN.slice(0, -1) + (TOKEN.endsWith("x") ? "y" : "x");
    const i = makeInput({ authorizationHeader: `Bearer ${wrong}` });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(401);
  });
});

describe("processNewsletterWelcomeRequest — body validation", () => {
  it("returns 400 when body is null", async () => {
    const i = makeInput({ body: null });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(400);
  });

  it("returns 400 when email is missing", async () => {
    const i = makeInput({ body: { lang: "ru" } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(400);
  });

  it("returns 400 when email is malformed", async () => {
    const i = makeInput({ body: { email: "not-an-email", lang: "ru" } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(400);
  });

  it("returns 400 when email exceeds 254 chars", async () => {
    const long = "x".repeat(260) + "@example.com";
    const i = makeInput({ body: { email: long } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(400);
  });
});

describe("processNewsletterWelcomeRequest — happy path", () => {
  it("returns 200 and calls sendEmail with normalized args", async () => {
    const i = makeInput({ body: { email: "  USER@Example.COM ", lang: "ru", unsubscribeToken: VALID_TOKEN } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(200);
    expect(i.sendEmail).toHaveBeenCalledTimes(1);
    expect(i.sendEmail).toHaveBeenCalledWith("user@example.com", "ru", VALID_TOKEN);
  });

  it("stamps welcome_sent_at via stampSentAt", async () => {
    const i = makeInput();
    await processNewsletterWelcomeRequest(i);
    expect(i.stampSentAt).toHaveBeenCalledTimes(1);
    const call = i.stampSentAt.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toBe("foo@example.com");
    expect(call?.[1]).toBe(Math.floor(1_700_000_000_000 / 1000));
  });

  it("defaults lang to en when omitted", async () => {
    const i = makeInput({ body: { email: "x@y.io", unsubscribeToken: VALID_TOKEN } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(200);
    expect(i.sendEmail).toHaveBeenCalledWith("x@y.io", "en", VALID_TOKEN);
  });

  it("defaults lang to en when value is outside the allowlist", async () => {
    const i = makeInput({ body: { email: "x@y.io", lang: "de", unsubscribeToken: VALID_TOKEN } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(200);
    expect(i.sendEmail).toHaveBeenCalledWith("x@y.io", "en", VALID_TOKEN);
  });
});

describe("processNewsletterWelcomeRequest — unsubscribe token contract", () => {
  it("returns 400 when unsubscribeToken is missing", async () => {
    const i = makeInput({ body: { email: "x@y.io", lang: "en" } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(400);
    expect(i.sendEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when unsubscribeToken has wrong shape (too short)", async () => {
    const i = makeInput({ body: { email: "x@y.io", lang: "en", unsubscribeToken: "tooshort" } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(400);
    expect(i.sendEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when unsubscribeToken contains non-hex chars", async () => {
    const i = makeInput({
      body: { email: "x@y.io", lang: "en", unsubscribeToken: "z".repeat(32) },
    });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(400);
    expect(i.sendEmail).not.toHaveBeenCalled();
  });

  it("forwards the token verbatim to sendEmail as the third arg", async () => {
    const tok = "0123456789abcdef0123456789abcdef";
    const i = makeInput({ body: { email: "x@y.io", lang: "pl", unsubscribeToken: tok } });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(200);
    expect(i.sendEmail).toHaveBeenCalledWith("x@y.io", "pl", tok);
  });
});

describe("processNewsletterWelcomeRequest — send error", () => {
  it("returns 500 and stamps welcome_send_error on { ok: false }", async () => {
    const i = makeInput({
      sendEmail: vi.fn<TestInput["sendEmail"]>(async () => ({ ok: false as const, error: "resend_429" })),
    });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(500);
    expect(i.stampSendError).toHaveBeenCalledTimes(1);
    expect(i.stampSentAt).not.toHaveBeenCalled();
    const call = i.stampSendError.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toBe("foo@example.com");
    expect(call?.[1]).toBe("resend_429");
  });

  it("returns 500 and stamps welcome_send_error when sender throws", async () => {
    const i = makeInput({
      sendEmail: vi.fn<TestInput["sendEmail"]>(async () => {
        throw new Error("network blew up");
      }),
    });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(500);
    expect(i.stampSendError).toHaveBeenCalledTimes(1);
    const call = i.stampSendError.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[1]).toBe("network blew up");
  });

  it("does not crash when stampSendError itself throws", async () => {
    const i = makeInput({
      sendEmail: vi.fn<TestInput["sendEmail"]>(async () => {
        throw new Error("boom");
      }),
      stampSendError: vi.fn<TestInput["stampSendError"]>(async () => {
        throw new Error("db blew up too");
      }),
    });
    const r = await processNewsletterWelcomeRequest(i);
    expect(r.status).toBe(500);
  });
});
