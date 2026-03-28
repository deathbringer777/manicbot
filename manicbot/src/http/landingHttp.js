import { resolveLandingOrigin, isLandingPath, buildLandingFetchUrl } from '../utils/landing-pages-proxy.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryLanding(request, env, url) {
  if (request.method !== 'GET' || !isLandingPath(url.pathname)) return null;
  if (url.pathname === '/blog') {
    return Response.redirect(new URL('/blog/', url).toString(), 308);
  }
  const landingOrigin = resolveLandingOrigin(env);
  const landingUrl = buildLandingFetchUrl(url.pathname, landingOrigin);
  const res = await fetch(landingUrl, { headers: request.headers });
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}
