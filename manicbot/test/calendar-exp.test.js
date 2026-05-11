/**
 * P2-15 — calendar URL expiry.
 *
 * Asserts that:
 *   1. Fresh URLs minted by `makeCalendarUrl` include `exp` in the query.
 *   2. `verifyCalendarSig` accepts an exp-bound payload while inside the
 *      window and rejects it after.
 *   3. Legacy exp-less URLs (pre-P2-15) still verify because the signature
 *      checker tries the legacy payload after the exp-bound one.
 *   4. Tampering with `exp` invalidates the signature.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  makeCalendarUrl,
  verifyCalendarSig,
  CALENDAR_URL_EXP_SECONDS,
} from '../src/utils/ics.js';

const SECRET = 'c'.repeat(64);

function ctxWith() {
  return { APP_BASE_URL: 'https://manicbot.com', BOT_ENCRYPTION_KEY: SECRET };
}

describe('makeCalendarUrl — emits `exp` (P2-15)', () => {
  it('includes exp ≈ now + 30d in the URL', async () => {
    const before = Math.floor(Date.now() / 1000);
    const url = await makeCalendarUrl(ctxWith(), 'a777_p215');
    const u = new URL(url);
    const exp = Number(u.searchParams.get('exp'));
    expect(Number.isFinite(exp)).toBe(true);
    // Allow a small jitter (test-process startup time).
    expect(exp).toBeGreaterThanOrEqual(before + CALENDAR_URL_EXP_SECONDS - 5);
    expect(exp).toBeLessThanOrEqual(before + CALENDAR_URL_EXP_SECONDS + 5);
  });
});

describe('verifyCalendarSig — exp policy (P2-15)', () => {
  it('verifies a fresh URL inside the expiry window', async () => {
    const url = await makeCalendarUrl(ctxWith(), 'a888_fresh');
    const u = new URL(url);
    const ok = await verifyCalendarSig(
      SECRET,
      'a888_fresh',
      u.searchParams.get('ts'),
      u.searchParams.get('sig'),
      u.searchParams.get('exp'),
    );
    expect(ok).toBe(true);
  });

  it('still verifies a pre-P2-15 URL minted without exp (legacy payload fallback)', async () => {
    // Simulate a URL that the legacy generator would have produced:
    // payload = `aptId:ts`, signed with the HKDF subkey, no `exp` param.
    const { deriveHmacSubkey } = await import('../src/utils/security.js');
    const subKey = await deriveHmacSubkey(SECRET, 'calendar-hmac-v1');
    const aptId = 'a999_legacy_p215';
    const ts = String(Math.floor(Date.now() / 1000));
    const payload = `${aptId}:${ts}`;
    const enc = new TextEncoder();
    const macBuf = await crypto.subtle.sign('HMAC', subKey, enc.encode(payload));
    const sig = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    const ok = await verifyCalendarSig(SECRET, aptId, ts, sig);
    expect(ok).toBe(true);
  });

  it('rejects a tampered exp (signature is over `aptId:ts:exp`)', async () => {
    const url = await makeCalendarUrl(ctxWith(), 'a101_tampered');
    const u = new URL(url);
    const bumpedExp = String(Number(u.searchParams.get('exp')) + 365 * 24 * 3600);
    const ok = await verifyCalendarSig(
      SECRET,
      'a101_tampered',
      u.searchParams.get('ts'),
      u.searchParams.get('sig'),
      bumpedExp,
    );
    expect(ok).toBe(false);
  });
});

// HTTP-layer expiry policy: imported here so we exercise the 410-Gone branch.
describe('calendarHttp.tryCalendar — expiry policy (P2-15)', () => {
  it('returns 410 Gone for an exp-bound URL whose exp has passed', async () => {
    const { tryCalendar } = await import('../src/http/calendarHttp.js');
    const { deriveHmacSubkey } = await import('../src/utils/security.js');

    // Build an in-the-past exp + signature.
    const aptId = 'a202_expired';
    const ts = String(Math.floor(Date.now() / 1000) - 60); // 1 min ago
    const exp = String(Math.floor(Date.now() / 1000) - 1); // expired
    const subKey = await deriveHmacSubkey(SECRET, 'calendar-hmac-v1');
    const enc = new TextEncoder();
    const macBuf = await crypto.subtle.sign('HMAC', subKey, enc.encode(`${aptId}:${ts}:${exp}`));
    const sig = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    const req = new Request(`https://manicbot.com/calendar/${aptId}.ics?sig=${sig}&ts=${ts}&exp=${exp}`);
    const url = new URL(req.url);
    const res = await tryCalendar(req, { BOT_ENCRYPTION_KEY: SECRET, db: null, kv: null, globalKv: null }, url);
    expect(res.status).toBe(410);
  });

  it('returns 403 Forbidden for a forged signature (not 410)', async () => {
    const { tryCalendar } = await import('../src/http/calendarHttp.js');
    const aptId = 'a303_forged';
    const ts = String(Math.floor(Date.now() / 1000));
    const exp = String(Math.floor(Date.now() / 1000) + 100);
    const forgedSig = 'deadbeef'.repeat(8); // 64 hex chars but wrong

    const req = new Request(`https://manicbot.com/calendar/${aptId}.ics?sig=${forgedSig}&ts=${ts}&exp=${exp}`);
    const url = new URL(req.url);
    const res = await tryCalendar(req, { BOT_ENCRYPTION_KEY: SECRET, db: null, kv: null, globalKv: null }, url);
    expect(res.status).toBe(403);
  });

  it('accepts an exp-less URL inside the 14-day grace window from deploy anchor', async () => {
    const { tryCalendar } = await import('../src/http/calendarHttp.js');
    const { deriveHmacSubkey } = await import('../src/utils/security.js');

    // Pin "now" to a known time inside the grace window. The grace boundary
    // is P2_15_DEPLOY_TS + 14d = 1810000000 + 1209600 = 1811209600. Pick
    // 1810000000 + 7d = inside grace.
    const fakeNowMs = (1810000000 + 7 * 24 * 3600) * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNowMs);

    try {
      const aptId = 'a404_legacy';
      const ts = String(Math.floor(fakeNowMs / 1000) - 60);
      const subKey = await deriveHmacSubkey(SECRET, 'calendar-hmac-v1');
      const enc = new TextEncoder();
      const macBuf = await crypto.subtle.sign('HMAC', subKey, enc.encode(`${aptId}:${ts}`));
      const sig = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

      const req = new Request(`https://manicbot.com/calendar/${aptId}.ics?sig=${sig}&ts=${ts}`);
      const url = new URL(req.url);
      // No DB — appointment lookup will 503; we just check the signature/expiry
      // gate passes (status != 403/410).
      const res = await tryCalendar(req, { BOT_ENCRYPTION_KEY: SECRET, db: null, kv: null, globalKv: null }, url);
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(410);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('410 Gones an exp-less URL after the grace window expires', async () => {
    const { tryCalendar } = await import('../src/http/calendarHttp.js');
    const { deriveHmacSubkey } = await import('../src/utils/security.js');

    // Pin "now" past P2_15_DEPLOY_TS + 14d. Also bump 'ts' close to "now"
    // so the 48-hour age check (ICS_LINK_MAX_AGE_SEC) doesn't bounce us
    // before we hit the exp policy.
    const fakeNowMs = (1810000000 + 60 * 24 * 3600) * 1000; // 60 days after deploy
    vi.spyOn(Date, 'now').mockReturnValue(fakeNowMs);

    try {
      const aptId = 'a505_too_old';
      const ts = String(Math.floor(fakeNowMs / 1000) - 60); // 1 min ago — well inside 48h
      const subKey = await deriveHmacSubkey(SECRET, 'calendar-hmac-v1');
      const enc = new TextEncoder();
      const macBuf = await crypto.subtle.sign('HMAC', subKey, enc.encode(`${aptId}:${ts}`));
      const sig = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

      const req = new Request(`https://manicbot.com/calendar/${aptId}.ics?sig=${sig}&ts=${ts}`);
      const url = new URL(req.url);
      const res = await tryCalendar(req, { BOT_ENCRYPTION_KEY: SECRET, db: null, kv: null, globalKv: null }, url);
      expect(res.status).toBe(410);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
