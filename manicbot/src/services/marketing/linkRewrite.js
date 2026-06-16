/**
 * @fileoverview Rewrite campaign-email links through the signed /r/ redirect
 * so clicks are tracked first-party (independent of Resend's own click webhook)
 * and can be attributed to conversions.
 *
 * Only http(s) `href`s are rewritten. The unsubscribe link (`/u/…`),
 * already-wrapped `/r/…` links, and non-web schemes (mailto:, tel:, #anchor)
 * are left untouched — rewriting the unsubscribe link especially would break
 * one-click opt-out compliance.
 *
 * Fail-open: any error (no secret, signing failure) returns the original HTML.
 * A tracking problem must NEVER stop an email from sending.
 */

import { signClickToken } from './clickToken.js';

function pathnameStartsWith(url, prefix) {
  try {
    return new URL(url).pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

function shouldRewrite(url, origin) {
  if (!/^https?:\/\//i.test(url)) return false; // only absolute http(s)
  if (pathnameStartsWith(url, '/u/')) return false; // unsubscribe — keep raw
  if (pathnameStartsWith(url, '/r/')) return false; // already wrapped
  if (origin && url.startsWith(`${origin}/r/`)) return false;
  return true;
}

/**
 * @param {string} html
 * @param {{ origin: string, campaignId: string, sendId?: string|null, tenantId: string, contactId?: number|null, secret: string, ttlSec?: number }} opts
 * @returns {Promise<string>}
 */
export async function rewriteLinksForTracking(html, opts) {
  const { origin, campaignId, sendId = null, tenantId, contactId = null, secret, ttlSec } = opts || {};
  if (!html || !secret || !origin || !campaignId || !tenantId) return html;
  try {
    const urls = new Set();
    for (const m of html.matchAll(/href\s*=\s*(["'])(.*?)\1/gi)) {
      const url = (m[2] ?? '').trim();
      if (shouldRewrite(url, origin)) urls.add(url);
    }
    if (urls.size === 0) return html;

    const map = new Map();
    await Promise.all([...urls].map(async (url) => {
      const token = await signClickToken(
        secret,
        { campaignId, sendId, tenantId, contactId, url },
        ttlSec,
      );
      map.set(url, `${origin}/r/${token}`);
    }));

    return html.replace(/href\s*=\s*(["'])(.*?)\1/gi, (full, quote, url) => {
      const tracked = map.get((url ?? '').trim());
      return tracked ? `href=${quote}${tracked}${quote}` : full;
    });
  } catch {
    return html; // fail-open
  }
}
