/**
 * PR-B / migration 0069 — referrals tRPC router.
 *
 * Covers the eligibility matrix, code auto-generation, dashboard counters
 * (rolling 12mo cap math), validateCode rate limiting, and the
 * `recordRedemption` server helper that webUsers.register calls.
 *
 * Heavy webhook + fraud flow is covered in Worker tests under manicbot/test/.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
    BOT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  },
}));
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: 0 })),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { referralsRouter, recordRedemption, __testing__ } from "~/server/api/routers/referrals";
import {
  createDbMock,
  makeAdminCtx,
  makeTenantOwnerCtx,
  makeTenantManagerCtx,
  makeMasterCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

const TENANT = "t_alpha";

describe("referrals.assertReferralEligible (via getMyCode)", () => {
  const createCaller = createCallerFactory(referralsRouter);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_715_000_000 * 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("UNAUTHORIZED for unauthenticated callers", async () => {
    const mock = createDbMock([]);
    const caller = createCaller(makeUnauthCtx(mock.db));
    await expect(caller.getMyCode()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("tenant_owner gets a fresh code on first call (idempotent on second)", async () => {
    // First call: no existing row -> insert new. Second call: existing row -> return same code.
    const mock = createDbMock([
      [], // existing referral_codes lookup → empty
      [{ code: "OWNE-AB23K" }], // simulated existing row after insert (next getMyCode call)
    ]);
    const caller = createCaller(makeTenantOwnerCtx(mock.db, TENANT));

    const a = await caller.getMyCode();
    expect(a.code).toMatch(/^[A-Z]{4}-[A-Z0-9]{5}$/);
    expect(a.shareUrl).toContain(`?ref=${encodeURIComponent(a.code)}`);

    const b = await caller.getMyCode();
    expect(b.code).toBe("OWNE-AB23K");
  });

  it("FORBIDDEN for tenant_manager (staff, not customer)", async () => {
    const mock = createDbMock([]);
    const caller = createCaller(makeTenantManagerCtx(mock.db, TENANT));
    await expect(caller.getMyCode()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("master on PERSONAL tenant → allowed", async () => {
    const mock = createDbMock([
      [{ isPersonal: 1 }],   // tenants.isPersonal lookup
      [],                    // existing referral_codes lookup
    ]);
    const caller = createCaller(makeMasterCtx(mock.db, TENANT));
    const out = await caller.getMyCode();
    expect(out.code).toMatch(/^[A-Z]{4}-[A-Z0-9]{5}$/);
  });

  it("master on NON-personal tenant → FORBIDDEN", async () => {
    const mock = createDbMock([
      [{ isPersonal: 0 }],
    ]);
    const caller = createCaller(makeMasterCtx(mock.db, TENANT));
    await expect(caller.getMyCode()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("system_admin without an impersonated tenant → BAD_REQUEST", async () => {
    const mock = createDbMock([]);
    const caller = createCaller(makeAdminCtx(mock.db));
    await expect(caller.getMyCode()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("referrals.getMyDashboard counters", () => {
  const createCaller = createCallerFactory(referralsRouter);

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_715_000_000 * 1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aggregates pending/confirmed/rewarded counts + months-remaining cap", async () => {
    const now = 1_715_000_000;
    const inviteRows = [
      { id: "r1", status: "pending",     createdAt: now - 86400, rewardId: null, inviteeName: "Anna Kostyuk",  inviteeEmail: "anna@example.com" },
      { id: "r2", status: "first_paid",  createdAt: now - 172800, rewardId: null, inviteeName: null,            inviteeEmail: "bob@example.com" },
      { id: "r3", status: "rewarded",    createdAt: now - 200000, rewardId: "rw1", inviteeName: "Maria Petrov",  inviteeEmail: "maria@example.com" },
      { id: "r4", status: "invalidated", createdAt: now - 500000, rewardId: null, inviteeName: "Bad Actor",     inviteeEmail: "bad@example.com" },
    ];
    const rewardRows = [
      // applied within the rolling 12mo
      { id: "rw1", kind: "free_month", amountGrosz: 6000, status: "applied",  appliedAt: now - 100, expiresAt: now + 365 * 86400, createdAt: now - 200000 },
      // applied outside the rolling 12mo (shouldn't count toward cap)
      { id: "rw2", kind: "free_month", amountGrosz: 4500, status: "applied",  appliedAt: now - 100, expiresAt: now + 86400,       createdAt: now - 400 * 86400 },
      // pending (not applied) — does not count toward cap
      { id: "rw3", kind: "free_month", amountGrosz: 9000, status: "pending",  appliedAt: null,      expiresAt: now + 365 * 86400, createdAt: now - 50 },
    ];

    const mock = createDbMock([
      [{ code: "OWNE-AB23K" }], // active code lookup
      inviteRows,                // invited rows
      rewardRows,                // reward rows
    ]);
    const caller = createCaller(makeTenantOwnerCtx(mock.db, TENANT));

    const out = await caller.getMyDashboard();
    expect(out.code).toBe("OWNE-AB23K");
    expect(out.shareUrl).toContain("?ref=OWNE-AB23K");

    expect(out.counters.pending).toBe(1);
    expect(out.counters.firstPaid).toBe(1);
    expect(out.counters.rewarded).toBe(1);
    expect(out.counters.invalidated).toBe(1);
    // applied rewards: rw1 (6000, in-window) + rw2 (4500, out-of-window). Both count toward totalEarned.
    expect(out.counters.totalEarnedGrosz).toBe(10500);
    // Only rw1 counts toward the 12mo cap.
    expect(out.counters.monthsUsedInRollingYear).toBe(1);
    expect(out.counters.monthsRemainingInCap).toBe(5);

    // Invitee names should be masked.
    expect(out.invited[0]!.inviteeMaskedName).toMatch(/^Anna K\.?$/);
    expect(out.invited[3]!.inviteeMaskedName).toMatch(/^Bad A\.?$/);
  });
});

describe("referrals.validateCode", () => {
  const createCaller = createCallerFactory(referralsRouter);

  it("returns { valid: false } on unknown code without leaking detail", async () => {
    const mock = createDbMock([[]]); // code lookup → empty
    const caller = createCaller(makeUnauthCtx(mock.db));
    const out = await caller.validateCode({ code: "BOGU-SXXXX" });
    expect(out.valid).toBe(false);
    expect((out as { ownerDisplayName: string | null }).ownerDisplayName).toBeNull();
  });

  it("returns { valid: true, ownerDisplayName } on a real active code", async () => {
    const mock = createDbMock([
      [{ ownerWebUserId: "w_owner", ownerTenantId: TENANT, isActive: 1 }],
      [{ name: "Anna Kostyuk", email: "anna@example.com" }],
    ]);
    const caller = createCaller(makeUnauthCtx(mock.db));
    const out = await caller.validateCode({ code: "ANNA-K2X7M" });
    expect(out.valid).toBe(true);
    expect((out as { ownerDisplayName: string }).ownerDisplayName).toBe("Anna Kostyuk");
    expect((out as { expectedInviteeDiscountMonthly: number }).expectedInviteeDiscountMonthly).toBe(20);
    expect((out as { expectedInviteeDiscountYearly: number }).expectedInviteeDiscountYearly).toBe(10);
  });

  it("returns { valid: false } on an archived (is_active=0) code", async () => {
    const mock = createDbMock([
      [{ ownerWebUserId: "w_owner", ownerTenantId: TENANT, isActive: 0 }],
    ]);
    const caller = createCaller(makeUnauthCtx(mock.db));
    const out = await caller.validateCode({ code: "ANNA-K2X7M" });
    expect(out.valid).toBe(false);
  });
});

describe("recordRedemption (server helper, not a procedure)", () => {
  it("self_referral_web_user when invitee == referrer", async () => {
    const mock = createDbMock([
      [{ ownerWebUserId: "w_self", ownerTenantId: "t_owner", isActive: 1 }],
    ]);
    const res = await recordRedemption(mock.db as never, {
      code: "SELF-AB23K",
      inviteeWebUserId: "w_self",
      inviteeTenantId: "t_invitee_new",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("self_referral_web_user");
  });

  it("self_referral_tenant when invitee tenant == referrer tenant", async () => {
    const mock = createDbMock([
      [{ ownerWebUserId: "w_owner", ownerTenantId: "t_alpha", isActive: 1 }],
    ]);
    const res = await recordRedemption(mock.db as never, {
      code: "ANNA-K2X7M",
      inviteeWebUserId: "w_invitee",
      inviteeTenantId: "t_alpha",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("self_referral_tenant");
  });

  it("invalid_code on unknown or inactive code", async () => {
    const mock = createDbMock([[]]);
    const res = await recordRedemption(mock.db as never, {
      code: "GHOS-T2X7M",
      inviteeWebUserId: "w_invitee",
      inviteeTenantId: "t_invitee",
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("invalid_code");
  });

  it("happy path: inserts a referrals row in pending status + audit event", async () => {
    const mock = createDbMock([
      [{ ownerWebUserId: "w_owner", ownerTenantId: "t_alpha", isActive: 1 }],
    ]);
    const res = await recordRedemption(mock.db as never, {
      code: "ANNA-K2X7M",
      inviteeWebUserId: "w_invitee",
      inviteeTenantId: "t_invitee",
    });
    expect(res.ok).toBe(true);
    expect(res.referralId).toBeDefined();
    const pendingInsert = mock.insertCalls.find((c) => c.values.status === "pending");
    expect(pendingInsert).toBeDefined();
    expect(pendingInsert!.values.referrerWebUserId).toBe("w_owner");
    expect(pendingInsert!.values.inviteeWebUserId).toBe("w_invitee");
    const eventInsert = mock.insertCalls.find((c) => c.values.event === "code_redeemed");
    expect(eventInsert).toBeDefined();
  });
});

describe("code shape + masking", () => {
  it("generateReferralCode returns 10-char SLUG-TOKEN", () => {
    for (let i = 0; i < 50; i += 1) {
      const c = __testing__.generateReferralCode("anna.kostyuk@example.com");
      expect(c).toMatch(/^[A-Z]{4}-[A-Z2-9]{5}$/);
      // No look-alike chars in the token
      expect(c.slice(5)).not.toMatch(/[01OI]/);
    }
  });

  it("maskName uses first name + last initial when both available", () => {
    expect(__testing__.maskName("Anna Kostyuk", "")).toBe("Anna K.");
  });

  it("maskName uses first-initial-only when single token", () => {
    expect(__testing__.maskName("Anna", "")).toBe("A.");
  });

  it("maskName uses email prefix when no name", () => {
    expect(__testing__.maskName(null, "anna@example.com")).toBe("an…");
  });
});
