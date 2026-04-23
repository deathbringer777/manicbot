/**
 * @fileoverview Web chat channel — HTTP routes.
 *
 * This file is a mirror of `metaWebhooksHttp.js` but for the built-in web
 * widget. Instead of a webhook POST from Meta, the client (browser) POSTs
 * JSON and then reads the bot's replies inline from the response body.
 *
 * Routes:
 *   POST /chat/init                 → creates a session, returns salon branding
 *   POST /chat/send                 → inbound message, returns bot's replies
 *   GET  /chat/poll                 → out-of-band messages (cron-pushed, etc.)
 *   OPTIONS (any)                   → CORS preflight
 *
 * Flow parity with WA/IG:
 *   resolveTenantFromSlug → buildChannelCtx(webAdapter) → initServices →
 *   adapter.normalize → handleInbound → onMsg/onCb → adapter.send() →
 *   drainOutbox → HTTP response body.
 */

import { resolveTenantFromSlug, buildChannelCtx } from '../channels/resolver.js';
import { log } from '../utils/logger.js';
import {
  WebAdapter,
  chatIdFromSession,
  generateSessionId,
  readOutbox,
} from '../channels/web.js';
import { handleInbound } from '../handlers/inbound.js';
import { initServices } from '../services/services.js';
import { envCtx } from './envCtx.js';
import { logEvent } from '../utils/events.js';
import { dbAll } from '../utils/db.js';
import { checkAndIncrement } from '../utils/rateLimit.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function jsonError(message, status = 400, extra = {}) {
  return jsonResponse({ ok: false, error: message, ...extra }, status);
}

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Per-IP rate limiter for public /chat/* endpoints. Returns a 429 Response
 * when over the threshold, otherwise null so the caller can proceed.
 *
 * Thresholds are sized against expected widget behavior:
 *   init  — 10/min (page-load only)
 *   send  — 30/min (~1 msg per 2s)
 *   poll  — 60/min (widget polls every 3s → 20/min baseline)
 *
 * #S11 — prevents flood-based Workers CPU / KV-write exhaustion.
 */
async function rateLimitChat(ctx, ip, action, limit, windowSec = 60) {
  if (!ctx?.db) return null;
  const rl = await checkAndIncrement(ctx, `chat:${ip}`, action, limit, windowSec);
  if (!rl.limited) return null;
  const retryAfter = Math.max(1, rl.retryAfter);
  return new Response(
    JSON.stringify({ ok: false, error: 'rate_limited', retryAfter }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Retry-After': String(retryAfter),
        ...CORS_HEADERS,
      },
    },
  );
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Salon branding response shape — matches what ChatClient expects. */
async function loadSalonBranding(ctx, slug) {
  const rows = await dbAll(
    ctx,
    `SELECT id, name, display_name, logo, cover_photo, brand_palette, slug, description, city
       FROM tenants WHERE slug = ? AND public_active = 1 LIMIT 1`,
    slug,
  );
  const t = rows[0];
  if (!t) return null;
  let brandPalette = null;
  try { brandPalette = t.brand_palette ? JSON.parse(t.brand_palette) : null; } catch { /* ignore */ }
  return {
    slug: t.slug,
    name: t.display_name || t.name || '',
    legalName: t.name || '',
    logo: t.logo || null,
    coverPhoto: t.cover_photo || null,
    brandPalette,
    description: t.description || null,
    city: t.city || null,
  };
}

/** Build a tenant context for the web channel for a given slug. */
async function buildWebCtxForSlug(env, slug, sessionChatId) {
  const ec = envCtx(env);
  const resolved = await resolveTenantFromSlug(ec, slug);
  if (!resolved) return null;
  const adapter = new WebAdapter({ tenantId: resolved.tenantId });
  const ctx = await buildChannelCtx(env, resolved.tenantId, resolved.channelConfig, adapter);
  if (!ctx) return null;
  // Allow the adapter to reach back into ctx for KV writes (mirrors WA pattern).
  adapter._ctx = ctx;
  // SECURITY: tag the adapter + ctx with the active session's chat_id so that
  //  - WebAdapter.send refuses any non-active recipient
  //  - telegram.js:send reroutes staff notifications via Telegram instead of
  //    leaking them into the client's outbox
  //  - users.js role helpers (isAdmin / isPlatformAdmin / getRole) and
  //    roles.js resolveRole hard-lock this chat_id to the client role even if
  //    a stale tenant_roles row matched its hash.
  if (typeof sessionChatId === 'number' && Number.isFinite(sessionChatId)) {
    adapter.setActiveChat(sessionChatId);
    ctx._webSessionChatId = sessionChatId;
    ctx._lockToClientRole = true;
  }
  await initServices(ctx);
  return { ctx, adapter };
}

/**
 * SECURITY: strip control characters that could break logging / db inserts /
 * downstream renderers. Allow tab and newline. Cap to a hard length so a
 * single POST cannot blow up bot state.
 * @param {unknown} value
 * @param {number} maxLen
 * @returns {string|null}
 */
