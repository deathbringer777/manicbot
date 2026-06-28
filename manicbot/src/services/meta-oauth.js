/**
 * @fileoverview Meta OAuth handlers — the I/O layer over `meta-oauth-logic.js`.
 *
 * Wire flow:
 *
 *   admin-app tRPC.metaOAuth.start
 *      → POST /meta/oauth/start (Bearer ADMIN_KEY)
 *          • mints state → stores in KV (15min TTL)
 *          • returns { authUrl }
 *
 *   Browser opens authUrl → user authorizes on Meta → Meta GETs:
 *      → GET /meta/{instagram|facebook}/callback?code=…&state=…
 *          • parses + validates state against KV
 *          • exchanges code for long-lived token
 *          • (FB-Login) fetches /me/accounts and derives Page Tokens
 *          • stores draft → KV under same state
 *          • 302 → ${returnTo}?meta_state=…
 *
 *   admin-app tRPC.metaOAuth.consume
 *      → POST /meta/oauth/consume (Bearer ADMIN_KEY)
 *          • reads draft, decides auto-finalize vs picker
 *          • returns { ok, channelConfigId | needsPicker, pages }
 *
 *   admin-app tRPC.metaOAuth.finalize (only when picker shown)
 *      → POST /meta/oauth/finalize (Bearer ADMIN_KEY)
 *          • binds chosen pageId from draft
 *          • writes channel_configs row
 *          • auto-subscribes Page webhook
 *
 * Security invariants:
 *   - State is 64-char hex (CSPRNG, 32 bytes). Forgery requires guessing.
 *   - State is single-use: consumed on draft creation, draft is single-use
 *     on finalize.
 *   - Draft contains tenantId from the start step; finalize ignores any
 *     tenantId in input to prevent cross-tenant binding.
 *   - PKCE S256 enforced on both providers.
 *   - All Meta secrets read from env at handler time — never bundled in
 *     auth URL builder or logged.
 */

import { log } from '../utils/logger.js';
import { logEvent } from '../utils/events.js';
import { audit } from '../utils/audit.js';
import { getTenant } from '../tenant/storage.js';
import { createChannelConfig } from '../channels/token-manager.js';
import { dbAll } from '../utils/db.js';
import {
  META_OAUTH_PROVIDERS,
  isMetaOAuthProvider,
  generateOauthState,
  isValidOauthState,
  generatePkceVerifier,
  deriveCodeChallengeS256,
  buildMetaAuthUrl,
  buildCallbackUri,
  parseMetaCallbackQuery,
  canAutoFinalizeDraft,
  detectMetaTokenType,
  configApiForTokenType,
  renderOAuthPopupClosePage,
  deriveOpenerOriginFromReturnTo,
} from './meta-oauth-logic.js';

// ─── KV namespaces + TTLs ────────────────────────────────────────────────────

const STATE_PREFIX = 'meta:oauth:state:';
const DRAFT_PREFIX = 'meta:oauth:draft:';
const STATE_TTL_SEC = 15 * 60;   // 15-minute window from /start to callback
const DRAFT_TTL_SEC = 15 * 60;   // 15-minute window from callback to finalize

function nowSec() { return Math.floor(Date.now() / 1000); }
function getKv(ctx) { return ctx?.globalKv || ctx?.kv || null; }

// ─── Helpers for env access (provider-scoped) ────────────────────────────────

/**
 * Returns the App ID + Secret for the given provider. Reads from ctx (which
 * includes env spread). Never logs the secret.
 *
 * @returns {{ appId: string | null, appSecret: string | null }}
 */
function readProviderCredentials(ctx, provider) {
  const profile = META_OAUTH_PROVIDERS[provider];
  if (!profile) return { appId: null, appSecret: null };
  return {
    appId: ctx?.[profile.appIdEnvKey] || null,
    appSecret: ctx?.[profile.appSecretEnvKey] || null,
  };
}

