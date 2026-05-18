/**
 * Pure-logic tests for `services/meta-oauth-logic.js`.
 *
 * Pins the security-critical contracts (state shape, URL construction,
 * provider profile, callback parsing) so a refactor that breaks any of
 * them cannot land silently.
 *
 * I/O behavior (KV roundtrip, code exchange, channel_config writes) is
 * tested in `meta-oauth-handlers.test.js`.
 */
import { describe, it, expect } from 'vitest';
import {
  detectMetaTokenType,
  configApiForTokenType,
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
  renderOAuthPopupClosePage,
  deriveOpenerOriginFromReturnTo,
} from '../src/services/meta-oauth-logic.js';

// ─── detectMetaTokenType ─────────────────────────────────────────────────────

describe('detectMetaTokenType', () => {
  it('detects IGAA-prefixed tokens as Instagram Login product', () => {
    expect(detectMetaTokenType('IGAAYmZBxxxxxxxxxx')).toBe('igaa');
  });

  it('detects EAA-prefixed tokens as Facebook Graph product', () => {
    expect(detectMetaTokenType('EAAxxxxxxxxxx')).toBe('eaa');
  });

  it('returns unknown for empty / non-string / unrelated input', () => {
    expect(detectMetaTokenType('')).toBe('unknown');
    expect(detectMetaTokenType('foo')).toBe('unknown');
    expect(detectMetaTokenType(null)).toBe('unknown');
    expect(detectMetaTokenType(undefined)).toBe('unknown');
    expect(detectMetaTokenType(42)).toBe('unknown');
  });

  it('is case-sensitive on the prefix (Meta tokens are uppercase)', () => {
    // Lower-case 'igaa' isn't a Meta token; treat as unknown so a typo can't
    // route through the wrong API host.
    expect(detectMetaTokenType('igaaxxx')).toBe('unknown');
    expect(detectMetaTokenType('eaaxxx')).toBe('unknown');
  });
});

// ─── configApiForTokenType ────────────────────────────────────────────────────

describe('configApiForTokenType', () => {
  it('routes IGAA tokens to graph.instagram.com (instagram_direct)', () => {
    expect(configApiForTokenType('igaa')).toBe('instagram_direct');
  });

  it('routes EAA tokens to graph.facebook.com (facebook)', () => {
    expect(configApiForTokenType('eaa')).toBe('facebook');
  });

  it('throws on unknown — callers must reject before storage', () => {
    expect(() => configApiForTokenType('unknown')).toThrow(/unknown_token_type/);
  });
});

// ─── META_OAUTH_PROVIDERS ─────────────────────────────────────────────────────

