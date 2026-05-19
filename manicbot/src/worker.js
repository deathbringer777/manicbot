import { buildCtx } from './config.js';
import {
  buildLegacyCtx,
  resolveTenantFromBotId,
  buildTenantCtx,
} from './tenant/resolver.js';
import { listTenantIds, getBotIdsByTenantId, getTenant } from './tenant/storage.js';
import { tenantHasActiveChannel } from './channels/resolver.js';
import { handleCron } from './handlers/cron.js';
import { phaseInstagramAutopilot } from './marketing/autopilot.js';
import { envCtx } from './http/envCtx.js';
import { ensureDemoBotsProvisioned } from './http/demoBots.js';
import { ensurePreviewTenantProvisioned } from './tenant/previewTenant.js';
import { getCtx } from './http/resolveCtx.js';
import { tryLanding } from './http/landingHttp.js';
import { tryLegalPages } from './http/legalPagesHttp.js';
import { tryStripe } from './http/stripeHttp.js';
import { tryAdminKeyRoutes } from './http/adminKeyHttp.js';
import { tryMessengerOutboundRoute } from './http/messengerOutboundHttp.js';
import { tryMessengerWsRoute } from './http/messengerWsHttp.js';
export { MessengerHub } from './durable/messengerHub.js';
import { tryLeadRoutes } from './http/leadsHttp.js';
import { tryGoogle } from './http/googleHttp.js';
import { tryMetaOAuth } from './http/metaOAuthHttp.js';
import { tryAdminPanel } from './http/adminPanelHttp.js';
import { tryCalendar } from './http/calendarHttp.js';
import { tryTelegramWebhook } from './http/telegramWebhookHttp.js';
import { tryMetaWebhooks } from './http/metaWebhooksHttp.js';
import { trySearchApi } from './http/searchHttp.js';
import { tryUpload } from './http/uploadHttp.js';
import { tryChatWeb } from './http/chatWebHttp.js';
import { tryEmbed } from './http/embedHttp.js';
import { tryDemoPage } from './http/demoPageHttp.js';
import { isAdminAppPath } from './http/adminAppProxy.js';
import { handleTrackRequest } from './http/trackHttp.js';
import { handleUnsubscribeRequest } from './http/unsubscribeHttp.js';
import { handleHealthRequest } from './http/healthHttp.js';
import { logEvent, emitCronSkipRateLimited } from './utils/events.js';
import { log } from './utils/logger.js';
import { captureError } from './utils/errorCapture.js';
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

/**
 * Decide whether the legacy single-bot fallback ctx is forbidden for this request.
 *
 * Forbidden when:
 *   - REQUIRE_WEBHOOK_BOT_ID=1 AND DB is bound (multi-tenant mode is enforced), AND
 *   - request is POST, AND
 *   - path is `/webhook` (legacy single-bot — must use `/webhook/{botId}`), OR
 *   - path is `/webhook/{botId}` for a Telegram bot that we failed to resolve.
 *     The `/webhook/{botId}` case is the silent-bug regression: pre-fix, the
 *     worker fell back to legacy ctx (env.WEBHOOK_SECRET) which never matches
 *     Telegram's per-bot secret_token → 403 forever, ✓✓-no-reply on the user
 *     side. Now we refuse legacy fallback for that path so the worker returns
 *     a loud 404 + log event instead of silently mismatching secrets.
 *
 * NOT forbidden:
 *   - `/webhook/wa` and `/webhook/ig` are Meta channels (handled earlier in
 *     `tryMetaWebhooks`); legacy fallback for them is harmless because Meta
 *     paths don't reach this code path post-resolution.
 *
 * Exported so test/webhook-resolution-cascade.test.js can verify path matching
 * without driving the full worker.fetch.
 */
export function disallowLegacyWebhook(env, request, url) {
  if (env.REQUIRE_WEBHOOK_BOT_ID !== '1' || !env.DB) return false;
  if (request.method !== 'POST') return false;
  if (url.pathname === '/webhook') return true;
  const m = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (m && m[1] !== 'wa' && m[1] !== 'ig') return true;
  return false;
}

