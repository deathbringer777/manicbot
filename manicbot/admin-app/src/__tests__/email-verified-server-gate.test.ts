/**
 * Server-side email-verification enforcement (audit 2026-06-12, CS-2).
 *
 * Like the billing gate (CS-1), email verification was enforced ONLY by a
 * client render-swap (EmailVerificationGate) — an unverified account could
 * operate the product via direct tRPC. New assertEmailVerified(ctx) in
 * tenantAccess.ts re-checks web_users.email_verified on the server for the
 * same high-value outbound/product mutations as CS-1.
 *
 * Parity note: web_users.email_verified is NOT NULL DEFAULT 0, and the six
 * existing prod accounts with 0 are already blocked by the client gate, so
 * server enforcement introduces no regression.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: 0 })),
}));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    AUTH_SECRET: "test-secret",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
  },
}));
vi.mock("~/server/api/slotsBusy", () => ({
  slotsBusy: vi.fn().mockResolvedValue({ busy: false }),
}));

import { assertEmailVerified } from "~/server/api/tenantAccess";
import { createCallerFactory } from "~/server/api/trpc";
import { appointmentsRouter } from "~/server/api/routers/appointments";
import { createDbMock, makeTenantOwnerCtx, makeAdminCtx } from "./helpers/db-mock";

const TENANT = "t_ev";
const NOW = Math.floor(Date.now() / 1000);
const activeTrial = () => ({
  billingStatus: "trialing",
  trialEndsAt: NOW + 86400,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
});

describe("assertEmailVerified — unit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws FORBIDDEN email_unverified when email_verified = 0", async () => {
    const { db } = createDbMock([[{ emailVerified: 0 }]]);
    await expect(
      assertEmailVerified(makeTenantOwnerCtx(db, TENANT) as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "email_unverified" });
  });

  it("passes when email_verified = 1", async () => {
    const { db } = createDbMock([[{ emailVerified: 1 }]]);
    await expect(
      assertEmailVerified(makeTenantOwnerCtx(db, TENANT) as never),
    ).resolves.toBeUndefined();
  });

  it("fails closed when the web_users row is missing", async () => {
    const { db } = createDbMock([[]]);
    await expect(
      assertEmailVerified(makeTenantOwnerCtx(db, TENANT) as never),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("skips system_admin (no DB read)", async () => {
    const { db } = createDbMock([]);
    await expect(assertEmailVerified(makeAdminCtx(db) as never)).resolves.toBeUndefined();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects a missing session", async () => {
    const { db } = createDbMock([]);
    await expect(
      assertEmailVerified({ db, webUser: null } as never),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("email gate wired into high-value mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  const callAppointments = createCallerFactory(appointmentsRouter);

  it("appointments.createManual → FORBIDDEN email_unverified for an unverified caller", async () => {
    // owner ctx: assertTenantOwner = no read; select #1 = billing (active
    // trial), select #2 = email_verified row.
    const { db } = createDbMock([[activeTrial()], [{ emailVerified: 0 }]]);
    const caller = callAppointments(makeTenantOwnerCtx(db, TENANT) as never);
    await expect(
      caller.createManual({
        tenantId: TENANT,
        clientName: "A",
        clientPhone: "+48123123",
        serviceId: "svc1",
        date: "2026-06-15",
        time: "10:00",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "email_unverified" });
  });

  it("appointments.createManual proceeds for a verified caller (failure, if any, is not email_unverified)", async () => {
    const { db } = createDbMock([[activeTrial()], [{ emailVerified: 1 }]]);
    const caller = callAppointments(makeTenantOwnerCtx(db, TENANT) as never);
    try {
      await caller.createManual({
        tenantId: TENANT,
        clientName: "A",
        clientPhone: "+48123123",
        serviceId: "svc1",
        date: "2026-06-15",
        time: "10:00",
      });
    } catch (e) {
      expect((e as { message?: string }).message).not.toBe("email_unverified");
    }
  });
});
