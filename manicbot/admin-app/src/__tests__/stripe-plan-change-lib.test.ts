/**
 * Param-shape tests for the in-app plan-change / pause Stripe helpers. These
 * pin the exact REST encoding (especially the subscription-schedule downgrade
 * recipe) since this path can't be exercised against live Stripe in CI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  changeSubscriptionPlanImmediate,
  scheduleDowngradeAtPeriodEnd,
  releaseScheduledChange,
  pauseSubscription,
  resumeSubscription,
  previewPlanChange,
} from "~/server/lib/stripe";

const KEY = "sk_test_xxx";

function bodyParams(call: unknown[]): URLSearchParams {
  const opts = call[1] as { body?: string } | undefined;
  return new URLSearchParams(opts?.body ?? "");
}
function urlOf(call: unknown[]): string {
  return String(call[0]);
}
function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe("plan-change Stripe helpers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("upgrade replaces the item price with always_invoice + error_if_incomplete", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "sub_1", status: "active" }));
    await changeSubscriptionPlanImmediate(KEY, "sub_1", "si_1", "price_pro");
    const p = bodyParams(fetchMock.mock.calls[0]!);
    expect(urlOf(fetchMock.mock.calls[0]!)).toContain("/subscriptions/sub_1");
    expect(p.get("items[0][id]")).toBe("si_1");
    expect(p.get("items[0][price]")).toBe("price_pro");
    expect(p.get("proration_behavior")).toBe("always_invoice");
    expect(p.get("payment_behavior")).toBe("error_if_incomplete");
  });

  it("downgrade creates a schedule from the sub, then appends a cheaper phase (proration none + release)", async () => {
    fetchMock.mockResolvedValueOnce(ok({
      id: "sub_sched_1",
      phases: [{ start_date: 1000, end_date: 2000, items: [{ price: "price_pro", quantity: 1 }] }],
    }));
    fetchMock.mockResolvedValueOnce(ok({ id: "sub_sched_1" }));

    const res = await scheduleDowngradeAtPeriodEnd(KEY, "sub_1", "price_start");
    expect(res).toEqual({ scheduleId: "sub_sched_1", effectiveAt: 2000 });

    const create = bodyParams(fetchMock.mock.calls[0]!);
    expect(urlOf(fetchMock.mock.calls[0]!)).toContain("/subscription_schedules");
    expect(create.get("from_subscription")).toBe("sub_1");

    const mod = bodyParams(fetchMock.mock.calls[1]!);
    expect(urlOf(fetchMock.mock.calls[1]!)).toContain("/subscription_schedules/sub_sched_1");
    expect(mod.get("end_behavior")).toBe("release");
    expect(mod.get("phases[0][items][0][price]")).toBe("price_pro");
    expect(mod.get("phases[0][start_date]")).toBe("1000");
    expect(mod.get("phases[0][end_date]")).toBe("2000");
    expect(mod.get("phases[1][items][0][price]")).toBe("price_start");
    expect(mod.get("phases[1][items][0][quantity]")).toBe("1");
    expect(mod.get("phases[1][proration_behavior]")).toBe("none");
  });

  it("downgrade tolerates a price returned as an object {id}", async () => {
    fetchMock.mockResolvedValueOnce(ok({
      id: "sch_2",
      phases: [{ start_date: 5, end_date: 9, items: [{ price: { id: "price_pro" }, quantity: 1 }] }],
    }));
    fetchMock.mockResolvedValueOnce(ok({ id: "sch_2" }));
    const res = await scheduleDowngradeAtPeriodEnd(KEY, "sub_x", "price_start");
    expect(res.effectiveAt).toBe(9);
    expect(bodyParams(fetchMock.mock.calls[1]!).get("phases[0][items][0][price]")).toBe("price_pro");
  });

  it("downgrade throws (and never modifies) if the created schedule phase is incomplete", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "sch_3", phases: [{ items: [{ price: "p" }] }] }));
    await expect(scheduleDowngradeAtPeriodEnd(KEY, "sub_1", "price_start")).rejects.toThrow(/phase_incomplete/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("release POSTs to the schedule release endpoint", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "sch_1", status: "released" }));
    await releaseScheduledChange(KEY, "sch_1");
    expect(urlOf(fetchMock.mock.calls[0]!)).toContain("/subscription_schedules/sch_1/release");
  });

  it("pause sets pause_collection void + resumes_at when given", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "sub_1", status: "active" }));
    await pauseSubscription(KEY, "sub_1", 12345);
    const p = bodyParams(fetchMock.mock.calls[0]!);
    expect(p.get("pause_collection[behavior]")).toBe("void");
    expect(p.get("pause_collection[resumes_at]")).toBe("12345");
  });

  it("pause omits resumes_at for an indefinite pause", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "sub_1" }));
    await pauseSubscription(KEY, "sub_1");
    const p = bodyParams(fetchMock.mock.calls[0]!);
    expect(p.get("pause_collection[behavior]")).toBe("void");
    expect(p.has("pause_collection[resumes_at]")).toBe(false);
  });

  it("resume clears pause_collection", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "sub_1", status: "active" }));
    await resumeSubscription(KEY, "sub_1");
    expect(bodyParams(fetchMock.mock.calls[0]!).get("pause_collection")).toBe("");
  });

  it("previewPlanChange GETs the upcoming invoice for the new price and returns the amount", async () => {
    fetchMock.mockResolvedValueOnce(ok({ amount_due: 1234, currency: "pln" }));
    const res = await previewPlanChange(KEY, "sub_1", "si_1", "price_pro");
    expect(res).toEqual({ amountDue: 1234, currency: "pln" });
    expect(urlOf(fetchMock.mock.calls[0]!)).toContain("/invoices/upcoming");
    expect(urlOf(fetchMock.mock.calls[0]!)).toContain("subscription=sub_1");
  });
});
