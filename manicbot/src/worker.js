import { buildCtx } from './config.js';
import {
  buildLegacyCtx,
  resolveTenantFromBotId,
  buildTenantCtx,
} from './tenant/resolver.js';
import { listTenantIds, getBotIdsByTenantId } from './tenant/storage.js';
import { handleCron } from './handlers/cron.js';
import { envCtx } from './http/envCtx.js';
import { ensureDemoBotsProvisioned } from './http/demoBots.js';
import { ensurePreviewTenantProvisioned } from './tenant/previewTenant.js';
import { getCtx } from './http/resolveCtx.js';
import { tryLanding } from './http/landingHttp.js';
import { tryStripe } from './http/stripeHttp.js';
import { tryAdminKeyRoutes } from './http/adminKeyHttp.js';
import { tryLeadRoutes } from './http/leadsHttp.js';
import { tryGoogle } from './http/googleHttp.js';
import { tryAdminPanel } from './http/adminPanelHttp.js';
import { tryCalendar } from './http/calendarHttp.js';
import { tryTelegramWebhook } from './http/telegramWebhookHttp.js';
import { tryMetaWebhooks } from './http/metaWebhooksHttp.js';
import { trySearchApi } from './http/searchHttp.js';
import { tryUpload } from './http/uploadHttp.js';
import { tryChatWeb } from './http/chatWebHttp.js';
import { tryEmbed } from './http/embedHttp.js';
import { isAdminAppPath } from './http/adminAppProxy.js';
import { logEvent } from './utils/events.js';
import { generateSitemapResponse, generateRobotsResponse } from './utils/seo.js';

