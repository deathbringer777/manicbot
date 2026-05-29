/**
 * salon.createMasterAccount and salon.resetMasterPassword degrade gracefully
 * when BOT_ENCRYPTION_KEY is missing on Pages env.
 *
 * Pre-fix: both mutations threw PRECONDITION_FAILED, blocking the Masters tab
 * entirely when the secret wasn't deployed to Cloudflare Pages.
 *
 * Post-fix: the account is created / password is reset with
 * `password_encrypted = NULL`. The OTP-gated peek/reset feature returns
 * `password_not_vaulted` until the key is configured, but core account
 * lifecycle keeps working.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/server/security/audit", () => ({
  writeAudit: vi.fn(async () => undefined),
  ctxIp: () => "127.0.0.1",
}));
vi.mock("~/server/email/emailService", () => ({
  sendMasterInviteEmail: vi.fn(async () => undefined),
}));
// requireOtpConfirmation is called inside resetMasterPassword; stub it out
// so we don't have to mint a real OTP code in unit-test land.
vi.mock("~/server/auth/otp", () => ({
  requireOtpConfirmation: vi.fn(async () => undefined),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { createDbMock, makeTenantOwnerCtx } from "./helpers/db-mock";

const TENANT = "t_salon_alpha";
const NOW = 1_715_000_000;
const VALID_KEK = "0123456789abcdef0123456789abcdef"; // 32 chars

function findWebUserInsert(insertCalls: Array<{ values: any }>) {
  return insertCalls.find((c) => typeof c.values?.passwordHash === "string");
}

describe("salon.createMasterAccount — BOT_ENCRYPTION_KEY optional (graceful degradation)", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("creates the master account with password_encrypted populated when BOT_ENCRYPTION_KEY is set", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: VALID_KEK,
      },
    }));
    const { salonRouter } = await import("~/server/api/routers/salon");
    const factory = createCallerFactory(salonRouter);

    const mock = createDbMock([[]]); // email-existence check → no conflict
    const caller = factory(makeTenantOwnerCtx(mock.db, TENANT) as never);

    await caller.createMasterAccount({ tenantId: TENANT, name: "Anna" });

    const insert = findWebUserInsert(mock.insertCalls);
    expect(insert).toBeTruthy();
    expect(typeof insert!.values.passwordEncrypted).toBe("string");
    expect((insert!.values.passwordEncrypted as string).startsWith("v1$")).toBe(true);
  });

  it("creates the master account with password_encrypted = null when BOT_ENCRYPTION_KEY is unset", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: "", // unset on Pages
      },
    }));
    const { salonRouter } = await import("~/server/api/routers/salon");
    const factory = createCallerFactory(salonRouter);

    const mock = createDbMock([[]]); // email-existence check → no conflict
    const caller = factory(makeTenantOwnerCtx(mock.db, TENANT) as never);

    // Must NOT throw — this is the regression we are pinning.
    await expect(
      caller.createMasterAccount({ tenantId: TENANT, name: "Anna" }),
    ).resolves.toBeTruthy();

    const insert = findWebUserInsert(mock.insertCalls);
    expect(insert).toBeTruthy();
    expect(insert!.values.passwordEncrypted).toBeNull();
    // Hash is still present — the master can still log in.
    expect(typeof insert!.values.passwordHash).toBe("string");
    expect((insert!.values.passwordHash as string).length).toBeGreaterThan(20);
  });

  it("creates the master account with password_encrypted = null when BOT_ENCRYPTION_KEY is too short (<32)", async () => {
    vi.resetModules();
    vi.doMock("~/env", () => ({
      env: {
        WORKER_PUBLIC_URL: "https://worker.test",
        ADMIN_KEY: "test-admin-key",
        ADMIN_CHAT_ID: "12345",
        TELEGRAM_BOT_TOKEN: "0:TEST",
        AUTH_SECRET: "test-secret",
        BOT_ENCRYPTION_KEY: "too-short", // 9 chars
      },
    }));
    const { salonRouter } = await import("~/server/api/routers/salon");
    const factory = createCallerFactory(salonRouter);

    const mock = createDbMock([[]]);
    const caller = factory(makeTenantOwnerCtx(mock.db, TENANT) as never);

    await expect(
      caller.createMasterAccount({ tenantId: TENANT, name: "Boris" }),
    ).resolves.toBeTruthy();

    const insert = findWebUserInsert(mock.insertCalls);
    expect(insert!.values.passwordEncrypted).toBeNull();
  });
});
