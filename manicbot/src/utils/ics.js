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

async function hexSign(key, payload) {
  const enc = new TextEncoder();
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a signed calendar download URL for an appointment.
 * The URL includes HMAC-SHA256 signature and timestamp for replay protection.
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
  const payload = `${aptId}:${ts}`;
  const subKey = await deriveHmacSubkey(secret, ICS_HMAC_LABEL);
  const sig = await hexSign(subKey, payload);
  return `${baseUrl}/calendar/${aptId}.ics?sig=${sig}&ts=${ts}`;
}

/**
 * Verify a signed calendar URL signature.
 * Accepts both new (HKDF subkey) and legacy (raw key) signatures during the
 * grace window. After LEGACY_HMAC_GRACE_UNTIL_TS, only subkey signatures verify.
 *
 * @param {string} secret  - BOT_ENCRYPTION_KEY
 * @param {string} aptId
 * @param {string} ts      - timestamp string from URL
 * @param {string} sig     - hex signature from URL
 * @returns {Promise<boolean>}
 */
export async function verifyCalendarSig(secret, aptId, ts, sig) {
  if (!secret || secret.length < CAL_HMAC_MIN_KEY_LEN) return false;
  if (!aptId || !ts || !sig) return false;
  const payload = `${aptId}:${ts}`;

  try {
    const subKey = await deriveHmacSubkey(secret, ICS_HMAC_LABEL);
    const expected = await hexSign(subKey, payload);
    if (timingSafeHexEq(expected, sig)) return true;
  } catch { /* fall through */ }

  // Legacy verification: accept raw-key signatures only during grace window.
  if (Math.floor(Date.now() / 1000) < LEGACY_HMAC_GRACE_UNTIL_TS) {
    try {
      const enc = new TextEncoder();
      const rawKey = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const expected = await hexSign(rawKey, payload);
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