async function proxyToAdminApp(request, env, url) {
  const pagesBase = (env.ADMIN_APP_URL || 'https://admin-app-3nc.pages.dev').replace(/\/$/, '');
  const target = new URL(url.pathname + url.search, pagesBase);
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set('x-forwarded-host', url.hostname);
  proxyHeaders.set('x-forwarded-proto', url.protocol.replace(':', ''));
  const proxyReq = new Request(target.toString(), {
    method: request.method,
    headers: proxyHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    redirect: 'manual',
  });
  const resp = await fetch(proxyReq);
  const headers = new Headers(resp.headers);
  // Remove any Location headers pointing to the Pages domain — rewrite to origin
  const location = headers.get('location');
  if (location && location.includes(pagesBase.replace('https://', ''))) {
    headers.set('location', location.replace(pagesBase, url.origin));
  }
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

function disallowLegacyWebhook(env, request, url) {
  return (
    env.REQUIRE_WEBHOOK_BOT_ID === '1' &&
    env.DB &&
    request.method === 'POST' &&
    url.pathname === '/webhook'
  );
}

function logWorkerError(label, request, url, error, extra = {}) {
  const payload = {
    method: request.method,
    path: url.pathname,
    message: error?.message || String(error || label),
    ...extra,
  };
  if (error?.stack) payload.stack = error.stack;
  console.error(`[worker] ${label}`, payload);
}

/** Append standard security headers to any outgoing response. */
function addSecurityHeaders(resp) {
  const h = new Headers(resp.headers);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!h.has('Content-Security-Policy')) {
    h.set('Content-Security-Policy', "frame-ancestors 'none'");
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

let _securityValidated = false;
/**
 * Validate security configuration at startup. Throws on hard failures to
 * fail-fast rather than silently running with insecure defaults.
 *
 * Enforcement rules:
 *   - ADMIN_KEY: if set, must be ≥ 32 chars (throw). If unset, admin
 *     endpoints are disabled by isAdminKeyValid (no throw).
 *   - BOT_ENCRYPTION_KEY: if set, must be ≥ 32 chars (throw). If unset,
 *     warn only — downstream code (token encryption, calendar signing,
 *     Google OAuth) already fails closed individually.
 *   - META_APP_SECRET: if Meta channels are configured (META_VERIFY_TOKEN_*),
 *     must be set AND ≥ 32 chars (throw).
 */
function validateSecurityConfig(env) {
  if (_securityValidated) return;
  _securityValidated = true;

  if (env.ADMIN_KEY && String(env.ADMIN_KEY).length < 32) {
    throw new Error('[SECURITY] ADMIN_KEY must be at least 32 characters — refusing to start');
  }

  if (env.BOT_ENCRYPTION_KEY && String(env.BOT_ENCRYPTION_KEY).length < 32) {
    throw new Error('[SECURITY] BOT_ENCRYPTION_KEY must be at least 32 characters — refusing to start');
  }
  if (!env.BOT_ENCRYPTION_KEY) {
    console.warn('[SECURITY] BOT_ENCRYPTION_KEY not set — bot/channel tokens will be stored in plaintext and calendar links disabled');
  }

  const metaConfigured = !!(env.META_VERIFY_TOKEN_WA || env.META_VERIFY_TOKEN_IG);
  if (metaConfigured) {
    if (!env.META_APP_SECRET) {
      throw new Error('[SECURITY] META_APP_SECRET is required when META_VERIFY_TOKEN_WA/IG is set — refusing to start');
    }
    if (String(env.META_APP_SECRET).length < 32) {
      throw new Error('[SECURITY] META_APP_SECRET must be at least 32 characters — refusing to start');
    }
  }
}

export default {
  async fetch(request, env, executionCtx) {
    validateSecurityConfig(env);
    const url = new URL(request.url);

    // robots.txt — served BEFORE landing proxy so Workers own it
    if (url.pathname === '/robots.txt' && request.method === 'GET') {
      return addSecurityHeaders(generateRobotsResponse(url.origin));
    }

    // sitemap.xml — dynamic (static entries + DB-driven salons)
    if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
      return addSecurityHeaders(await generateSitemapResponse(env, url.origin));
    }

    // Admin-app routes → proxy to Cloudflare Pages (see isAdminAppPath)
    if (isAdminAppPath(url.pathname)) {
      return addSecurityHeaders(await proxyToAdminApp(request, env, url));
    }

    // Public search API (CORS-enabled, no auth)
    if (url.pathname.startsWith('/api/search/')) {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        });
      }
      const searchRes = await trySearchApi(request, env, url);
      if (searchRes) return addSecurityHeaders(searchRes);
    }

    await ensureDemoBotsProvisioned(env);
    await ensurePreviewTenantProvisioned(env);

    let res = await tryLanding(request, env, url);
    if (res) return addSecurityHeaders(res);

    res = await tryStripe(request, env, url);
    if (res) return res; // Stripe webhook — no browser headers needed

    res = await tryAdminKeyRoutes(request, env, url);
    if (res) return addSecurityHeaders(res);

    res = await tryLeadRoutes(request, env, url, executionCtx);
    if (res) return addSecurityHeaders(res);

    // Upload + CDN routes (POST /upload/asset, GET /cdn/*) — before landing proxy.
    res = await tryUpload(request, env, url);
    if (res) return addSecurityHeaders(res);

    res = await tryGoogle(request, env, url);
    if (res) return addSecurityHeaders(res);

    // Meta WA/IG before getCtx: paths /webhook/wa and /webhook/ig are not Telegram bot ids.
    res = await tryMetaWebhooks(request, env, url, executionCtx);
    if (res) return res; // Webhook — no browser headers needed

    // Web chat widget routes (/chat/init, /chat/send, /chat/poll).
    // These need env.DB + env.MANICBOT; they build their own ctx internally.
    res = await tryChatWeb(request, env, url);
    if (res) return res; // Structured JSON response with own CORS headers

    // Embeddable landing widget (/embed/demo-chat.js): static JS, public CORS.
    res = await tryEmbed(request, env, url);
    if (res) return addSecurityHeaders(res);

    const isAdminPath = url.pathname.startsWith('/admin/');
    const needsFallback = url.pathname !== '/' && !isAdminPath;
    function tryFallbackCtx() {
      const skipLegacy = disallowLegacyWebhook(env, request, url);
      if (env.BOT_TOKEN && env.WEBHOOK_SECRET && !skipLegacy) return buildLegacyCtx(env);
      if (!skipLegacy) return buildCtx(env);
      return null;
    }
    let ctx;
    try {
      ctx = await getCtx(env, url, request);
      if (!ctx && needsFallback) ctx = tryFallbackCtx();
    } catch (e) {
      logWorkerError('context resolution failed', request, url, e);
      void logEvent(envCtx(env), 'error.handler', { level: 'error', message: e?.message ?? 'Unknown error', stack: e?.stack?.slice(0, 300) });
      if (needsFallback) {
        try {
          ctx = tryFallbackCtx();
        } catch (fallbackError) {
          logWorkerError('fallback context build failed', request, url, fallbackError);
          void logEvent(envCtx(env), 'error.handler', { level: 'error', message: fallbackError?.message ?? 'Unknown error', stack: fallbackError?.stack?.slice(0, 300) });
        }
      }
      if (!ctx) return new Response('Internal Server Error', { status: 500 });
    }
    if (!ctx) {
      if (disallowLegacyWebhook(env, request, url)) {
        return new Response('Legacy /webhook disabled; use /webhook/{botId}', { status: 403 });
      }
      return new Response('Not Found', { status: 404 });
    }
    ctx.baseUrl = url.origin;
    const ADMIN_401 = new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="ManicBot Admin"' },
    });

    res = await tryAdminPanel(request, ctx, url, ADMIN_401);
    if (res) return addSecurityHeaders(res);

    res = await tryCalendar(request, ctx, url);
    if (res) return addSecurityHeaders(res);

    res = await tryTelegramWebhook(request, ctx, url);
    if (res) return res; // Telegram webhook — no browser headers needed

    // Unknown GET paths → proxy to landing SPA (renders a 404 page)
    if (request.method === 'GET') {
      const landingRes = await tryLanding(request, env, url, /* force */ true);
      if (landingRes) return addSecurityHeaders(landingRes);
    }
    return addSecurityHeaders(new Response('Not Found', { status: 404 }));
  },

  /**
   * Cron entry — Cloudflare scheduled trigger every 15 min.
   *
   * Sprint 2 (#5 in audit): refactored from sequential for-loop (capped at ~100
   * tenants by 30s CPU budget) to a Cloudflare Queues fan-out. The producer
   * (this handler) only LISTS active tenants and enqueues one message each —
   * fast even for 5000+ tenants. The consumer (`queue` handler below) gets a
   * fresh CPU budget per batch.
   *
   * Falls back to legacy single-bot cron if MANICBOT_TENANT_CRON binding is
   * absent (local dev / tests).
   */
  async scheduled(event, env, _scheduledCtx) {
    try {
      const ec = envCtx(env);
      // Queues fan-out path
      if (ec.db && env.MANICBOT_TENANT_CRON?.sendBatch) {
        const tenantIds = await listTenantIds(ec);
        if (tenantIds.length > 0) {
          const batchSize = 100;
          const scheduledAt = event.scheduledTime || Date.now();
          for (let i = 0; i < tenantIds.length; i += batchSize) {
            const batch = tenantIds.slice(i, i + batchSize).map(tenantId => ({
              body: { tenantId, scheduledAt },
            }));
            await env.MANICBOT_TENANT_CRON.sendBatch(batch);
          }
          void logEvent(ec, 'cron.scheduled.enqueued', {
            level: 'info',
            message: `Enqueued ${tenantIds.length} tenant cron jobs`,
            data: { tenantCount: tenantIds.length, scheduledAt },
          });
          return;
        }
      }
      // Legacy in-process path (no Queue binding OR no D1 tenants)
      if (ec.db) {
        const tenantIds = await listTenantIds(ec);
        if (tenantIds.length > 0) {
          for (const tenantId of tenantIds) {
            const botIds = await getBotIdsByTenantId(ec, tenantId);
            if (botIds.length === 0) continue;
            const resolved = await resolveTenantFromBotId(ec, botIds[0], env.BOT_ENCRYPTION_KEY || null);
            if (!resolved) continue;
            const ctx = buildTenantCtx(env, resolved);
            _scheduledCtx.waitUntil(handleCron(ctx));
          }
          return;
        }
      }
      const ctx = env.BOT_TOKEN && env.WEBHOOK_SECRET ? buildLegacyCtx(env) : buildCtx(env);
      _scheduledCtx.waitUntil(handleCron(ctx));
    } catch (e) {
      console.error('Cron init error:', {
        message: e?.message || String(e),
        stack: e?.stack || null,
      });
      void logEvent(envCtx(env), 'error.cron', { level: 'error', message: e?.message ?? 'Cron init error', data: { stack: e?.stack?.slice(0, 300) } });
    }
  },

  /**
   * Queue consumer — processes one tenant's cron per message with full CPU budget.
   * Receives batches of {tenantId, scheduledAt}. On error, message.retry()
   * with backoff; after 3 retries the message goes to the DLQ.
   */
  async queue(batch, env, _ctx) {
    const ec = envCtx(env);
    for (const msg of batch.messages) {
      const { tenantId, scheduledAt } = msg.body || {};
      if (!tenantId) {
        msg.ack();
        continue;
      }
      try {
        const botIds = await getBotIdsByTenantId(ec, tenantId);
        if (botIds.length === 0) {
          msg.ack();
          continue;
        }
        const resolved = await resolveTenantFromBotId(ec, botIds[0], env.BOT_ENCRYPTION_KEY || null);
        if (!resolved) {
          msg.ack();
          continue;
        }
        const ctx = buildTenantCtx(env, resolved);
        await handleCron(ctx);
        msg.ack();
      } catch (e) {
        void logEvent(ec, 'cron.tenant.failed', {
          level: 'error',
          message: `Cron failed for tenant ${tenantId}: ${e?.message ?? 'unknown'}`,
          data: { tenantId, scheduledAt, attempts: msg.attempts, error: e?.message?.slice(0, 200) },
        });
        // Retry up to 3 times (configured in wrangler.toml max_retries)
        msg.retry({ delaySeconds: Math.min(60 * msg.attempts, 300) });
      }
    }
  },
};
