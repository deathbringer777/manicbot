/**
 * Tests for `voidOpenInvoicesForCustomer` (Worker) — the helper that voids a
 * customer's still-open invoices on cancellation so Stripe stops dunning
 * (retry charges + "update your card" emails) on a sub that has been cancelled.
 *
 * Contract:
 *   1. GET /v1/invoices?customer=…&status=open — only open invoices are voidable.
 *   2. POST /v1/invoices/{id}/void for each.
 *   3. Per-invoice failures are swallowed (best-effort); no customer id → no-op.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { voidOpenInvoicesForCustomer } from '../src/billing/stripe.js';

const SECRET = 'sk_test_void_xxx';

function makeFetchMock() {
  const calls = [];
  const responses = [];
  const mock = vi.fn(async (url, opts) => {
    calls.push({ url, method: opts?.method ?? 'GET' });
    const next = responses.shift();
    if (!next) throw new Error(`unmocked fetch: ${opts?.method ?? 'GET'} ${url}`);
    return new Response(next.body == null ? '' : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { mock, calls, responses };
}

describe('voidOpenInvoicesForCustomer — Worker', () => {
  let fx;
  beforeEach(() => {
    fx = makeFetchMock();
    vi.stubGlobal('fetch', fx.mock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists open invoices then voids each', async () => {
    fx.responses.push({ status: 200, body: { data: [{ id: 'in_1' }, { id: 'in_2' }] } });
    fx.responses.push({ status: 200, body: { id: 'in_1', status: 'void' } });
    fx.responses.push({ status: 200, body: { id: 'in_2', status: 'void' } });

    const res = await voidOpenInvoicesForCustomer(SECRET, 'cus_abc');

    expect(res.voided).toEqual(['in_1', 'in_2']);
    expect(fx.calls[0].url).toContain('/invoices?customer=cus_abc&status=open');
    expect(fx.calls[1].url).toContain('/invoices/in_1/void');
    expect(fx.calls[1].method).toBe('POST');
    expect(fx.calls[2].url).toContain('/invoices/in_2/void');
  });

  it('walks all pages (pagination) then voids every collected invoice', async () => {
    // Stripe caps a list page at 100. A customer with >100 open invoices must
    // not leave the overflow un-voided — it would keep dunning them. The list
    // is walked fully (cursor by starting_after) BEFORE any void, so flipping
    // invoices out of the status=open filter can't skip the overflow page.
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `in_${i + 1}` }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({ id: `in_${i + 101}` }));
    fx.responses.push({ status: 200, body: { data: page1, has_more: true } });
    fx.responses.push({ status: 200, body: { data: page2, has_more: false } });
    for (let i = 1; i <= 150; i++) {
      fx.responses.push({ status: 200, body: { id: `in_${i}`, status: 'void' } });
    }

    const res = await voidOpenInvoicesForCustomer(SECRET, 'cus_big');

    expect(res.voided).toHaveLength(150);
    // 2nd fetch is the page-2 LIST carrying the cursor — not a void POST.
    expect(fx.calls[1].method).toBe('GET');
    expect(fx.calls[1].url).toContain('starting_after=in_100');
    expect(fx.calls[1].url).toContain('status=open');
    // Voids begin only after BOTH list pages are collected.
    expect(fx.calls[2].method).toBe('POST');
    expect(fx.calls[2].url).toContain('/invoices/in_1/void');
  });

  it('swallows a per-invoice void failure (best-effort)', async () => {
    fx.responses.push({ status: 200, body: { data: [{ id: 'in_1' }, { id: 'in_2' }] } });
    fx.responses.push({ status: 400, body: { error: { message: 'cannot void' } } });
    fx.responses.push({ status: 200, body: { id: 'in_2', status: 'void' } });

    const res = await voidOpenInvoicesForCustomer(SECRET, 'cus_abc');
    expect(res.voided).toEqual(['in_2']);
  });

  it('throws when the list call fails (caller treats as best-effort)', async () => {
    fx.responses.push({ status: 401, body: { error: { message: 'bad key' } } });
    await expect(voidOpenInvoicesForCustomer(SECRET, 'cus_abc')).rejects.toThrow();
  });

  it('no-ops without a customer id', async () => {
    const res = await voidOpenInvoicesForCustomer(SECRET, '');
    expect(res.voided).toEqual([]);
    expect(fx.calls.length).toBe(0);
  });
});