/**
 * P2-2 — Predicate: does this URL pathname require a Telegram/admin/calendar
 * ctx to be built before dispatch?
 *
 * Returns true for: /webhook, /webhook/{botId}, /admin/*, /setup,
 * /remove-webhook, /calendar/{aptId}[.ics]. Everything else (landing,
 * /api/search/*, /embed/*, static assets) can short-circuit to tryLanding
 * without a D1 round-trip.
 *
 * Exported so test/worker-fast-path-landing.test.js can verify the matcher
 * stays in sync with the actual route handlers.
 */
export function pathNeedsCtx(pathname) {
  if (!pathname || typeof pathname !== 'string') return false;
  if (pathname === '/webhook' || /^\/webhook\/[^/]+$/.test(pathname)) return true;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return true;
  if (pathname === '/setup' || pathname === '/remove-webhook') return true;
  if (/^\/calendar\/.+/.test(pathname)) return true;
  return false;
}

function logWorkerError(label, request, url, error, extra = {}) {
  const payload = {
    method: request.method,
    path: url.pathname,
    message: error?.message || String(error || label),
    ...extra,
  };
  if (error?.stack) payload.stack = error.stack;
  log.error(`worker.${label.replace(/\s+/g, '_')}`, new Error(payload.message), payload);
}

/**
 * Append standard security headers to any outgoing response.
 *
 * This is a *floor*, not an overwriter. Each header is set only if the
 * response doesn't already carry one — so the admin-app proxy (which
 * runs its own per-route middleware on Cloudflare Pages, e.g.
 * `X-Frame-Options: SAMEORIGIN` for `/salon/{slug}/chat` to make the
 * salon-dashboard chat preview iframe render) keeps its choices, while
 * Worker-served responses (HTML admin panel, /setup wizard, landing
 * proxy fall-throughs, calendar .ics, embed JS, Stripe success page,
 * etc.) get the strict defaults. The CSP slot already used this pattern;
 * the rest of the headers now match.
 */
export function addSecurityHeaders(resp) {
  const h = new Headers(resp.headers);
  if (!h.has('X-Content-Type-Options')) h.set('X-Content-Type-Options', 'nosniff');
  if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'DENY');
  if (!h.has('Referrer-Policy')) h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!h.has('Strict-Transport-Security')) {
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (!h.has('Permissions-Policy')) {
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(self), usb=()');
  }
  if (!h.has('Cross-Origin-Opener-Policy')) h.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!h.has('Content-Security-Policy')) {
    // Strict default. The Worker mostly serves: the embed widget script,
    // small HTML admin pages (/setup, /admin/*), Stripe success page,
    // calendar .ics files. Inline scripts in those pages have to be moved
    // to external files or attribute-event-free. Telegram & Stripe iframes
    // are intentionally allowed.
    h.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://api.stripe.com https://api.telegram.org https://core.telegram.org https://*.telegram.org https://challenges.cloudflare.com",
        "frame-src https://js.stripe.com https://challenges.cloudflare.com",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://accounts.google.com https://checkout.stripe.com",
        "upgrade-insecure-requests",
      ].join('; '),
    );
  }
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

let _securityValidated = false;

/**
 * Reset the module-level "validation has run" cache. Test-only — exported
 * so the Vitest suite can exercise the validation gate multiple times in
 * one process (the production Worker only loads once per isolate).
 */
export function __resetSecurityValidationForTests() {
  _securityValidated = false;
}

