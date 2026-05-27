/**
 * sendNewsletterWelcomeEmail — production-ready unsub token + RFC 8058 headers.
 *
 * Pinned contract:
 *   1. The unsubscribe URL points to the Worker `/u/<token>` endpoint, NOT
 *      to a `?token=placeholder` stub.
 *   2. Resend payload includes `List-Unsubscribe: <URL>` and
 *      `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers — those
 *      enable Gmail / Apple Mail one-click unsub from the inbox UI.
 *   3. The token round-trips verbatim from caller -> URL.
 *
 * Tests mock global fetch (Resend transport).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendNewsletterWelcomeEmail } from "~/server/email/emailService";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("sendNewsletterWelcomeEmail — production unsub flow", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const origKey = process.env.RESEND_API_KEY;
  const origFrom = process.env.RESEND_FROM;
  const origWorker = process.env.WORKER_PUBLIC_URL;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "Test <onboarding@resend.dev>";
    process.env.WORKER_PUBLIC_URL = "https://manicbot.com";
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_test" }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env.RESEND_API_KEY = origKey;
    process.env.RESEND_FROM = origFrom;
    process.env.WORKER_PUBLIC_URL = origWorker;
    vi.unstubAllGlobals();
  });

  it("builds the unsubscribe URL with the real token at /u/<token>", async () => {
    await sendNewsletterWelcomeEmail("subscriber@example.com", "en", TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const init = call[1] as { body: string; headers: Record<string, string> };
    const body = JSON.parse(init.body);
    expect(body.html).toContain(`https://manicbot.com/u/${TOKEN}`);
    expect(body.html).not.toContain("placeholder");
  });

  it("sends List-Unsubscribe + List-Unsubscribe-Post RFC 8058 headers via Resend payload", async () => {
    // Resend exposes message-level headers via the `headers` field on the
    // request body (not as actual HTTP headers on the call to Resend itself).
    await sendNewsletterWelcomeEmail("subscriber@example.com", "en", TOKEN);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const init = call[1] as { body: string; headers: Record<string, string> };
    const body = JSON.parse(init.body);
    expect(body.headers).toBeDefined();
    expect(body.headers["List-Unsubscribe"]).toBe(`<https://manicbot.com/u/${TOKEN}>`);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("falls back to manicbot.com when WORKER_PUBLIC_URL is unset", async () => {
    delete process.env.WORKER_PUBLIC_URL;
    await sendNewsletterWelcomeEmail("subscriber@example.com", "ru", TOKEN);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const init = call[1] as { body: string; headers: Record<string, string> };
    const body = JSON.parse(init.body);
    expect(body.html).toContain(`https://manicbot.com/u/${TOKEN}`);
  });

  it("strips a trailing slash from WORKER_PUBLIC_URL", async () => {
    process.env.WORKER_PUBLIC_URL = "https://manicbot.com/";
    await sendNewsletterWelcomeEmail("subscriber@example.com", "en", TOKEN);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const init = call[1] as { body: string; headers: Record<string, string> };
    const body = JSON.parse(init.body);
    // Exactly one slash between origin and /u/
    expect(body.html).toContain(`https://manicbot.com/u/${TOKEN}`);
    expect(body.html).not.toContain(`https://manicbot.com//u/`);
  });

  it("does not include the legacy ?token=placeholder URL anywhere", async () => {
    await sendNewsletterWelcomeEmail("subscriber@example.com", "pl", TOKEN);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const init = call[1] as { body: string; headers: Record<string, string> };
    expect(init.body).not.toContain("placeholder");
    expect(init.body).not.toContain("/unsubscribe?token=");
  });
});
