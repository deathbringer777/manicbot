/**
 * @fileoverview Pure logic for Meta (Facebook + Instagram) OAuth.
 *
 * Kept I/O-free so the unit tests can exercise the security-critical bits
 * (token-type detection, state generation, auth URL construction, callback
 * query parsing) without spinning up KV mocks or fetch interceptors.
 *
 * The I/O layer (KV state storage, code-for-token exchange, channel_config
 * writes, webhook subscribe) lives in `meta-oauth.js`. Tests there exercise
 * the round-trip behavior; tests here pin the contract.
 */

// ─── Token-type detection ────────────────────────────────────────────────────

/**
 * Meta currently issues two prefixes that the channel layer cares about:
 *
 *   - `EAA…`  — classic Facebook Graph token (User or Page). Routes through
 *               `graph.facebook.com`. Used by the legacy IG-Messenger product
 *               where DMs go via the linked FB Page.
 *   - `IGAA…` — Instagram Login product token (post-Mar-2026). Routes through
 *               `graph.instagram.com`. Tied directly to the IG Business
 *               account, no FB Page required.
 *
 * `unknown` is returned for anything else; callers must reject these so we
 * don't store a token whose lifecycle we don't understand.
 *
 * @param {string} token
 * @returns {'igaa' | 'eaa' | 'unknown'}
 */
export function detectMetaTokenType(token) {
  if (typeof token !== 'string' || token.length === 0) return 'unknown';
  if (token.startsWith('IGAA')) return 'igaa';
  if (token.startsWith('EAA')) return 'eaa';
  return 'unknown';
}

/**
 * For a token whose type is known, which channel_configs.config.api value
 * should the row carry?
 *
 *   - 'igaa' → 'instagram_direct' (graph.instagram.com)
 *   - 'eaa'  → 'facebook'         (graph.facebook.com via Page)
 *
 * Throws on 'unknown' — callers should reject those before reaching this.
 *
 * @param {'igaa' | 'eaa'} tokenType
 * @returns {'instagram_direct' | 'facebook'}
 */
export function configApiForTokenType(tokenType) {
  if (tokenType === 'igaa') return 'instagram_direct';
  if (tokenType === 'eaa') return 'facebook';
  throw new Error(`unknown_token_type:${tokenType}`);
}

// ─── OAuth provider profiles ────────────────────────────────────────────────

/**
 * Per-provider OAuth wire-protocol constants. The two products differ in
 * authorize endpoint, token-exchange endpoint, default scope set, and which
 * App ID / App Secret to use.
 *
 * `instagram` uses the Instagram Login product (graph.instagram.com, IGAA
 * tokens). `facebook` uses Facebook Login for Business (graph.facebook.com,
 * EAA Page tokens via the User Token → /me/accounts → Page route).
 */
export const META_OAUTH_PROVIDERS = Object.freeze({
  instagram: Object.freeze({
    id: 'instagram',
    authUrl: 'https://www.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    longLivedTokenUrl: 'https://graph.instagram.com/access_token',
    meUrl: 'https://graph.instagram.com/v21.0/me',
    /**
     * `instagram_business_basic` reads profile, `instagram_business_manage_messages`
     * is the messaging permission required for DMs (the whole reason we're
     * connecting). The four scopes mirror what Meta's "Instagram Login → API
     * setup with Instagram login" wizard emits.
     */
    scopes: [
      'instagram_business_basic',
      'instagram_business_manage_messages',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
    ],
    appIdEnvKey: 'META_INSTAGRAM_APP_ID',
    appSecretEnvKey: 'META_INSTAGRAM_APP_SECRET',
  }),
  facebook: Object.freeze({
    id: 'facebook',
    authUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    longLivedTokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
    meUrl: 'https://graph.facebook.com/v21.0/me',
    accountsUrl: 'https://graph.facebook.com/v21.0/me/accounts',
    /**
     * Page-Messaging scopes. `pages_manage_metadata` is required to call
     * /{page_id}/subscribed_apps post-connect. `instagram_basic` +
     * `instagram_manage_messages` cover IG-via-Page DM reception.
     */
    scopes: [
      'pages_show_list',
      'pages_messaging',
      'pages_manage_metadata',
      'instagram_basic',
      'instagram_manage_messages',
    ],
    appIdEnvKey: 'META_APP_ID',
    appSecretEnvKey: 'META_APP_SECRET',
  }),
});

/**
 * Narrow type guard for the `provider` query param.
 *
 * @param {unknown} value
 * @returns {value is 'instagram' | 'facebook'}
 */
export function isMetaOAuthProvider(value) {
  return value === 'instagram' || value === 'facebook';
}

// ─── State token generation ─────────────────────────────────────────────────

/**
 * CSPRNG-backed OAuth state token. 32 random bytes encoded as 64-char hex.
 *
 * Used both as the KV key for the in-flight connect AND as the `state`
 * parameter on the auth URL — Meta echoes it back, we look it up, attacker
 * can't forge a state because they don't know the value we minted.
 *
 * @returns {string} 64-char hex
 */
