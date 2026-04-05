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
});
