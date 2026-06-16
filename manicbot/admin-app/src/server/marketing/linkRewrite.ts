/**
 * Admin-app twin of the Worker `services/marketing/linkRewrite.js`.
 *
 * Rewrites campaign-email http(s) links through the signed Worker `/r/`
 * redirect for first-party click tracking. Skips the unsubscribe link,
 * already-wrapped `/r/` links, and non-web schemes. Fail-open: any error
 * returns the original HTML — a tracking glitch must never block a send.
 */

import { signClickToken } from "./clickToken";

function pathnameStartsWith(url: string, prefix: string): boolean {
  try {
    return new URL(url).pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

function shouldRewrite(url: string, origin: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (pathnameStartsWith(url, "/u/")) return false;
  if (pathnameStartsWith(url, "/r/")) return false;
  if (origin && url.startsWith(`${origin}/r/`)) return false;
  return true;
}

export interface RewriteOpts {
  origin: string;
  campaignId: string;
  sendId?: string | null;
  tenantId: string;
  contactId?: number | null;
  secret: string;
  ttlSec?: number;
}

export async function rewriteLinksForTracking(html: string, opts: RewriteOpts): Promise<string> {
  const { origin, campaignId, sendId = null, tenantId, contactId = null, secret, ttlSec } = opts ?? {};
  if (!html || !secret || !origin || !campaignId || !tenantId) return html;
  try {
    const urls = new Set<string>();
    for (const m of html.matchAll(/href\s*=\s*(["'])(.*?)\1/gi)) {
      const url = (m[2] ?? "").trim();
      if (shouldRewrite(url, origin)) urls.add(url);
    }
    if (urls.size === 0) return html;

    const map = new Map<string, string>();
    await Promise.all(
      [...urls].map(async (url) => {
        const token = await signClickToken(secret, { campaignId, sendId, tenantId, contactId, url }, ttlSec);
        map.set(url, `${origin}/r/${token}`);
      }),
    );

    return html.replace(/href\s*=\s*(["'])(.*?)\1/gi, (full, quote, url) => {
      const tracked = map.get((url ?? "").trim());
      return tracked ? `href=${quote}${tracked}${quote}` : full;
    });
  } catch {
    return html; // fail-open
  }
}
