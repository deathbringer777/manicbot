// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Composer } from "~/components/chat/Composer";
import { renderWithLang } from "./helpers/renderWithLang";

afterEach(() => {
  cleanup();
});

/**
 * Mobile chat UX regression guards.
 *
 * Real-browser concerns (iOS auto-zoom, dynamic viewport, safe-area) are
 * impossible to test in JSDOM. Instead we assert on the *intent* — the
 * specific classes/styles that prevent the regressions:
 *
 *  - textarea must be >= 16px on mobile (iOS Safari zooms when smaller)
 *  - composer must respect iOS safe-area-inset-bottom (home indicator)
 *  - ChatClient root must not pin min-h-screen (overrides dvh and pushes
 *    the input out when the keyboard opens)
 */
describe("chat mobile layout — regression guards", () => {
  it("Composer textarea uses 16px font on all viewports (iOS zoom-killer)", () => {
    const { container } = renderWithLang(<Composer onSend={() => {}} />);
    const ta = container.querySelector("textarea");
    expect(ta).not.toBeNull();
    const cls = ta!.className;
    // Must NOT have text-sm (14px) as a base class — Safari iOS zooms in
    // when an input is focused with font-size < 16px.
    expect(cls).not.toMatch(/(?:^|\s)text-sm(?:\s|$)/);
    // Must have text-base (16px) as the base — it can still upscale on md
    expect(cls).toMatch(/(?:^|\s)text-base(?:\s|$)/);
  });

  it("Composer form pads the iOS home-indicator safe area", () => {
    const { container } = renderWithLang(<Composer onSend={() => {}} />);
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    // The composer must respect env(safe-area-inset-bottom) somewhere —
    // either as an inline style or a Tailwind arbitrary class. Note:
    // happy-dom strips inline `style` containing env()/max(), so this is
    // why we recommend the className route.
    const inline = form!.getAttribute("style") ?? "";
    const cls = form!.className;
    const haystack = `${cls} ${inline}`;
    expect(haystack).toMatch(/safe-area-inset-bottom/);
  });

  it("ChatClient root container does not pin min-h-screen (keeps h-dvh stable when keyboard opens)", () => {
    // Source-level guard: reading the file is more reliable than rendering
    // the full ChatClient (which fires off /chat/init network calls). The
    // bug we care about is the literal class string in source.
    const src = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(public)/salon/[slug]/chat/ChatClient.tsx",
      ),
      "utf8",
    );
    // The inner container that wraps the chat column must not carry
    // min-h-screen — it overrides h-dvh and prevents the layout from
    // shrinking when the on-screen keyboard appears.
    expect(src).not.toMatch(/className="h-dvh\s+min-h-screen/);
  });

  it("PublicLayoutClient drops the public chrome on mobile chat route", () => {
    const src = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(public)/PublicLayoutClient.tsx",
      ),
      "utf8",
    );
    // Mobile chat must render full-bleed: header + the pt-16 header offset
    // both have to be hidden on mobile so the Composer is glued to the
    // bottom of the viewport.
    expect(src).toMatch(/isChatRoute/);
    expect(src).toMatch(/hidden md:block/);
    // The pt-16 offset must be gated behind md: (or absent) on the chat
    // route, otherwise the chat overflows the viewport by 64px.
    const usesUnconditionalPt16 = /<main className="pt-16">[\s\S]*<\/main>/.test(
      src,
    );
    if (usesUnconditionalPt16) {
      // OK only if it's not the chat branch — verify there's a chat-specific
      // branch that uses md:pt-16 instead.
      expect(src).toMatch(/md:pt-16/);
    }
  });
});
