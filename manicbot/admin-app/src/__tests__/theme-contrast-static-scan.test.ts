/**
 * Theme contrast static scan — regression guard for the 2026-05-16 HelpSection
 * pale-on-pale bug.
 *
 * Walks src/**\/*.{ts,tsx} (excluding tests + the primitives + globals.css
 * itself) and fails when a single className string contains BOTH:
 *
 *   1. `text-{c}-{200|300}` without a `dark:` prefix  (pale text in light theme)
 *   2. A pale background class — `bg-{c}-{50|100}`, `bg-{c}-500/{10|15|20|25}`,
 *      `bg-{c}-900/{...}`, or `bg-white` — also without a `dark:` prefix
 *
 * The pair is the bug: pale text on pale background renders as invisible in
 * light theme. Pale text alone (e.g. a decorative `text-slate-300` star icon
 * with `dark:text-slate-600` pair on a card) is intentionally subtle and is
 * NOT flagged. Hover-only variants (`hover:text-X-200`) are not flagged here
 * — they're transient and tracked separately.
 *
 * New offenders must be routed through the <Button>/<Pill> primitives in
 * src/components/ui/ or use explicit paired light+dark variant classes.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..");

// Files and dirs the scanner deliberately does not check.
const SKIP_DIRS = new Set([
  "__tests__",
  "__mocks__",
  "node_modules",
  ".next",
  "build",
  "dist",
]);

const SKIP_FILES = new Set([
  // The primitive files themselves carry the canonical class strings; they
  // are validated by Button.test.tsx / Pill.test.tsx instead.
  "components/ui/Button.tsx",
  "components/ui/Pill.tsx",
]);

const PALE_TEXT_COLORS = [
  "brand",
  "accent",
  "violet",
  "emerald",
  "amber",
  "red",
  "sky",
  "blue",
  "pink",
  "rose",
  "fuchsia",
  "indigo",
  "purple",
  "green",
  "yellow",
  "orange",
  "teal",
  "cyan",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
];

const PALE_SHADES = ["200", "300"];

// Tokenize Tailwind class chains (`dark:hover:text-slate-200`).
const CLASS_TOKEN_RE = /[A-Za-z][A-Za-z0-9_\-:/[\].]*[A-Za-z0-9_\-/\]]/g;

// Pale TEXT shade (-200 / -300), no variant prefix at all (always-on in
// light theme). Hover/focus variants are excluded — they're transient and
// not the same bug class.
const PALE_TEXT_RE = new RegExp(
  `^text-(?:${PALE_TEXT_COLORS.join("|")})-(?:${PALE_SHADES.join("|")})$`,
);

// Pale background — the offending pair. Catches `bg-X-50`, `bg-X-100`,
// `bg-X-500/{10..25}`, and plain `bg-white`.
const PALE_BG_RE = new RegExp(
  `^bg-(?:white|(?:${PALE_TEXT_COLORS.join("|")})-(?:50|100|500/(?:10|15|20|25)))$`,
);

function classifyToken(token: string): "pale-text" | "pale-bg" | "other" {
  const parts = token.split(":");
  const utility = parts[parts.length - 1] ?? "";
  const variants = parts.slice(0, -1);
  // Only flag classes that apply in light theme — i.e. no `dark:` in the chain
  // and no transient variants like `hover:` / `focus:` / `active:` / `group-hover:`.
  const isTransient =
    variants.includes("hover") ||
    variants.includes("focus") ||
    variants.includes("focus-visible") ||
    variants.includes("active") ||
    variants.some((v) => v.startsWith("group-")) ||
    variants.some((v) => v.startsWith("peer-"));
  if (variants.includes("dark") || isTransient) return "other";
  if (PALE_TEXT_RE.test(utility)) return "pale-text";
  if (PALE_BG_RE.test(utility)) return "pale-bg";
  return "other";
}

interface Violation {
  file: string;
  line: number;
  paleText: string;
  paleBg: string;
  excerpt: string;
}

// Extract every short Tailwind class-string literal from the source. We
// scan for quoted strings AND backtick template-string segments (between
// `${...}` interpolations or backticks), but we discard anything that's:
//   - Longer than 400 chars (probably docs/big template, not className)
//   - Spans more than 4 lines
//   - Does not contain a recognizable Tailwind class prefix
//   - Lives inside a /* ... */ comment block (stripped first)
function extractClassNames(source: string): Array<{ value: string; line: number }> {
  const out: Array<{ value: string; line: number }> = [];
  // Strip block comments to avoid pulling Tailwind-looking words out of docs.
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  // Strip line comments too (// ...) — only outside strings, but for our purposes
  // a per-line wipe of trailing `// ...` is good enough.
  const lines = stripped.split("\n").map((l) => l.replace(/\/\/.*$/, ""));

  const TW_HINT = /(?:\bdark:|\bbg-(?:white|black|brand|accent|slate|gray|zinc|neutral|stone|emerald|amber|red|violet|sky|blue|pink|rose|fuchsia|indigo|purple|green|yellow|orange|teal|cyan)|\btext-(?:white|black|brand|accent|slate|gray|zinc|neutral|stone|emerald|amber|red|violet|sky|blue|pink|rose|fuchsia|indigo|purple|green|yellow|orange|teal|cyan)|\bborder-(?:brand|accent|slate|gray|emerald|amber|red|violet|sky|blue))/;

  // 1) Plain quoted strings on a single line containing a TW hint.
  lines.forEach((line, idx) => {
    // Match "..." and '...' (no escapes inside for simplicity — fine for the codebase).
    const re = /(["'])([^"'\n]{2,400})\1/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const value = m[2] ?? "";
      if (TW_HINT.test(value)) out.push({ value, line: idx + 1 });
    }
  });

  // 2) Backtick template-string segments. We split on `${...}` so each segment
  //    is plain text. We then split THAT on backticks to isolate template-string
  //    contents. This catches `${base} text-X-... ${rest}` correctly per-segment.
  const tplRe = /`([^`]{2,1200})`/g;
  let t: RegExpExecArray | null;
  while ((t = tplRe.exec(stripped)) !== null) {
    const body = t[1] ?? "";
    if (body.split("\n").length > 6) continue; // probably not a className
    // Replace ${...} with a separator so we don't merge unrelated tokens.
    const segments = body.replace(/\$\{[^}]*\}/g, "\u0000").split("\u0000");
    const startLine = stripped.slice(0, t.index).split("\n").length;
    for (const seg of segments) {
      if (seg.length > 400) continue;
      if (TW_HINT.test(seg)) out.push({ value: seg, line: startLine });
    }
  }

  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(p, out);
    } else if (st.isFile() && /\.(tsx?|jsx?)$/.test(entry)) {
      // Skip co-located tests.
      if (/\.test\.(tsx?|jsx?)$/.test(entry)) continue;
      out.push(p);
    }
  }
  return out;
}

function scan(path: string): Violation[] {
  const rel = relative(ROOT, path).split(sep).join("/");
  if (SKIP_FILES.has(rel)) return [];
  const source = readFileSync(path, "utf8");
  const violations: Violation[] = [];
  const literals = extractClassNames(source);

  for (const lit of literals) {
    const tokens: string[] = [];
    let m: RegExpExecArray | null;
    CLASS_TOKEN_RE.lastIndex = 0;
    while ((m = CLASS_TOKEN_RE.exec(lit.value)) !== null) tokens.push(m[0]);
    let paleText: string | null = null;
    let paleBg: string | null = null;
    for (const t of tokens) {
      const c = classifyToken(t);
      if (c === "pale-text" && !paleText) paleText = t;
      if (c === "pale-bg" && !paleBg) paleBg = t;
    }
    if (paleText && paleBg) {
      violations.push({
        file: rel,
        line: lit.line,
        paleText,
        paleBg,
        excerpt: lit.value.replace(/\s+/g, " ").trim().slice(0, 200),
      });
    }
  }
  return violations;
}

describe("theme contrast — pale text on pale bg audit", () => {
  it("no className pairs pale text shade with pale bg without `dark:` prefix", () => {
    const files = walk(ROOT);
    const violations: Violation[] = [];
    for (const f of files) violations.push(...scan(f));

    if (violations.length > 0) {
      const grouped = new Map<string, Violation[]>();
      for (const v of violations) {
        if (!grouped.has(v.file)) grouped.set(v.file, []);
        grouped.get(v.file)!.push(v);
      }
      const report = [...grouped.entries()]
        .map(([file, vs]) => {
          const lines = vs
            .map(
              (v) =>
                `  L${v.line}  ${v.paleText} on ${v.paleBg}\n    ${v.excerpt}`,
            )
            .join("\n");
          return `\n${file}\n${lines}`;
        })
        .join("\n");
      throw new Error(
        `Found ${violations.length} pale-on-pale violations across ${grouped.size} files. ` +
          `These render as invisible text in light theme (light-mode text + light-mode bg, no \`dark:\` prefix). ` +
          `Fix by adding explicit light classes (\`text-{c}-700 bg-{c}-50\`) and pairing with \`dark:\` variants, ` +
          `or by replacing the inline classes with <Button>/<Pill> primitives in src/components/ui/.\n${report}`,
      );
    }

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 (added 2026-05-31, SalonCalendarSection account-title bug) —
// unconditional near-white text on a *bare text node*.
//
// Rule 1 above only catches pale text (-200/-300) PAIRED WITH a pale bg in the
// SAME className. It misses the most common invisible-text bug: a solid
// `text-white` (or a pale `text-{c}-{50|100}` shade) with no `dark:`
// variant on a plain <p>/<h2>/<span> whose surface comes from a PARENT. In
// light theme (the default) that parent surface — `glass-card` (near-white),
// the page `--background` (#fafaf7), or a non-adaptive dark tint like
// `bg-slate-900/40` — is light, so the white text vanishes. Only text-select
// reveals it. (The reported case: the Google Calendar account title on a
// glass-card in Settings → "Мой салон".)
//
// `text-white` is legitimate on buttons / avatars / FABs / chat bubbles, where
// the element carries its OWN non-light background — either a `bg-*`/gradient
// class, or an inline `style` background betrayed by a `rounded`/`shadow`/
// dimension/centering shape. Any such "self-surface signal" in the same
// className proves the element is not a bare text node, so we skip it. A few
// components legitimately render white/pale text on a colored-or-dark PARENT
// whose background is not in the same className (chat bubbles, a dark UI mock,
// the dark-only system-admin tools); those are allowlisted by file below.
//
// Pale -200/-300 text alone stays allowed (decorative subtle text), matching
// Rule 1's contract. The rule is precision-biased: prefer a missed edge case
// over a false alarm, same philosophy as Rule 1.
// ---------------------------------------------------------------------------

