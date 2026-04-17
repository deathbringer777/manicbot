import { randomId, encryptToken, decryptToken } from '../utils/security.js';
import { dbAll, dbGet, dbRun } from '../utils/db.js';

// #S6: HKDF subkey label for Google OAuth refresh tokens.
// Distinct trust domain from channel/bot tokens — leak in one shouldn't
// compromise the others.
const GOOGLE_REFRESH_LABEL = 'google-refresh-v1';
import { warsawToUTC } from '../utils/date.js';
import { getMaster, saveMaster } from './users.js';
import {
  createCalendarEvent as createServiceAccountCalendarEvent,
  updateCalendarEvent as updateServiceAccountCalendarEvent,
  deleteCalendarEvent as deleteServiceAccountCalendarEvent,
  buildCalendarEvent,
} from './calendar.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GCAL_API = 'https://www.googleapis.com/calendar/v3';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/calendar';
const OAUTH_SESSION_PREFIX = 'gcal:oauth:';
const SYNC_HORIZON_DAYS = 90;
const WATCH_RENEW_WINDOW_MS = 24 * 3600 * 1000;

function getRawKv(ctx) {
  return ctx?.globalKv || ctx?.kv || null;
}

function getBaseUrl(ctx) {
  return (ctx?.baseUrl || ctx?.APP_BASE_URL || '').replace(/\/$/, '');
}

function getRedirectUri(ctx) {
  return (ctx?.GOOGLE_OAUTH_REDIRECT_URI || `${getBaseUrl(ctx)}/google/callback`).replace(/\/$/, '');
}

function hasOAuthConfig(ctx) {
  return !!(ctx?.GOOGLE_OAUTH_CLIENT_ID && ctx?.GOOGLE_OAUTH_CLIENT_SECRET && getRedirectUri(ctx));
}

const GOOGLE_TOKEN_ENC_MIN_LEN = 32;

/**
 * Returns the key used to encrypt/decrypt Google OAuth refresh tokens.
 *
 * Key separation (NIST SP 800-57): ADMIN_KEY is for authentication of admin
 * endpoints, NOT for crypto. Do not reuse it as an encryption key.
 *
 * Order of preference:
 *   1. GOOGLE_TOKEN_ENCRYPTION_KEY (dedicated key — recommended)
 *   2. BOT_ENCRYPTION_KEY (shared with bot token encryption — acceptable)
 *
 * If neither is set, returns null — callers must handle this by disabling
 * Google Calendar integration rather than falling back to weak crypto.
 */
function getTokenEncryptionKey(ctx) {
  const key = ctx?.GOOGLE_TOKEN_ENCRYPTION_KEY || ctx?.BOT_ENCRYPTION_KEY || null;
  if (!key || String(key).length < GOOGLE_TOKEN_ENC_MIN_LEN) {
    console.error(
      '[google-oauth] encryption key missing or too short — Google Calendar integration disabled. ' +
      'Set GOOGLE_TOKEN_ENCRYPTION_KEY (or BOT_ENCRYPTION_KEY) to at least 32 chars.'
    );
    return null;
  }
  return key;
}

function nowTs() {
  return Date.now();
}

