/**
 * Phase 2 cleanup: orphan-router pin for `otpRouter`.
 *
 * The OTP router is security-sensitive — it issues codes for destructive
 * actions (archive_master, reset_master_password, peek_master_password,
 * unarchive_master). Pins:
 *   - protectedProcedure auth gate (unauth UNAUTHORIZED)
 *   - whitelisted-action zod enum (anything outside the four allowed
 *     actions is rejected at the input boundary)
 *   - actionLabel length cap (>200 chars rejected)
 *   - payload-binding (code is bound to a specific payload hash — the
 *     pure-helper side is covered by otp-action-code.test.ts; this file
 *     pins the source contract)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    ADMIN_CHAT_ID: "12345",
    AUTH_SECRET: "test",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    WORKER_PUBLIC_URL: "https://worker.test.local",
    UPLOAD_TOKEN_SECRET: "0123456789abcdef0123456789abcdef",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { otpRouter } from "~/server/api/routers/otp";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const callerFactory = createCallerFactory(otpRouter);

describe("otp.request — protected gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers (UNAUTHORIZED)", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeUnauthCtx(db) as never);
    await expect(
      caller.request({
        action: "archive_master",
        payload: { masterId: 1 },
        actionLabel: "Archive master 1",
      } as never),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("otp.request — input validation (zod boundary)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an action that isn't in the whitelist", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(
      caller.request({
        // @ts-expect-error — intentionally invalid action
        action: "delete_tenant",
        payload: { tenantId: "t" },
        actionLabel: "Delete tenant",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects actionLabel longer than 200 chars", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(
      caller.request({
        action: "archive_master",
        payload: { masterId: 1 },
        actionLabel: "x".repeat(201),
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects empty actionLabel", async () => {
    const { db } = createDbMock();
    const caller = callerFactory(makeTenantOwnerCtx(db, "t") as never);
    await expect(
      caller.request({
        action: "archive_master",
        payload: { masterId: 1 },
        actionLabel: "",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts each of the four whitelisted actions", async () => {
    // Reads zod enum directly from the router source — pins the four-element set.
    const src = readFileSync(
      path.resolve(__dirname, "../server/api/routers/otp.ts"),
      "utf8",
    );
    expect(src).toMatch(/"archive_master"/);
    expect(src).toMatch(/"unarchive_master"/);
    expect(src).toMatch(/"reset_master_password"/);
    expect(src).toMatch(/"peek_master_password"/);
    // Pin the cap so the four entries are documented as the only allowed set.
    const list = src.match(/ACTION_WHITELIST\s*=\s*\[[\s\S]*?\]\s*as const/);
    expect(list).toBeTruthy();
    const actions = (list?.[0]?.match(/"[a-z_]+"/g) ?? []).length;
    expect(actions).toBe(4);
  });
});

describe("otp.request — payload-binding contract (source pin)", () => {
  it("the OTP helper hashes (webUserId, action, payload) — payload binds to one operation", () => {
    // The pure-helper `requestActionOtp` lives in server/auth/otp.ts and is
    // exercised by otp-action-code.test.ts (existing). Here we just pin the
    // router → helper wiring so a refactor that drops `payload` from the
    // call site can't go unnoticed.
    const src = readFileSync(
      path.resolve(__dirname, "../server/api/routers/otp.ts"),
      "utf8",
    );
    expect(src).toMatch(/requestActionOtp\(\{[\s\S]*?webUserId:\s*webUser\.id/);
    expect(src).toMatch(/requestActionOtp\(\{[\s\S]*?action:\s*input\.action/);
    expect(src).toMatch(/requestActionOtp\(\{[\s\S]*?payload:\s*input\.payload/);
  });

  it("uses checkRateLimit with otp:${userId}:${action} key (per-user-per-action throttle)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../server/api/routers/otp.ts"),
      "utf8",
    );
    expect(src).toMatch(/`otp:\$\{webUser\.id\}:\$\{input\.action\}`/);
    // 5 issuances per 10 minutes — pinned constants.
    expect(src).toMatch(/RL_MAX\s*=\s*5/);
    expect(src).toMatch(/RL_WINDOW_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
  });
});

describe("otp.request — system_admin can issue OTPs too", () => {
  it("admin role passes the protectedProcedure gate (precondition: needs email)", async () => {
    // makeAdminCtx supplies webUser with email — the procedure proceeds past
    // the protectedProcedure middleware. It will eventually hit the rate
    // limit / DB layer; we just confirm the auth gate doesn't block admins.
    const { db } = createDbMock();
    const caller = callerFactory(makeAdminCtx(db) as never);
    try {
      await caller.request({
        action: "archive_master",
        payload: { masterId: 1 },
        actionLabel: "Archive master 1",
      } as never);
    } catch (err: unknown) {
      // We don't expect a clean success without a full D1 fixture, but the
      // error MUST NOT be UNAUTHORIZED/FORBIDDEN/BAD_REQUEST — those would
      // indicate the gate or input boundary refused us.
      const code = (err as { code?: string }).code;
      expect(code).not.toBe("UNAUTHORIZED");
      expect(code).not.toBe("FORBIDDEN");
      // BAD_REQUEST would only fire on invalid input, which this isn't.
      expect(code).not.toBe("BAD_REQUEST");
    }
  });
});