const NAKED_WHITE_TEXT_SKIP = new Set([
  // Solid white/pale text rendered on a colored-or-dark PARENT surface that is
  // not present in the element's own className. Verified intentional; each is
  // correct in BOTH themes.
  "app/(dashboard)/messages/_components/PlatformOwnerView.tsx", // timestamps on colored bubbles (system-admin pane)
  "app/(dashboard)/messages/_components/PlatformAdminPane.tsx", // timestamps on colored bubbles (system-admin pane)
  "app/(dashboard)/marketing-autopilot/MarketingAutopilotClient.tsx", // system-admin tool, intentionally dark-only surfaces (bg-slate-900 modals)
]);

// Near-white text: SOLID `text-white` or a very pale `text-{c}-{50|100}` shade.
// NOT -200/-300 (decorative-subtle, allowed — Rule 1's contract). NOT
// opacity-modified white (`text-white/N`): a softened white is a deliberate
// de-emphasis that only reads on an already-dark/colored surface (chat bubbles,
// the "today" calendar cell, dark UI mocks) — empirically always intentional,
// never the invisible-on-light bug, which is full-strength `text-white`.
const NEAR_WHITE_TEXT_RE = new RegExp(
  `^text-(?:white|(?:${PALE_TEXT_COLORS.join("|")})-(?:50|100))$`,
);

