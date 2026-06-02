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
