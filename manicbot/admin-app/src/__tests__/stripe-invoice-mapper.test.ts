import { describe, it, expect } from "vitest";
import { mapStripeInvoiceRow } from "~/server/lib/stripe";

describe("mapStripeInvoiceRow", () => {
  it("uses amount_paid for a paid invoice and uppercases currency", () => {
    const r = mapStripeInvoiceRow({
      id: "in_1",
      number: "ABC-001",
      created: 1_700_000_000,
      amount_paid: 9000,
      amount_due: 0,
      currency: "pln",
      status: "paid",
      hosted_invoice_url: "https://stripe.test/i/1",
      invoice_pdf: "https://stripe.test/i/1.pdf",
    });
    expect(r).toEqual({
      id: "in_1",
      number: "ABC-001",
      created: 1_700_000_000,
      amount: 9000,
      currency: "PLN",
      status: "paid",
      paid: true,
      hostedUrl: "https://stripe.test/i/1",
      pdfUrl: "https://stripe.test/i/1.pdf",
    });
  });

  it("uses amount_due for an unpaid (open) invoice", () => {
    const r = mapStripeInvoiceRow({
      id: "in_2",
      created: 1_700_000_100,
      amount_paid: 0,
      amount_due: 6000,
      currency: "pln",
      status: "open",
    });
    expect(r.paid).toBe(false);
    expect(r.amount).toBe(6000);
    expect(r.status).toBe("open");
    expect(r.number).toBeNull();
    expect(r.hostedUrl).toBeNull();
    expect(r.pdfUrl).toBeNull();
  });

  it("treats paid=true as paid even if status is missing", () => {
    const r = mapStripeInvoiceRow({ id: "in_3", paid: true, amount_paid: 4500, currency: "usd" });
    expect(r.paid).toBe(true);
    expect(r.amount).toBe(4500);
    expect(r.currency).toBe("USD");
  });

  it("defaults numeric/string fields safely on a sparse object", () => {
    const r = mapStripeInvoiceRow({ id: "in_4" });
    expect(r.amount).toBe(0);
    expect(r.created).toBe(0);
    expect(r.currency).toBe("");
    expect(r.status).toBe("");
    expect(r.paid).toBe(false);
  });
});
