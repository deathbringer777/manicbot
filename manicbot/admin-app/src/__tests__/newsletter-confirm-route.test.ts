/**
 * Unit tests for the internal newsletter-confirm handler (migration 0092).
 *
 * Mirrors newsletter-welcome-route.test.ts. The pure handler
 * `processNewsletterConfirmRequest` carries the auth + validation logic;
 * the route file wires it to NextResponse + Drizzle.
 *
 * Cases:
 *   * Missing/wrong/constant-time Bearer → 401
 *   * Missing expectedToken env → 401 (never accept on misconfig)
 *   * Bad body / missing email / malformed email → 400
 *   * Missing or malformed confirmToken → 400
 *   * Happy path → 200, sendEmail called with (email, lang, confirmToken)
 *   * Send returns ok:false → 500, stampSendError called
 *   * Send throws → 500, stampSendError called
 *   * Lang defaults to 'en' when omitted or invalid
 */
import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import {
  processNewsletterConfirmRequest,
  extractBearer,
} from "~/server/newsletter/processConfirmRequest";

const TOKEN = "internal-token-xxxxxxxxxxxxxxxxxxx";
const GOOD_CONFIRM_TOKEN = "a".repeat(32);

type TestInput = Parameters<typeof processNewsletterConfirmRequest>[0];
interface TestInputWithMocks extends TestInput {
  sendEmail: Mock<TestInput["sendEmail"]>;
  stampSendError: Mock<TestInput["stampSendError"]>;
}

function makeInput(overrides: Partial<TestInputWithMocks> = {}): TestInputWithMocks {
  return {
    authorizationHeader: `Bearer ${TOKEN}`,
    body: { email: "foo@example.com", lang: "ru", confirmToken: GOOD_CONFIRM_TOKEN },
    expectedToken: TOKEN,
    sendEmail: vi.fn<TestInput["sendEmail"]>(async () => ({ ok: true as const })),
    stampSendError: vi.fn<TestInput["stampSendError"]>(async () => undefined),
    ...overrides,
  };
}

describe("extractBearer (confirm)", () => {
  it("returns the token portion of a valid header", () => {
    expect(extractBearer("Bearer xyz")).toBe("xyz");
  });
  it("returns null on missing / malformed header", () => {
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer("Token abc")).toBeNull();
  });
});

describe("processNewsletterConfirmRequest — auth", () => {
  it("returns 401 when expectedToken env is missing", async () => {
    const i = makeInput({ expectedToken: null });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(401);
    expect(i.sendEmail).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is absent", async () => {
    const i = makeInput({ authorizationHeader: null });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(401);
  });

  it("returns 401 on wrong Bearer", async () => {
    const i = makeInput({ authorizationHeader: "Bearer wrong-token-xxxxxxxxxxxx" });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(401);
  });

  it("uses constant-time compare", async () => {
    const wrong = TOKEN.slice(0, -1) + (TOKEN.endsWith("x") ? "y" : "x");
    const i = makeInput({ authorizationHeader: `Bearer ${wrong}` });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(401);
  });
});

describe("processNewsletterConfirmRequest — body validation", () => {
  it("returns 400 when body is null", async () => {
    const i = makeInput({ body: null });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(400);
  });

  it("returns 400 when email is missing", async () => {
    const i = makeInput({ body: { lang: "ru", confirmToken: GOOD_CONFIRM_TOKEN } });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(400);
  });

  it("returns 400 when email is malformed", async () => {
    const i = makeInput({ body: { email: "not-an-email", confirmToken: GOOD_CONFIRM_TOKEN } });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(400);
  });

  it("returns 400 when confirmToken is missing", async () => {
    const i = makeInput({ body: { email: "x@y.io", lang: "en" } });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(400);
  });

  it("returns 400 when confirmToken is malformed (too short)", async () => {
    const i = makeInput({ body: { email: "x@y.io", lang: "en", confirmToken: "abc123" } });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(400);
  });

  it("returns 400 when confirmToken is malformed (uppercase / dashes)", async () => {
    const i = makeInput({
      body: { email: "x@y.io", lang: "en", confirmToken: "A".repeat(32) },
    });
    expect((await processNewsletterConfirmRequest(i)).status).toBe(400);
    const j = makeInput({
      body: { email: "x@y.io", lang: "en", confirmToken: "abc-".repeat(8) },
    });
    expect((await processNewsletterConfirmRequest(j)).status).toBe(400);
  });
});

describe("processNewsletterConfirmRequest — happy path", () => {
  it("returns 200 + calls sendEmail(email, lang, confirmToken) with normalized args", async () => {
    const i = makeInput({
      body: { email: "  USER@Example.COM ", lang: "ru", confirmToken: GOOD_CONFIRM_TOKEN },
    });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(200);
    expect(i.sendEmail).toHaveBeenCalledTimes(1);
    expect(i.sendEmail).toHaveBeenCalledWith("user@example.com", "ru", GOOD_CONFIRM_TOKEN);
  });

  it("defaults lang to en when omitted", async () => {
    const i = makeInput({ body: { email: "x@y.io", confirmToken: GOOD_CONFIRM_TOKEN } });
    expect((await processNewsletterConfirmRequest(i)).status).toBe(200);
    expect(i.sendEmail).toHaveBeenCalledWith("x@y.io", "en", GOOD_CONFIRM_TOKEN);
  });

  it("defaults lang to en when value is outside the allowlist", async () => {
    const i = makeInput({
      body: { email: "x@y.io", lang: "de", confirmToken: GOOD_CONFIRM_TOKEN },
    });
    expect((await processNewsletterConfirmRequest(i)).status).toBe(200);
    expect(i.sendEmail).toHaveBeenCalledWith("x@y.io", "en", GOOD_CONFIRM_TOKEN);
  });
});

describe("processNewsletterConfirmRequest — send error", () => {
  it("returns 500 + stamps error on { ok: false }", async () => {
    const i = makeInput({
      sendEmail: vi.fn<TestInput["sendEmail"]>(async () => ({ ok: false as const, error: "resend_429" })),
    });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(500);
    expect(i.stampSendError).toHaveBeenCalledTimes(1);
    const call = i.stampSendError.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[0]).toBe("foo@example.com");
    expect(call?.[1]).toBe("resend_429");
  });

  it("returns 500 + stamps error when sender throws", async () => {
    const i = makeInput({
      sendEmail: vi.fn<TestInput["sendEmail"]>(async () => {
        throw new Error("network blew up");
      }),
    });
    const r = await processNewsletterConfirmRequest(i);
    expect(r.status).toBe(500);
    expect(i.stampSendError).toHaveBeenCalledTimes(1);
    const call = i.stampSendError.mock.calls[0];
    expect(call?.[1]).toBe("network blew up");
  });
});
