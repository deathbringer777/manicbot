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
import { logEvent } from './utils/events.js';

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

export default {
  async fetch(request, env, executionCtx) {
    const url = new URL(request.url);

    // /dashboard* → redirect to admin-app Cloudflare Pages (runs before everything else)
    if (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')) {
      const pagesBase = (env.ADMIN_APP_URL || 'https://admin-app-3nc.pages.dev').replace(/\/$/, '');
      const rest = url.pathname.slice('/dashboard'.length) || '/';
      return Response.redirect(pagesBase + rest + url.search, 302);
    }

    // /salon/* and /search → redirect to admin-app Pages
    if (url.pathname.startsWith('/salon/') || url.pathname === '/search' || url.pathname.startsWith('/search/')) {
      const pagesBase = (env.ADMIN_APP_URL || 'https://admin-app-3nc.pages.dev').replace(/\/$/, '');
      return Response.redirect(pagesBase + url.pathname + url.search, 302);
    }

    await ensureDemoBotsProvisioned(env);

    let res = await tryLanding(request, env, url);
    if (res) return res;

    res = await tryStripe(request, env, url);
    if (res) return res;

    res = await tryAdminKeyRoutes(request, env, url);
    if (res) return res;

    res = await tryGoogle(request, env, url);
    if (res) return res;

    // Meta WA/IG before getCtx: paths /webhook/wa and /webhook/ig are not Telegram bot ids.
    res = await tryMetaWebhooks(request, env, url, executionCtx);
    if (res) return res;

    const isAdminPath = url.pathname.startsWith('/admin/');
    let ctx;
    try {
      ctx = await getCtx(env, url, request);
      if (!ctx && url.pathname !== '/' && !isAdminPath) {
        const skipLegacy = disallowLegacyWebhook(env, request, url);
        if (env.BOT_TOKEN && env.WEBHOOK_SECRET && !skipLegacy) ctx = buildLegacyCtx(env);
        else if (!skipLegacy) ctx = buildCtx(env);
      }
    } catch (e) {
      logWorkerError('context resolution failed', request, url, e);
      void logEvent(envCtx(env), 'error.handler', { level: 'error', message: e?.message ?? 'Unknown error', stack: e?.stack?.slice(0, 300) });
      if (url.pathname !== '/' && !isAdminPath) {
        try {
          const skipLegacy = disallowLegacyWebhook(env, request, url);
          if (env.BOT_TOKEN && env.WEBHOOK_SECRET && !skipLegacy) ctx = buildLegacyCtx(env);
          else if (!skipLegacy) ctx = buildCtx(env);
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
    if (res) return res;

    res = await tryCalendar(request, ctx, url);
    if (res) return res;

    res = await tryTelegramWebhook(request, ctx, url);
    if (res) return res;

    return new Response('Not Found', { status: 404 });
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
    }
  },
};
