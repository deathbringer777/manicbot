/**
 * Live Stripe read helpers used by the God Mode Billing dashboard's real-money
 * widgets: getBalance, listRecentCharges, listPayouts, listDisputes.
 *
 * These page Stripe live (vs. the D1 ledger which powers the historical chart).
 * Tests pin the request shape (path, param encoding, limit clamp) and the parse
 * (Stripe minor units preserved, has_more → hasMore). Version-pin coverage lives
 * in stripe-lib-version.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getBalance, listRecentCharges, listPayouts, listDisputes, voidOpenInvoicesForCustomer } from "~/server/lib/stripe";

const KEY = "sk_test_fin";

function urlOf(call: unknown[]): URL {
  return new URL(String((call as unknown[])[0]));
}

describe("admin-app stripe.ts — live financial read helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getBalance parses available/pending preserving minor units + currency", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ available: [{ amount: 12000, currency: "pln" }], pending: [{ amount: 3000, currency: "pln" }] }),
    });

    const res = await getBalance(KEY);

    expect(res.available).toEqual([{ amount: 12000, currency: "pln" }]);
    expect(res.pending).toEqual([{ amount: 3000, currency: "pln" }]);
    expect(urlOf(fetchMock.mock.calls[0]!).pathname).toBe("/v1/balance");
  });

  it("getBalance throws on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid API Key" } }) });
    await expect(getBalance(KEY)).rejects.toThrow();
  });

  it("listRecentCharges maps fields, clamps limit to 100, surfaces has_more", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{
          id: "ch_1", amount: 4500, currency: "pln", created: 100, status: "succeeded",
          paid: true, refunded: false, amount_refunded: 0, description: "Subscription",
          billing_details: { email: "a@b.co" },
        }],
        has_more: true,
      }),
    });

    const res = await listRecentCharges(KEY, { limit: 999 });

    expect(res.hasMore).toBe(true);
    expect(res.data[0]).toMatchObject({
      id: "ch_1", amount: 4500, currency: "pln", created: 100, status: "succeeded",
      paid: true, refunded: false, amountRefunded: 0, email: "a@b.co",
    });
    const u = urlOf(fetchMock.mock.calls[0]!);
    expect(u.pathname).toBe("/v1/charges");
    expect(u.searchParams.get("limit")).toBe("100");
  });

  it("listPayouts maps arrival_date → arrivalDate and status", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "po_1", amount: 50000, currency: "pln", arrival_date: 1700, status: "paid", created: 1600 }], has_more: false }),
    });

    const res = await listPayouts(KEY);

    expect(res.data[0]).toMatchObject({ id: "po_1", amount: 50000, currency: "pln", arrivalDate: 1700, status: "paid", created: 1600 });
    expect(urlOf(fetchMock.mock.calls[0]!).pathname).toBe("/v1/payouts");
  });

  it("listDisputes maps reason, status and evidence_details.due_by → dueBy", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "dp_1", amount: 4500, currency: "pln", reason: "fraudulent", status: "needs_response", created: 1500, evidence_details: { due_by: 1800 } }], has_more: false }),
    });

    const res = await listDisputes(KEY);

    expect(res.data[0]).toMatchObject({ id: "dp_1", amount: 4500, currency: "pln", reason: "fraudulent", status: "needs_response", created: 1500, dueBy: 1800 });
    expect(urlOf(fetchMock.mock.calls[0]!).pathname).toBe("/v1/disputes");
  });

  it("voidOpenInvoicesForCustomer lists status=open then POSTs /void for each", async () => {
    // 1st call: list open invoices for the customer
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "in_1" }, { id: "in_2" }] }),
    });
    // 2nd + 3rd calls: void each
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "in_1", status: "void" }) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "in_2", status: "void" }) });

    const res = await voidOpenInvoicesForCustomer(KEY, "cus_abc");

    expect(res.voided).toEqual(["in_1", "in_2"]);
    const listUrl = urlOf(fetchMock.mock.calls[0]!);
    expect(listUrl.pathname).toBe("/v1/invoices");
    expect(listUrl.searchParams.get("customer")).toBe("cus_abc");
    expect(listUrl.searchParams.get("status")).toBe("open");
    expect(urlOf(fetchMock.mock.calls[1]!).pathname).toBe("/v1/invoices/in_1/void");
    expect(urlOf(fetchMock.mock.calls[2]!).pathname).toBe("/v1/invoices/in_2/void");
  });

  it("voidOpenInvoicesForCustomer walks all pages before voiding (pagination)", async () => {
    // >100 open invoices must not leave the overflow un-voided. Both list pages
    // are fetched (cursor by starting_after) BEFORE any void, so flipping
    // invoices out of the status=open filter can't skip the overflow page.
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `in_${i + 1}` }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({ id: `in_${i + 101}` }));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: page1, has_more: true }) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: page2, has_more: false }) });
    for (let i = 1; i <= 150; i++) {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: `in_${i}`, status: "void" }) });
    }

    const res = await voidOpenInvoicesForCustomer(KEY, "cus_big");

    expect(res.voided).toHaveLength(150);
    // 2nd call is the page-2 LIST carrying the cursor, not a void POST.
    const page2Url = urlOf(fetchMock.mock.calls[1]!);
    expect(page2Url.pathname).toBe("/v1/invoices");
    expect(page2Url.searchParams.get("starting_after")).toBe("in_100");
    expect(page2Url.searchParams.get("status")).toBe("open");
    // Voids begin only after both list pages are collected.
    expect(urlOf(fetchMock.mock.calls[2]!).pathname).toBe("/v1/invoices/in_1/void");
  });

  it("voidOpenInvoicesForCustomer skips an invoice whose void fails (best-effort)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: "in_1" }, { id: "in_2" }] }) });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: "cannot void" } }) });
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "in_2", status: "void" }) });

    const res = await voidOpenInvoicesForCustomer(KEY, "cus_abc");

    expect(res.voided).toEqual(["in_2"]);
  });

  it("voidOpenInvoicesForCustomer returns empty (no list call) without a customer id", async () => {
    const res = await voidOpenInvoicesForCustomer(KEY, "");
    expect(res.voided).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
