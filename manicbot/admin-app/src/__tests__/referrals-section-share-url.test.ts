/**
 * Locks down the language-aware share URL in ReferralsSection.
 *
 * The component (a) reads the inviter's UI lang from LangContext and
 * (b) appends `&lang=${lang}` to every outbound share surface so:
 *
 *   - Telegram/WhatsApp/iMessage/Slack previews render in the inviter's
 *     language (server-side /register generateMetadata keys off ?lang=)
 *   - The invitee landing on /register?ref=…&lang=ru auto-switches to RU
 *     via LangContext (no manual locale picker dance)
 *
 * Rendering the full component requires mocking the tRPC client, useLang,
 * navigator.share, navigator.clipboard, and next-auth — overkill for what's
 * effectively a string-templating change. We use the same structural
 * pattern as `blog-slug-page-structure.test.ts`: read the source, assert
 * every share surface uses the localised URL variant.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_PATH = join(
  process.cwd(),
  "src/components/settings/sections/ReferralsSection.tsx",
);

/**
 * Find the line containing `marker` and return that line plus the next
 * `tail` lines as one blob. The nested template-literal in the WhatsApp
 * href spans multiple `}`s, so a flat `[^}]*` regex fails — line-based
 * proximity is the correct primitive here.
 */
function findBlock(src: string, marker: string, tail = 3): string {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.includes(marker)) {
      return lines.slice(i, i + tail + 1).join("\n");
    }
  }
  throw new Error(`marker not found in source: ${marker}`);
}

describe("ReferralsSection — language-aware share URL", () => {
  const src = readFileSync(SRC_PATH, "utf8");

  it("derives a localised share URL by appending &lang=<inviter lang>", () => {
    // Allow either string-concat or template-literal style; tolerant of
    // whitespace and quote variants. The point: the suffix MUST be composed
    // from `lang` (LangContext) so swapping UI lang re-derives the URL.
    expect(src).toMatch(/shareUrl\s*\?\s*`\$\{\s*shareUrl\s*\}&lang=\$\{\s*lang\s*\}`/);
    expect(src).toMatch(/const\s+shareUrlLocalized\s*=/);
  });

  it("WhatsApp share link uses the localised URL", () => {
    const block = findBlock(src, "wa.me/");
    expect(block).toContain("shareUrlLocalized");
  });

  it("Telegram share link uses the localised URL", () => {
    const block = findBlock(src, "t.me/share/url");
    expect(block).toContain("shareUrlLocalized");
  });

  it("Instagram clipboard copy uses the localised URL", () => {
    // IG button: navigator.clipboard.writeText(`${c.shareTemplate} ${shareUrlLocalized}`)
    // Locate by the shareTemplate token inside a clipboard write.
    expect(src).toMatch(/clipboard\.writeText\(`\$\{c\.shareTemplate\}\s+\$\{shareUrlLocalized\}`/);
  });

  it("Web Share API (onShare) uses the localised URL", () => {
    expect(src).toMatch(/navigator\.share\(\{\s*url:\s*shareUrlLocalized/);
    expect(src).toMatch(/clipboard\.writeText\(shareUrlLocalized\)/);
  });

  it("the copy-link button uses the localised URL", () => {
    // The display <span> and the explicit Copy button both show/copy the
    // exact URL the share buttons send — no canonical-vs-share split.
    expect(src).toMatch(/<CopyButton\s+value=\{shareUrlLocalized\}/);
    const displaySpan = findBlock(src, "min-w-0 flex-1 truncate", 2);
    expect(displaySpan).toContain("shareUrlLocalized");
  });

  it("share-message templates mention the 20% off discount (warmer copy regression guard)", () => {
    // The plan rewrote the four shareTemplate strings to be more inviting;
    // if someone reverts, catch it. Pin the discount mention in two locales
    // (RU/UA share `20% off`, PL shares `20% zniżki`).
    for (const probe of ["20% off", "20% zniżki"]) {
      expect(src).toContain(probe);
    }
  });
});
