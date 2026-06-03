/**
 * S2 Fix 6 — every admin-app Stripe REST call must pin `Stripe-Version`.
 *
 * The Worker side (`manicbot/src/billing/stripe.js`) pins `2024-06-20` on
 * every request via authHeader(). The admin-app `server/lib/stripe.ts` did
 * NOT send the header at all, so it floated on whatever default version is
 * attached to the API key in the Stripe dashboard. That matters because
 * `current_period_end` moved from the subscription root into `items[].` in
 * API version 2025-04-01: an unpinned admin-app reading the root field would
 * silently get `undefined` after a dashboard-side version bump.
 *
 * These tests capture the headers passed to fetch for every exported helper
 * and assert the pinned version is present. They are header-capture only —
 * the Stripe response bodies are stubbed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getOrCreateCustomer,
  createOneTimePercentOffCoupon,
  createCheckoutSession,
  createEmbeddedCheckoutSession,
  createBillingPortalSession,
  retrieveSubscription,
  ensureCoupon,
  applyCouponToSubscription,
  cancelSubscriptionAtPeriodEnd,
  getBalance,
  listRecentCharges,
  listPayouts,
  listDisputes,
} from "~/server/lib/stripe";

const PINNED = "2024-06-20";
const KEY = "sk_test_version_pin";

/** Pull the headers object out of a captured fetch call (2nd arg, or default GET). */
function headersOf(call: unknown[]): Record<string, string> {
  const init = (call?.[1] ?? {}) as { headers?: Record<string, string> };
  return init.headers ?? {};
}

describe("admin-app stripe.ts — Stripe-Version pin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("every helper sends Stripe-Version: 2024-06-20", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // A permissive mock: any GET/POST resolves ok with a body broad enough
      // for all helpers (id/url/client_secret/percent_off/...).
      fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "obj_1",
          url: "https://stripe.test/redirect",
          client_secret: "cs_test_secret",
          percent_off: 50,
          duration: "repeating",
          duration_in_months: 3,
          cancel_at_period_end: true,
          current_period_end: 1893456000,
          status: "active",
          data: [{ id: "cus_1", email: null }],
        }),
      }));
      vi.stubGlobal("fetch", fetchMock);
    });

    it("getOrCreateCustomer (search GET + create POST both pinned)", async () => {
      // Force the create branch: search returns no data → POST customer.
      fetchMock.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      }));
      await getOrCreateCustomer(KEY, { tenantId: "t1", name: "Salon", email: "a@b.co" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const call of fetchMock.mock.calls) {
        expect(headersOf(call)["Stripe-Version"]).toBe(PINNED);
      }
    });

    it("createOneTimePercentOffCoupon", async () => {
      await createOneTimePercentOffCoupon(KEY, { percentOff: 20, name: "x" });
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("createCheckoutSession", async () => {
      await createCheckoutSession(KEY, {
        customerId: "cus_1",
        priceId: "price_1",
        successUrl: "https://app/s",
        cancelUrl: "https://app/c",
        tenantId: "t1",
        plan: "pro",
      });
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("createEmbeddedCheckoutSession", async () => {
      await createEmbeddedCheckoutSession(KEY, {
        customerId: "cus_1",
        priceId: "price_1",
        returnUrl: "https://app/r",
        tenantId: "t1",
        plan: "pro",
      });
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("createBillingPortalSession", async () => {
      await createBillingPortalSession(KEY, { customerId: "cus_1", returnUrl: "https://app/r" });
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("retrieveSubscription", async () => {
      await retrieveSubscription(KEY, "sub_1");
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("applyCouponToSubscription", async () => {
      await applyCouponToSubscription(KEY, "sub_1", "COUPON");
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("cancelSubscriptionAtPeriodEnd", async () => {
      await cancelSubscriptionAtPeriodEnd(KEY, "sub_1");
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("getBalance", async () => {
      await getBalance(KEY);
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("listRecentCharges", async () => {
      await listRecentCharges(KEY, { limit: 5 });
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("listPayouts", async () => {
      await listPayouts(KEY);
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("listDisputes", async () => {
      await listDisputes(KEY);
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });
  });

  describe("ensureCoupon pins the version on GET, POST, and the duplicate re-GET", () => {
    it("existing coupon (single GET) is pinned", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "C", percent_off: 50, duration: "repeating" }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      await ensureCoupon(KEY, "C", 50, { duration: "repeating", months: 3 });
      expect(headersOf(fetchMock.mock.calls[0]!)["Stripe-Version"]).toBe(PINNED);
    });

    it("missing coupon → GET 404 then POST create, both pinned", async () => {
      const fetchMock = vi
        .fn()
        // GET → 404
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
        // POST create → ok
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: "C", percent_off: 50, duration: "repeating" }),
        });
      vi.stubGlobal("fetch", fetchMock);
      await ensureCoupon(KEY, "C", 50, { duration: "repeating", months: 3 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const call of fetchMock.mock.calls) {
        expect(headersOf(call)["Stripe-Version"]).toBe(PINNED);
      }
    });

    it("duplicate-race → GET 404, POST 400 already-exists, re-GET — all pinned", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({ error: { code: "resource_already_exists" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: "C", percent_off: 50, duration: "repeating" }),
        });
      vi.stubGlobal("fetch", fetchMock);
      await ensureCoupon(KEY, "C", 50, { duration: "repeating", months: 3 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      for (const call of fetchMock.mock.calls) {
        expect(headersOf(call)["Stripe-Version"]).toBe(PINNED);
      }
    });
  });
});
