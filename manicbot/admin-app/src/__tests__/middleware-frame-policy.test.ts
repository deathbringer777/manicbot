/**
 * Frame-embedding policy pins for the edge middleware.
 *
 * Background — the «Веб-чат» sub-tab in the salon dashboard renders
 * a same-origin `<iframe src="https://manicbot.com/salon/{slug}/chat">`
 * so the salon owner can see exactly what their clients see. Before this
 * pin, `src/middleware.ts` shipped:
 *   • `Content-Security-Policy: frame-ancestors 'none'`
 *   • `X-Frame-Options: DENY`
 * on every response. Both headers refuse same-origin embedding, so the
 * iframe rendered as a blank box on prod. Regression-guard the policy:
 *
 *   1. The chat surface (`/salon/{slug}/chat`) MUST be embeddable from
 *      the same origin (so the dashboard preview works).
 *   2. Everything else (`/dashboard`, `/login`, `/api/...`) MUST keep
 *      the strict `frame-ancestors 'none'` + `X-Frame-Options: DENY`
 *      defaults to block clickjacking.
 *
 * The middleware works against `NextRequest` instances. We synthesise
 * one with the minimum shape (`nextUrl.pathname`, `headers`) since
 * happy-dom / Vitest don't ship a Next runtime.
 */
import { describe, it, expect } from "vitest";
import { middleware } from "~/middleware";

type MaybeRequest = {
  nextUrl: { pathname: string };
  headers: Headers;
};

function makeReq(pathname: string): MaybeRequest {
  return {
    nextUrl: { pathname },
    headers: new Headers(),
  };
}

describe("middleware frame-embedding policy", () => {
  describe("public chat surface (/salon/<slug>/chat)", () => {
    const req = makeReq("/salon/manicbot-demo/chat");
    const res = middleware(req as never);

    it("uses SAMEORIGIN for X-Frame-Options so the dashboard iframe renders", () => {
      const xfo = res.headers.get("X-Frame-Options");
      expect(xfo).toBe("SAMEORIGIN");
    });

    it("uses frame-ancestors 'self' in CSP so the dashboard iframe renders", () => {
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      // Accept either the bare 'self' directive or one that includes self
      // alongside other allowed origins.
      expect(csp).toMatch(/frame-ancestors[^;]*'self'/);
      expect(csp).not.toMatch(/frame-ancestors\s+'none'/);
    });
  });

  describe("nested chat-adjacent paths (regression guard)", () => {
    // The matcher selects pathname.includes("/chat") naively in early drafts;
    // pin a couple of cousin paths to make sure we don't accidentally open up
    // /salon/<slug>/booking or /chat-something to same-origin framing too.
    it("keeps /salon/<slug> (the profile page, no /chat suffix) framed-denied", () => {
      const res = middleware(makeReq("/salon/manicbot-demo") as never);
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toMatch(/frame-ancestors\s+'none'/);
    });
  });

  describe("dashboard + login + API (must stay DENY)", () => {
    it.each([
      "/dashboard",
      "/login",
      "/api/trpc/whatever",
      "/settings",
      "/plugins",
    ])("path %s keeps X-Frame-Options: DENY", (path) => {
      const res = middleware(makeReq(path) as never);
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      const csp = res.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toMatch(/frame-ancestors\s+'none'/);
    });
  });
});