export function generateOauthState() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * State tokens must match this shape exactly. Used to reject malformed
 * callback queries before any KV lookup so attackers can't probe the
 * namespace with garbage.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isValidOauthState(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

// ─── PKCE (RFC 7636) ────────────────────────────────────────────────────────

/**
 * 64-char base64url verifier. We use S256 challenge mode — Meta supports
 * both plain and S256, S256 is the only secure choice. PKCE hardens against
 * authorization-code-injection even though our client secret stays
 * server-side (defense in depth).
 *
 * @returns {string}
 */
export function generatePkceVerifier() {
  const buf = crypto.getRandomValues(new Uint8Array(48));
  return base64urlEncode(buf).slice(0, 64);
}

/**
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function deriveCodeChallengeS256(verifier) {
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64urlEncode(new Uint8Array(hashBuf));
}

function base64urlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// ─── Auth URL construction ──────────────────────────────────────────────────

/**
 * Build the Meta authorization URL for the given provider and a freshly
 * minted state.
 *
 * @param {Object} args
 * @param {'instagram' | 'facebook'} args.provider
 * @param {string} args.appId
 * @param {string} args.redirectUri
 * @param {string} args.state
 * @param {string} [args.codeChallenge]
 * @returns {string}
 */
export function buildMetaAuthUrl({ provider, appId, redirectUri, state, codeChallenge }) {
  if (!isMetaOAuthProvider(provider)) {
    throw new Error(`invalid_provider:${provider}`);
  }
  if (!appId) throw new Error('missing_app_id');
  if (!redirectUri) throw new Error('missing_redirect_uri');
  if (!isValidOauthState(state)) throw new Error('invalid_state');

  const profile = META_OAUTH_PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: profile.scopes.join(provider === 'instagram' ? ',' : ' '),
    state,
  });
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${profile.authUrl}?${params.toString()}`;
}

/**
 * Build the redirect URI Meta will call back. Centralized so the auth URL
 * builder, the callback handler, and the code-exchange call all agree on
 * the exact string (Meta requires byte-identical match).
 *
 * @param {string} baseUrl - e.g. "https://manicbot.com" (no trailing slash)
 * @param {'instagram' | 'facebook'} provider
 * @returns {string}
 */
export function buildCallbackUri(baseUrl, provider) {
  if (!isMetaOAuthProvider(provider)) {
    throw new Error(`invalid_provider:${provider}`);
  }
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  if (!trimmed) throw new Error('missing_base_url');
  return `${trimmed}/meta/${provider}/callback`;
}

// ─── Callback parsing ───────────────────────────────────────────────────────

/**
 * Parse a Meta callback query string. Rejects malformed states + denies
 * before any KV / Graph round-trip.
 *
 * Meta returns `error` + `error_reason` + `error_description` when the user
 * cancels or the app lacks permissions; we surface those verbatim so the
 * UI can show a friendly message.
 *
 * @param {URLSearchParams} params
 * @returns {{ ok: true, code: string, state: string }
 *          | { ok: false, state: string | null, error: string, errorDescription?: string }}
 */
export function parseMetaCallbackQuery(params) {
  const state = params.get('state') || '';
  const validState = isValidOauthState(state) ? state : null;

  const error = params.get('error');
  if (error) {
    return {
      ok: false,
      state: validState,
      error,
      errorDescription: params.get('error_description') || params.get('error_reason') || undefined,
    };
  }

  if (!validState) {
    return { ok: false, state: null, error: 'invalid_state' };
  }

  const code = params.get('code');
  if (!code || typeof code !== 'string' || code.length === 0) {
    return { ok: false, state: validState, error: 'missing_code' };
  }

  return { ok: true, code, state: validState };
}

// ─── Draft persistence shape ────────────────────────────────────────────────

/**
 * After a successful code exchange the Worker stores a "draft" channel
 * config under the same OAuth state. The admin-app then calls `consume` to
 * either auto-create the channel (IG-direct, single-account) or fetch a
 * page picker (FB-Login, multi-page).
 *
 * @typedef {Object} MetaOAuthDraft
 * @property {'instagram' | 'facebook'} provider
 * @property {string} tenantId
 * @property {string} webUserId       - admin-app web_users.id of initiator
 * @property {string} accessToken     - long-lived; never logged
 * @property {number | null} expiresAt - Unix seconds, null = non-expiring
 * @property {Object | null} graphMe   - what /me returned (for confirmation UI)
 * @property {Array<{ id: string, name: string, accessToken: string, igBusinessId?: string }>} [pages]
 *           - FB-Login only: the user's Pages, each with its Page Token
 * @property {string | null} igUserId  - IG-direct only: graph.instagram.com /me.id
 * @property {string | null} igUsername - IG-direct only: graph.instagram.com /me.username
 * @property {number} createdAt        - Unix seconds
 */

/**
 * Decide whether the draft can be finalized without a Page picker.
 *
 *   - IG-direct flow: always single-account, no picker needed.
 *   - FB-Login flow: picker needed UNLESS exactly one Page came back AND
 *                     that Page has an IG Business account linked (i.e. it's
 *                     unambiguous which Page to bind).
 *
 * @param {MetaOAuthDraft} draft
 * @returns {boolean}
 */
export function canAutoFinalizeDraft(draft) {
  if (!draft) return false;
  if (draft.provider === 'instagram') return true;
  if (draft.provider !== 'facebook') return false;
  const pages = Array.isArray(draft.pages) ? draft.pages : [];
  if (pages.length !== 1) return false;
  return Boolean(pages[0]?.igBusinessId);
}

// ─── Popup callback page ────────────────────────────────────────────────────

/**
 * Build the safe origin that the popup HTML will postMessage TO. We extract
 * it from the admin-app's `returnTo` URL — that's the only origin we ever
 * intended to talk to. Anything malformed falls back to `'*'` only as a
 * dead-last belt-and-suspenders; the receiver still validates `event.origin`
 * AND the state token so a misbehaving sender can't ride this channel.
 *
 * @param {string} returnTo
 * @returns {string}
 */
export function deriveOpenerOriginFromReturnTo(returnTo) {
  try {
    return new URL(String(returnTo || '')).origin;
  } catch {
    return '*';
  }
}

/**
 * Naive but tight HTML escape for the few attribute / text values we splice
 * into the popup HTML. We never accept caller-controlled values here — only
 * server-derived strings (state, error code, origin) — but if any of those
 * ever change, we want this layer to refuse to render dangerous content.
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render the HTML that the popup window lands on after Meta's callback when
 * the flow was started with `popup: true`. It does three things:
 *
 *   1. `window.opener.postMessage({...}, openerOrigin)` — the opener (admin
 *      app) is listening for this and resumes the consume flow.
 *   2. `window.close()` — the popup goes away on its own.
 *   3. Fallback: if `window.opener` is null (user opened the callback URL
 *      directly, or the opener was lost) — top-level redirect to `returnTo`
 *      with the same `meta_*` query params so the legacy mount-handler path
 *      can still pick it up.
 *
 * The opener checks `event.origin === workerOrigin` AND
 * `event.data.meta_state === pendingState`. Both checks live in the
 * admin-app `InstagramConnect.tsx`. This HTML is the trusted sender.
 *
 * @param {Object} args
 * @param {'1' | '0'} args.metaOk
 * @param {string} args.metaState - 64-char hex state from the auth flow
 * @param {string | null} [args.metaError]
 * @param {string | null} [args.metaErrorDescription]
 * @param {string} args.openerOrigin - validated admin-app origin
 * @param {string} args.fallbackUrl - URL to top-level-redirect to if opener is gone
 * @returns {string} HTML
 */
export function renderOAuthPopupClosePage({
  metaOk,
  metaState,
  metaError = null,
  metaErrorDescription = null,
  openerOrigin,
  fallbackUrl,
}) {
  const okFlag = metaOk === '1' ? '1' : '0';
  const safeState = isValidOauthState(metaState) ? metaState : '';
  // JSON-stringify is safe here for inline JS because we then escape `</` to
  // `<\/` to keep an attacker-controlled error message (e.g. with a literal
  // `</script>`) from breaking out of the script context.
  const payload = JSON.stringify({
    source: 'manicbot-meta-oauth',
    meta_ok: okFlag,
    meta_state: safeState,
    meta_error: metaError || undefined,
    meta_error_description: metaErrorDescription || undefined,
  }).replace(/<\/script/gi, '<\\/script');

  const openerOriginJs = JSON.stringify(openerOrigin || '*');
  const fallbackUrlJs = JSON.stringify(String(fallbackUrl || '/'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Meta OAuth · ManicBot</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
    color: #e2e8f0; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 24px;
  }
  .card {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 18px; padding: 28px 32px; max-width: 360px;
  }
  h1 { font-size: 16px; margin: 0 0 6px; font-weight: 600; }
  p { font-size: 13px; margin: 0; color: #94a3b8; line-height: 1.5; }
  .spin {
    width: 24px; height: 24px; margin: 0 auto 12px;
    border: 2px solid rgba(255,255,255,0.18); border-top-color: #f472b6;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="card">
  <div class="spin" aria-hidden="true"></div>
  <h1>Завершаем подключение…</h1>
  <p>Можете закрыть это окно, если оно не закроется автоматически.</p>
</div>
<script>(function(){
  var payload = ${payload};
  var openerOrigin = ${openerOriginJs};
  var fallbackUrl = ${fallbackUrlJs};
  function bailToFallback() { try { window.location.replace(fallbackUrl); } catch (e) {} }
  try {
    if (window.opener && !window.opener.closed) {
      try { window.opener.postMessage(payload, openerOrigin); } catch (e) {}
      setTimeout(function(){ try { window.close(); } catch (e) {} bailToFallback(); }, 120);
    } else {
      bailToFallback();
    }
  } catch (e) { bailToFallback(); }
})();</script>
<noscript><a href="${escapeHtml(fallbackUrl)}">Continue</a></noscript>
</body>
</html>`;
}
