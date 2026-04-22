import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware — two responsibilities:
 *  1. Route dispatch for Cloudflare Pages + @cloudflare/next-on-pages (unchanged).
 *  2. Security response headers injected on every request.
 *
 * CSP uses 'unsafe-inline' for styles (Tailwind) and scripts while we are on
 * next-on-pages without nonce support. TODO: migrate to nonce-based CSP once
 * server-component nonce forwarding is available on the edge runtime.
 */
export function middleware(_request: NextRequest) {
  const res = NextResponse.next();

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
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://js.stripe.com",
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

  res.headers.set("Content-Security-Policy", csp);
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
