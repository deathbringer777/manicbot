import { describe, it, expect, vi } from "vitest";
import {
  signGooglePrefillToken,
  verifyGooglePrefillToken,
  GOOGLE_PREFILL_TTL_SEC,
} from "~/server/auth/googlePrefillToken";

describe("googlePrefillToken", () => {
  const secret = "test-secret-at-least-32-chars-long!!";

  it("round-trips payload", async () => {
    const token = await signGooglePrefillToken(secret, {
      email: "User@Example.COM",
      name: "Jane Doe",
      sub: "google-sub-123",
      ttlSec: 3600,
    });
    const out = await verifyGooglePrefillToken(secret, token);
    expect(out).not.toBeNull();
    expect(out!.email).toBe("user@example.com");
    expect(out!.name).toBe("Jane Doe");
    expect(out!.sub).toBe("google-sub-123");
  });

  it("rejects wrong secret", async () => {
    const token = await signGooglePrefillToken(secret, {
      email: "a@b.co",
      name: null,
      sub: "sub",
      ttlSec: 3600,
    });
    expect(await verifyGooglePrefillToken("other-secret", token)).toBeNull();
  });

  it("rejects tampered token", async () => {
    const token = await signGooglePrefillToken(secret, {
      email: "a@b.co",
      name: null,
      sub: "sub",
      ttlSec: 3600,
    });
    const tampered = token.slice(0, -4) + "xxxx";
    expect(await verifyGooglePrefillToken(secret, tampered)).toBeNull();
  });

  it("rejects expired payload", async () => {
    const token = await signGooglePrefillToken(secret, {
      email: "a@b.co",
      name: null,
      sub: "sub",
      ttlSec: 2,
    });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10_000);
    try {
      expect(await verifyGooglePrefillToken(secret, token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows null name", async () => {
    const token = await signGooglePrefillToken(secret, {
      email: "x@y.z",
      name: null,
      sub: "s",
      ttlSec: 600,
    });
    const out = await verifyGooglePrefillToken(secret, token);
    expect(out?.name).toBeNull();
  });

  it("default TTL matches constant", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signGooglePrefillToken(secret, {
      email: "t@t.tt",
      name: "N",
      sub: "s",
    });
    const out = await verifyGooglePrefillToken(secret, token);
    expect(out).not.toBeNull();
    expect(out!.exp - before).toBeGreaterThanOrEqual(GOOGLE_PREFILL_TTL_SEC - 2);
    expect(out!.exp - before).toBeLessThanOrEqual(GOOGLE_PREFILL_TTL_SEC + 2);
  });

  // #P0-1 (2026-05-24 audit) — jti field guarantees single-use replay protection.
  it("mints a fresh jti per token", async () => {
    const a = await signGooglePrefillToken(secret, { email: "a@b.co", name: null, sub: "s", ttlSec: 600 });
    const b = await signGooglePrefillToken(secret, { email: "a@b.co", name: null, sub: "s", ttlSec: 600 });
    const pa = await verifyGooglePrefillToken(secret, a);
    const pb = await verifyGooglePrefillToken(secret, b);
    expect(pa?.jti).toMatch(/^[0-9a-f-]{8,}$/);
    expect(pb?.jti).toMatch(/^[0-9a-f-]{8,}$/);
    expect(pa?.jti).not.toBe(pb?.jti);
  });

  it("honors caller-supplied jti (for deterministic tests)", async () => {
    const token = await signGooglePrefillToken(secret, {
      email: "a@b.co", name: null, sub: "s", ttlSec: 600,
      jti: "deterministic-jti-for-test",
    });
    const out = await verifyGooglePrefillToken(secret, token);
    expect(out?.jti).toBe("deterministic-jti-for-test");
  });

  it("rejects pre-#P0-1 tokens without jti (signed payload, no jti field)", async () => {
    // Hand-roll an old-format payload (no jti). HMAC it with the same secret
    // so the signature passes, then ensure verify still rejects on missing jti.
    const oldPayload = {
      email: "a@b.co",
      name: null,
      sub: "s",
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const enc = new TextEncoder();
    const payloadBytes = enc.encode(JSON.stringify(oldPayload));
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payloadBytes));
    const toB64Url = (bytes: Uint8Array) => {
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    const oldToken = `${toB64Url(payloadBytes)}.${toB64Url(sig)}`;
    expect(await verifyGooglePrefillToken(secret, oldToken)).toBeNull();
  });
});