// A solid light background does not darken the element, so it cannot justify
// white text (`bg-white text-white` would itself be a bug, not a surface).
const NON_DARKENING_BG_RE = new RegExp(
  `^bg-(?:white|(?:${PALE_TEXT_COLORS.join("|")})-(?:50|100))$`,
);

// Does this className supply its OWN non-light surface, or is it a styled
// container / icon rather than a bare text node? Any hit → not a text bug.
function hasSelfSurfaceSignal(tokens: string[]): boolean {
  let hasFlex = false;
  let hasCenter = false;
  for (const token of tokens) {
    const util = token.split(":").pop() ?? "";
    if (util.startsWith("bg-") && !NON_DARKENING_BG_RE.test(util)) return true; // own colored bg
    if (/^(?:from|via|to)-/.test(util)) return true; // gradient stop
    if (util.startsWith("rounded")) return true; // pill / avatar / bubble / button
    if (util.startsWith("shadow")) return true; // styled element (incl. shadow-[...])
    if (/^(?:h|w|size)-/.test(util)) return true; // sized icon / avatar / FAB / full-width button
    if (util === "flex" || util === "inline-flex") hasFlex = true;
    if (util === "items-center" || util === "justify-center") hasCenter = true;
  }
  return hasFlex && hasCenter; // centering container (icon/avatar wrapper)
}