function rowToIntegration(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scope: row.scope,
    masterChatId: row.master_chat_id,
    providerAccountEmail: row.provider_account_email,
    calendarId: row.calendar_id,
    calendarSummary: row.calendar_summary,
    refreshTokenEnc: row.refresh_token_enc,
    syncEnabled: row.sync_enabled === 1,
    syncDirection: row.sync_direction || 'two_way',
    watchChannelId: row.watch_channel_id,
    watchResourceId: row.watch_resource_id,
    watchExpiration: row.watch_expiration,
    lastSyncAt: row.last_sync_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function eventTimeToTs(value) {
  if (!value) return null;
  if (value.dateTime) return new Date(value.dateTime).getTime();
  if (value.date) {
    return Date.parse(`${value.date}T00:00:00Z`);
  }
  return null;
}

function busyBlockId(integrationId, eventId) {
  return `${integrationId}:${eventId}`;
}

async function ensureGoogleCalendarSchema(ctx) {
  if (!ctx?.db || ctx._gcalSchemaReady) return;
  await dbRun(ctx, `
    CREATE TABLE IF NOT EXISTS google_integrations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      master_chat_id INTEGER,
      provider_account_email TEXT,
      calendar_id TEXT NOT NULL,
      calendar_summary TEXT,
      refresh_token_enc TEXT NOT NULL,
      sync_enabled INTEGER NOT NULL DEFAULT 1,
      sync_direction TEXT NOT NULL DEFAULT 'two_way',
      watch_channel_id TEXT,
      watch_resource_id TEXT,
      watch_expiration INTEGER,
      last_sync_at INTEGER,
      last_sync_status TEXT,
      last_sync_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await dbRun(ctx, 'CREATE INDEX IF NOT EXISTS idx_gcal_integration_scope ON google_integrations(tenant_id, scope, master_chat_id)');
  await dbRun(ctx, 'CREATE INDEX IF NOT EXISTS idx_gcal_integration_watch ON google_integrations(watch_channel_id)');
  await dbRun(ctx, 'CREATE INDEX IF NOT EXISTS idx_gcal_integration_calendar ON google_integrations(calendar_id)');

  await dbRun(ctx, `
    CREATE TABLE IF NOT EXISTS google_busy_blocks (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      external_event_id TEXT NOT NULL,
      summary TEXT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await dbRun(ctx, 'CREATE INDEX IF NOT EXISTS idx_gcal_busy_lookup ON google_busy_blocks(integration_id, start_ts, end_ts)');

  try {
    await dbRun(ctx, 'ALTER TABLE appointments ADD COLUMN google_integration_id TEXT');
  } catch {}
  // Add description/location columns to busy_blocks for richer metadata
  try { await dbRun(ctx, 'ALTER TABLE google_busy_blocks ADD COLUMN description TEXT'); } catch {}
  try { await dbRun(ctx, 'ALTER TABLE google_busy_blocks ADD COLUMN location TEXT'); } catch {}
  try { await dbRun(ctx, 'ALTER TABLE google_busy_blocks ADD COLUMN creator TEXT'); } catch {}
  // Cascade-delete trigger: clean up busy blocks when an integration is removed
  await dbRun(ctx, `
    CREATE TRIGGER IF NOT EXISTS trg_gcal_integration_delete
    AFTER DELETE ON google_integrations
    BEGIN
      DELETE FROM google_busy_blocks WHERE integration_id = OLD.id;
    END
  `);
  ctx._gcalSchemaReady = true;
}

async function getOAuthSession(ctx, sessionId) {
  const kv = getRawKv(ctx);
  if (!kv || !sessionId) return null;
  try {
    return await kv.get(OAUTH_SESSION_PREFIX + sessionId, 'json');
  } catch {
    return null;
  }
}

async function putOAuthSession(ctx, sessionId, payload, ttlSec = 900) {
  const kv = getRawKv(ctx);
  if (!kv || !sessionId) return false;
  await kv.put(OAUTH_SESSION_PREFIX + sessionId, JSON.stringify(payload), { expirationTtl: ttlSec });
  return true;
}

async function deleteOAuthSession(ctx, sessionId) {
  const kv = getRawKv(ctx);
  if (!kv || !sessionId) return;
  try { await kv.delete(OAUTH_SESSION_PREFIX + sessionId); } catch {}
}

function buildGoogleAuthUrl(ctx, sessionId) {
  const params = new URLSearchParams({
    client_id: ctx.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: getRedirectUri(ctx),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: OAUTH_SCOPE,
    state: sessionId,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(ctx, code) {
  const body = new URLSearchParams({
    code,
    client_id: ctx.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: ctx.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: getRedirectUri(ctx),
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Failed to exchange Google OAuth code');
  }
  return data;
}

async function refreshAccessToken(ctx, integration) {
  const key = getTokenEncryptionKey(ctx);
  const refreshToken = integration.refreshTokenEnc && key
    ? await decryptToken(integration.refreshTokenEnc, key, GOOGLE_REFRESH_LABEL)
    : null;
  if (!refreshToken) throw new Error('Missing Google refresh token');

  const body = new URLSearchParams({
    client_id: ctx.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: ctx.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (err) {
      // Network error — retry if not last attempt
      if (attempt === MAX_RETRIES - 1) throw err;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.access_token) return data.access_token;
    // 4xx = permanent (invalid_grant, etc.) — fail immediately
    if (res.status < 500) {
      throw new Error(data.error_description || data.error || 'Failed to refresh Google access token');
    }
    // 5xx = transient — retry
    if (attempt === MAX_RETRIES - 1) {
      throw new Error(data.error_description || data.error || `Google token refresh failed after ${MAX_RETRIES} attempts (${res.status})`);
    }
    await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
  }
}

/** In-memory per-tenant Google API quota tracker (resets per isolate). */
const _quotaCounters = new Map();
const GCAL_DAILY_QUOTA_WARN = 500;

function trackGcalQuota(tenantId) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${tenantId || 'global'}:${day}`;
  const count = (_quotaCounters.get(key) || 0) + 1;
  _quotaCounters.set(key, count);
  if (count === GCAL_DAILY_QUOTA_WARN) {
    console.warn(`[gcal] quota warning: tenant ${tenantId} hit ${GCAL_DAILY_QUOTA_WARN} API calls today`);
  }
  // Prune old days (keep only today)
  for (const k of _quotaCounters.keys()) {
    if (!k.endsWith(day)) _quotaCounters.delete(k);
  }
  return count;
}

async function googleJsonRequest(url, opts = {}, tenantId = null) {
  trackGcalQuota(tenantId);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error?.message || data.error_description || text || `Google API request failed (${res.status})`);
  }
  return data;
}

async function listGoogleCalendars(accessToken) {
  let pageToken = null;
  const items = [];
  do {
    const params = new URLSearchParams({ maxResults: '250' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await googleJsonRequest(`${GCAL_API}/users/me/calendarList?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return items;
}

async function listCalendarEvents(accessToken, calendarId, timeMin, timeMax) {
  let pageToken = null;
  const items = [];
  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '2500',
      orderBy: 'startTime',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await googleJsonRequest(
      `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return items;
}

async function createOAuthCalendarEvent(ctx, integration, event) {
  const accessToken = await refreshAccessToken(ctx, integration);
  return googleJsonRequest(`${GCAL_API}/calendars/${encodeURIComponent(integration.calendarId)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });
}

async function updateOAuthCalendarEvent(ctx, integration, eventId, event) {
  const accessToken = await refreshAccessToken(ctx, integration);
  return googleJsonRequest(`${GCAL_API}/calendars/${encodeURIComponent(integration.calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });
}

async function deleteOAuthCalendarEvent(ctx, integration, eventId) {
  const accessToken = await refreshAccessToken(ctx, integration);
  const res = await fetch(`${GCAL_API}/calendars/${encodeURIComponent(integration.calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(text || `Google delete failed (${res.status})`);
  }
}

async function startWatchForIntegration(ctx, integration) {
  const baseUrl = getBaseUrl(ctx);
  if (!baseUrl) return integration;
  await stopWatchForIntegration(ctx, integration);
  const accessToken = await refreshAccessToken(ctx, integration);
  const channelId = `gcal-${randomId(12)}`;
  const payload = {
    id: channelId,
    type: 'web_hook',
    address: `${baseUrl}/google/webhook`,
    token: integration.id,
  };
  const data = await googleJsonRequest(
    `${GCAL_API}/calendars/${encodeURIComponent(integration.calendarId)}/events/watch`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );
  const updatedAt = nowTs();
  await dbRun(ctx,
    `UPDATE google_integrations
        SET watch_channel_id = ?, watch_resource_id = ?, watch_expiration = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`,
    data.id || channelId,
    data.resourceId || null,
    data.expiration ? parseInt(data.expiration, 10) : null,
    updatedAt,
    integration.id,
    integration.tenantId,
  );
  return {
    ...integration,
    watchChannelId: data.id || channelId,
    watchResourceId: data.resourceId || null,
    watchExpiration: data.expiration ? parseInt(data.expiration, 10) : null,
    updatedAt,
  };
}

async function stopWatchForIntegration(ctx, integration) {
  if (!integration?.watchChannelId || !integration?.watchResourceId) return;
  try {
    const accessToken = await refreshAccessToken(ctx, integration);
    await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: integration.watchChannelId,
        resourceId: integration.watchResourceId,
      }),
    }).catch(() => {});
  } catch {}
}

function mapEventToBusyBlock(integration, event) {
  if (!event?.id) return null;
  if (event.status === 'cancelled') return null;
  if (event.transparency === 'transparent') return null;
  const startTs = eventTimeToTs(event.start, false);
  const endTs = eventTimeToTs(event.end, true);
  if (!startTs || !endTs || endTs <= startTs) return null;
  return {
    id: busyBlockId(integration.id, event.id),
    integrationId: integration.id,
    tenantId: integration.tenantId,
    calendarId: integration.calendarId,
    externalEventId: event.id,
    summary: event.summary || null,
    description: event.description || null,
    location: event.location || null,
    creator: event.creator?.email || event.organizer?.email || null,
    startTs,
    endTs,
    updatedAt: nowTs(),
  };
}

async function persistBusyBlocks(ctx, integration, blocks) {
  await dbRun(ctx, 'DELETE FROM google_busy_blocks WHERE integration_id = ?', integration.id);
  for (const block of blocks) {
    await dbRun(ctx,
      `INSERT OR REPLACE INTO google_busy_blocks
        (id, integration_id, tenant_id, calendar_id, external_event_id, summary, description, location, creator, start_ts, end_ts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      block.id,
      block.integrationId,
      block.tenantId,
      block.calendarId,
      block.externalEventId,
      block.summary,
      block.description,
      block.location,
      block.creator,
      block.startTs,
      block.endTs,
      block.updatedAt,
    );
  }
}

async function persistIntegrationState(ctx, integrationId, tenantId, patch) {
  const updates = [];
  const params = [];
  const columns = {
    providerAccountEmail: 'provider_account_email',
    calendarId: 'calendar_id',
    calendarSummary: 'calendar_summary',
    refreshTokenEnc: 'refresh_token_enc',
    syncEnabled: 'sync_enabled',
    syncDirection: 'sync_direction',
    watchChannelId: 'watch_channel_id',
    watchResourceId: 'watch_resource_id',
    watchExpiration: 'watch_expiration',
    lastSyncAt: 'last_sync_at',
    lastSyncStatus: 'last_sync_status',
    lastSyncError: 'last_sync_error',
    updatedAt: 'updated_at',
  };
  for (const [key, column] of Object.entries(columns)) {
    if (key in patch) {
      let value = patch[key];
      if (key === 'syncEnabled') value = value ? 1 : 0;
      updates.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (!updates.length) return;
  params.push(integrationId, tenantId);
  await dbRun(ctx, `UPDATE google_integrations SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`, ...params);
}

async function clearAppointmentCalendarLink(ctx, aptId) {
  if (!ctx?.db || !ctx?.tenantId || !aptId) return;
  await dbRun(ctx,
    `UPDATE appointments
        SET google_event_id = NULL, google_calendar_id = NULL, google_integration_id = NULL
      WHERE id = ? AND tenant_id = ?`,
    aptId, ctx.tenantId,
  );
}

async function saveAppointmentCalendarLink(ctx, aptId, fields) {
  if (!ctx?.db || !ctx?.tenantId || !aptId) return;
  await dbRun(ctx,
    `UPDATE appointments
        SET google_event_id = ?, google_calendar_id = ?, google_integration_id = ?
      WHERE id = ? AND tenant_id = ?`,
    fields.googleEventId || null,
    fields.googleCalendarId || null,
    fields.googleIntegrationId || null,
    aptId,
    ctx.tenantId,
  );
}

export async function getGoogleIntegration(ctx, { scope = 'tenant', masterChatId = null } = {}) {
  await ensureGoogleCalendarSchema(ctx);
  if (!ctx?.db || !ctx?.tenantId) return null;
  let row;
  if (scope === 'master') {
    row = await dbGet(ctx,
      'SELECT * FROM google_integrations WHERE tenant_id = ? AND scope = ? AND master_chat_id = ? AND sync_enabled = 1 ORDER BY updated_at DESC LIMIT 1',
      ctx.tenantId, scope, masterChatId,
    );
  } else {
    row = await dbGet(ctx,
      'SELECT * FROM google_integrations WHERE tenant_id = ? AND scope = ? AND master_chat_id IS NULL AND sync_enabled = 1 ORDER BY updated_at DESC LIMIT 1',
      ctx.tenantId, scope,
    );
  }
  return rowToIntegration(row);
}

export async function getGoogleIntegrationById(ctx, integrationId) {
  await ensureGoogleCalendarSchema(ctx);
  if (!ctx?.db || !integrationId) return null;
  const row = await dbGet(ctx, 'SELECT * FROM google_integrations WHERE id = ?', integrationId);
  return rowToIntegration(row);
}

export async function saveGoogleIntegration(ctx, data) {
  await ensureGoogleCalendarSchema(ctx);
  if (!ctx?.db || !ctx?.tenantId) return null;
  const scope = data.scope === 'master' ? 'master' : 'tenant';
  const existing = await getGoogleIntegration(ctx, { scope, masterChatId: scope === 'master' ? data.masterChatId : null });
  const id = existing?.id || randomId(12);
  const createdAt = existing?.createdAt || nowTs();
  const updatedAt = nowTs();
  await dbRun(ctx,
    `INSERT OR REPLACE INTO google_integrations
      (id, tenant_id, scope, master_chat_id, provider_account_email, calendar_id, calendar_summary, refresh_token_enc, sync_enabled, sync_direction, watch_channel_id, watch_resource_id, watch_expiration, last_sync_at, last_sync_status, last_sync_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    ctx.tenantId,
    scope,
    scope === 'master' ? data.masterChatId : null,
    data.providerAccountEmail || null,
    data.calendarId,
    data.calendarSummary || null,
    data.refreshTokenEnc,
    data.syncEnabled === false ? 0 : 1,
    data.syncDirection || 'two_way',
    data.watchChannelId || null,
    data.watchResourceId || null,
    data.watchExpiration || null,
    data.lastSyncAt || null,
    data.lastSyncStatus || null,
    data.lastSyncError || null,
    createdAt,
    updatedAt,
  );
  return {
    id,
    tenantId: ctx.tenantId,
    scope,
    masterChatId: scope === 'master' ? data.masterChatId : null,
    providerAccountEmail: data.providerAccountEmail || null,
    calendarId: data.calendarId,
    calendarSummary: data.calendarSummary || null,
    refreshTokenEnc: data.refreshTokenEnc,
    syncEnabled: data.syncEnabled !== false,
    syncDirection: data.syncDirection || 'two_way',
    watchChannelId: data.watchChannelId || null,
    watchResourceId: data.watchResourceId || null,
    watchExpiration: data.watchExpiration || null,
    lastSyncAt: data.lastSyncAt || null,
    lastSyncStatus: data.lastSyncStatus || null,
    lastSyncError: data.lastSyncError || null,
    createdAt,
    updatedAt,
  };
}

export async function deleteGoogleIntegration(ctx, { scope = 'tenant', masterChatId = null } = {}) {
  await ensureGoogleCalendarSchema(ctx);
  const integration = await getGoogleIntegration(ctx, { scope, masterChatId });
  if (!integration) return false;
  await stopWatchForIntegration(ctx, integration);
  await dbRun(
    ctx,
    'UPDATE appointments SET google_integration_id = NULL, google_calendar_id = NULL, google_event_id = NULL WHERE tenant_id = ? AND google_integration_id = ?',
    ctx.tenantId,
    integration.id,
  );
  await dbRun(ctx, 'DELETE FROM google_busy_blocks WHERE integration_id = ?', integration.id);
  await dbRun(ctx, 'DELETE FROM google_integrations WHERE id = ? AND tenant_id = ?', integration.id, ctx.tenantId);
  if (scope === 'master' && masterChatId != null) {
    const master = await getMaster(ctx, masterChatId);
    if (master) await saveMaster(ctx, masterChatId, { ...master, googleCalendarId: null, calendarEnabled: false });
  }
  return true;
}

export async function createGoogleConnectUrl(ctx, { scope = 'master', actorChatId, masterChatId = null } = {}) {
  if (!ctx?.db || !ctx?.tenantId || !hasOAuthConfig(ctx) || !getBaseUrl(ctx)) return null;
  const sessionId = randomId(16);
  await putOAuthSession(ctx, sessionId, {
    stage: 'oauth',
    tenantId: ctx.tenantId || null,
    botId: ctx.bot?.botId || null,
    scope,
    actorChatId,
    masterChatId,
    createdAt: nowTs(),
  }, 900);
  return `${getBaseUrl(ctx)}/google/connect?session=${encodeURIComponent(sessionId)}`;
}

export async function handleGoogleConnectRequest(ctx, url) {
  const sessionId = url.searchParams.get('session') || '';
  const session = await getOAuthSession(ctx, sessionId);
  if (!session || session.stage !== 'oauth') {
    return new Response('Google session expired. Return to Telegram and open the panel again.', { status: 400 });
  }
  if (!hasOAuthConfig(ctx)) {
    return new Response('Google OAuth is not configured on the platform.', { status: 500 });
  }
  return Response.redirect(buildGoogleAuthUrl(ctx, sessionId), 302);
}

function renderCalendarChoiceHtml(sessionId, accountEmail, calendars) {
  const rows = calendars.map((cal) => {
    const title = cal.summaryOverride || cal.summary || cal.id;
    const primary = cal.primary ? 'Primary' : cal.accessRole || '';
    const safeTitle = String(title).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeId = String(cal.id).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safePrimary = String(primary).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
      <div class="card">
        <h3>${safeTitle}</h3>
        <p><code>${safeId}</code></p>
        ${safePrimary ? `<p class="meta">${safePrimary}</p>` : ''}
        <a class="btn" href="/google/select?session=${encodeURIComponent(sessionId)}&calendarId=${encodeURIComponent(cal.id)}">Use this calendar</a>
      </div>
    `;
  }).join('');

  return `<!doctype html>
  <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Choose Google Calendar</title>
  <style>
    body{font-family:system-ui;background:#faf5ff;color:#2e1065;max-width:760px;margin:40px auto;padding:0 16px}
    .card{background:#fff;border:1px solid #e9d5ff;border-radius:14px;padding:16px;margin:12px 0;box-shadow:0 1px 4px rgba(0,0,0,.06)}
    .btn{display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px}
    code{background:#f3e8ff;padding:2px 6px;border-radius:6px}
    .meta{color:#6b21a8}
  </style></head><body>
    <h1>Choose calendar</h1>
    <p>Connected Google account: <b>${String(accountEmail || 'unknown').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b></p>
    <p>Select which calendar should be used for sync in ManicBot.</p>
    ${rows || '<p>No writable calendars found.</p>'}
    <p>After selecting a calendar, return to Telegram and reopen the calendar panel.</p>
  </body></html>`;
}

export async function handleGoogleCallback(ctx, url) {
  const sessionId = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const error = url.searchParams.get('error') || '';
  const session = await getOAuthSession(ctx, sessionId);
  if (!session || session.stage !== 'oauth') {
    return new Response('Google session expired. Return to Telegram and try again.', { status: 400 });
  }
  if (error) {
    return new Response(`Google authorization failed: ${error}`, { status: 400 });
  }
  if (!code) {
    return new Response('Missing Google authorization code.', { status: 400 });
  }
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(ctx, code);
  } catch (e) {
    console.error('[google] exchangeCodeForTokens failed:', e.message);
    return new Response('Google token exchange failed. Please try again.', { status: 500 });
  }
  const key = getTokenEncryptionKey(ctx);
  const refreshTokenEnc = tokens.refresh_token && key
    ? await encryptToken(tokens.refresh_token, key, GOOGLE_REFRESH_LABEL)
    : null;
  if (!refreshTokenEnc) {
    return new Response('Unable to securely store Google refresh token. Configure GOOGLE_TOKEN_ENCRYPTION_KEY or BOT_ENCRYPTION_KEY.', { status: 500 });
  }
  const calendars = await listGoogleCalendars(tokens.access_token);
  const writable = calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer');
  const accountEmail = writable.find(c => c.primary)?.id || writable[0]?.id || null;
  await putOAuthSession(ctx, sessionId, {
    ...session,
    stage: 'select',
    refreshTokenEnc,
    accountEmail,
    calendars: writable.map(c => ({
      id: c.id,
      summary: c.summary,
      summaryOverride: c.summaryOverride,
      primary: !!c.primary,
      accessRole: c.accessRole,
    })),
  }, 900);
  return new Response(renderCalendarChoiceHtml(sessionId, accountEmail, writable), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function handleGoogleSelect(ctx, url) {
  const sessionId = url.searchParams.get('session') || '';
  const calendarId = url.searchParams.get('calendarId') || '';
  const session = await getOAuthSession(ctx, sessionId);
  if (!session || session.stage !== 'select') {
    return new Response('Google session expired. Return to Telegram and try again.', { status: 400 });
  }
  if (!session.tenantId) {
    return new Response('Google OAuth is available only in D1 multi-tenant mode.', { status: 400 });
  }
  const calendar = (session.calendars || []).find(c => c.id === calendarId);
  if (!calendar) {
    return new Response('Selected calendar was not found in this Google session.', { status: 400 });
  }
  const tenantCtx = {
    ...ctx,
    tenantId: session.tenantId,
    baseUrl: getBaseUrl(ctx),
  };
  await ensureGoogleCalendarSchema(tenantCtx);
  const integration = await saveGoogleIntegration(tenantCtx, {
    scope: session.scope,
    masterChatId: session.scope === 'master' ? session.masterChatId : null,
    providerAccountEmail: session.accountEmail || calendar.id,
    calendarId: calendar.id,
    calendarSummary: calendar.summaryOverride || calendar.summary || calendar.id,
    refreshTokenEnc: session.refreshTokenEnc,
    syncEnabled: true,
    syncDirection: 'two_way',
  });
  let finalIntegration = integration;
  try {
    finalIntegration = await startWatchForIntegration(tenantCtx, integration);
  } catch (e) {
    await persistIntegrationState(tenantCtx, integration.id, tenantCtx.tenantId, {
      lastSyncStatus: 'watch_error',
      lastSyncError: e.message,
      updatedAt: nowTs(),
    });
  }
  try {
    await syncGoogleBusyBlocks(tenantCtx, finalIntegration);
  } catch (e) {
    await persistIntegrationState(tenantCtx, integration.id, tenantCtx.tenantId, {
      lastSyncStatus: 'sync_error',
      lastSyncError: e.message,
      updatedAt: nowTs(),
    });
  }

  if (session.scope === 'master' && session.masterChatId != null) {
    const master = await getMaster(tenantCtx, session.masterChatId);
    if (master) {
      await saveMaster(tenantCtx, session.masterChatId, {
        ...master,
        googleCalendarId: finalIntegration.calendarId,
        calendarEnabled: true,
      });
    }
  }

  await deleteOAuthSession(ctx, sessionId);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Google Calendar connected</title>
  <style>body{font-family:system-ui;max-width:680px;margin:48px auto;padding:0 16px;background:#eff6ff;color:#1e3a8a}
  .card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.08)} code{background:#dbeafe;padding:2px 6px;border-radius:6px}</style>
  </head><body><div class="card">
  <h1>Google Calendar connected</h1>
  <p>Account: <b>${String(finalIntegration.providerAccountEmail || 'unknown').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b></p>
  <p>Calendar: <code>${String(finalIntegration.calendarSummary || finalIntegration.calendarId).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></p>
  <p>Initial sync is complete. Return to Telegram and reopen the calendar panel.</p>
  </div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function handleGoogleWebhook(ctx, request) {
  await ensureGoogleCalendarSchema(ctx);
  const integrationId = request.headers.get('X-Goog-Channel-Token') || '';
  const channelId = request.headers.get('X-Goog-Channel-ID') || '';
  const resourceState = request.headers.get('X-Goog-Resource-State') || '';
  if (!integrationId) return new Response('Missing channel token', { status: 400 });
  const integration = await getGoogleIntegrationById(ctx, integrationId);
  if (!integration) return new Response('Unknown integration', { status: 404 });
  // Validate the channel ID matches what we registered to prevent spoofed webhooks
  if (integration.watchChannelId && channelId && integration.watchChannelId !== channelId) {
    console.warn('[gcal] webhook channel ID mismatch:', channelId, 'vs', integration.watchChannelId);
    return new Response('Channel ID mismatch', { status: 403 });
  }
  if (resourceState && resourceState !== 'sync') {
    try {
      await syncGoogleBusyBlocks(ctx, integration);
    } catch (e) {
      console.error('[gcal] webhook sync failed:', e.message);
    }
  }
  return new Response('OK');
}

export async function syncGoogleBusyBlocks(ctx, integration) {
  await ensureGoogleCalendarSchema(ctx);
  if (!integration) throw new Error('Google integration not found');
  if (!hasOAuthConfig(ctx)) throw new Error('Google OAuth is not configured');
  const accessToken = await refreshAccessToken(ctx, integration);
  const timeMin = new Date(nowTs() - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(nowTs() + SYNC_HORIZON_DAYS * 24 * 3600 * 1000).toISOString();
  const events = await listCalendarEvents(accessToken, integration.calendarId, timeMin, timeMax);
  const blocks = events.map(event => mapEventToBusyBlock(integration, event)).filter(Boolean);
  await persistBusyBlocks(ctx, integration, blocks);
  await persistIntegrationState(ctx, integration.id, integration.tenantId, {
    lastSyncAt: nowTs(),
    lastSyncStatus: 'ok',
    lastSyncError: null,
    updatedAt: nowTs(),
  });
  return { ok: true, blocks: blocks.length };
}

export async function syncGoogleIntegrationNow(ctx, { scope = 'tenant', masterChatId = null } = {}) {
  const integration = await getGoogleIntegration(ctx, { scope, masterChatId });
  if (!integration) return { ok: false, error: 'not_connected' };
  const result = await syncGoogleBusyBlocks(ctx, integration);
  return { ok: true, result, integration };
}

export async function renewExpiringGoogleWatches(ctx) {
  await ensureGoogleCalendarSchema(ctx);
  if (!ctx?.db || !ctx?.tenantId || !hasOAuthConfig(ctx)) return 0;
  const threshold = nowTs() + WATCH_RENEW_WINDOW_MS;
  const rows = await dbAll(ctx,
    'SELECT * FROM google_integrations WHERE tenant_id = ? AND sync_enabled = 1 AND (watch_expiration IS NULL OR watch_expiration < ?)',
    ctx.tenantId, threshold,
  );
  let renewed = 0;
  for (const row of rows) {
    try {
      const integration = rowToIntegration(row);
      await startWatchForIntegration(ctx, integration);
      renewed++;
    } catch (e) {
      console.error('[gcal] watch renew failed:', e.message);
      await persistIntegrationState(ctx, row.id, ctx.tenantId, {
        lastSyncStatus: 'watch_error',
        lastSyncError: e.message,
        updatedAt: nowTs(),
      });
    }
  }
  return renewed;
}

export async function loadExternalBusyBlocks(ctx, date, masterId = null) {
  await ensureGoogleCalendarSchema(ctx);
  if (!ctx?.db || !ctx?.tenantId || !date) return [];
  const integrations = [];
  const tenantIntegration = await getGoogleIntegration(ctx, { scope: 'tenant' });
  if (tenantIntegration) integrations.push(tenantIntegration);
  if (masterId != null) {
    const masterIntegration = await getGoogleIntegration(ctx, { scope: 'master', masterChatId: masterId });
    if (masterIntegration) integrations.push(masterIntegration);
  }
  if (!integrations.length) return [];

  const [year, month, day] = date.split('-').map(Number);
  const startTs = warsawToUTC(year, month, day, 0, 0).getTime();
  const endTs = warsawToUTC(year, month, day + 1, 0, 0).getTime();
  const result = [];
  const seen = new Set();
  for (const integration of integrations) {
    const rows = await dbAll(ctx,
      'SELECT * FROM google_busy_blocks WHERE integration_id = ? AND start_ts < ? AND end_ts > ?',
      integration.id, endTs, startTs,
    );
    for (const row of rows) {
      const id = `${row.integration_id}:${row.external_event_id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push({
        integrationId: row.integration_id,
        externalEventId: row.external_event_id,
        startTs: row.start_ts,
        endTs: row.end_ts,
        summary: row.summary,
        description: row.description || null,
        location: row.location || null,
        creator: row.creator || null,
        source: 'google_calendar',
      });
    }
  }
  return result;
}

/**
 * Load Google Calendar events for admin panel display.
 * Returns busy blocks for the given date range, formatted for UI.
 */
async function loadGoogleCalendarEvents(ctx, dateFrom, dateTo) {
  await ensureGoogleCalendarSchema(ctx);
  if (!ctx?.db || !ctx?.tenantId) return [];
  const { warsawToUTC } = await import('../utils/date.js');
  const [yf, mf, df] = dateFrom.split('-').map(Number);
  const [yt, mt, dt2] = dateTo.split('-').map(Number);
  const startTs = warsawToUTC(yf, mf, df, 0, 0).getTime();
  const endTs = warsawToUTC(yt, mt, dt2 + 1, 0, 0).getTime();
  const rows = await dbAll(ctx,
    'SELECT * FROM google_busy_blocks WHERE tenant_id = ? AND start_ts < ? AND end_ts > ? ORDER BY start_ts',
    ctx.tenantId, endTs, startTs,
  );
  return rows.map(row => ({
    externalEventId: row.external_event_id,
    summary: row.summary || '(без названия)',
    description: row.description || null,
    location: row.location || null,
    creator: row.creator || null,
    startTs: row.start_ts,
    endTs: row.end_ts,
    calendarId: row.calendar_id,
    source: 'google_calendar',
  }));
}

async function resolveCalendarTarget(ctx, apt) {
  const masterId = apt?.masterId || apt?.confirmedBy || null;
  if (ctx?.db && ctx?.tenantId) {
    if (masterId != null) {
      const masterIntegration = await getGoogleIntegration(ctx, { scope: 'master', masterChatId: masterId });
      if (masterIntegration) return { type: 'oauth', integration: masterIntegration };
    }
    const tenantIntegration = await getGoogleIntegration(ctx, { scope: 'tenant' });
    if (tenantIntegration) return { type: 'oauth', integration: tenantIntegration };
  }
  if (masterId != null && ctx?.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const master = await getMaster(ctx, masterId);
    if (master?.googleCalendarId && master?.calendarEnabled) {
      return { type: 'service_account', calendarId: master.googleCalendarId };
    }
  }
  return null;
}

export async function syncAppointmentCalendar(ctx, apt) {
  if (!apt?.id) return { ok: false, error: 'missing_appointment' };
  const target = await resolveCalendarTarget(ctx, apt);
  if (!target) return { ok: false, skipped: 'not_connected' };
  const service = ctx.svc?.find(s => s.id === apt.svcId);
  const masterId = apt?.masterId || apt?.confirmedBy || null;
  let masterName = null;
  if (masterId != null) {
    const master = await getMaster(ctx, masterId);
    masterName = master?.name || null;
  }
  const salon = ctx.tenant?.salon;
  const event = buildCalendarEvent(apt, service, salon, salon?.timezone || 'Europe/Warsaw', {
    masterName,
    currency: salon?.currency || 'PLN',
  });

  if (target.type === 'oauth') {
    try {
      if (apt.googleEventId && apt.googleIntegrationId === target.integration.id) {
        await updateOAuthCalendarEvent(ctx, target.integration, apt.googleEventId, event);
        await saveAppointmentCalendarLink(ctx, apt.id, {
          googleEventId: apt.googleEventId,
          googleCalendarId: target.integration.calendarId,
          googleIntegrationId: target.integration.id,
        });
        apt.googleCalendarId = target.integration.calendarId;
        apt.googleIntegrationId = target.integration.id;
        return { ok: true, mode: 'oauth', action: 'updated' };
      }

      if (apt.googleEventId) {
        await deleteAppointmentCalendar(ctx, apt);
      }

      const created = await createOAuthCalendarEvent(ctx, target.integration, event);
      await saveAppointmentCalendarLink(ctx, apt.id, {
        googleEventId: created.id,
        googleCalendarId: target.integration.calendarId,
        googleIntegrationId: target.integration.id,
      });
      apt.googleEventId = created.id;
      apt.googleCalendarId = target.integration.calendarId;
      apt.googleIntegrationId = target.integration.id;
      return { ok: true, mode: 'oauth', action: 'created' };
    } catch (err) {
      console.error('[gcal-sync] OAuth calendar operation failed for apt:', apt.id, err.message);
      return { ok: false, error: err.message };
    }
  }

  try {
    if (apt.googleEventId && !apt.googleIntegrationId && apt.googleCalendarId === target.calendarId) {
      await updateServiceAccountCalendarEvent(ctx, target.calendarId, apt.googleEventId, event);
      await saveAppointmentCalendarLink(ctx, apt.id, {
        googleEventId: apt.googleEventId,
        googleCalendarId: target.calendarId,
        googleIntegrationId: null,
      });
      apt.googleCalendarId = target.calendarId;
      apt.googleIntegrationId = null;
      return { ok: true, mode: 'service_account', action: 'updated' };
    }

    if (apt.googleEventId) {
      await deleteAppointmentCalendar(ctx, apt);
    }

    const created = await createServiceAccountCalendarEvent(ctx, target.calendarId, event);
    await saveAppointmentCalendarLink(ctx, apt.id, {
      googleEventId: created.id,
      googleCalendarId: target.calendarId,
      googleIntegrationId: null,
    });
    apt.googleEventId = created.id;
    apt.googleCalendarId = target.calendarId;
    apt.googleIntegrationId = null;
    return { ok: true, mode: 'service_account', action: 'created' };
  } catch (err) {
    console.error('[gcal-sync] Service account calendar operation failed for apt:', apt.id, err.message);
    return { ok: false, error: err.message };
  }
}

export async function deleteAppointmentCalendar(ctx, apt) {
  if (!apt?.googleEventId) return { ok: false, skipped: 'no_event' };
  try {
    if (apt.googleIntegrationId) {
      const integration = await getGoogleIntegrationById(ctx, apt.googleIntegrationId);
      if (integration) {
        await deleteOAuthCalendarEvent(ctx, integration, apt.googleEventId);
      }
    } else if (apt.googleCalendarId) {
      await deleteServiceAccountCalendarEvent(ctx, apt.googleCalendarId, apt.googleEventId);
    }
  } catch (e) {
    console.error('[gcal] delete appointment event failed:', e.message);
  }
  await clearAppointmentCalendarLink(ctx, apt.id);
  apt.googleEventId = null;
  apt.googleCalendarId = null;
  apt.googleIntegrationId = null;
  return { ok: true };
}

export async function revokeGoogleIntegration(ctx, { scope = 'tenant', masterChatId = null } = {}) {
  const integration = await getGoogleIntegration(ctx, { scope, masterChatId });
  if (!integration) return false;
  try {
    const key = getTokenEncryptionKey(ctx);
    const refreshToken = integration.refreshTokenEnc && key
      ? await decryptToken(integration.refreshTokenEnc, key, GOOGLE_REFRESH_LABEL)
      : null;
    if (refreshToken) {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => {});
    }
  } catch {}
  return deleteGoogleIntegration(ctx, { scope, masterChatId });
}
