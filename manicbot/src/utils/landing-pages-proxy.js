/**
 * Paths fetched from Cloudflare Pages (LANDING_URL) through the Worker.
 * Keep in sync with manicbot-analysis/public and Vite dist output.
 */

export const DEFAULT_LANDING_ORIGIN = 'https://manicbot-landing.pages.dev';

/**
 * @param {Record<string, unknown>} env
 * @returns {string} Origin without trailing slash
 */
export function resolveLandingOrigin(env) {
  const raw = env.LANDING_URL && String(env.LANDING_URL).trim();
  if (raw) {
    const o = raw.replace(/\/$/, '');
    try {
      const host = new URL(o).hostname;
      if (host === 'manicbot.com' || host === 'www.manicbot.com') return DEFAULT_LANDING_ORIGIN;
    } catch {
      /* ignore */
    }
    return o;
  }
  return DEFAULT_LANDING_ORIGIN;
}

/** SPA legal/info routes — keep in sync with manicbot-analysis/src/lib/routes.ts */
const LEGAL_PATHS = new Set(['/privacy', '/terms', '/cookies', '/support']);

/**
 * @param {string} pathname URL pathname (no query)
 * @returns {boolean}
 */
export function isLandingPath(pathname) {
  if (pathname === '/' || pathname.startsWith('/assets/')) return true;
  if (pathname === '/favicon.svg' || pathname === '/favicon.ico') return true;
  if (LEGAL_PATHS.has(pathname)) return true;
  if (/^\/[^/]+\.(?:png|svg|ico|txt|xml|webmanifest)$/i.test(pathname)) return true;
  return false;
}

/**
 * @param {string} pathname
 * @param {string} landingOrigin from resolveLandingOrigin
 * @returns {string} Full URL to fetch on Pages
 */
export function buildLandingFetchUrl(pathname, landingOrigin) {
  return pathname === '/' ? `${landingOrigin}/` : `${landingOrigin}${pathname}`;
}
