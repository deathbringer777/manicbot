/**
 * billingRouter — God Mode real-money procedures (Stage 2 of the unified
 * Billing dashboard):
 *   - getStripeFinancials: LIVE balance / payouts / recent charges / disputes,
 *     fetched with per-section error isolation (Promise.allSettled) so a Stripe
 *     blip degrades one widget, never the whole page, and never throws.
 *   - getLedgerSummary: D1 read over `stripe_ledger` (synced by the Worker cron)
 *     — daily revenue series + totals + estimated-MRR-vs-actual-net reconciliation.
 *
 * All money is Stripe minor units (PLN grosze) end to end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    STRIPE_SECRET_KEY: undefined as string | undefined,
  },
}));

import { env } from "~/env";
import { createCallerFactory } from "~/server/api/trpc";
import { billingRouter } from "~/server/api/routers/billing";
import { createDbMock, makeAdminCtx, makeUnauthCtx, makeForbiddenWebCtx } from "./helpers/db-mock";

const createCaller = createCallerFactory(billingRouter);
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;

function setKey(v: string | undefined) {
  (env as unknown as { STRIPE_SECRET_KEY: string | undefined }).STRIPE_SECRET_KEY = v;
}

describe("getStripeFinancials (live)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setKey("sk_test_fin");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws UNAUTHORIZED / FORBIDDEN for non-admins", async () => {
    const { db } = createDbMock();
    await expect(createCaller(makeUnauthCtx(db) as never).getStripeFinancials()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(createCaller(makeForbiddenWebCtx(db) as never).getStripeFinancials()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns configured:false and makes no Stripe calls when the key is absent", async () => {
    setKey(undefined);
    const { db } = createDbMock();
    const res = await createCaller(makeAdminCtx(db) as never).getStripeFinancials();
    expect(res.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aggregates balance / payouts / charges / disputes on the happy path", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ available: [{ amount: 12000, currency: "pln" }], pending: [] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: "po_1", amount: 50000, currency: "pln", arrival_date: 1700, status: "paid", created: 1600 }], has_more: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: "ch_1", amount: 4500, currency: "pln", created: 100, status: "succeeded", paid: true }], has_more: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [], has_more: false }) });

    const { db } = createDbMock();
    const res = await createCaller(makeAdminCtx(db) as never).getStripeFinancials();

    expect(res.configured).toBe(true);
    expect(res.liveMode).toBe(false);
    expect(res.balance?.available[0]?.amount).toBe(12000);
    expect(res.payouts.rows[0]?.id).toBe("po_1");
    expect(res.charges.rows[0]?.id).toBe("ch_1");
    expect(res.disputes.rows).toHaveLength(0);
    expect(res.errors).toHaveLength(0);
  });

  it("degrades per-section when one Stripe call fails — no throw, others intact", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ available: [{ amount: 12000, currency: "pln" }], pending: [] }) })
      .mockRejectedValueOnce(new Error("payouts down"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: "ch_1", amount: 4500, currency: "pln", created: 100, status: "succeeded", paid: true }], has_more: false }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [], has_more: false }) });

    const { db } = createDbMock();
    const res = await createCaller(makeAdminCtx(db) as never).getStripeFinancials();

    expect(res.balance).not.toBeNull();
    expect(res.payouts.error).toBe(true);
    expect(res.payouts.rows).toHaveLength(0);
    expect(res.charges.rows[0]?.id).toBe("ch_1");
    expect(res.errors).toContain("payouts");
  });

  it("flags liveMode true for an sk_live_ key", async () => {
    setKey("sk_live_xyz");
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ available: [], pending: [], data: [] }) });
    const { db } = createDbMock();
    const res = await createCaller(makeAdminCtx(db) as never).getStripeFinancials();
    expect(res.liveMode).toBe(true);
  });
});

describe("getLedgerSummary (D1 ledger)", () => {
  beforeEach(() => setKey("sk_test_fin"));

  it("throws UNAUTHORIZED when unauthenticated", async () => {
    const { db } = createDbMock();
    await expect(createCaller(makeUnauthCtx(db) as never).getLedgerSummary({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("buckets ledger rows into a daily series and computes totals + reconciliation", async () => {
    const t0 = now - 5 * DAY;
    const ledger = [
      { type: "charge", amount: 4500, fee: 100, net: 4400, created: t0 },
      { type: "charge", amount: 6000, fee: 150, net: 5850, created: t0 + 10 },
      { type: "refund", amount: -4500, fee: 0, net: -4500, created: t0 + DAY },
    ];
    const tenants = [
      { plan: "pro", billingStatus: "active" },
      { plan: "max", billingStatus: "active" },
      { plan: "start", billingStatus: "trialing" }, // excluded from MRR (not active)
    ];

    const { db } = createDbMock([ledger, tenants]);
    const res = await createCaller(makeAdminCtx(db) as never).getLedgerSummary({ days: 30 });

    // gross = charge amounts only (4500+6000); net = all net (4400+5850-4500); fee = 100+150+0
    expect(res.totals.gross).toBe(10500);
    expect(res.totals.net).toBe(5750);
    expect(res.totals.fee).toBe(250);
    // series covers every row (sum of points == totals), at least one bucket
    expect(res.series.length).toBeGreaterThanOrEqual(1);
    expect(res.series.reduce((s: number, p: { net: number }) => s + p.net, 0)).toBe(5750);
    // reconciliation: estimatedMRR = pro(60)+max(90) = 150 PLN → 15000 grosze
    expect(res.reconciliation.estimatedMrrMinor).toBe(15000);
    expect(res.reconciliation.actualNet30dMinor).toBe(5750);
  });
});
