import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware — two responsibilities:
 *  1. Route dispatch for Cloudflare Pages + @cloudflare/next-on-pages (unchanged).
 *  2. Security response headers injected on every request.
 *
 * CSP uses a per-request cryptographic nonce for inline scripts (replaces
 * 'unsafe-inline'). The nonce is forwarded to server components via the
 * `x-csp-nonce` REQUEST header so layouts can read it with `headers()` and
 * pass it to <Script nonce={nonce}> tags. Style-src keeps 'unsafe-inline' because
 * Tailwind v4 generates inline styles that cannot be nonced without a full rebuild.
 *
 * NextAuth routes (/api/auth/*) are excluded from this middleware via the matcher
 * so that CSRF cookies and OAuth state cookies are forwarded unmodified to the
 * route handler — required for Google OAuth and credentials sign-in to work.
 */

/** Generate a cryptographically random nonce (Base64, 22+ chars). */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function middleware(_request: NextRequest) {
  const nonce = generateNonce();

  // ── Content-Security-Policy ──────────────────────────────────────────────
  // Permits:
  //   - same-origin scripts + styles (Tailwind/Next bundles)
  //   - Cloudflare Turnstile challenge iframe/script
  //   - Stripe.js for payment form
  //   - connect-src for tRPC calls and Stripe API
  // Blocks:
  //   - <object>, <embed>, <base> overrides, other origins loading as frames
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com https://js.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.stripe.com https://*.manicbot.com https://challenges.cloudflare.com https://core.telegram.org https://*.telegram.org",
    "frame-src https://challenges.cloudflare.com https://js.stripe.com",
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

  // Forward the nonce to server components via request headers so layouts can
  // read it with `headers()` and pass it to <Script nonce={nonce}> tags.
  const requestHeaders = new Headers(_request.headers);
  requestHeaders.set("x-csp-nonce", nonce);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("x-csp-nonce", nonce);
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self), usb=()",
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
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
};