function sanitizeUserText(value, maxLen) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  const trimmed = cleaned.replace(/\s+$/g, '').slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : null;
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response|null>}
 */
export async function tryChatWeb(request, env, url) {
  const p = url.pathname;
  if (!p.startsWith('/chat/')) return null;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── POST /chat/init ──────────────────────────────────────────────────────
  if (request.method === 'POST' && p === '/chat/init') {
    if (!env.DB) return jsonError('DB not bound', 500);
    const ec = envCtx(env);
    const ip = clientIp(request);
    const rlRes = await rateLimitChat(ec, ip, 'chat-init', 10, 60);
    if (rlRes) return rlRes;

    const body = await readJson(request);
    const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
    if (!slug) return jsonError('slug required', 400);

    const branding = await loadSalonBranding(ec, slug);
    if (!branding) return jsonError('Salon not found or not published', 404);

    const sessionId = generateSessionId();
    const chatId = await chatIdFromSession(sessionId);

    void logEvent(ec, 'chat.web.init', {
      tenantId: null,
      level: 'info',
      message: `web chat session opened for slug=${slug}`,
      data: { slug, chatId },
    });

    return jsonResponse({
      ok: true,
      sessionId,
      chatId,
      salon: branding,
    });
  }

  // ── POST /chat/send ──────────────────────────────────────────────────────
  if (request.method === 'POST' && p === '/chat/send') {
    if (!env.DB) return jsonError('DB not bound', 500);
    const ipSend = clientIp(request);
    const rlSend = await rateLimitChat(envCtx(env), ipSend, 'chat-send', 30, 60);
    if (rlSend) return rlSend;

    const body = await readJson(request);
    const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    // SECURITY: cap + strip control chars on every user-supplied field.
    const text = sanitizeUserText(body?.text, 4000);
    const callbackData = sanitizeUserText(body?.callbackData, 256);
    const userName = sanitizeUserText(body?.userName, 64);
    const userLang = sanitizeUserText(body?.userLang, 8);
    // Opaque parent message id (the bubble id of the message whose button was
    // tapped). Forwarded so the bot's `editPhoto` can morph that bubble in
    // place instead of spawning a new one for every navigation arrow.
    const messageId = sanitizeUserText(body?.messageId, 64);

    if (!slug) return jsonError('slug required', 400);
    if (!sessionId || sessionId.length < 16 || sessionId.length > 128) return jsonError('sessionId required', 400);
    if (!/^[a-f0-9]+$/i.test(sessionId)) return jsonError('sessionId malformed', 400);
    if (!text && !callbackData) return jsonError('text or callbackData required', 400);

    const chatId = await chatIdFromSession(sessionId);

    const built = await buildWebCtxForSlug(env, slug, chatId);
    if (!built) return jsonError('Salon not found or not published', 404);
    const { ctx, adapter } = built;

    // Normalize inbound payload into the standard InboundMessage shape.
    const inbound = adapter.normalize({
      sessionId,
      chatId,
      text,
      callbackData,
      messageId,
      userName,
      userLang,
    });
    if (!inbound) return jsonError('Invalid payload', 400);

    try {
      await handleInbound(ctx, inbound);
    } catch (e) {
      log.error('http.chatWeb', e instanceof Error ? e : new Error(String(e?.message)), { action: 'handleInbound' });
      void logEvent(envCtx(env), 'chat.web.error', {
        tenantId: ctx.tenantId,
        level: 'error',
        message: e?.message ?? 'handler failed',
        data: { slug, chatId },
      });
      return jsonError('Internal error', 500);
    }

    // Drain any messages the bot produced synchronously.
    const messages = adapter.drainOutbox();

    return jsonResponse({ ok: true, messages });
  }

  // ── GET /chat/poll ────────────────────────────────────────────────────────
  if (request.method === 'GET' && p === '/chat/poll') {
    if (!env.DB) return jsonError('DB not bound', 500);
    const ipPoll = clientIp(request);
    const rlPoll = await rateLimitChat(envCtx(env), ipPoll, 'chat-poll', 60, 60);
    if (rlPoll) return rlPoll;

    const slug = url.searchParams.get('slug') || '';
    const sessionId = url.searchParams.get('sessionId') || '';
    const sinceTs = parseInt(url.searchParams.get('since') || '0', 10) || 0;
    if (!slug) return jsonError('slug required', 400);
    if (!sessionId || sessionId.length < 16 || sessionId.length > 128) return jsonError('sessionId required', 400);
    if (!/^[a-f0-9]+$/i.test(sessionId)) return jsonError('sessionId malformed', 400);

    const chatId = await chatIdFromSession(sessionId);
    const built = await buildWebCtxForSlug(env, slug, chatId);
    if (!built) return jsonError('Salon not found or not published', 404);
    const { ctx } = built;

    const messages = await readOutbox(ctx, chatId, { sinceTs, clear: true });
    return jsonResponse({ ok: true, messages });
  }

  // Unknown /chat/* path
  return null;
}
