/**
 * listBalanceTransactions — Worker Stripe REST helper used by the ledger sync.
 *
 * balance_transactions is the single Stripe object that carries fee + net
 * natively (invoices do not) and covers every money movement (charge, refund,
 * dispute, payout, fee). The ledger sync pages it; these tests pin the request
 * shape (pinned API version, auth, param encoding, limit clamp) and the parse.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listBalanceTransactions } from '../src/billing/stripe.js';

const KEY = 'sk_test_btxn';

function parseUrl(url) {
  const u = new URL(String(url));
  return { path: u.origin + u.pathname, params: u.searchParams };
}

describe('listBalanceTransactions', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs balance_transactions with pinned version + auth and parses data/has_more', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        object: 'list',
        data: [{ id: 'txn_1', amount: 4500, fee: 100, net: 4400, currency: 'pln', type: 'charge', created: 1000 }],
        has_more: false,
      }),
    });

    const res = await listBalanceTransactions(KEY, { limit: 50 });

    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe('txn_1');
    expect(res.has_more).toBe(false);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    const { path, params } = parseUrl(url);
    expect(path).toBe('https://api.stripe.com/v1/balance_transactions');
    expect(params.get('limit')).toBe('50');
    expect(opts.method ?? 'GET').toBe('GET');
    expect(opts.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(opts.headers['Stripe-Version']).toBe('2024-06-20');
  });

  it('defaults limit to 100 and omits optional params', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], has_more: false }) });

    await listBalanceTransactions(KEY);

    const { params } = parseUrl(fetchMock.mock.calls[0][0]);
    expect(params.get('limit')).toBe('100');
    expect(params.get('created[gte]')).toBeNull();
    expect(params.get('starting_after')).toBeNull();
  });

  it('clamps limit to the [1, 100] range Stripe allows', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: [], has_more: false }) });

    await listBalanceTransactions(KEY, { limit: 500 });
    expect(parseUrl(fetchMock.mock.calls[0][0]).params.get('limit')).toBe('100');

    await listBalanceTransactions(KEY, { limit: 0 });
    expect(parseUrl(fetchMock.mock.calls[1][0]).params.get('limit')).toBe('1');
  });

  it('passes created[gte] and starting_after when provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], has_more: false }) });

    await listBalanceTransactions(KEY, { createdGte: 1700000000, startingAfter: 'txn_after' });

    const { params } = parseUrl(fetchMock.mock.calls[0][0]);
    expect(params.get('created[gte]')).toBe('1700000000');
    expect(params.get('starting_after')).toBe('txn_after');
  });

  it('throws on a non-2xx Stripe response (so the sync can abort without advancing the cursor)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API Key provided' } }),
    });

    await expect(listBalanceTransactions(KEY, {})).rejects.toThrow('Invalid API Key');
  });
});
