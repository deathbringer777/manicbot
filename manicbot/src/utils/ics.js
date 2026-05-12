import { ADDRESS } from '../config.js';
import { warsawToUTC } from './date.js';
import { svcName } from './helpers.js';
import { deriveHmacSubkey } from './security.js';

const ICS_HMAC_LABEL = 'calendar-hmac-v1';

function escIcs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function makeICS(ctx, apt, lang) {
  const svc = ctx.svc.find(s => s.id === apt.svcId);
  if (!svc) return '';
  const name = svcName(ctx, lang, apt.svcId);
  const [y, mo, d] = apt.date.split('-').map(Number);
  const [h, mi] = apt.time.split(':').map(Number);
  const start = warsawToUTC(y, mo, d, h, mi);
  const end = new Date(start.getTime() + svc.dur * 60000);
  const f = dt => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const safeName = name.replace(/[^\w\sа-яА-ЯёЁіІїЇєЄґҐa-zA-Zżźćńółęąś']/gui, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ManicBot//Bot', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${apt.id}@manicbot`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
    `SUMMARY:${escIcs(safeName)}`,
    `DESCRIPTION:${escIcs(safeName)}`,
    `LOCATION:${escIcs(ADDRESS)}`, 'STATUS:CONFIRMED',
    'BEGIN:VALARM', 'TRIGGER:-PT24H', 'ACTION:DISPLAY', 'DESCRIPTION:24h', 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:2h', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

const CAL_HMAC_MIN_KEY_LEN = 32;
// #S6: outstanding signed URLs in customers' calendar apps were minted before
// HKDF subkeys existed. We accept legacy signatures (raw key) until this date,
// then strictly require subkey signatures. Clients re-fetch on calendar refresh.
const LEGACY_HMAC_GRACE_UNTIL_TS = 1781827200; // 2026-06-17 (60 days from #S6 deploy)

// P2-15 — every freshly-minted URL gets an `exp` claim 30 days into the future.
// Tying it to the HMAC payload means an attacker cannot extend the expiry
// without forging the signature.
export const CALENDAR_URL_EXP_SECONDS = 30 * 24 * 3600;

async function hexSign(key, payload) {
  const enc = new TextEncoder();
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a signed calendar download URL for an appointment.
 * The URL includes HMAC-SHA256 signature, timestamp, and an explicit expiry
 * (P2-15) for replay protection.
 *
 * Uses HKDF subkey of BOT_ENCRYPTION_KEY (label='calendar-hmac-v1') for key
 * separation from token encryption. Verification accepts legacy raw-key
 * signatures during a grace window so URLs in customer calendars don't 401
 * the moment we rotate keys.
 *
 * @param {object} ctx - Worker context (needs APP_BASE_URL, BOT_ENCRYPTION_KEY ≥32 chars)
 * @param {string} aptId - Appointment ID
 * @returns {Promise<string|null>} Full URL or null if missing config
 */
export async function makeCalendarUrl(ctx, aptId) {
  const baseUrl = (ctx?.APP_BASE_URL || '').replace(/\/$/, '');
  const secret = ctx?.BOT_ENCRYPTION_KEY || '';
  if (!baseUrl || !secret || secret.length < CAL_HMAC_MIN_KEY_LEN) return null;

  const ts = String(Math.floor(Date.now() / 1000));
  // P2-15 — sign `exp` into the payload so it cannot be tampered with on the URL.
  const exp = String(Math.floor(Date.now() / 1000) + CALENDAR_URL_EXP_SECONDS);
  const payload = `${aptId}:${ts}:${exp}`;
  const subKey = await deriveHmacSubkey(secret, ICS_HMAC_LABEL);
  const sig = await hexSign(subKey, payload);
  return `${baseUrl}/calendar/${aptId}.ics?sig=${sig}&ts=${ts}&exp=${exp}`;
}

/**
 * Verify a signed calendar URL signature.
 *
 * Accepts three signature flavours, in order:
 *   1. New (P2-15): payload `aptId:ts:exp`, HKDF subkey. Preferred for any
 *      URL minted after the P2-15 deploy.
 *   2. Pre-P2-15: payload `aptId:ts`, HKDF subkey. Still valid for URLs
 *      already in customer calendars.
 *   3. Legacy (#S6): payload `aptId:ts`, raw key — only during the legacy
 *      grace window.
 *
 * Expiry (#P2-15) is checked here when `exp` is passed; the calendarHttp.js
 * layer applies a separate `ts`-age policy and a grace period for legacy
 * exp-less URLs.
 *
 * @param {string} secret  - BOT_ENCRYPTION_KEY
 * @param {string} aptId
 * @param {string} ts      - timestamp string from URL
 * @param {string} sig     - hex signature from URL
 * @param {string} [exp]   - expiry unix-ts string (P2-15)
 * @returns {Promise<boolean>}
 */
export async function verifyCalendarSig(secret, aptId, ts, sig, exp) {
  if (!secret || secret.length < CAL_HMAC_MIN_KEY_LEN) return false;
  if (!aptId || !ts || !sig) return false;

  // P2-15 — try the exp-bound payload first if exp is provided.
  if (exp) {
    try {
      const subKey = await deriveHmacSubkey(secret, ICS_HMAC_LABEL);
      const expected = await hexSign(subKey, `${aptId}:${ts}:${exp}`);
      if (timingSafeHexEq(expected, sig)) return true;
    } catch { /* fall through */ }
  }

  // Pre-P2-15 payload (no exp).
  const legacyPayload = `${aptId}:${ts}`;
  try {
    const subKey = await deriveHmacSubkey(secret, ICS_HMAC_LABEL);
    const expected = await hexSign(subKey, legacyPayload);
    if (timingSafeHexEq(expected, sig)) return true;
  } catch { /* fall through */ }

  // #S6 — raw-key signatures only during legacy grace window.
  if (Math.floor(Date.now() / 1000) < LEGACY_HMAC_GRACE_UNTIL_TS) {
    try {
      const enc = new TextEncoder();
      const rawKey = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const expected = await hexSign(rawKey, legacyPayload);
      if (timingSafeHexEq(expected, sig)) return true;
    } catch { /* fall through */ }
  }
  return false;
}

function timingSafeHexEq(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export { escIcs };
