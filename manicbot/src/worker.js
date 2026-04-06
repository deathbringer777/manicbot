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
import { getCtx } from './http/resolveCtx.js';
import { tryLanding } from './http/landingHttp.js';
import { tryStripe } from './http/stripeHttp.js';
import { tryAdminKeyRoutes } from './http/adminKeyHttp.js';
import { tryGoogle } from './http/googleHttp.js';
import { tryAdminPanel } from './http/adminPanelHttp.js';
import { tryCalendar } from './http/calendarHttp.js';
import { tryTelegramWebhook } from './http/telegramWebhookHttp.js';
import { tryMetaWebhooks } from './http/metaWebhooksHttp.js';
import { trySearchApi } from './http/searchHttp.js';
import { isAdminAppPath } from './http/adminAppProxy.js';
import { logEvent } from './utils/events.js';

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

async function generateSitemap(env, origin) {
  const base = origin || 'https://manicbot.com';
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/search', priority: '0.8', changefreq: 'daily' },
    { loc: '/login', priority: '0.3', changefreq: 'monthly' },
    { loc: '/blog/', priority: '0.7', changefreq: 'weekly' },
  ];
  let salonUrls = [];
  if (env.DB) {
    try {
      const result = await env.DB.prepare('SELECT slug FROM tenants WHERE public_active = 1 AND slug IS NOT NULL').all();
      salonUrls = (result.results || []).map(r => ({
        loc: `/salon/${r.slug}`,
        priority: '0.6',
        changefreq: 'weekly',
      }));
    } catch { /* ignore */ }
  }
  const allPages = [...staticPages, ...salonUrls];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${base}${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
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
function validateSecurityConfig(env) {
  if (_securityValidated) return;
  _securityValidated = true;
  if (!env.BOT_ENCRYPTION_KEY) {
    console.warn('[SECURITY] BOT_ENCRYPTION_KEY not set — tokens stored in plaintext in D1');
  }
  if (!env.META_APP_SECRET && (env.META_VERIFY_TOKEN_WA || env.META_VERIFY_TOKEN_IG)) {
    console.warn('[SECURITY] META_APP_SECRET not set but Meta channels configured — webhooks unverified');
  }
  if (env.ADMIN_KEY && env.ADMIN_KEY.length < 32) {
    console.warn('[SECURITY] ADMIN_KEY shorter than 32 chars — consider using a stronger key');
  }
}

export default {
  async fetch(request, env, executionCtx) {
    validateSecurityConfig(env);
    const url = new URL(request.url);

    // robots.txt
    if (url.pathname === '/robots.txt' && request.method === 'GET') {
      return new Response(
        'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /webhook\nSitemap: ' + url.origin + '/sitemap.xml\n',
        { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' } },
      );
    }

    // Sitemap
    if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
      return addSecurityHeaders(await generateSitemap(env, url.origin));
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

    let res = await tryLanding(request, env, url);
    if (res) return addSecurityHeaders(res);

    res = await tryStripe(request, env, url);
    if (res) return res; // Stripe webhook — no browser headers needed

    res = await tryAdminKeyRoutes(request, env, url);
    if (res) return addSecurityHeaders(res);

    res = await tryGoogle(request, env, url);
    if (res) return addSecurityHeaders(res);

    // Meta WA/IG before getCtx: paths /webhook/wa and /webhook/ig are not Telegram bot ids.
    res = await tryMetaWebhooks(request, env, url, executionCtx);
    if (res) return res; // Webhook — no browser headers needed

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
      if (!ctx) return new Response(e?.message || 'Server Error', { status: 500 });
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

  async scheduled(event, env, _scheduledCtx) {
    try {
      const ec = envCtx(env);
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
      const ctx =
        env.BOT_TOKEN && env.WEBHOOK_SECRET ? buildLegacyCtx(env) : buildCtx(env);
      _scheduledCtx.waitUntil(handleCron(ctx));
    } catch (e) {
      console.error('Cron init error:', {
        message: e?.message || String(e),
        stack: e?.stack || null,
      });
      void logEvent(envCtx(env), 'error.cron', { level: 'error', message: e?.message ?? 'Cron init error', data: { stack: e?.stack?.slice(0, 300) } });
    }
  },
};
