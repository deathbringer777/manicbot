/**
 * CSP `script-src` — static route hash/'unsafe-inline' guard.
 *
 * Bug history (commit a15cad0, 2026-05-17):
 *   `themeInitHash` was appended to BOTH script-src branches in
 *   middleware.ts — the dynamic-route (nonce) branch AND the static-route
 *   ('unsafe-inline') branch. The hash was intended to authorise the
 *   inline theme-init <script> in app/layout.tsx without forcing the
 *   root layout async.
 *
 *   Per CSP3 spec: when a hash or nonce is present in script-src, the
 *   `'unsafe-inline'` directive is IGNORED. Result: every inline script
 *   on the SSG public pages (/salon/*, /blog/*, /help/*, /rules/*,
 *   /search/*) was blocked — including Next.js's own streaming RSC
 *   scripts (`self.__next_f.push(...)`). Visible symptom: the salon
 *   chat preview iframe in the Channels tab rendered blank, because
 *   /salon/<slug>/chat is SSG and could no longer execute its inline
 *   scripts. User flagged it as "превью чата не работает".
 *
 *   Browser console error captured during diagnosis:
 *     "Executing inline script violates the following Content Security
 *      Policy directive 'script-src 'self' 'unsafe-inline'
 *      'sha256-...'. Note that 'unsafe-inline' is ignored if either a
 *      hash or nonce value is present in the source list. The action
 *      has been blocked."
 *
 * Fix: drop `themeInitHash` from the SSG ('unsafe-inline') branch.
 *   - Dynamic routes keep both nonce + hash (no conflict; nonces and
 *     hashes coexist on the same script-src without invalidating each
 *     other).
 *   - Static SSG routes keep only 'unsafe-inline'. The theme-init
 *     script is still allowed because 'unsafe-inline' covers all
 *     inline scripts without needing a hash there.
 *
 * This test pins the contract at the source-string level so any
 * future PR that re-introduces a hash or nonce in the static
 * branch fails immediately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(__dirname, "..", "middleware.ts"),
  "utf8",
);

describe("middleware CSP — static route script-src must not carry a hash", () => {
  it("declares the dual scriptSrc construction (nonce vs unsafe-inline)", () => {
    // Anchor on the conditional that picks the branch.
    expect(SRC).toMatch(/const\s+scriptSrc\s*=\s*usesNonce/);
  });

  it("dynamic-route branch keeps the themeInitHash (no conflict with nonce)", () => {
    // Capture the nonce branch template literal.
    const m = SRC.match(/usesNonce\s*\n?\s*\?\s*`([^`]+)`/);
    expect(m).toBeTruthy();
    const dynamicScriptSrc = m![1]!;
    expect(dynamicScriptSrc).toContain("'nonce-${nonce}'");
    expect(dynamicScriptSrc).toContain("${themeInitHash}");
    expect(dynamicScriptSrc).not.toContain("'unsafe-inline'");
  });

  it("static-route branch uses 'unsafe-inline' with NO hash or nonce", () => {
    // Capture the second template literal (after `:`) — the static branch.
    const m = SRC.match(/usesNonce[\s\S]*?:\s*`([^`]+)`/);
    expect(m).toBeTruthy();
    const staticScriptSrc = m![1]!;
    expect(staticScriptSrc).toContain("'unsafe-inline'");
    // Hard NO on hash interpolation — `themeInitHash` injected here
    // would make the browser drop `'unsafe-inline'` per CSP3 spec,
    // blocking every inline script on SSG pages.
    expect(staticScriptSrc).not.toContain("${themeInitHash}");
    // Defense in depth: also no literal sha256/sha384/sha512 string,
    // in case a future PR hardcodes the hash instead of using the variable.
    expect(staticScriptSrc).not.toMatch(/'sha(256|384|512)-/);
    // No nonce either — nonces require dynamic rendering.
    expect(staticScriptSrc).not.toContain("'nonce-");
  });

  it("isStaticPublicRoute includes /salon/* (the chat preview path)", () => {
    // The fix only matters if /salon/<slug>/chat is recognised as
    // static — otherwise it would use the nonce branch and the bug
    // wouldn't have manifested. This test pins the routing premise.
    expect(SRC).toMatch(/pathname\.startsWith\("\/salon\/"\)/);
  });

  it("themeInitHash constant is still defined (used by the nonce branch)", () => {
    expect(SRC).toMatch(/const\s+themeInitHash\s*=\s*"'sha256-[A-Za-z0-9+/=]+='"/);
  });
});
