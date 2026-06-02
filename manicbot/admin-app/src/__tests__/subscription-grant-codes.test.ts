/**
 * Admin-issued subscription grant codes (migration 0103).
 *
 * Covers code primitives (format/entropy/hashing), the systemAdminProcedure
 * generate/list/revoke surface, the registration-time redemption helper, and
 * the validate-time peek — including the security-critical paths: a random
 * never-generated string is rejected, a code is one-time, and a lost atomic
 * claim never grants.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { WORKER_PUBLIC_URL: "https://worker.test", AUTH_SECRET: "test-secret" },
}));
vi.mock("~/server/auth/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: 0 })),
}));

import { createCallerFactory } from "~/server/api/trpc";
import {
  subscriptionGrantCodesRouter,
  generateGrantCode,
  isGrantCode,
  hashGrantCode,
  normalizeGrantCode,
  peekGrantCode,
  redeemGrantCodeAtRegistration,
  GRANT_CODE_PREFIX,
} from "~/server/api/routers/subscriptionGrantCodes";
import {
  createDbMock,
  makeAdminCtx,
  makeUnauthCtx,
  makeTenantOwnerCtx,
} from "./helpers/db-mock";

const FIXED = 1_715_000_000;
const YEAR = 365 * 86400;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(FIXED * 1000);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("grant code primitives", () => {
  it("generateGrantCode → SVC- prefix, no-look-alike token, fits the register regex", () => {
    const c = generateGrantCode();
    expect(c.startsWith(GRANT_CODE_PREFIX)).toBe(true);
    expect(c).toMatch(/^SVC-[A-HJ-NP-Z2-9]{11}$/); // no 0/O/1/I
    expect(c).toMatch(/^[A-Z0-9-]{6,16}$/); // accepted by webUsers.register / referrals.validateCode
    expect(generateGrantCode()).not.toBe(c); // random
    expect(isGrantCode(c)).toBe(true);
  });

  it("isGrantCode: true for SVC- (any case), false for referral-shaped / random", () => {
    expect(isGrantCode("SVC-ABCDEFGHJKL")).toBe(true);
    expect(isGrantCode("svc-abcdefghjkl")).toBe(true);
    expect(isGrantCode("OWNE-AB23K")).toBe(false); // referral shape [A-Z]{4}-...
    expect(isGrantCode("RANDOMSTRING")).toBe(false);
  });

  it("hashGrantCode → 64-hex, normalized (case/space-insensitive), deterministic", async () => {
    const h1 = await hashGrantCode("SVC-ABCDEFGHJKL");
    const h2 = await hashGrantCode("  svc-abcdefghjkl ");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(normalizeGrantCode("  svc-x ")).toBe("SVC-X");
  });
});

describe("generate (systemAdminProcedure)", () => {
  const createCaller = createCallerFactory(subscriptionGrantCodesRouter);

  it("stores the hash (never the plaintext) and returns the plaintext once", async () => {
    const mock = createDbMock();
    const res = await createCaller(makeAdminCtx(mock.db)).generate({
      plan: "max",
      durationDays: 365,
      count: 2,
      note: "QA tester",
    });

    expect(res.codes).toHaveLength(2);
    // 2 code inserts + 1 audit insert
    const codeInserts = mock.insertCalls.filter((c) => "codeHash" in c.values);
    expect(codeInserts).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const code = res.codes[i]!.code;
      const stored = codeInserts[i]!.values;
      expect(code).toMatch(/^SVC-[A-HJ-NP-Z2-9]{11}$/);
      expect(String(stored.codeHash)).toMatch(/^[0-9a-f]{64}$/);
      expect(String(stored.codeHash)).not.toContain(code); // plaintext not persisted
      expect(await hashGrantCode(code)).toBe(stored.codeHash); // hash matches the issued code
      expect(stored.plan).toBe("max");
      expect(stored.durationDays).toBe(365);
      expect(stored.status).toBe("active");
      expect(stored.note).toBe("QA tester");
    }
  });

  it("UNAUTHORIZED for unauthenticated, FORBIDDEN for non-system_admin", async () => {
    await expect(
      createCaller(makeUnauthCtx(createDbMock().db)).generate({ plan: "max" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      createCaller(makeTenantOwnerCtx(createDbMock().db, "t_x")).generate({ plan: "max" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("redeemGrantCodeAtRegistration", () => {
  const TENANT = "t_new";
  const WU = "w_new";
  const activeRow = (over: Record<string, unknown> = {}) => ({
    id: "g1",
    plan: "max",
    durationDays: 365,
    status: "active",
    expiresAt: null,
    ...over,
  });
  const grant = (m: ReturnType<typeof createDbMock>) =>
    m.updateCalls.find((u) => u.values.billingStatus === "active");

  it("valid active code → atomic claim wins → grants the max year", async () => {
    const mock = createDbMock([[activeRow()]], [[{ id: "g1" }]]);
    const out = await redeemGrantCodeAtRegistration(mock.db as never, {
      code: "SVC-ABCDEFGHJKL",
      tenantId: TENANT,
      webUserId: WU,
      actor: "admin@test.com",
    });
    expect(out).toMatchObject({ ok: true, plan: "max", periodEnd: FIXED + YEAR });
    expect(grant(mock)?.values.plan).toBe("max");
    expect(grant(mock)?.values.currentPeriodEnd).toBe(FIXED + YEAR);
    expect(grant(mock)?.values.trialEndsAt).toBeNull();
  });

  it("random / never-generated string → not_found, no grant", async () => {
    const mock = createDbMock([[]]);
    const out = await redeemGrantCodeAtRegistration(mock.db as never, {
      code: "SVC-ZZZZZZZZZZZ",
      tenantId: TENANT,
      webUserId: WU,
      actor: "a",
    });
    expect(out).toMatchObject({ ok: false, reason: "not_found" });
    expect(grant(mock)).toBeUndefined();
  });

  it("revoked code → revoked, no grant", async () => {
    const mock = createDbMock([[activeRow({ status: "revoked" })]]);
    const out = await redeemGrantCodeAtRegistration(mock.db as never, {
      code: "SVC-ABCDEFGHJKL",
      tenantId: TENANT,
      webUserId: WU,
      actor: "a",
    });
    expect(out).toMatchObject({ ok: false, reason: "revoked" });
    expect(grant(mock)).toBeUndefined();
  });

  it("already-redeemed code → already_redeemed, no grant", async () => {
    const mock = createDbMock([[activeRow({ status: "redeemed" })]]);
    const out = await redeemGrantCodeAtRegistration(mock.db as never, {
      code: "SVC-ABCDEFGHJKL",
      tenantId: TENANT,
      webUserId: WU,
      actor: "a",
    });
    expect(out).toMatchObject({ ok: false, reason: "already_redeemed" });
    expect(grant(mock)).toBeUndefined();
  });

  it("expired code → expired, no grant", async () => {
    const mock = createDbMock([[activeRow({ expiresAt: FIXED - 10 })]]);
    const out = await redeemGrantCodeAtRegistration(mock.db as never, {
      code: "SVC-ABCDEFGHJKL",
      tenantId: TENANT,
      webUserId: WU,
      actor: "a",
    });
    expect(out).toMatchObject({ ok: false, reason: "expired" });
    expect(grant(mock)).toBeUndefined();
  });

  it("concurrent loser (atomic claim returns no row) → already_redeemed, no grant", async () => {
    // SELECT sees an active row, but the conditional UPDATE claims nothing
    // because a concurrent redeemer already flipped status → returning [].
    const mock = createDbMock([[activeRow()]], [[]]);
    const out = await redeemGrantCodeAtRegistration(mock.db as never, {
      code: "SVC-ABCDEFGHJKL",
      tenantId: TENANT,
      webUserId: WU,
      actor: "a",
    });
    expect(out).toMatchObject({ ok: false, reason: "already_redeemed" });
    expect(grant(mock)).toBeUndefined();
  });
});

describe("peekGrantCode (validateCode support — never consumes)", () => {
  it("active → valid + plan, no mutation", async () => {
    const mock = createDbMock([[{ id: "g1", plan: "max", durationDays: 365, status: "active", expiresAt: null }]]);
    expect(await peekGrantCode(mock.db as never, "SVC-ABCDEFGHJKL")).toMatchObject({ valid: true, plan: "max" });
    expect(mock.updateCalls).toHaveLength(0);
  });

  it("revoked / expired / unknown → invalid", async () => {
    expect(await peekGrantCode(createDbMock([[{ status: "revoked" }]]).db as never, "SVC-X")).toMatchObject({ valid: false });
    expect(await peekGrantCode(createDbMock([[{ status: "active", expiresAt: FIXED - 1 }]]).db as never, "SVC-X")).toMatchObject({ valid: false });
    expect(await peekGrantCode(createDbMock([[]]).db as never, "SVC-X")).toMatchObject({ valid: false });
  });
});

describe("list + revoke (systemAdminProcedure)", () => {
  const createCaller = createCallerFactory(subscriptionGrantCodesRouter);

  it("list never returns codeHash", async () => {
    const mock = createDbMock([
      [{ id: "g1", codePrefix: "SVC-7K9", plan: "max", durationDays: 365, status: "active", note: "QA", createdBy: "a", createdAt: FIXED, expiresAt: null, redeemedByTenantId: null, redeemedAt: null }],
    ]);
    const rows = await createCaller(makeAdminCtx(mock.db)).list({});
    expect(rows[0]).not.toHaveProperty("codeHash");
    expect(rows[0]!.codePrefix).toBe("SVC-7K9");
  });

  it("revoke flips an active code; guard blocks non-admins", async () => {
    const mock = createDbMock([], [[{ id: "g1" }]]);
    expect(await createCaller(makeAdminCtx(mock.db)).revoke({ id: "g1" })).toMatchObject({ ok: true });
    await expect(
      createCaller(makeUnauthCtx(createDbMock().db)).revoke({ id: "g1" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
