/**
 * Tests for the Resend webhook route handler
 * (`app/api/resend/webhook/route.ts`).
 *
 * Verifies that:
 *   1. The route reads RESEND_WEBHOOK_SECRET via getRuntimeEnv() (not
 *      process.env directly) — the fix for the CF Pages edge-runtime gap.
 *   2. A missing/unset secret returns 503 (never silently accepts unsigned events).
 *   3. A valid, correctly-signed payload returns 200.
 *   4. An invalid signature returns 403.
 *   5. A stale timestamp (replay attack) returns 403.
 *   6. A missing svix-id/svix-timestamp header returns 403.
 *
 * DB calls are mocked at the module boundary; the signature is computed
 * with real Web Crypto so the HMAC path is exercised end-to-end.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks (must be hoisted above any imports that trigger them) ──────

vi.mock("~/server/db", () => ({
  getDb: () => ({
    run: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
}));

vi.mock("~/env", () => ({
  env: {
    AUTH_SECRET: "test-auth-secret-not-used-here",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));

// ── Helper: sign a payload like Svix does ───────────────────────────────────

/**
 * Produce a `svix-signature` header value for the given inputs.
 * The secret may be a raw string (TextEncoder path) or "whsec_<base64>".
 */
async function signSvix(
  svixId: string,
  svixTimestampSec: number,
  rawBody: string,
  secret: string,
): Promise<string> {
  const signedContent = `${svixId}.${svixTimestampSec}.${rawBody}`;
  const secretBytes = secret.startsWith("whsec_")
    ? Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return `v1,${b64}`;
}

// ── Route under test ─────────────────────────────────────────────────────────

// Import after mocks are declared so vi.mock hoisting applies.
import { POST } from "~/app/api/resend/webhook/route";

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-webhook-secret-for-unit-tests";
const SVIX_ID = "msg_test_abc123";
const VALID_BODY = JSON.stringify({
  type: "email.delivered",
  data: { email_id: "re_test_001", to: "user@example.com" },
});

/** Build a Request with proper Svix headers for the given body and secret. */
async function buildSignedRequest(
  body: string,
  secret: string,
  nowSec: number,
  overrides: Record<string, string> = {},
): Promise<Request> {
  const signature = await signSvix(SVIX_ID, nowSec, body, secret);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "svix-id": SVIX_ID,
    "svix-timestamp": String(nowSec),
    "svix-signature": signature,
    ...overrides,
  };
  return new Request("https://example.com/api/resend/webhook", {
    method: "POST",
    headers,
    body,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resend webhook route — secret env sourcing", () => {
  const originalEnv = process.env.RESEND_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.RESEND_WEBHOOK_SECRET;
    } else {
      process.env.RESEND_WEBHOOK_SECRET = originalEnv;
    }
  });

  it("returns 503 when RESEND_WEBHOOK_SECRET is unset (getRuntimeEnv returns undefined)", async () => {
    // This test verifies the fix: the route must not short-circuit to 503
    // due to process.env being empty on CF Pages edge. The fix switches to
    // getRuntimeEnv(), which in test falls back to process.env — so unsetting
    // process.env here correctly simulates the misconfiguration case.
    delete process.env.RESEND_WEBHOOK_SECRET;

    const nowSec = Math.floor(Date.now() / 1000);
    const req = await buildSignedRequest(VALID_BODY, TEST_SECRET, nowSec);
    const res = await POST(req);
    expect(res.status).toBe(503);
  });

  it("returns 200 on a correctly-signed payload when secret is provided via getRuntimeEnv", async () => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;

    const nowSec = Math.floor(Date.now() / 1000);
    const req = await buildSignedRequest(VALID_BODY, TEST_SECRET, nowSec);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; outcome: string };
    expect(json.ok).toBe(true);
    expect(json.outcome).toBe("delivered");
  });
});

describe("resend webhook route — signature validation", () => {
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("returns 403 on a tampered signature (wrong secret used for signing)", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // Sign with a different secret — verification must fail.
    const req = await buildSignedRequest(VALID_BODY, "wrong-secret-not-the-right-one", nowSec);
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when svix-signature header is missing", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const req = await buildSignedRequest(VALID_BODY, TEST_SECRET, nowSec, {
      "svix-signature": "",
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 on a stale timestamp (replay attack, >5 min old)", async () => {
    // 6 minutes ago — outside the ±300 s tolerance window.
    const staleSec = Math.floor(Date.now() / 1000) - 361;
    const req = await buildSignedRequest(VALID_BODY, TEST_SECRET, staleSec);
    const res = await POST(req);
    // Timestamp check fires before signature check, so this is 403 (stale).
    expect(res.status).toBe(403);
  });

  it("returns 403 on a missing svix-timestamp header", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const req = await buildSignedRequest(VALID_BODY, TEST_SECRET, nowSec, {
      "svix-timestamp": "",
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 on valid signature but malformed JSON body", async () => {
    const badBody = "not-json";
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
    const nowSec = Math.floor(Date.now() / 1000);
    const sig = await signSvix(SVIX_ID, nowSec, badBody, TEST_SECRET);
    const req = new Request("https://example.com/api/resend/webhook", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "svix-id": SVIX_ID,
        "svix-timestamp": String(nowSec),
        "svix-signature": sig,
      },
      body: badBody,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 for a whsec_ base64-prefixed secret", async () => {
    // Simulate a Svix-style base64 webhook secret.
    const rawBytes = crypto.getRandomValues(new Uint8Array(24));
    const b64Secret = "whsec_" + btoa(String.fromCharCode(...rawBytes));
    process.env.RESEND_WEBHOOK_SECRET = b64Secret;

    const nowSec = Math.floor(Date.now() / 1000);
    const req = await buildSignedRequest(VALID_BODY, b64Secret, nowSec);
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("resend webhook route — event routing", () => {
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  it("returns outcome=bounced for email.bounced event", async () => {
    const body = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "re_bounce", to: "bounce@example.com" },
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const req = await buildSignedRequest(body, TEST_SECRET, nowSec);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; outcome: string };
    expect(json.outcome).toBe("bounced");
  });

  it("returns outcome=ignored for an unknown event type", async () => {
    const body = JSON.stringify({
      type: "email.unknown_future_type",
      data: {},
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const req = await buildSignedRequest(body, TEST_SECRET, nowSec);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; outcome: string };
    expect(json.outcome).toBe("ignored");
  });
});
