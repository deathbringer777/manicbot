import { describe, it, expect, vi } from 'vitest';
import { makeCalendarUrl, verifyCalendarSig } from '../src/utils/ics.js';

const SECRET = 'a'.repeat(64);

function ctxWith(secret = SECRET, baseUrl = 'https://manicbot.com') {
  return { APP_BASE_URL: baseUrl, BOT_ENCRYPTION_KEY: secret };
}

describe('#S6 — calendar URL signing (ics.js)', () => {
  it('makeCalendarUrl produces a verifiable URL', async () => {
    const url = await makeCalendarUrl(ctxWith(), 'a123_xyz');
    // P2-15 — URL now includes `exp` after `ts`.
    expect(url).toMatch(/^https:\/\/manicbot\.com\/calendar\/a123_xyz\.ics\?sig=[a-f0-9]+&ts=\d+&exp=\d+$/);
    const u = new URL(url);
    const sig = u.searchParams.get('sig');
    const ts = u.searchParams.get('ts');
    const exp = u.searchParams.get('exp');
    expect(await verifyCalendarSig(SECRET, 'a123_xyz', ts, sig, exp)).toBe(true);
  });

  it('verifyCalendarSig rejects tampered aptId', async () => {
    const url = await makeCalendarUrl(ctxWith(), 'a123_xyz');
    const u = new URL(url);
    const ok = await verifyCalendarSig(SECRET, 'a999_evil', u.searchParams.get('ts'), u.searchParams.get('sig'), u.searchParams.get('exp'));
    expect(ok).toBe(false);
  });

  it('verifyCalendarSig rejects tampered ts', async () => {
    const url = await makeCalendarUrl(ctxWith(), 'a123_xyz');
    const u = new URL(url);
    const ok = await verifyCalendarSig(SECRET, 'a123_xyz', '0', u.searchParams.get('sig'), u.searchParams.get('exp'));
    expect(ok).toBe(false);
  });

  it('verifyCalendarSig rejects wrong secret', async () => {
    const url = await makeCalendarUrl(ctxWith(), 'a123_xyz');
    const u = new URL(url);
    const wrong = 'b'.repeat(64);
    const ok = await verifyCalendarSig(wrong, 'a123_xyz', u.searchParams.get('ts'), u.searchParams.get('sig'), u.searchParams.get('exp'));
    expect(ok).toBe(false);
  });

  it('verifyCalendarSig rejects legacy signature AFTER grace window', async () => {
    // Mock Date.now to be after LEGACY_HMAC_GRACE_UNTIL_TS (2026-06-17 → +1 year)
    const mockNow = 1850000000 * 1000; // 2028-08-something
    vi.spyOn(Date, 'now').mockReturnValue(mockNow);
    try {
      const enc = new TextEncoder();
      const rawKey = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const ts = String(Math.floor(mockNow / 1000));
      const payload = `a888_late:${ts}`;
      const macBuf = await crypto.subtle.sign('HMAC', rawKey, enc.encode(payload));
      const sig = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      const ok = await verifyCalendarSig(SECRET, 'a888_late', ts, sig);
      expect(ok).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('makeCalendarUrl returns null with missing config', async () => {
    expect(await makeCalendarUrl({}, 'a1_x')).toBeNull();
    expect(await makeCalendarUrl({ APP_BASE_URL: 'https://x.com' }, 'a1_x')).toBeNull();
    expect(await makeCalendarUrl({ APP_BASE_URL: 'https://x.com', BOT_ENCRYPTION_KEY: 'short' }, 'a1_x')).toBeNull();
  });

  it('verifyCalendarSig rejects empty inputs', async () => {
    expect(await verifyCalendarSig(SECRET, '', '1', 'abc')).toBe(false);
    expect(await verifyCalendarSig(SECRET, 'a1', '', 'abc')).toBe(false);
    expect(await verifyCalendarSig(SECRET, 'a1', '1', '')).toBe(false);
    expect(await verifyCalendarSig('', 'a1', '1', 'abc')).toBe(false);
  });
});
