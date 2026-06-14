/**
 * resolveFeaturedServiceId — which service the web-chat welcome card showcases.
 * Priority: manual pin → most-booked (past a warm-up threshold) → first with photos.
 *
 * db.js is mocked so getConfig (dbGet) and the popularity projection (dbAll) are
 * driven per test. Popularity is counted in JS, so no SQL GROUP BY is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbGet = vi.fn();
const dbAll = vi.fn();
vi.mock('../src/utils/db.js', () => ({
  dbGet: (...a) => dbGet(...a),
  dbAll: (...a) => dbAll(...a),
  dbRun: vi.fn(async () => {}),
}));

import { resolveFeaturedServiceId, MIN_BOOKINGS_FOR_FEATURED } from '../src/services/services.js';

const SVC = [
  { id: 'classic', active: true, hidden: false, photos: ['a', 'b'] },
  { id: 'gel', active: true, hidden: false, photos: ['c'] },
  { id: 'nophoto', active: true, hidden: false, photos: [] },
  { id: 'secret', active: true, hidden: true, photos: ['x'] },
];

function makeCtx({ svc = SVC, pin = null, appts = [] } = {}) {
  dbGet.mockResolvedValue(pin == null ? null : { value: JSON.stringify(pin) });
  dbAll.mockResolvedValue(appts.map(svc_id => ({ svc_id })));
  return { db: {}, tenantId: 't1', svc };
}

describe('resolveFeaturedServiceId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('manual pin wins when it points at a valid featurable service', async () => {
    expect(await resolveFeaturedServiceId(makeCtx({ pin: 'gel', appts: Array(99).fill('classic') }))).toBe('gel');
  });

  it("ignores an 'auto' sentinel and falls back to popular/first", async () => {
    expect(await resolveFeaturedServiceId(makeCtx({ pin: 'auto' }))).toBe('classic');
  });

  it('ignores a pin that is missing / hidden / has no photos', async () => {
    expect(await resolveFeaturedServiceId(makeCtx({ pin: 'gone' }))).toBe('classic');
    expect(await resolveFeaturedServiceId(makeCtx({ pin: 'nophoto' }))).toBe('classic');
    expect(await resolveFeaturedServiceId(makeCtx({ pin: 'secret' }))).toBe('classic');
  });

  it('promotes the most-booked service once it clears the warm-up threshold', async () => {
    const appts = Array(MIN_BOOKINGS_FOR_FEATURED).fill('gel');
    expect(await resolveFeaturedServiceId(makeCtx({ appts }))).toBe('gel');
  });

  it('keeps the first service while the top one is below the threshold', async () => {
    const appts = Array(MIN_BOOKINGS_FOR_FEATURED - 1).fill('gel');
    expect(await resolveFeaturedServiceId(makeCtx({ appts }))).toBe('classic');
  });

  it('never features a no-photo / hidden service even if it is the most booked', async () => {
    const appts = [...Array(50).fill('nophoto'), ...Array(50).fill('secret')];
    expect(await resolveFeaturedServiceId(makeCtx({ appts }))).toBe('classic');
  });

  it('returns null when no service has photos', async () => {
    const svc = [{ id: 'a', active: true, hidden: false, photos: [] }];
    expect(await resolveFeaturedServiceId(makeCtx({ svc }))).toBe(null);
  });
});
