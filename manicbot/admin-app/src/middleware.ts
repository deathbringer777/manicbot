import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware — two responsibilities:
 *  1. Route dispatch for Cloudflare Pages + @cloudflare/next-on-pages (unchanged).
 *  2. Security response headers injected on every request.
 *
 * CSP uses a per-request cryptographic nonce for inline scripts (replaces
 * 'unsafe-inline'). The nonce is exposed via the `x-csp-nonce` response header
 * so that server components and Next.js layouts can read it with `headers()` and
 * pass it to <Script nonce={nonce}> tags. Style-src keeps 'unsafe-inline' because
 * Tailwind v4 generates inline styles that cannot be nonced without a full rebuild.
 */

/** Generate a cryptographically random nonce (Base64, 22+ chars). */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa is available in the Edge runtime
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
    "connect-src 'self' https://api.stripe.com https://*.manicbot.com https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com https://js.stripe.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");

  const res = NextResponse.next({
    request: { headers: new Headers(_request.headers) },
  });
  res.headers.set("Content-Security-Policy", csp);
  // Expose nonce to server components via headers() API
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
