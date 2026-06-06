/**
 * #U1/#U2 — URL scheme guard.
 *
 * Zod's `z.string().url()` ACCEPTS `javascript:` and `data:` URLs. Attachment /
 * photo URLs are later rendered into `<a href>` / `<img src>`, so an attacker
 * (same-tenant staff) could store `javascript:…` and land a click-to-XSS the
 * moment a render site isn't CSP-protected. Constrain user-supplied URLs to
 * `https://` (the only scheme our CDN mints).
 */
export const isHttpsUrl = (u: string): boolean => /^https:\/\//i.test(u);

/**
 * SEC-002 — Web Push endpoint SSRF guard.
 *
 * A stored push `endpoint` is later `fetch()`-ed by the Worker (with VAPID
 * headers). `z.string().url()` accepts ANY scheme/host, so without this an
 * authenticated user could register an internal/loopback/metadata endpoint
 * and use a self-notification to turn the Worker into an SSRF proxy. Real
 * browsers only ever mint push endpoints on these four vendor services, so we
 * pin to https + their host suffixes. Keep in sync with the Worker copy in
 * `manicbot/src/services/webpush.js` (isAllowedPushEndpoint).
 */
const ALLOWED_PUSH_HOST_SUFFIXES = [
  ".googleapis.com", // FCM — Chrome, Edge(Chromium), Opera, Brave, Samsung
  ".push.services.mozilla.com", // Firefox autopush (incl. regional)
  ".notify.windows.com", // WNS — Edge
  ".wns.windows.com", // WNS
  ".push.apple.com", // Safari
];
export const isAllowedPushEndpoint = (u: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
};