/**
 * Resolve the OAuth base URL.
 *
 * `APP_BASE_URL` MUST win over the request origin: Meta whitelists exactly
 * one redirect URI per app, and that whitelist is keyed off the canonical
 * production origin (https://manicbot.com). If we let `request.url.origin`
 * drive the redirect_uri, then any non-canonical hit on the Worker
 * (workers.dev preview, a misconfigured custom domain, a stripe-style
 * proxy) silently produces a redirect_uri Meta refuses — exactly the
 * "Invalid Request: Request parameters are invalid: Invalid redirect_uri"
 * the user just reported.
 *
 * `baseUrl` (mirror of request origin) is kept as the LAST-resort fallback
 * for environments where APP_BASE_URL isn't set (local dev, ad-hoc test
 * harnesses).
 */
function getBaseUrl(ctx) {
  return String(ctx?.APP_BASE_URL || ctx?.baseUrl || '').replace(/\/+$/, '');
}

// ─── Bearer auth (mirror of adminKeyHttp.js) ─────────────────────────────────

function isAdminKeyValid(env, request) {
  if (!env?.ADMIN_KEY) return false;
  const authHeader = request?.headers?.get?.('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const given = authHeader.slice(7);
  // Constant-time comparison — `timingSafeEqual` from utils/security.js.
  // Inlining here keeps the OAuth module self-contained.
  if (given.length !== env.ADMIN_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ env.ADMIN_KEY.charCodeAt(i);
  }
  return diff === 0;
}

// ─── HTTP: POST /meta/oauth/start (admin-keyed) ─────────────────────────────

/**
 * SEC-004 — returnTo origin allowlist (open-redirect / token-leak guard).
 *
 * `returnTo` is stored in KV state and later used as the callback 302 target
 * AND as the popup postMessage targetOrigin (deriveOpenerOriginFromReturnTo).
 * The old check only required an `http(s)://` scheme, so anyone who could call
 * this endpoint (ADMIN_KEY holder, or a future caller) could redirect the OAuth
 * completion — carrying `meta_state` — to an attacker origin. Pin returnTo to a
 * known admin-app / worker origin. Mirrors google-calendar-oauth's
 * isAllowedWebReturnUrl; also accepts the worker base origin since the admin-app
 * is served from the same apex (admin.manicbot.com does not resolve — see
 * reference_admin_prod_url).
 *
 * @param {any} ctx
 * @param {string} returnTo
 * @returns {boolean}
 */
function isAllowedMetaReturnTo(ctx, returnTo) {
  let target;
  try {
    target = new URL(returnTo);
  } catch {
    return false;
  }
  const allowed = new Set();
  for (const candidate of [ctx.ADMIN_APP_URL, ctx.AUTH_URL, ctx.APP_BASE_URL, getBaseUrl(ctx)]) {
    if (!candidate) continue;
    try {
      allowed.add(new URL(candidate).origin);
    } catch { /* ignore unparseable config */ }
  }
  if (allowed.size === 0) allowed.add('https://manicbot.com');
  return allowed.has(target.origin);
}

/**
 * Mint OAuth state, store it in KV with the tenant binding, return the
 * provider-specific authorize URL.
 *
 * Input body:
 *   - provider: 'instagram' | 'facebook'
 *   - tenantId: string
 *   - webUserId: string   (admin-app web_users.id of the initiator)
 *   - returnTo:  string   (where Meta should redirect after callback)
 *
 * Output: { ok: true, authUrl, state, expiresAt }
 *      or { ok: false, error, status }
 */
export async function handleMetaOAuthStart(ctx, request) {
  if (!isAdminKeyValid(ctx, request)) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const kv = getKv(ctx);
  if (!kv) {
    return Response.json({ ok: false, error: 'kv_not_bound' }, { status: 500 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const { provider, tenantId, webUserId, returnTo, popup } = body || {};
  if (!isMetaOAuthProvider(provider)) {
    return Response.json({ ok: false, error: 'invalid_provider' }, { status: 400 });
  }
  if (!tenantId || typeof tenantId !== 'string') {
    return Response.json({ ok: false, error: 'missing_tenant_id' }, { status: 400 });
  }
  if (!webUserId || typeof webUserId !== 'string') {
    return Response.json({ ok: false, error: 'missing_web_user_id' }, { status: 400 });
  }
  if (!returnTo || typeof returnTo !== 'string' || !isAllowedMetaReturnTo(ctx, returnTo)) {
    return Response.json({ ok: false, error: 'invalid_return_to' }, { status: 400 });
  }
  // popup is a UX hint — when truthy the callback returns an HTML page that
  // postMessages the opener and self-closes (vs the default 302 to returnTo).
  // We coerce-then-store so a tampered string can't sneak through.
  const popupMode = popup === true || popup === 'true';

  const tenant = await getTenant(ctx, tenantId);
  if (!tenant) {
    return Response.json({ ok: false, error: 'tenant_not_found' }, { status: 404 });
  }

  const { appId, appSecret } = readProviderCredentials(ctx, provider);
  if (!appId || !appSecret) {
    return Response.json({
      ok: false,
      error: 'oauth_not_configured',
      hint: `Set ${META_OAUTH_PROVIDERS[provider].appIdEnvKey} and ${META_OAUTH_PROVIDERS[provider].appSecretEnvKey}`,
    }, { status: 503 });
  }

  const baseUrl = getBaseUrl(ctx);
  if (!baseUrl) {
    return Response.json({ ok: false, error: 'missing_base_url' }, { status: 500 });
  }

  const state = generateOauthState();
  const verifier = generatePkceVerifier();
  const codeChallenge = await deriveCodeChallengeS256(verifier);
  const redirectUri = buildCallbackUri(baseUrl, provider);

  const statePayload = {
    provider,
    tenantId,
    webUserId,
    pkceVerifier: verifier,
    returnTo,
    popup: popupMode,
    createdAt: nowSec(),
  };

  try {
    await kv.put(STATE_PREFIX + state, JSON.stringify(statePayload), { expirationTtl: STATE_TTL_SEC });
  } catch (e) {
    log.error('services.metaOAuth', e instanceof Error ? e : new Error(String(e?.message)), { action: 'put_state' });
    return Response.json({ ok: false, error: 'state_persist_failed' }, { status: 500 });
  }

  const authUrl = buildMetaAuthUrl({ provider, appId, redirectUri, state, codeChallenge });

  await audit(ctx, 'meta_oauth.start', {
    tenantId, webUserId, provider, state: state.slice(0, 8) + '…',
  });

  return Response.json({
    ok: true,
    authUrl,
    state,
    // callbackOrigin lets the admin-app validate `event.origin` on incoming
    // postMessage frames from the popup. Same value the popup HTML uses as
    // its postMessage targetOrigin — both sides agree on which origin is
    // allowed to broker the OAuth completion.
    callbackOrigin: new URL(redirectUri).origin,
    expiresAt: nowSec() + STATE_TTL_SEC,
  });
}

// ─── HTTP: GET /meta/{provider}/callback (Meta-initiated) ────────────────────

/**
 * Meta-initiated callback. Parses the query, validates state from KV,
 * exchanges the code, stores the resulting draft, and 302s back to the
 * admin-app with `?meta_state=…&meta_ok=1` (or `meta_ok=0&meta_error=…`).
 */
export async function handleMetaOAuthCallback(ctx, request, url, provider) {
  if (!isMetaOAuthProvider(provider)) {
    return new Response('invalid provider', { status: 400 });
  }
  const kv = getKv(ctx);
  if (!kv) return new Response('kv_not_bound', { status: 500 });

  const parsed = parseMetaCallbackQuery(url.searchParams);

  // No state at all means we can't even find the tenant context — render an
  // error page that's safe to show without leaking namespace info.
  if (!parsed.state) {
    return new Response('Invalid OAuth state. Please restart the connect flow.', {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const stateRaw = await kv.get(STATE_PREFIX + parsed.state);
  if (!stateRaw) {
    return new Response('OAuth session expired. Please restart the connect flow.', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  // Single-use: delete the state immediately so a replay can't proceed.
  try { await kv.delete(STATE_PREFIX + parsed.state); } catch {}

  let statePayload;
  try { statePayload = JSON.parse(stateRaw); } catch { statePayload = null; }
  if (!statePayload || statePayload.provider !== provider) {
    return new Response('OAuth state mismatch.', { status: 400 });
  }

  // User cancelled or Meta returned a permission error.
  if (!parsed.ok) {
    return finishCallback(statePayload, {
      meta_ok: '0',
      meta_state: parsed.state,
      meta_error: parsed.error,
      meta_error_description: parsed.errorDescription || '',
    });
  }

  // Exchange code → long-lived token + (FB-Login) Pages list.
  let draft;
  try {
    draft = await exchangeCodeAndBuildDraft(ctx, {
      provider,
      tenantId: statePayload.tenantId,
      webUserId: statePayload.webUserId,
      code: parsed.code,
      pkceVerifier: statePayload.pkceVerifier,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('services.metaOAuth', e instanceof Error ? e : new Error(msg), { action: 'exchange_code' });
    return finishCallback(statePayload, {
      meta_ok: '0',
      meta_state: parsed.state,
      meta_error: 'code_exchange_failed',
      meta_error_description: msg,
    });
  }

  // Persist draft under the same state so the admin-app can consume it.
  try {
    await kv.put(DRAFT_PREFIX + parsed.state, JSON.stringify(draft), { expirationTtl: DRAFT_TTL_SEC });
  } catch (e) {
    log.error('services.metaOAuth', e instanceof Error ? e : new Error(String(e?.message)), { action: 'put_draft' });
    return finishCallback(statePayload, {
      meta_ok: '0',
      meta_state: parsed.state,
      meta_error: 'draft_persist_failed',
    });
  }

  await logEvent(ctx, 'meta_oauth.callback_ok', {
    tenantId: statePayload.tenantId,
    message: 'Meta OAuth callback succeeded',
    data: { provider, pages: draft.pages?.length ?? 0, hasIgUser: !!draft.igUserId },
  });

  return finishCallback(statePayload, {
    meta_ok: '1',
    meta_state: parsed.state,
  });
}

/**
 * Two-way callback finisher.
 *
 *   - `statePayload.popup === true` → return an HTML page that postMessages
 *     the opener and self-closes. The admin-app's `InstagramConnect` mounts
 *     a window message listener and resumes the consume flow there.
 *   - otherwise → legacy 302 to `returnTo` with the same params on the URL,
 *     so the mount-time `useSearchParams` handler picks them up. This is
 *     the popup-blocker fallback path.
 *
 * Both paths carry the SAME params (`meta_ok`, `meta_state`, optional
 * error fields) so the admin-app receiver doesn't care which one fired.
 */
function finishCallback(statePayload, params) {
  if (statePayload?.popup === true) {
    const openerOrigin = deriveOpenerOriginFromReturnTo(statePayload.returnTo);
    const fallbackUrl = buildReturnUrl(statePayload.returnTo, params);
    const html = renderOAuthPopupClosePage({
      metaOk: params.meta_ok,
      metaState: params.meta_state || '',
      metaError: params.meta_error || null,
      metaErrorDescription: params.meta_error_description || null,
      openerOrigin,
      fallbackUrl,
    });
    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // popup is private to this user's session — never cache.
        'cache-control': 'no-store',
        // Sandbox notes: the page contains an inline script we control, so
        // a strict default-src 'self' would block it. We allow inline only
        // for THIS response (route-scoped), keeping the worker's global CSP
        // unaffected. `frame-ancestors 'none'` blocks the page from being
        // iframed by a malicious origin.
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  return Response.redirect(buildReturnUrl(statePayload.returnTo, params), 302);
}

function buildReturnUrl(returnTo, params) {
  const url = new URL(returnTo);
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

// ─── Code exchange — provider-specific ─────────────────────────────────────

/**
 * Run the full OAuth code-exchange flow for the given provider:
 *
 *   instagram:
 *     1. POST api.instagram.com/oauth/access_token (short-lived)
 *     2. GET  graph.instagram.com/access_token?grant_type=ig_exchange_token (long-lived, 60d)
 *     3. GET  graph.instagram.com/v21.0/me        (igUserId + username)
 *
 *   facebook:
 *     1. GET  graph.facebook.com/v21.0/oauth/access_token  (short-lived User token)
 *     2. GET  graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token (long-lived)
 *     3. GET  graph.facebook.com/v21.0/me                 (userId + name)
 *     4. GET  graph.facebook.com/v21.0/me/accounts        (Pages, each with Page Token + IG link)
 *
 * Returns a fully-populated MetaOAuthDraft.
 */
async function exchangeCodeAndBuildDraft(ctx, { provider, tenantId, webUserId, code, pkceVerifier }) {
  const profile = META_OAUTH_PROVIDERS[provider];
  const { appId, appSecret } = readProviderCredentials(ctx, provider);
  const redirectUri = buildCallbackUri(getBaseUrl(ctx), provider);

  if (provider === 'instagram') {
    // Step 1: short-lived token via api.instagram.com (form POST).
    const shortRes = await fetch(profile.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
        code_verifier: pkceVerifier,
      }),
    });
    const shortData = await shortRes.json().catch(() => ({}));
    if (!shortRes.ok || !shortData.access_token) {
      throw new Error(shortData.error_message || shortData.error || 'ig_short_token_exchange_failed');
    }
    const shortToken = String(shortData.access_token);
    const igUserIdFromShort = shortData.user_id ? String(shortData.user_id) : null;

    // Step 2: upgrade to long-lived (60-day) token.
    const longUrl = new URL(profile.longLivedTokenUrl);
    longUrl.searchParams.set('grant_type', 'ig_exchange_token');
    longUrl.searchParams.set('client_secret', appSecret);
    longUrl.searchParams.set('access_token', shortToken);
    const longRes = await fetch(longUrl);
    const longData = await longRes.json().catch(() => ({}));
    if (!longRes.ok || !longData.access_token) {
      throw new Error(longData.error?.message || longData.error || 'ig_long_token_exchange_failed');
    }
    const longToken = String(longData.access_token);
    const expiresAt = longData.expires_in
      ? nowSec() + Number(longData.expires_in)
      : null;

    // Step 3: /me — confirm token + capture username.
    const meRes = await fetch(`${profile.meUrl}?fields=id,username,account_type&access_token=${encodeURIComponent(longToken)}`);
    const meData = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !meData.id) {
      throw new Error(meData.error?.message || 'ig_me_probe_failed');
    }

    return {
      provider: 'instagram',
      tenantId,
      webUserId,
      accessToken: longToken,
      expiresAt,
      graphMe: { id: meData.id, username: meData.username, account_type: meData.account_type },
      pages: null,
      igUserId: String(meData.id || igUserIdFromShort || ''),
      igUsername: meData.username || null,
      createdAt: nowSec(),
    };
  }

  // Facebook Login for Business path.
  // Step 1: short-lived User token.
  const shortUrl = new URL(profile.tokenUrl);
  shortUrl.searchParams.set('client_id', appId);
  shortUrl.searchParams.set('client_secret', appSecret);
  shortUrl.searchParams.set('redirect_uri', redirectUri);
  shortUrl.searchParams.set('code', code);
  shortUrl.searchParams.set('code_verifier', pkceVerifier);
  const shortRes = await fetch(shortUrl);
  const shortData = await shortRes.json().catch(() => ({}));
  if (!shortRes.ok || !shortData.access_token) {
    throw new Error(shortData.error?.message || shortData.error || 'fb_short_token_exchange_failed');
  }
  const userTokenShort = String(shortData.access_token);

  // Step 2: long-lived (60d) User token.
  const longUrl = new URL(profile.longLivedTokenUrl);
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', appId);
  longUrl.searchParams.set('client_secret', appSecret);
  longUrl.searchParams.set('fb_exchange_token', userTokenShort);
  const longRes = await fetch(longUrl);
  const longData = await longRes.json().catch(() => ({}));
  if (!longRes.ok || !longData.access_token) {
    throw new Error(longData.error?.message || 'fb_long_token_exchange_failed');
  }
  const userTokenLong = String(longData.access_token);

  // Step 3: /me confirmation.
  const meRes = await fetch(`${profile.meUrl}?access_token=${encodeURIComponent(userTokenLong)}`);
  const meData = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !meData.id) {
    throw new Error(meData.error?.message || 'fb_me_probe_failed');
  }

  // Step 4: /me/accounts — Pages + per-Page tokens + IG linkage.
  const accountsUrl = new URL(profile.accountsUrl);
  accountsUrl.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username}');
  accountsUrl.searchParams.set('access_token', userTokenLong);
  const accountsRes = await fetch(accountsUrl);
  const accountsData = await accountsRes.json().catch(() => ({}));
  if (!accountsRes.ok) {
    throw new Error(accountsData.error?.message || 'fb_me_accounts_failed');
  }
  const pages = Array.isArray(accountsData.data) ? accountsData.data : [];
  const normalizedPages = pages.map(p => ({
    id: String(p.id),
    name: String(p.name || ''),
    accessToken: String(p.access_token || ''),
    igBusinessId: p.instagram_business_account?.id ? String(p.instagram_business_account.id) : null,
    igUsername: p.instagram_business_account?.username || null,
  }));

  return {
    provider: 'facebook',
    tenantId,
    webUserId,
    accessToken: userTokenLong,
    expiresAt: null, // FB long-lived User tokens are 60d but Page tokens derived from them are non-expiring
    graphMe: { id: meData.id, name: meData.name },
    pages: normalizedPages,
    igUserId: null,
    igUsername: null,
    createdAt: nowSec(),
  };
}

// ─── HTTP: POST /meta/oauth/consume (admin-keyed) ────────────────────────────

/**
 * Read the draft, decide whether we can auto-finalize, return either the
 * finalized channel_config id OR the list of Pages for the picker UI.
 *
 * Input body: { state: string, tenantId: string, webUserId: string }
 *   - tenantId + webUserId MUST match the values bound to the draft. This is
 *     the IDOR guard: a tenant_owner of tenant A can't consume a draft that
 *     belongs to tenant B even if they leaked the state value.
 *
 * Output:
 *   - auto-finalized:   { ok: true, autoFinalized: true, channelConfigId, ... }
 *   - needs picker:     { ok: true, autoFinalized: false, pages: [...] }
 *   - error:            { ok: false, error, status }
 */
export async function handleMetaOAuthConsume(ctx, request) {
  if (!isAdminKeyValid(ctx, request)) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const kv = getKv(ctx);
  if (!kv) return Response.json({ ok: false, error: 'kv_not_bound' }, { status: 500 });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const { state, tenantId, webUserId } = body || {};

  if (!isValidOauthState(state)) {
    return Response.json({ ok: false, error: 'invalid_state' }, { status: 400 });
  }

  const draftRaw = await kv.get(DRAFT_PREFIX + state);
  if (!draftRaw) {
    return Response.json({ ok: false, error: 'draft_not_found' }, { status: 404 });
  }
  let draft;
  try { draft = JSON.parse(draftRaw); } catch { draft = null; }
  if (!draft) {
    return Response.json({ ok: false, error: 'draft_malformed' }, { status: 500 });
  }

  // IDOR guard — bind to the tenant + initiator on the draft.
  if (draft.tenantId !== tenantId || draft.webUserId !== webUserId) {
    return Response.json({ ok: false, error: 'draft_tenant_mismatch' }, { status: 403 });
  }

  if (canAutoFinalizeDraft(draft)) {
    // For the FB single-IG-page case we pre-select the only page so the
    // FB branch of persistChannelFromDraft doesn't fall through to
    // page_not_selected. IG-direct ignores selectedPage entirely.
    const autoFinalizedDraft = draft.provider === 'facebook' && Array.isArray(draft.pages) && draft.pages.length === 1
      ? { ...draft, selectedPage: draft.pages[0] }
      : draft;
    // Auto-bind. Delete draft so it can't be reused.
    try { await kv.delete(DRAFT_PREFIX + state); } catch {}
    const finalize = await persistChannelFromDraft(ctx, autoFinalizedDraft);
    if (!finalize.ok) {
      return Response.json({ ok: false, error: finalize.error }, { status: finalize.status || 500 });
    }
    return Response.json({
      ok: true,
      autoFinalized: true,
      ...finalize.result,
    });
  }

  // FB-Login multi-page: surface the picker. Strip access_token from the
  // wire response — the picker only needs name + id + ig linkage to render.
  const safePages = (draft.pages || []).map(p => ({
    id: p.id,
    name: p.name,
    igBusinessId: p.igBusinessId,
    igUsername: p.igUsername,
  }));

  return Response.json({
    ok: true,
    autoFinalized: false,
    provider: draft.provider,
    graphMe: draft.graphMe,
    pages: safePages,
  });
}

// ─── HTTP: POST /meta/oauth/finalize (admin-keyed) ───────────────────────────

/**
 * Bind the chosen page from a previously-consumed draft.
 *
 * Input body: { state, tenantId, webUserId, pageId }
 */
export async function handleMetaOAuthFinalize(ctx, request) {
  if (!isAdminKeyValid(ctx, request)) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const kv = getKv(ctx);
  if (!kv) return Response.json({ ok: false, error: 'kv_not_bound' }, { status: 500 });

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const { state, tenantId, webUserId, pageId } = body || {};

  if (!isValidOauthState(state)) {
    return Response.json({ ok: false, error: 'invalid_state' }, { status: 400 });
  }
  if (!pageId || typeof pageId !== 'string') {
    return Response.json({ ok: false, error: 'missing_page_id' }, { status: 400 });
  }

  const draftRaw = await kv.get(DRAFT_PREFIX + state);
  if (!draftRaw) {
    return Response.json({ ok: false, error: 'draft_not_found' }, { status: 404 });
  }
  let draft;
  try { draft = JSON.parse(draftRaw); } catch { draft = null; }
  if (!draft) {
    return Response.json({ ok: false, error: 'draft_malformed' }, { status: 500 });
  }
  if (draft.tenantId !== tenantId || draft.webUserId !== webUserId) {
    return Response.json({ ok: false, error: 'draft_tenant_mismatch' }, { status: 403 });
  }
  if (draft.provider !== 'facebook') {
    return Response.json({ ok: false, error: 'finalize_only_supported_for_fb' }, { status: 400 });
  }
  const chosenPage = (draft.pages || []).find(p => p.id === pageId);
  if (!chosenPage) {
    return Response.json({ ok: false, error: 'page_not_in_draft' }, { status: 400 });
  }
  if (!chosenPage.accessToken) {
    return Response.json({ ok: false, error: 'page_token_missing' }, { status: 500 });
  }

  // Burn the draft regardless of outcome to make finalize single-use.
  try { await kv.delete(DRAFT_PREFIX + state); } catch {}

  const finalize = await persistChannelFromDraft(ctx, {
    ...draft,
    selectedPage: chosenPage,
  });
  if (!finalize.ok) {
    return Response.json({ ok: false, error: finalize.error }, { status: finalize.status || 500 });
  }
  return Response.json({ ok: true, ...finalize.result });
}

// ─── Channel persistence + auto-subscribe ────────────────────────────────────

/**
 * Translate a (consumed or chosen) draft into a `channel_configs` row + a
 * webhook subscription.
 *
 * @returns {Promise<{ ok: boolean, error?: string, status?: number, result?: object }>}
 */
async function persistChannelFromDraft(ctx, draft) {
  if (!ctx?.BOT_ENCRYPTION_KEY || String(ctx.BOT_ENCRYPTION_KEY).length < 32) {
    return { ok: false, error: 'bot_encryption_key_missing', status: 503 };
  }

  // Bail if an active IG row already exists — keep the explicit "use update
  // endpoint" semantics from the manual /admin/ig-channel.
  const existing = await dbAll(ctx,
    "SELECT id FROM channel_configs WHERE tenant_id = ? AND channel_type = 'instagram' AND active = 1 LIMIT 1",
    draft.tenantId,
  );
  if (existing.length) {
    return { ok: false, error: 'channel_already_exists', status: 409 };
  }

  let tokenToStore;
  let configObj;
  let subscribePromise;

  if (draft.provider === 'instagram') {
    const tokenType = detectMetaTokenType(draft.accessToken);
    if (tokenType !== 'igaa') {
      // Sanity check — the Instagram Login flow MUST return IGAA. Refuse
      // silent fallback rather than storing a misclassified row.
      return { ok: false, error: 'ig_token_not_igaa', status: 500 };
    }
    tokenToStore = draft.accessToken;
    configObj = {
      api: configApiForTokenType(tokenType), // 'instagram_direct'
      ig_user_id: draft.igUserId,
      ig_username: draft.igUsername,
      // Mirror the existing fields so downstream resolvers find this row by
      // either column. page_id stays null — there's no FB Page in this flow.
      ig_account_id: draft.igUserId,
      instagram_business_id: draft.igUserId,
    };
    subscribePromise = subscribeInstagramDirect(ctx, draft.accessToken, draft.igUserId);
  } else {
    // facebook
    const chosen = draft.selectedPage;
    if (!chosen) return { ok: false, error: 'page_not_selected', status: 500 };
    const tokenType = detectMetaTokenType(chosen.accessToken);
    if (tokenType !== 'eaa') {
      return { ok: false, error: 'fb_page_token_not_eaa', status: 500 };
    }
    tokenToStore = chosen.accessToken;
    configObj = {
      api: configApiForTokenType(tokenType), // 'facebook'
      page_id: chosen.id,
      page_name: chosen.name,
      ig_account_id: chosen.igBusinessId || undefined,
      instagram_business_id: chosen.igBusinessId || undefined,
    };
    subscribePromise = subscribeFacebookPage(ctx, chosen.id, chosen.accessToken);
  }

  const channelConfigId = await createChannelConfig(
    ctx,
    draft.tenantId,
    'instagram',
    configObj,
    tokenToStore,
    ctx.BOT_ENCRYPTION_KEY,
    null,                    // webhookVerifyToken — App-level subscription, not per-channel
    draft.expiresAt ?? null, // token_expires_at — IGAA 60d expiry; null for non-expiring Page tokens
  );

  if (!channelConfigId) {
    return { ok: false, error: 'channel_persist_failed', status: 409 };
  }

  // Auto-subscribe; capture failures non-fatally so the row still lands —
  // operator can hit the /admin/ig-resubscribe endpoint to retry.
  const subscribeRes = await subscribePromise.catch(e => ({
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  }));

  await audit(ctx, 'meta_oauth.finalize', {
    tenantId: draft.tenantId,
    webUserId: draft.webUserId,
    provider: draft.provider,
    channelConfigId,
    subscribeOk: subscribeRes.ok === true,
  });

  await logEvent(ctx, 'meta_oauth.channel_created', {
    tenantId: draft.tenantId,
    message: 'Meta channel created via OAuth',
    data: {
      provider: draft.provider,
      channelConfigId,
      subscribed: subscribeRes.ok === true,
      subscribeError: subscribeRes.ok ? null : subscribeRes.error,
    },
  });

  return {
    ok: true,
    result: {
      channelConfigId,
      provider: draft.provider,
      subscribed: subscribeRes.ok === true,
      subscribeError: subscribeRes.ok ? null : subscribeRes.error,
      identity: draft.provider === 'instagram'
        ? { igUserId: draft.igUserId, igUsername: draft.igUsername }
        : { pageId: draft.selectedPage.id, pageName: draft.selectedPage.name },
    },
  };
}

/**
 * POST graph.instagram.com/v21.0/{ig_user_id}/subscribed_apps
 * Subscribes the IG-direct webhook so DMs hit /webhook/ig.
 */
async function subscribeInstagramDirect(ctx, token, igUserId) {
  if (!token || !igUserId) return { ok: false, error: 'missing_token_or_user_id' };
  try {
    const url = new URL(`https://graph.instagram.com/v21.0/${encodeURIComponent(igUserId)}/subscribed_apps`);
    // `comments` powers the @manicbot_com social-automation comment inbox
    // (migration 0127) alongside the DM fields.
    url.searchParams.set('subscribed_fields', 'messages,messaging_postbacks,messaging_seen,message_reactions,comments');
    url.searchParams.set('access_token', token);
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      return { ok: false, error: data?.error?.message || `status_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * POST graph.facebook.com/{page_id}/subscribed_apps
 * Subscribes the Page-Messenger webhook.
 */
async function subscribeFacebookPage(ctx, pageId, pageToken) {
  if (!pageId || !pageToken) return { ok: false, error: 'missing_page_id_or_token' };
  try {
    const url = new URL(`https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/subscribed_apps`);
    // `feed` powers the @manicbot_com social-automation comment inbox
    // (migration 0127) alongside the DM fields.
    url.searchParams.set('subscribed_fields', 'messages,messaging_postbacks,message_reads,message_reactions,feed');
    url.searchParams.set('access_token', pageToken);
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      return { ok: false, error: data?.error?.message || `status_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
