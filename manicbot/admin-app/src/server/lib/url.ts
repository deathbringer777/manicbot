import { env } from "~/env";

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
 * IU-1 (audit 2026-06-12) — chat/ticket attachment URL pin.
 *
 * Attachment URLs render in the counterparty's browser as inline `<img src>`
 * and click-through `<a target=_blank>`. A bare https check let any
 * attacker-controlled host through (tracking pixel / phishing toward salon
 * owners and platform support staff). Pin to the exact shape our upload flow
 * mints (`uploadHttp.js`: `<origin>/cdn/t/<tid>/chat_attachment-<sha>.<ext>`).
 *
 * V-2 (post-fix verification 2026-06-12): the original pin matched only the
 * PATH shape with an unconstrained `[^/]+` host, so an attacker could serve a
 * path-matching URL from their OWN domain and still get it rendered. The host
 * is now pinned too — it MUST equal the WORKER_PUBLIC_URL origin host (where
 * the worker actually serves `/cdn/...`), with the production apex as a static
 * fallback. The capture group exposes the tenant segment so messenger can
 * additionally require it to match the message's tenant.
 */
const CHAT_ATTACHMENT_URL_RE =
  /^https:\/\/([^/@]+)\/cdn\/t\/([A-Za-z0-9_-]+)\/chat_attachment-[a-f0-9]{6,64}\.(?:webp|jpg|jpeg|png)$/i;

/** Production CDN hosts (apex + www) — the worker serves `/cdn/...` from these. */
const STATIC_ATTACHMENT_HOSTS = new Set(["manicbot.com", "www.manicbot.com"]);

/** True when `host` is an origin the worker mints/serves attachments on. */
function isAllowedAttachmentHost(host: string): boolean {
  const h = host.toLowerCase();
  if (STATIC_ATTACHMENT_HOSTS.has(h)) return true;
  const configured = env.WORKER_PUBLIC_URL;
  if (configured) {
    try {
      if (new URL(configured).host.toLowerCase() === h) return true;
    } catch {
      /* malformed env — fall through to reject */
    }
  }
  return false;
}

export const isChatAttachmentCdnUrl = (u: string): boolean => {
  const m = CHAT_ATTACHMENT_URL_RE.exec(u);
  return m !== null && isAllowedAttachmentHost(m[1]!);
};

/**
 * Tenant segment of a valid CDN attachment URL, or null when it doesn't match
 * the pin (host included).
 */
export const chatAttachmentUrlTenant = (u: string): string | null => {
  const m = CHAT_ATTACHMENT_URL_RE.exec(u);
  if (!m || !isAllowedAttachmentHost(m[1]!)) return null;
  return m[2] ?? null;
};

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
