/**
 * Shell stacking-context pin.
 *
 * Bug history: the content wrapper inside both `WebShell` and `Shell`
 * carried `relative z-10`. That combo establishes a stacking context
 * for everything rendered as `{children}`. Modals using the 0062
 * contract (`fixed inset-0 z-[100]`) then get trapped INSIDE that
 * z-10 stacking context, which is below the sticky page header
 * (z-30) sitting OUTSIDE the wrapper. Visible symptom: when a modal
 * opens, a horizontal light band remains at the top showing the
 * header bleeding through the dark overlay.
 *
 * Fix: drop the explicit z-index. The decorative orb layer is
 * positioned `absolute` earlier in DOM order, so the content wrapper
 * paints above it naturally. Modals can then escape to the root
 * stacking context where their z-[100] actually wins against the
 * sticky header (z-30).
 *
 * This test pins the contract by string-matching the wrapper. If a
 * future PR re-introduces `relative z-<anything>` on the content
 * wrapper, the test fails immediately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("shell content wrapper — no stacking trap", () => {
  it("WebShell.tsx — content wrapper carries no z-N (only `relative`)", () => {
    const src = read("components/layout/WebShell.tsx");
    // Anchor on the documented hook so the test stays robust against
    // unrelated reshuffles of the same file.
    const idx = src.indexOf('data-tour="web-content"');
    expect(idx).toBeGreaterThan(0);
    // Capture the className attribute that follows that anchor (handles
    // both string literal and template literal forms).
    const tail = src.slice(idx, idx + 800);
    const m = tail.match(/className=\{?`?"?([^"`]+)/);
    expect(m).toBeTruthy();
    const cls = m![1]!;
    expect(cls).toMatch(/\brelative\b/);
    // Hard NO on any z-utility — z-10, z-20, z-[100], z-50, etc.
    expect(cls).not.toMatch(/\bz-(?!auto\b)[\w[\]]+/);
  });

  it("Shell.tsx — Telegram Mini App content wrapper carries no z-N", () => {
    const src = read("components/layout/Shell.tsx");
    // Anchor on the unique content wrapper that wraps {children}.
    const idx = src.indexOf('mx-auto max-w-7xl w-full">{children}');
    expect(idx).toBeGreaterThan(0);
    // Look backwards within the same JSX line for the className string.
    const head = src.slice(Math.max(0, idx - 200), idx + 80);
    const m = head.match(/className="([^"]+)">\{children\}/);
    expect(m).toBeTruthy();
    const cls = m![1]!;
    expect(cls).toMatch(/\brelative\b/);
    expect(cls).not.toMatch(/\bz-(?!auto\b)[\w[\]]+/);
  });
});
