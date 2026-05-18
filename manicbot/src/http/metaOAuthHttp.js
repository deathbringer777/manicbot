import { envCtx } from './envCtx.js';
import {
  handleMetaOAuthStart,
  handleMetaOAuthCallback,
  handleMetaOAuthConsume,
  handleMetaOAuthFinalize,
} from '../services/meta-oauth.js';

/**
 * Meta (Facebook + Instagram) OAuth routes. Mirrors the Google OAuth
 * surface in `googleHttp.js`. The admin-keyed endpoints are called by
 * admin-app tRPC procedures; the per-provider callbacks are GET-only and
 * accept Meta's redirect.
 *
 * Routes:
 *
 *   POST /meta/oauth/start             (Bearer ADMIN_KEY)
 *     Mint state, store binding, return authorize URL.
 *
 *   GET  /meta/instagram/callback      (Meta-initiated)
 *   GET  /meta/facebook/callback       (Meta-initiated)
 *     Exchange code, persist draft, 302 back to admin-app.
 *
 *   POST /meta/oauth/consume           (Bearer ADMIN_KEY)
 *     Read draft, auto-finalize OR return Page picker payload.
 *
 *   POST /meta/oauth/finalize          (Bearer ADMIN_KEY)
 *     After picker selection, bind chosen Page + write channel_config.
 *
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryMetaOAuth(request, env, url) {
  const ctx = { ...envCtx(env), ...env, baseUrl: url.origin };

  if (request.method === 'POST' && url.pathname === '/meta/oauth/start') {
    return handleMetaOAuthStart(ctx, request);
  }
  if (request.method === 'POST' && url.pathname === '/meta/oauth/consume') {
    return handleMetaOAuthConsume(ctx, request);
  }
  if (request.method === 'POST' && url.pathname === '/meta/oauth/finalize') {
    return handleMetaOAuthFinalize(ctx, request);
  }
  if (request.method === 'GET' && url.pathname === '/meta/instagram/callback') {
    return handleMetaOAuthCallback(ctx, request, url, 'instagram');
  }
  if (request.method === 'GET' && url.pathname === '/meta/facebook/callback') {
    return handleMetaOAuthCallback(ctx, request, url, 'facebook');
  }
  return null;
}
