/**
 * Tests for provisioning.provisionTestAccount (added 2026-04-19).
 *
 * The procedure provisions the canonical test accounts used by
 * `npm run seed:test-accounts`. It must:
 *   - flag the tenant with is_test=1 and make it publicly visible
 *   - create a verified web_user (email_verified=1)
 *   - for kind='master', create a personal tenant + a masters row
 *   - for plan ∈ {start,pro,max}, set billing_status='active' and
 *     current_period_end ≈ now + 365d
 *   - for plan='expired_trial', set billing_status='trialing' and
 *     trial_ends_at < now
 *   - never assign role=system_admin
 *   - be idempotent on lower-cased email when an existing test tenant is found
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { provisioningRouter } from "~/server/api/routers/provisioning";
import { createDbMock, makeAdminCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(provisioningRouter);

function tenantsByPlan(plan: string, kind: "salon" | "master" = "salon") {
  return {
    kind,
    plan: plan as "start" | "pro" | "max" | "expired_trial",
    email: `${kind}-${plan}@test.example`,
    password: "TestPass!2026",
    name: `Test ${kind} ${plan}`,
    city: "Київ",
  };
}

describe("provisionTestAccount happy path (salon)", () => {
  it("creates an active annual salon with is_test=1, publicly visible", async () => {
    // No existing user found.
    const { db, insertCalls } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const before = Math.floor(Date.now() / 1000);

    const result = await caller.provisionTestAccount(tenantsByPlan("pro"));

    expect(result.role).toBe("tenant_owner");
    expect(result.plan).toBe("pro");
    expect(result.billingStatus).toBe("active");
    expect(result.isTest).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.currentPeriodEnd!).toBeGreaterThanOrEqual(before + 365 * 86400 - 5);
    expect(result.currentPeriodEnd!).toBeLessThanOrEqual(before + 365 * 86400 + 5);
    expect(result.trialEndsAt).toBeNull();

    // Inserts: tenants, then web_users (no masters for salon)
    const tenantInsert = insertCalls.find((c) => c.values.isTest !== undefined);
    expect(tenantInsert).toBeDefined();
    expect(tenantInsert!.values.isTest).toBe(1);
    expect(tenantInsert!.values.publicActive).toBe(1);
    expect(tenantInsert!.values.isPersonal).toBe(0);
    expect(tenantInsert!.values.plan).toBe("pro");
    expect(tenantInsert!.values.billingStatus).toBe("active");

    const webUserInsert = insertCalls.find((c) => c.values.email !== undefined);
    expect(webUserInsert).toBeDefined();
    expect(webUserInsert!.values.role).toBe("tenant_owner");
    expect(webUserInsert!.values.emailVerified).toBe(1);
    expect(webUserInsert!.values.email).toBe("salon-pro@test.example");
    expect(typeof webUserInsert!.values.passwordHash).toBe("string");
    expect((webUserInsert!.values.passwordHash as string).length).toBeGreaterThan(40);
  });
});

describe("provisionTestAccount happy path (master)", () => {
  it("creates a personal tenant + masters row", async () => {
    const { db, insertCalls } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);

    const result = await caller.provisionTestAccount(tenantsByPlan("max", "master"));

    expect(result.role).toBe("master");
    expect(typeof result.masterId).toBe("number");
    expect(result.masterId!).toBeGreaterThanOrEqual(10_000_000_000);

    const tenantInsert = insertCalls.find((c) => c.values.isTest !== undefined);
    expect(tenantInsert!.values.isPersonal).toBe(1);

    const masterInsert = insertCalls.find((c) => c.values.chatId !== undefined);
    expect(masterInsert).toBeDefined();
    expect(masterInsert!.values.active).toBe(1);
  });
});

describe("provisionTestAccount expired_trial", () => {
  it("sets billing_status='trialing' and trial_ends_at < now", async () => {
    const { db, insertCalls } = createDbMock([[]]);
    const caller = createCaller(makeAdminCtx(db) as never);
    const now = Math.floor(Date.now() / 1000);

    const result = await caller.provisionTestAccount(tenantsByPlan("expired_trial"));

    expect(result.billingStatus).toBe("trialing");
    expect(result.plan).toBe("start");
    expect(result.currentPeriodEnd).toBeNull();
    expect(result.trialEndsAt!).toBeLessThan(now);

    const tenantInsert = insertCalls.find((c) => c.values.isTest !== undefined);
    expect(tenantInsert!.values.billingStatus).toBe("trialing");
    expect((tenantInsert!.values.trialEndsAt as number)).toBeLessThan(now);
  });
});

describe("provisionTestAccount safety", () => {
  it("never produces role=system_admin", async () => {
    for (const kind of ["salon", "master"] as const) {
      const { db, insertCalls } = createDbMock([[]]);
      const caller = createCaller(makeAdminCtx(db) as never);
      await caller.provisionTestAccount(tenantsByPlan("start", kind));
      const webUserInsert = insertCalls.find((c) => c.values.email !== undefined);
      expect(webUserInsert!.values.role).not.toBe("system_admin");
    }
  });
});

describe("provisionTestAccount idempotency", () => {
  it("returns skipped=true when web_user already exists on a test tenant", async () => {
    // First select call returns existing user; second select returns the test tenant row.
    const existing = [{ id: "wu_existing", tenantId: "t_existing", role: "tenant_owner" }];
    const tenantRow = [
      {
        id: "t_existing",
        isTest: 1,
        plan: "pro",
        billingStatus: "active",
        currentPeriodEnd: 1_900_000_000,
        trialEndsAt: null,
      },
    ];
    const { db, insertCalls } = createDbMock([existing, tenantRow]);
    const caller = createCaller(makeAdminCtx(db) as never);

    const result = await caller.provisionTestAccount(tenantsByPlan("pro"));

    expect(result.skipped).toBe(true);
    expect(result.tenantId).toBe("t_existing");
    expect(insertCalls.length).toBe(0);
  });

  it("rejects when email is bound to a non-test account", async () => {
    const existing = [{ id: "wu_real", tenantId: "t_real", role: "tenant_owner" }];
    const tenantRow = [{ id: "t_real", isTest: 0 }];
    const { db } = createDbMock([existing, tenantRow]);
    const caller = createCaller(makeAdminCtx(db) as never);

    await expect(caller.provisionTestAccount(tenantsByPlan("pro"))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
