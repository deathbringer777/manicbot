/**
 * Admin-app `captureError` helper — pure-logic + best-effort contract.
 *
 * The Drizzle interaction is exercised end-to-end in salon-invite-flow.test.ts
 * (the transport-failure path mocks captureError as a unit). Here we pin
 * the parts that don't need a real database:
 *
 *   - `buildFingerprint` is deterministic and order-sensitive.
 *   - `captureError` never throws on DB failure (sidecar contract).
 *   - `captureError` short-circuits on missing required input.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/utils/logger", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { captureError, buildFingerprint } from "~/server/utils/captureError";

describe("buildFingerprint", () => {
  it("is deterministic for the same parts", () => {
    const a = buildFingerprint(["email.transport_failed", "Resend not configured", "/trpc/salon.sendMasterInvitation"]);
    const b = buildFingerprint(["email.transport_failed", "Resend not configured", "/trpc/salon.sendMasterInvitation"]);
    expect(a).toBe(b);
  });

  it("changes when any part changes", () => {
    const base = buildFingerprint(["a", "b", "c"]);
    expect(buildFingerprint(["a", "b", "d"])).not.toBe(base);
    expect(buildFingerprint(["a", "x", "c"])).not.toBe(base);
    expect(buildFingerprint(["x", "b", "c"])).not.toBe(base);
  });

  it("ignores null/undefined parts (treats them as absent)", () => {
    const a = buildFingerprint(["a", null, "c"]);
    const b = buildFingerprint(["a", undefined, "c"]);
    const c = buildFingerprint(["a", "c"]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("returns an 8-char lowercase hex string", () => {
    const fp = buildFingerprint(["test"]);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("captureError — best-effort sidecar contract", () => {
  it("returns ok:false without throwing when db is null", async () => {
    const r = await captureError(null as never, {
      errorType: "test.failure",
      message: "test message",
    });
    expect(r.ok).toBe(false);
  });

  it("returns ok:false on missing errorType", async () => {
    const db = { select: vi.fn() } as never;
    const r = await captureError(db, {
      errorType: "",
      message: "test message",
    });
    expect(r.ok).toBe(false);
    expect((db as { select: ReturnType<typeof vi.fn> }).select).not.toHaveBeenCalled();
  });

  it("returns ok:false on missing message", async () => {
    const db = { select: vi.fn() } as never;
    const r = await captureError(db, {
      errorType: "test.failure",
      message: "",
    });
    expect(r.ok).toBe(false);
  });

  it("never throws when the underlying db query rejects", async () => {
    const exploding = {
      select: () => {
        throw new Error("D1 unavailable");
      },
    } as never;
    // Must not throw — sidecar contract.
    const r = await captureError(exploding, {
      errorType: "test.failure",
      message: "boom",
    });
    expect(r.ok).toBe(false);
  });

  it("never throws on non-serialisable context", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const exploding = {
      select: () => {
        throw new Error("D1 unavailable");
      },
    } as never;
    const r = await captureError(exploding, {
      errorType: "test.failure",
      message: "boom",
      context: cyclic,
    });
    expect(r.ok).toBe(false);
  });
});
