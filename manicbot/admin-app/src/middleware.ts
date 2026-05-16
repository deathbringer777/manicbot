import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware — two responsibilities:
 *  1. Route dispatch for Cloudflare Pages + @cloudflare/next-on-pages (unchanged).
 *  2. Security response headers injected on every request.
 *
 * CSP strategy is route-aware:
 *
 *  • Public marketing/SEO pages (`/search`, `/salon/*`, `/blog`, `/help`,
 *    `/rules`) are statically prerendered (SSG) at build time. Their HTML is
 *    served identically across requests, so a per-request nonce can never
 *    match the inline scripts baked into that HTML — Next.js streams its
 *    framework state via inline `self.__next_f.push(...)` tags that have no
 *    nonce attribute on SSG output. For these routes we serve a CSP with
 *    `'unsafe-inline'` for `script-src` (no nonce). These pages have no
 *    auth-bearing state, so the XSS surface is minimal.
 *
 *  • Everything else (dashboard, auth flows, API routes, salon-bot chat) is
 *    rendered dynamically per request, so we serve a strict CSP with a
 *    per-request nonce in `script-src`. Next.js auto-applies the nonce to
 *    its streaming framework scripts when we forward the CSP on the request
 *    headers; same-origin static script files (e.g. `/theme-init.js`) match
 *    `'self'` and don't need a nonce.
 *
 * NextAuth routes (`/api/auth/*`) are excluded from this middleware via the
 * matcher below so that CSRF cookies and OAuth state cookies are forwarded
 * unmodified to the route handler — required for Google OAuth and credentials
 * sign-in to work.
 */

/** Generate a cryptographically random nonce (Base64, 22+ chars). */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Routes whose HTML is statically prerendered and therefore can't carry a per-request nonce. */
function isStaticPublicRoute(pathname: string): boolean {
  return (
    pathname === "/search" ||
    pathname.startsWith("/search/") ||
    pathname === "/blog" ||
    pathname.startsWith("/blog/") ||
    pathname === "/help" ||
    pathname.startsWith("/help/") ||
    pathname === "/rules" ||
    pathname.startsWith("/rules/") ||
    pathname.startsWith("/salon/")
  );
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const usesNonce = !isStaticPublicRoute(pathname);
  const nonce = usesNonce ? generateNonce() : "";

  // ── Content-Security-Policy ──────────────────────────────────────────────
  const scriptSrc = usesNonce
    ? `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com https://js.stripe.com`
    : `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com`;

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.stripe.com https://*.manicbot.com https://challenges.cloudflare.com https://core.telegram.org https://*.telegram.org",
    "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://manicbot.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // Google OAuth: form POST to /api/auth/signin/google returns a 302 to
    // accounts.google.com — `form-action` covers redirect targets, so the
    // Google host must be allowed or the browser silently drops the redirect
    // (button stuck on "Redirecting...").
    "form-action 'self' https://accounts.google.com",
    "upgrade-insecure-requests",
  ].join("; ");

  // For nonced (dynamic) routes, forward the nonce + the CSP itself on the
  // request headers so the Next.js renderer auto-applies the nonce to its own
  // streaming RSC inline scripts (`self.__next_f.push(...)`).
  const requestHeaders = new Headers(request.headers);
  if (usesNonce) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("x-csp-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });
  res.headers.set("Content-Security-Policy", csp);
  if (usesNonce) {
    res.headers.set("x-nonce", nonce);
    res.headers.set("x-csp-nonce", nonce);
  }
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), payment=(self), usb=()",
  );
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");

  return res;
}

export const config = {
  matcher: [
    /*
     * Run on all request paths EXCEPT:
     * - api/auth   NextAuth routes — must not be intercepted; OAuth state and
     *              CSRF cookies must reach the handler unmodified.
     * - _next/static, _next/image  Next.js internal assets
     * - favicon.ico, robots.txt, sitemap.xml  static metadata files
     */
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|theme-init\\.js|manifest\\.webmanifest|.*\\.svg|.*\\.png).*)",
  ],
};
