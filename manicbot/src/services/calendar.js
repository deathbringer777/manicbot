/**
 * Google Calendar API integration via Service Account.
 *
 * Setup for master:
 *   1. Platform creates a Google Service Account.
 *   2. Master shares their Google Calendar with the service account email
 *      (Calendar settings → Share with specific people → "Make changes to events").
 *   3. Master sends their Calendar ID (email or calendar ID) in the bot.
 *   4. Bot stores it in master.googleCalendarId.
 *
 * Env required:
 *   GOOGLE_SERVICE_ACCOUNT_KEY — JSON key file contents, base64-encoded or raw JSON string.
 */

const GCAL_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_CACHE_KEY = 'gcal:access_token';

/**
 * Sign a JWT for Google OAuth2 service account token exchange.
 */
async function signJWT(header, payload, privateKeyPem) {
  const enc = new TextEncoder();

  // Import PEM private key
  const pemContents = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const keyData = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const b64url = obj => btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    enc.encode(signingInput),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return `${signingInput}.${sigB64}`;
}

/**
 * Get a valid Google API access token, using KV cache to avoid re-signing every call.
 */
async function getAccessToken(ctx) {
  const env = ctx;
  const raw = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');

  // Check KV cache first (TTL stored alongside token)
  if (ctx.kv) {
    try {
      const cached = await ctx.kv.get(TOKEN_CACHE_KEY, 'json');
      if (cached?.token && cached.expiresAt > Date.now() + 60000) {
        return cached.token;
      }
    } catch {}
  }

  // Parse service account JSON (supports raw JSON or base64)
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch {
    try {
      sa = JSON.parse(atob(raw));
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON or base64-encoded JSON');
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJWT(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google token error: ${data.error || JSON.stringify(data)}`);

  // Cache with TTL (tokens last 3600s, cache for 3500s)
  if (ctx.kv) {
    try {
      await ctx.kv.put(TOKEN_CACHE_KEY, JSON.stringify({
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 100000,
      }), { expirationTtl: 3500 });
    } catch {}
  }

  return data.access_token;
}

/**
 * Create a Google Calendar event.
 * @param {object} ctx - tenant context (needs GOOGLE_SERVICE_ACCOUNT_KEY in env)
 * @param {string} calendarId - master's calendar ID (email or calendar ID)
 * @param {object} event - Google Calendar event object
 * @returns {object} created event (contains .id)
 */
export async function createCalendarEvent(ctx, calendarId, event) {
  const token = await getAccessToken(ctx);
  const res = await fetch(
    `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    },
  );
  return res.json();
}

/**
 * Delete a Google Calendar event.
 * @param {object} ctx - tenant context
 * @param {string} calendarId - master's calendar ID
 * @param {string} eventId - Google Calendar event ID
 */
export async function deleteCalendarEvent(ctx, calendarId, eventId) {
  try {
    const token = await getAccessToken(ctx);
    await fetch(
      `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
  } catch (e) {
    console.error('deleteCalendarEvent error:', e.message);
  }
}

/**
 * Build a Google Calendar event object from an appointment.
 * @param {object} apt - appointment
 * @param {object} svc - service object {e, id, dur}
 * @param {object} salon - salon info {name, address}
 * @param {string} timezone - IANA timezone string
 * @returns {object} Google Calendar event
 */
export function buildCalendarEvent(apt, svc, salon, timezone = 'Europe/Warsaw') {
  const [h, m] = apt.time.split(':').map(Number);
  const durMin = svc?.dur || 60;
  const endMinutes = h * 60 + m + durMin;
  const endH = String(Math.floor(endMinutes / 60)).padStart(2, '0');
  const endM = String(endMinutes % 60).padStart(2, '0');

  const svcLabel = svc ? `${svc.e || ''} ${svc.id}`.trim() : apt.svcId;
  return {
    summary: `${svcLabel} — ${apt.userName}`,
    description: [
      `Клиент: ${apt.userName}`,
      apt.userPhone ? `Телефон: ${apt.userPhone}` : null,
      apt.userTg   ? `Telegram: @${apt.userTg}` : null,
      `Услуга: ${svcLabel}`,
      apt.id ? `ID записи: ${apt.id}` : null,
    ].filter(Boolean).join('\n'),
    start: { dateTime: `${apt.date}T${apt.time}:00`, timeZone: timezone },
    end:   { dateTime: `${apt.date}T${endH}:${endM}:00`, timeZone: timezone },
    location: salon?.address || '',
    source: {
      title: salon?.name || 'ManicBot',
      url: 'https://manicbot.com',
    },
  };
}