describe('META_OAUTH_PROVIDERS', () => {
  it('exposes both providers with the required wire-protocol constants', () => {
    expect(META_OAUTH_PROVIDERS.instagram).toBeDefined();
    expect(META_OAUTH_PROVIDERS.facebook).toBeDefined();
    for (const k of ['authUrl', 'tokenUrl', 'meUrl', 'scopes', 'appIdEnvKey', 'appSecretEnvKey']) {
      expect(META_OAUTH_PROVIDERS.instagram[k]).toBeDefined();
      expect(META_OAUTH_PROVIDERS.facebook[k]).toBeDefined();
    }
  });

  it('Instagram provider uses graph.instagram.com host', () => {
    expect(META_OAUTH_PROVIDERS.instagram.meUrl).toMatch(/^https:\/\/graph\.instagram\.com\//);
    expect(META_OAUTH_PROVIDERS.instagram.tokenUrl).toMatch(/^https:\/\/api\.instagram\.com\//);
  });

  it('Facebook provider uses graph.facebook.com host', () => {
    expect(META_OAUTH_PROVIDERS.facebook.meUrl).toMatch(/^https:\/\/graph\.facebook\.com\//);
    expect(META_OAUTH_PROVIDERS.facebook.tokenUrl).toMatch(/^https:\/\/graph\.facebook\.com\//);
  });

  it('Instagram scopes include messaging permission', () => {
    expect(META_OAUTH_PROVIDERS.instagram.scopes).toContain('instagram_business_manage_messages');
  });

  it('Facebook scopes include pages_messaging + pages_manage_metadata for subscribe', () => {
    expect(META_OAUTH_PROVIDERS.facebook.scopes).toContain('pages_messaging');
    expect(META_OAUTH_PROVIDERS.facebook.scopes).toContain('pages_manage_metadata');
  });

  it('providers reference separate App ID + Secret env keys (key separation)', () => {
    expect(META_OAUTH_PROVIDERS.instagram.appSecretEnvKey).toBe('META_INSTAGRAM_APP_SECRET');
    expect(META_OAUTH_PROVIDERS.facebook.appSecretEnvKey).toBe('META_APP_SECRET');
    expect(META_OAUTH_PROVIDERS.instagram.appSecretEnvKey)
      .not.toBe(META_OAUTH_PROVIDERS.facebook.appSecretEnvKey);
  });

  it('provider config is frozen (immutable at runtime)', () => {
    expect(Object.isFrozen(META_OAUTH_PROVIDERS)).toBe(true);
    expect(Object.isFrozen(META_OAUTH_PROVIDERS.instagram)).toBe(true);
    expect(Object.isFrozen(META_OAUTH_PROVIDERS.facebook)).toBe(true);
  });
});

// ─── isMetaOAuthProvider ─────────────────────────────────────────────────────

describe('isMetaOAuthProvider', () => {
  it('accepts the two known providers', () => {
    expect(isMetaOAuthProvider('instagram')).toBe(true);
    expect(isMetaOAuthProvider('facebook')).toBe(true);
  });

  it('rejects everything else (incl. legacy names)', () => {
    expect(isMetaOAuthProvider('ig')).toBe(false);
    expect(isMetaOAuthProvider('fb')).toBe(false);
    expect(isMetaOAuthProvider('meta')).toBe(false);
    expect(isMetaOAuthProvider('')).toBe(false);
    expect(isMetaOAuthProvider(null)).toBe(false);
    expect(isMetaOAuthProvider(undefined)).toBe(false);
  });
});

// ─── generateOauthState / isValidOauthState ─────────────────────────────────

describe('generateOauthState', () => {
  it('returns 64-char lowercase hex (32 random bytes)', () => {
    for (let i = 0; i < 5; i++) {
      const s = generateOauthState();
      expect(s).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('produces distinct values across calls (CSPRNG check)', () => {
    const samples = new Set();
    for (let i = 0; i < 100; i++) samples.add(generateOauthState());
    expect(samples.size).toBe(100);
  });
});

describe('isValidOauthState', () => {
  it('accepts a freshly minted state', () => {
    expect(isValidOauthState(generateOauthState())).toBe(true);
  });

  it('rejects malformed inputs — wrong length / casing / type', () => {
    expect(isValidOauthState('')).toBe(false);
    expect(isValidOauthState('abc123')).toBe(false);
    expect(isValidOauthState('A'.repeat(64))).toBe(false); // uppercase
    expect(isValidOauthState('g'.repeat(64))).toBe(false); // non-hex char
    expect(isValidOauthState(null)).toBe(false);
    expect(isValidOauthState(undefined)).toBe(false);
    expect(isValidOauthState({})).toBe(false);
  });
});

// ─── PKCE ───────────────────────────────────────────────────────────────────

describe('generatePkceVerifier / deriveCodeChallengeS256', () => {
  it('verifier is exactly 64 chars (URL-safe base64 alphabet)', () => {
    const v = generatePkceVerifier();
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('challenge is base64url-encoded SHA-256 of verifier (43 chars, no padding)', async () => {
    const v = generatePkceVerifier();
    const c = await deriveCodeChallengeS256(v);
    // SHA-256 = 32 bytes → base64url no-pad = 43 chars
    expect(c).toHaveLength(43);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c).not.toContain('=');
  });

  it('challenge derivation is deterministic for the same verifier', async () => {
    const v = generatePkceVerifier();
    const a = await deriveCodeChallengeS256(v);
    const b = await deriveCodeChallengeS256(v);
    expect(a).toBe(b);
  });
});

// ─── buildMetaAuthUrl ───────────────────────────────────────────────────────

describe('buildMetaAuthUrl', () => {
  const baseArgs = () => ({
    provider: /** @type {'instagram'} */ ('instagram'),
    appId: '3756985564432185',
    redirectUri: 'https://manicbot.com/meta/instagram/callback',
    state: generateOauthState(),
  });

  it('emits all required Meta OAuth query params', () => {
    const url = new URL(buildMetaAuthUrl(baseArgs()));
    expect(url.searchParams.get('client_id')).toBe('3756985564432185');
    expect(url.searchParams.get('redirect_uri'))
      .toBe('https://manicbot.com/meta/instagram/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('instagram_business_manage_messages');
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('targets Instagram authorize endpoint for instagram provider', () => {
    const url = new URL(buildMetaAuthUrl(baseArgs()));
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
  });

  it('targets Facebook authorize endpoint for facebook provider', () => {
    const url = new URL(buildMetaAuthUrl({ ...baseArgs(), provider: 'facebook' }));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
  });

  it('IG scopes are comma-separated, FB scopes are space-separated (Meta convention)', () => {
    const igUrl = new URL(buildMetaAuthUrl(baseArgs()));
    expect(igUrl.searchParams.get('scope')).toContain(',');
    expect(igUrl.searchParams.get('scope')).not.toContain(' ');

    const fbUrl = new URL(buildMetaAuthUrl({ ...baseArgs(), provider: 'facebook' }));
    expect(fbUrl.searchParams.get('scope')).toContain(' ');
  });

  it('includes PKCE challenge when provided', () => {
    const url = new URL(buildMetaAuthUrl({ ...baseArgs(), codeChallenge: 'abc_challenge' }));
    expect(url.searchParams.get('code_challenge')).toBe('abc_challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('omits PKCE params when no challenge supplied (backwards compat with no-PKCE callers)', () => {
    const url = new URL(buildMetaAuthUrl(baseArgs()));
    expect(url.searchParams.get('code_challenge')).toBeNull();
    expect(url.searchParams.get('code_challenge_method')).toBeNull();
  });

  it('refuses invalid provider', () => {
    expect(() => buildMetaAuthUrl({ ...baseArgs(), provider: 'meta' }))
      .toThrow(/invalid_provider/);
  });

  it('refuses missing app id / redirect / state', () => {
    expect(() => buildMetaAuthUrl({ ...baseArgs(), appId: '' })).toThrow(/missing_app_id/);
    expect(() => buildMetaAuthUrl({ ...baseArgs(), redirectUri: '' })).toThrow(/missing_redirect_uri/);
    expect(() => buildMetaAuthUrl({ ...baseArgs(), state: 'short' })).toThrow(/invalid_state/);
  });
});

// ─── buildCallbackUri ───────────────────────────────────────────────────────

describe('buildCallbackUri', () => {
  it('builds /meta/{provider}/callback for both providers', () => {
    expect(buildCallbackUri('https://manicbot.com', 'instagram'))
      .toBe('https://manicbot.com/meta/instagram/callback');
    expect(buildCallbackUri('https://manicbot.com', 'facebook'))
      .toBe('https://manicbot.com/meta/facebook/callback');
  });

  it('strips trailing slashes on the base URL', () => {
    expect(buildCallbackUri('https://manicbot.com/', 'instagram'))
      .toBe('https://manicbot.com/meta/instagram/callback');
    expect(buildCallbackUri('https://manicbot.com///', 'instagram'))
      .toBe('https://manicbot.com/meta/instagram/callback');
  });

  it('refuses invalid provider / missing base URL', () => {
    expect(() => buildCallbackUri('https://x.com', 'meta')).toThrow(/invalid_provider/);
    expect(() => buildCallbackUri('', 'instagram')).toThrow(/missing_base_url/);
  });
});

// ─── parseMetaCallbackQuery ──────────────────────────────────────────────────

describe('parseMetaCallbackQuery', () => {
  const validState = 'a'.repeat(64);

  it('returns ok=true for a valid code+state pair', () => {
    const params = new URLSearchParams({ code: 'AQD...', state: validState });
    expect(parseMetaCallbackQuery(params)).toEqual({
      ok: true,
      code: 'AQD...',
      state: validState,
    });
  });

  it('returns ok=false with the Meta error code when user cancels', () => {
    const params = new URLSearchParams({
      error: 'access_denied',
      error_reason: 'user_denied',
      error_description: 'User denied the request',
      state: validState,
    });
    const result = parseMetaCallbackQuery(params);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('access_denied');
    expect(result.errorDescription).toBe('User denied the request');
    expect(result.state).toBe(validState);
  });

  it('rejects malformed state — invalid_state, no KV lookup possible', () => {
    const params = new URLSearchParams({ code: 'AQD...', state: 'BAD' });
    const result = parseMetaCallbackQuery(params);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_state');
    expect(result.state).toBeNull();
  });

  it('rejects missing code (covers the legitimate-state-but-no-code edge)', () => {
    const params = new URLSearchParams({ state: validState });
    const result = parseMetaCallbackQuery(params);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing_code');
    expect(result.state).toBe(validState);
  });

  it('strips invalid state even when an error is present (no probing the namespace)', () => {
    const params = new URLSearchParams({ error: 'access_denied', state: 'BAD' });
    const result = parseMetaCallbackQuery(params);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('access_denied');
    expect(result.state).toBeNull();
  });
});

// ─── canAutoFinalizeDraft ────────────────────────────────────────────────────

describe('canAutoFinalizeDraft', () => {
  it('IG-direct drafts always auto-finalize', () => {
    expect(canAutoFinalizeDraft({
      provider: 'instagram',
      tenantId: 't', webUserId: 'u', accessToken: 'IGAA',
      expiresAt: null, graphMe: { id: '1' },
      igUserId: '1', igUsername: 'salon', createdAt: 0,
    })).toBe(true);
  });

  it('FB-Login with exactly one IG-linked Page auto-finalizes', () => {
    expect(canAutoFinalizeDraft({
      provider: 'facebook',
      tenantId: 't', webUserId: 'u', accessToken: 'EAA',
      expiresAt: null, graphMe: { id: '1' },
      pages: [{ id: 'pg', name: 'Page', accessToken: 'EAA_PAGE', igBusinessId: 'ig123' }],
      createdAt: 0,
    })).toBe(true);
  });

  it('FB-Login with multiple Pages needs a picker', () => {
    expect(canAutoFinalizeDraft({
      provider: 'facebook',
      tenantId: 't', webUserId: 'u', accessToken: 'EAA',
      expiresAt: null, graphMe: { id: '1' },
      pages: [
        { id: 'pg1', name: 'Page 1', accessToken: 'EAA_1', igBusinessId: 'ig1' },
        { id: 'pg2', name: 'Page 2', accessToken: 'EAA_2', igBusinessId: 'ig2' },
      ],
      createdAt: 0,
    })).toBe(false);
  });

  it('FB-Login with a single Page that has NO IG account does NOT auto-finalize', () => {
    // No IG linkage = nothing to bind. UI must show "no IG account on this Page".
    expect(canAutoFinalizeDraft({
      provider: 'facebook',
      tenantId: 't', webUserId: 'u', accessToken: 'EAA',
      expiresAt: null, graphMe: { id: '1' },
      pages: [{ id: 'pg', name: 'Page', accessToken: 'EAA_PAGE' }],
      createdAt: 0,
    })).toBe(false);
  });

  it('FB-Login with zero Pages does NOT auto-finalize', () => {
    expect(canAutoFinalizeDraft({
      provider: 'facebook',
      tenantId: 't', webUserId: 'u', accessToken: 'EAA',
      expiresAt: null, graphMe: { id: '1' },
      pages: [], createdAt: 0,
    })).toBe(false);
  });

  it('refuses unknown provider / null input', () => {
    expect(canAutoFinalizeDraft(null)).toBe(false);
    expect(canAutoFinalizeDraft({ provider: 'whatsapp' })).toBe(false);
  });
});

// ─── deriveOpenerOriginFromReturnTo ────────────────────────────────────────

describe('deriveOpenerOriginFromReturnTo', () => {
  it('extracts origin from a typical admin-app returnTo URL', () => {
    expect(deriveOpenerOriginFromReturnTo('https://admin.manicbot.com/dashboard?tab=channels'))
      .toBe('https://admin.manicbot.com');
  });

  it('handles port + protocol variations correctly', () => {
    expect(deriveOpenerOriginFromReturnTo('http://localhost:3000/x'))
      .toBe('http://localhost:3000');
    expect(deriveOpenerOriginFromReturnTo('https://manicbot-staging.pages.dev/y'))
      .toBe('https://manicbot-staging.pages.dev');
  });

  it('falls back to "*" on malformed inputs (postMessage will be loose, but state still gates)', () => {
    expect(deriveOpenerOriginFromReturnTo('')).toBe('*');
    expect(deriveOpenerOriginFromReturnTo(null)).toBe('*');
    expect(deriveOpenerOriginFromReturnTo('not a url')).toBe('*');
  });
});

// ─── renderOAuthPopupClosePage ─────────────────────────────────────────────

describe('renderOAuthPopupClosePage', () => {
  const validState = 'a'.repeat(64);

  it('emits a postMessage payload with source, meta_ok, meta_state', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: '1',
      metaState: validState,
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dashboard?meta_state=' + validState + '&meta_ok=1',
    });
    expect(html).toContain('manicbot-meta-oauth');
    expect(html).toContain('"meta_ok":"1"');
    expect(html).toContain('"meta_state":"' + validState + '"');
    expect(html).toContain('postMessage(payload');
    expect(html).toContain('"https://admin.manicbot.com"');
  });

  it('uses targetOrigin as the second arg to postMessage (origin-scoped, never bare "*" by default)', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: '1',
      metaState: validState,
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dash',
    });
    // postMessage(payload, openerOrigin) — payload first, origin second.
    expect(html).toMatch(/postMessage\(\s*payload\s*,\s*openerOrigin\s*\)/);
  });

  it('includes window.close() so the popup self-closes', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: '1',
      metaState: validState,
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dash',
    });
    expect(html).toContain('window.close()');
  });

  it('falls back to fallbackUrl when window.opener is null', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: '1',
      metaState: validState,
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dashboard?meta_state=' + validState + '&meta_ok=1',
    });
    expect(html).toContain('window.location.replace(fallbackUrl)');
    expect(html).toContain('meta_state=' + validState);
  });

  it('forwards meta_error + description on the failure branch', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: '0',
      metaState: validState,
      metaError: 'access_denied',
      metaErrorDescription: 'User denied',
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dash',
    });
    expect(html).toContain('"meta_ok":"0"');
    expect(html).toContain('"meta_error":"access_denied"');
    expect(html).toContain('"meta_error_description":"User denied"');
  });

  it('clamps a tampered metaOk to "0" (never trusts non-"1" inputs as success)', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: 'truthy',
      metaState: validState,
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dash',
    });
    expect(html).toContain('"meta_ok":"0"');
  });

  it('drops a malformed state (single source of truth for "valid state" — the receiver re-checks)', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: '1',
      metaState: 'short',
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dash',
    });
    expect(html).toContain('"meta_state":""');
  });

  it('escapes </script> in attacker-controlled error description so the script block cannot be broken out of', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: '0',
      metaState: validState,
      metaError: 'access_denied',
      metaErrorDescription: '</script><script>alert(1)</script>',
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dash',
    });
    // The literal closing tag should never appear inside the inline JS — the
    // escaper turns it into `<\/script`.
    const scriptStart = html.indexOf('<script>(function');
    const scriptEnd = html.indexOf('</script>', scriptStart);
    const scriptBody = html.slice(scriptStart, scriptEnd);
    expect(scriptBody).not.toContain('</script>');
    expect(scriptBody).toContain('<\\/script>');
  });

  it('emits Cyrillic-safe HTML (no character mojibake)', () => {
    const html = renderOAuthPopupClosePage({
      metaOk: '1',
      metaState: validState,
      openerOrigin: 'https://admin.manicbot.com',
      fallbackUrl: 'https://admin.manicbot.com/dash',
    });
    expect(html).toContain('Завершаем подключение');
    expect(html).toContain('charset="utf-8"');
  });
});