/**
 * Validate security configuration at startup. Throws on hard failures to
 * fail-fast rather than silently running with insecure defaults.
 *
 * Enforcement rules:
 *   - ADMIN_KEY: if set, must be ≥ 32 chars (throw). If unset, admin
 *     endpoints are disabled by isAdminKeyValid (no throw).
 *   - BOT_ENCRYPTION_KEY: REQUIRED. Must be set AND ≥ 32 chars (throw).
 *     Previously this was warn-only when absent (H-A, audit 2026-05-20),
 *     which let misconfigured deploys serve traffic with calendar links
 *     silently broken, channel tokens decrypting to null, and the master
 *     password vault panicking at consume time. Mirrors META_APP_SECRET
 *     semantics. Dev-time bypass: set ALLOW_PLAINTEXT_TOKENS=1 (mirrors
 *     ALLOW_LEGACY_BOT_CTX); produces a loud startup warning so the
 *     deviation is visible in every log line.
 *   - META_APP_SECRET: if Meta channels are configured (META_VERIFY_TOKEN_*),
 *     must be set AND ≥ 32 chars (throw).
 */
export function validateSecurityConfig(env) {
  if (_securityValidated) return;
  _securityValidated = true;

  if (env.ADMIN_KEY && String(env.ADMIN_KEY).length < 32) {
    throw new Error('[SECURITY] ADMIN_KEY must be at least 32 characters — refusing to start');
  }

  if (env.NOTIFY_TOKEN && String(env.NOTIFY_TOKEN).length < 32) {
    throw new Error('[SECURITY] NOTIFY_TOKEN must be at least 32 characters — refusing to start');
  }

  // H-A — fail-close on missing BOT_ENCRYPTION_KEY, with a dev-only escape
  // hatch behind ALLOW_PLAINTEXT_TOKENS=1.
  if (!env.BOT_ENCRYPTION_KEY) {
    if (env.ALLOW_PLAINTEXT_TOKENS === '1') {
      log.warn('worker.security', {
        message: '[SECURITY] ALLOW_PLAINTEXT_TOKENS=1 — BOT_ENCRYPTION_KEY unset; calendar links + channel decryption will fail closed downstream. Unset this var in production.',
      });
    } else {
      throw new Error('[SECURITY] BOT_ENCRYPTION_KEY is required — refusing to start. Set ALLOW_PLAINTEXT_TOKENS=1 only for local development.');
    }
  } else if (String(env.BOT_ENCRYPTION_KEY).length < 32) {
    throw new Error('[SECURITY] BOT_ENCRYPTION_KEY must be at least 32 characters — refusing to start');
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

  // P2-8 — ADMIN_APP_URL is warn-only at startup (kept compatible with local
  // dev where Pages is not configured). The fail-closed check is per-request
  // and lives in `requireAdminAppConfigured` below — it returns 503 when an
  // admin-app path is requested with no upstream configured.
  if (!env.ADMIN_APP_URL) {
    log.warn('worker.security', { message: 'ADMIN_APP_URL not set — admin-app paths will 503 (P2-8)' });
  }

  // P2-3 — Legacy single-bot ctx is now opt-in. If an operator explicitly
  // re-enables it (e.g. for smoke tests), shout in the logs so the deviation
  // is visible in every deploy.
  if (env.ALLOW_LEGACY_BOT_CTX === '1') {
    log.warn('worker.security', {
      message: '[SECURITY] ALLOW_LEGACY_BOT_CTX=1 — legacy single-bot ctx fallback is ENABLED. Bot tokens may bypass D1 + per-bot encryption. Unset this var in production.',
    });
  }
}

/**
 * P2-8 — fail-closed gate for admin-app proxy.
 *
 * Pre-fix: when `ADMIN_APP_URL` was unset the proxy silently fell through to a
 * hardcoded preview URL (`admin-app-3nc.pages.dev`). In a misconfigured
 * production environment this leaked staging-vs-prod boundaries (callers'
 * cookies, CSP nonces, NextAuth callbacks). Now we refuse the request with
 * 503 and let ops fix the deploy.
 *
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Response | null} 503 Response if path is admin-app and ADMIN_APP_URL is unset; null otherwise.
 */
export function requireAdminAppConfigured(request, env, url) {
  if (env.ADMIN_APP_URL) return null;
  if (!isAdminAppPath(url.pathname)) return null;
  return new Response('admin-app upstream not configured', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export default {
  async fetch(request, env, executionCtx) {
    try {
      validateSecurityConfig(env);
    } catch (e) {
      // Security config errors are fatal — surface them to the monitor.
      if (executionCtx?.waitUntil) {
        executionCtx.waitUntil(captureError(env, e, { source: 'worker.fetch', phase: 'startup' }));
      } else {
        void captureError(env, e, { source: 'worker.fetch', phase: 'startup' });
      }
      throw e;
    }
    const url = new URL(request.url);
    try {
    // robots.txt — served BEFORE landing proxy so Workers own it
    if (url.pathname === '/robots.txt' && request.method === 'GET') {
      return addSecurityHeaders(generateRobotsResponse(url.origin));
    }

    // sitemap.xml — dynamic (static entries + DB-driven salons)
    if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
      return addSecurityHeaders(await generateSitemapResponse(env, url.origin));
    }

    // Admin-app routes → proxy to Cloudflare Pages (see isAdminAppPath).
    // P2-8 — fail-closed when ADMIN_APP_URL is unset.
    if (isAdminAppPath(url.pathname)) {
      const gate = requireAdminAppConfigured(request, env, url);
      if (gate) return addSecurityHeaders(gate);
      return addSecurityHeaders(await proxyToAdminApp(request, env, url));
    }

    // Public liveness probe for external uptime monitors.
    // See src/http/healthHttp.js — fixed shape, no D1/KV, no env echo.
    // Routed before any heavy resolution so a stuck binding never takes it down.
    if (url.pathname === '/api/health') {
      return addSecurityHeaders(handleHealthRequest(request));
    }

    // PR-A: public unsubscribe endpoint. `/u/{token}` is reached from the
    // footer of every marketing email; the handler flips the contact's
    // `unsubscribed=1` and appends a `marketing_consent_log` row. Public
    // by design — token-only, no auth, GET-only.
    if (request.method === 'GET' && url.pathname.startsWith('/u/')) {
      const token = url.pathname.slice('/u/'.length).split('/')[0] ?? '';
      const res = await handleUnsubscribeRequest(request, token, env);
      return addSecurityHeaders(res);
    }

    // Landing analytics ingest (CORS-enabled, consent-gated server-side).
    // See src/http/trackHttp.js — drops events when no analytics consent row exists.
    if (url.pathname === '/api/track') {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        });
      }
      const trackRes = await handleTrackRequest(request, env);
      const merged = new Response(trackRes.body, trackRes);
      merged.headers.set('Access-Control-Allow-Origin', '*');
      return addSecurityHeaders(merged);
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

    // /demo — self-contained iPhone mockup with live preview-landing chat widget.
    // Must come before tryLanding so the landing proxy doesn't swallow it.
    const demoRes = tryDemoPage(request, env, url);
    if (demoRes) return demoRes;

    // Meta App Review requires statically-served Privacy Policy, Data
    // Deletion Instructions, and Terms. Must intercept BEFORE the landing
    // SPA proxy — landing returns the same SPA shell for any path which
    // gives HTTP 200 to GET but 404 to HEAD (Meta crawler uses HEAD).
    const legalRes = tryLegalPages(request, url);
    if (legalRes) return addSecurityHeaders(legalRes);

    let res = await tryLanding(request, env, url);
    if (res) return addSecurityHeaders(res);

    res = await tryStripe(request, env, url);
    if (res) return res; // Stripe webhook — no browser headers needed

    res = await tryAdminKeyRoutes(request, env, url);
    if (res) return addSecurityHeaders(res);

    // Internal messenger relay (admin-app → Worker → channel adapter).
    // Bearer-keyed; routed before any browser-facing handlers.
    res = await tryMessengerOutboundRoute(request, env, url);
    if (res) return addSecurityHeaders(res);

    // WebSocket upgrade for the realtime messenger (Phase 3). Forwards to
    // the per-tenant MessengerHub Durable Object after JWT verification.
    res = await tryMessengerWsRoute(request, env, url);
    if (res) return res; // WS upgrade — never wrap with browser headers

    res = await tryLeadRoutes(request, env, url, executionCtx);
    if (res) return addSecurityHeaders(res);

    // Upload + CDN routes (POST /upload/asset, GET /cdn/*) — before landing proxy.
    res = await tryUpload(request, env, url);
    if (res) return addSecurityHeaders(res);

    res = await tryGoogle(request, env, url);
    if (res) return addSecurityHeaders(res);

    // Meta OAuth (FB Login for Business + Instagram Login). Self-contained:
    // admin-keyed start / consume / finalize endpoints + per-provider GET
    // callback. Must run before tryMetaWebhooks because both live under
    // `/meta/...` but the webhook routes are `/webhook/wa` and `/webhook/ig`.
    res = await tryMetaOAuth(request, env, url);
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

    // P2-2 — hoist tryLanding(force=true) above the ctx-build ladder for
    // GETs that don't need a ctx. Before this gate, every public landing
    // request (`/`, `/api/search/*`, `/embed/*` fallback paths, etc.) paid
    // a D1 round-trip + a `_baseCtx` env-spread only to be discarded right
    // before tryLanding fired at the bottom of the pipeline.
    //
    // Paths that still need ctx: POST /webhook[...], /admin/*, /setup,
    // /remove-webhook, GET /calendar/*. Everything else is non-ctx.
    if (request.method === 'GET' && !pathNeedsCtx(url.pathname)) {
      const landingRes = await tryLanding(request, env, url, /* force */ true);
      if (landingRes) return addSecurityHeaders(landingRes);
    }

    const isAdminPath = url.pathname.startsWith('/admin/');
    const needsFallback = url.pathname !== '/' && !isAdminPath;
    function tryFallbackCtx() {
      const skipLegacy = disallowLegacyWebhook(env, request, url);
      // P2-3 — legacy bot ctx is opt-in. The plain `buildCtx` (no-bot landing
      // ctx) stays available because it's not bot-token-bearing.
      const legacyAllowed = env.ALLOW_LEGACY_BOT_CTX === '1';
      if (env.BOT_TOKEN && env.WEBHOOK_SECRET && !skipLegacy && legacyAllowed) return buildLegacyCtx(env);
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
      const capCtxResolve = captureError(env, e, { source: 'worker.fetch.resolveCtx', path: url.pathname });
      if (executionCtx?.waitUntil) executionCtx.waitUntil(capCtxResolve);
      else void capCtxResolve;
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
        if (url.pathname === '/webhook') {
          return new Response('Legacy /webhook disabled; use /webhook/{botId}', { status: 403 });
        }
        // /webhook/{botId} that we couldn't resolve — emit an event so this
        // P0 (bot silent on prod) can never recur silently.
        void logEvent(envCtx(env), 'webhook.bot_unresolved', {
          level: 'error',
          message: `Telegram webhook hit ${url.pathname} but bot could not be resolved (token decrypt failed, bot inactive, or row missing)`,
          data: { path: url.pathname },
        });
        return new Response('Bot not found or token unresolvable', { status: 404 });
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
    } catch (e) {
      // Unhandled error in a sub-handler: capture, then return 500.
      // Capture is async/best-effort — use waitUntil so the response is not blocked.
      const capturePromise = captureError(env, e, {
        source: 'worker.fetch',
        path: url.pathname,
      });
      if (executionCtx?.waitUntil) executionCtx.waitUntil(capturePromise);
      else void capturePromise;
      logWorkerError('unhandled', request, url, e);
      return addSecurityHeaders(new Response('Internal Server Error', { status: 500 }));
    }
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

      // ─── @manicbot_com IG autopilot ─────────────────────────────────────
      // Global phase (NOT per-tenant) — runs once per cron tick when
      // env.MARKETING_AUTOPILOT_ENABLED is set to "1". Defaults to off so
      // we don't accidentally fire 400s into Meta before App review
      // approves `instagram_content_publish`. Toggle via Cloudflare
      // dashboard once Meta + ANTHROPIC_API_KEY + MARKETING_IG_* secrets
      // are all in place.
      if (env.MARKETING_AUTOPILOT_ENABLED === '1') {
        const nowMs = event.scheduledTime || Date.now();
        _scheduledCtx.waitUntil(
          phaseInstagramAutopilot(env, nowMs).catch((e) => {
            log.error(
              'worker.marketingAutopilot',
              e instanceof Error ? e : new Error(String(e?.message || e)),
            );
            void captureError(env, e, {
              source: 'worker.scheduled',
              phase: 'marketing_autopilot',
            });
          }),
        );
      }

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
            if (botIds.length === 0) {
              await emitCronSkipRateLimited(ec, tenantId, 'no_bots');
              continue;
            }
            const resolved = await resolveTenantFromBotId(ec, botIds[0], env.BOT_ENCRYPTION_KEY || null);
            if (!resolved) {
              await emitCronSkipRateLimited(ec, tenantId, 'bot_unresolved');
              continue;
            }
            const ctx = buildTenantCtx(env, resolved);
            _scheduledCtx.waitUntil(handleCron(ctx));
          }
          return;
        }
      }
      // P2-3 — legacy ctx is opt-in. Default to landing-only buildCtx so cron
      // doesn't accidentally trigger telegram actions via env BOT_TOKEN.
      const legacyAllowed = env.ALLOW_LEGACY_BOT_CTX === '1';
      const ctx = env.BOT_TOKEN && env.WEBHOOK_SECRET && legacyAllowed ? buildLegacyCtx(env) : buildCtx(env);
      _scheduledCtx.waitUntil(handleCron(ctx));
    } catch (e) {
      log.error('worker.cron', e instanceof Error ? e : new Error(String(e?.message || e)), { stack: e?.stack?.slice(0, 300) || null });
      void logEvent(envCtx(env), 'error.cron', { level: 'error', message: e?.message ?? 'Cron init error', data: { stack: e?.stack?.slice(0, 300) } });
      void captureError(env, e, { source: 'worker.scheduled', phase: 'cron' });
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
          // IG-/WA-only tenants have no Telegram bot row but still need
          // cron (token refresh, webhook re-subscribe, post-visit). Diag
          // 2026-05-14: t_1c305v2g5011 was an IG-only salon whose IG
          // health-check + resubscribe had never run because of this gate.
          const tenant = await getTenant(ec, tenantId);
          const hasActiveChannel = tenant && await tenantHasActiveChannel(ec, tenantId);
          if (tenant && hasActiveChannel) {
            const { buildBotlessTenantCtx } = await import('./tenant/resolver.js');
            const ctx = buildBotlessTenantCtx(env, tenantId, tenant);
            await handleCron(ctx);
            msg.ack();
            continue;
          }
          // P0-1 — a tenant with no bot rows used to be silently dropped.
          // Emit a rate-limited (1/h/tenant/reason) skip event so this is
          // visible in the activity feed.
          await emitCronSkipRateLimited(ec, tenantId, 'no_bots');
          msg.ack();
          continue;
        }
        const resolved = await resolveTenantFromBotId(ec, botIds[0], env.BOT_ENCRYPTION_KEY || null);
        if (!resolved) {
          // P0-1 — token decrypt failed, bot inactive, or row missing.
          // Used to be a silent ack(); now emit cron.tenant.skipped.
          await emitCronSkipRateLimited(ec, tenantId, 'bot_unresolved');
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
        void captureError(env, e, {
          source: 'worker.queue.cron',
          tenantId,
          phase: 'cron',
        });
        // Retry up to 3 times (configured in wrangler.toml max_retries)
        msg.retry({ delaySeconds: Math.min(60 * msg.attempts, 300) });
      }
    }
  },
};
