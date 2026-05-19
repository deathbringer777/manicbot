/**
 * M-B + M-D (audit 2026-05-20) — CSP tightening.
 *
 * M-B: connect-src previously included the wildcard `https://*.manicbot.com`.
 * A subdomain takeover (typo-squat preview Pages, deleted PR alias) would
 * give an attacker an exfil endpoint reachable from the admin app. Replace
 * with an explicit allowlist.
 *
 * M-D: frame-src previously included `https://manicbot.com`. The «Веб-чат»
 * dashboard preview embeds `/salon/<slug>/chat` on the SAME Pages origin,
 * not the Worker apex, so 'self' is sufficient.
 */
import { describe, it, expect } from "vitest";
import { middleware } from "~/middleware";

function makeReq(pathname: string) {
  return { nextUrl: { pathname }, headers: new Headers() };
}

function cspOf(pathname: string): string {
  const res = middleware(makeReq(pathname) as never);
  return res.headers.get("Content-Security-Policy") ?? "";
}

describe("M-B — connect-src no longer wildcards *.manicbot.com", () => {
  it("dashboard route does NOT carry the `*.manicbot.com` wildcard", () => {
    const csp = cspOf("/dashboard");
    // Match the directive line specifically; the host pattern must not
    // appear anywhere in connect-src.
    const directive = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
    expect(directive).toBeDefined();
    expect(directive).not.toMatch(/\*\.manicbot\.com/);
  });

  it("explicit apex + landing + Pages origins are still permitted", () => {
    const csp = cspOf("/dashboard");
    const directive = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";
    expect(directive).toContain("https://manicbot.com");
    expect(directive).toContain("https://www.manicbot.com");
    expect(directive).toContain("https://admin-app.pages.dev");
  });

  it("Stripe + Telegram + Turnstile remain allowed (regression)", () => {
    const csp = cspOf("/dashboard");
    const directive = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";
    expect(directive).toContain("https://api.stripe.com");
    expect(directive).toContain("https://*.telegram.org");
    expect(directive).toContain("https://challenges.cloudflare.com");
  });
});

describe("M-D — frame-src no longer lists https://manicbot.com", () => {
  it("dashboard route drops https://manicbot.com from frame-src", () => {
    const csp = cspOf("/dashboard");
    const directive = csp.split(";").find((d) => d.trim().startsWith("frame-src")) ?? "";
    // 'self' covers the same-origin /salon/<slug>/chat embed; the apex
    // Worker URL is unnecessary here.
    expect(directive).toContain("'self'");
    expect(directive).not.toMatch(/https:\/\/manicbot\.com(?![a-z])/);
  });

  it("Stripe + Turnstile frames remain allowed", () => {
    const csp = cspOf("/dashboard");
    const directive = csp.split(";").find((d) => d.trim().startsWith("frame-src")) ?? "";
    expect(directive).toContain("https://js.stripe.com");
    expect(directive).toContain("https://challenges.cloudflare.com");
  });
});

describe("regression — chat preview embedding still works", () => {
  it("/salon/<slug>/chat is framed-allowed (frame-ancestors 'self' + 'self' in frame-src)", () => {
    const csp = cspOf("/salon/manicbot-demo/chat");
    expect(csp).toMatch(/frame-ancestors[^;]*'self'/);
    const directive = csp.split(";").find((d) => d.trim().startsWith("frame-src")) ?? "";
    expect(directive).toContain("'self'");
  });
});
