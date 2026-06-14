/**
 * Canonical host + scheme redirect for SEO de-duplication.
 *
 * Both `manicbot.com` and `www.manicbot.com` are bound to the Worker
 * (wrangler.toml custom_domain x2) and Cloudflare "Always Use HTTPS" is off, so
 * the apex/www and http/https variants all served 200 with identical content.
 * That produced duplicate URLs in Google's index ("Page with redirect",
 * duplicate-canonical noise — observed in GSC 2026-06-14).
 *
 * This 301s any `www.*` host or `http://` scheme onto the single canonical
 * origin `https://manicbot.com`, preserving path + query string.
 */

const CANONICAL_HOST = 'manicbot.com';
const WWW_HOST = `www.${CANONICAL_HOST}`;

/**
 * Decide whether a request must be redirected to the canonical origin.
 *
 * Only GET/HEAD requests are considered — a 301 on a POST would drop the body,
 * and webhooks/API clients already target the apex https origin. Only the
 * `manicbot.com` zone (apex + www) is touched, so dev/preview/`*.pages.dev`
 * origins keep working unchanged.
 *
 * Scheme detection: behind Cloudflare the Worker can see `https` in
 * `request.url` even for an http client, so the `CF-Visitor` header is the
 * source of truth when present, falling back to `url.protocol`.
 *
 * @param {Request} request Incoming request.
 * @returns {{ to: string, status: number } | null} absolute redirect target
 *   (different origin), or null when the request is already canonical.
 */
export function canonicalHostRedirect(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;

  const url = new URL(request.url);
  const host = url.hostname;
  if (host !== CANONICAL_HOST && host !== WWW_HOST) return null;

  let scheme = url.protocol === 'http:' ? 'http' : 'https';
  const cfVisitor = request.headers.get('cf-visitor');
  if (cfVisitor) {
    try {
      const parsed = JSON.parse(cfVisitor);
      if (parsed && typeof parsed.scheme === 'string') scheme = parsed.scheme;
    } catch {
      // Malformed header — keep the url.protocol fallback.
    }
  }

  const isWww = host === WWW_HOST;
  const isHttp = scheme === 'http';
  if (!isWww && !isHttp) return null; // already canonical — avoid a redirect loop

  url.protocol = 'https:';
  url.hostname = CANONICAL_HOST;
  return { to: url.toString(), status: 301 };
}
