/**
 * Source-level pin: NotificationBell must be mounted in WebShell.tsx —
 * the web dashboard header — directly above the theme-toggle button.
 *
 * Why a source test instead of a full RTL render: WebShell pulls in tRPC,
 * NextAuth, Tailwind, and the entire RoleContext stack which is overkill
 * for asserting a single component is on the page. The actual rendered
 * behavior is already covered by NotificationBell's own tests.
 *
 * Regression context: the bell shipped in 2026 only mounted in the
 * Telegram Mini App Shell.tsx; the web dashboard was bell-less, so any
 * salon owner using https://manicbot.com had no surface for in-app
 * notifications. PR1 of the notification-center upgrade fixed this.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../components/layout/WebShell.tsx");

describe("WebShell.tsx — NotificationBell mount", () => {
  const src = readFileSync(FILE, "utf8");

  it("imports NotificationBell", () => {
    expect(src).toMatch(/import \{ NotificationBell \} from "~\/components\/layout\/NotificationBell"/);
  });

  it("renders <NotificationBell /> in the topbar JSX", () => {
    expect(src).toMatch(/<NotificationBell \/>/);
  });

  it("places NotificationBell immediately above the theme-toggle button", () => {
    const bellIdx = src.indexOf("<NotificationBell />");
    const themeIdx = src.indexOf('data-testid="webshell-theme-toggle"');
    expect(bellIdx).toBeGreaterThan(-1);
    expect(themeIdx).toBeGreaterThan(-1);
    expect(bellIdx).toBeLessThan(themeIdx);
    // The slice strictly between bell and the theme toggle's data-testid
    // must contain exactly one `<button` opening — the theme toggle's
    // own one. Anything more means another interactive element sneaked
    // in. We also guard against accidentally mounting two bells.
    const bellTagEnd = bellIdx + "<NotificationBell />".length;
    const slice = src.slice(bellTagEnd, themeIdx);
    const buttonOpens = (slice.match(/<button\b/g) ?? []).length;
    expect(buttonOpens).toBe(1);
    expect(slice.match(/<NotificationBell\b/g)?.length ?? 0).toBe(0);
  });
});