function isUnconditionalNearWhite(token: string): boolean {
  const parts = token.split(":");
  const util = parts[parts.length - 1] ?? "";
  const variants = parts.slice(0, -1);
  if (variants.includes("dark")) return false;
  const isTransient =
    variants.includes("hover") ||
    variants.includes("focus") ||
    variants.includes("focus-visible") ||
    variants.includes("active") ||
    variants.some((v) => v.startsWith("group-")) ||
    variants.some((v) => v.startsWith("peer-"));
  if (isTransient) return false;
  return NEAR_WHITE_TEXT_RE.test(util);
}

interface NakedViolation {
  file: string;
  line: number;
  token: string;
  excerpt: string;
}

function scanNakedWhite(path: string): NakedViolation[] {
  const rel = relative(ROOT, path).split(sep).join("/");
  if (NAKED_WHITE_TEXT_SKIP.has(rel)) return [];
  const source = readFileSync(path, "utf8");
  const out: NakedViolation[] = [];
  for (const lit of extractClassNames(source)) {
    const tokens: string[] = [];
    let m: RegExpExecArray | null;
    CLASS_TOKEN_RE.lastIndex = 0;
    while ((m = CLASS_TOKEN_RE.exec(lit.value)) !== null) tokens.push(m[0]);
    const nearWhite = tokens.find(isUnconditionalNearWhite);
    if (!nearWhite) continue;
    if (hasSelfSurfaceSignal(tokens)) continue;
    out.push({
      file: rel,
      line: lit.line,
      token: nearWhite,
      excerpt: lit.value.replace(/\s+/g, " ").trim().slice(0, 200),
    });
  }
  return out;
}

describe("theme contrast — near-white text on bare text nodes", () => {
  it("never applies text-white / pale text to a bare text node without a `dark:` pair", () => {
    const files = walk(ROOT);
    const violations: NakedViolation[] = [];
    for (const f of files) violations.push(...scanNakedWhite(f));

    if (violations.length > 0) {
      const grouped = new Map<string, NakedViolation[]>();
      for (const v of violations) {
        if (!grouped.has(v.file)) grouped.set(v.file, []);
        grouped.get(v.file)!.push(v);
      }
      const report = [...grouped.entries()]
        .map(([file, vs]) => {
          const lines = vs
            .map((v) => `  L${v.line}  ${v.token}\n    ${v.excerpt}`)
            .join("\n");
          return `\n${file}\n${lines}`;
        })
        .join("\n");
      throw new Error(
        `Found ${violations.length} bare-text-node near-white violations across ${grouped.size} files. ` +
          `These render invisible (or very low contrast) in light theme — white/pale text on a parent-supplied ` +
          `light surface (glass-card, page background, or a non-adaptive dark tint), with no \`dark:\` pair. ` +
          `Fix with the semantic \`text-foreground\` token (or an explicit \`text-slate-900 dark:text-white\` pair). ` +
          `If the text genuinely sits on a colored/dark PARENT surface not in its own className, add the file to ` +
          `NAKED_WHITE_TEXT_SKIP with a one-line reason.\n${report}`,
      );
    }

    expect(violations).toEqual([]);
  });
});
