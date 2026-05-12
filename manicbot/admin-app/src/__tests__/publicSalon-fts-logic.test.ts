import { describe, it, expect } from "vitest";
import {
  buildFtsMatchExpression,
  PUBLIC_CACHE_CONTROL,
  PUBLIC_CACHEABLE_PROCEDURES,
  shouldCacheTrpcPath,
} from "~/server/api/publicSalon/publicSalonSearchLogic";

/**
 * Pure-logic unit tests for the FTS5 query builder. The integration
 * tests (`publicSalon-fts-integration.test.ts`) exercise the real
 * SQLite FTS5 tokenizer; here we only verify the wire format we hand
 * to D1.
 */
describe("buildFtsMatchExpression", () => {
  it("returns a single prefix-marked token for a one-word ASCII query", () => {
    expect(buildFtsMatchExpression("polish")).toBe("polish*");
  });

  it("returns space-joined prefix tokens for multi-word queries (FTS5 AND)", () => {
    expect(buildFtsMatchExpression("nail studio")).toBe("nail* studio*");
  });

  it("lowercases input so the expression is canonical", () => {
    expect(buildFtsMatchExpression("POLISH")).toBe("polish*");
    expect(buildFtsMatchExpression("Maniküra")).toBe("maniküra*");
  });

  it("strips FTS5 control characters and operators that would be parsed", () => {
    // Quotes, parens, asterisk, colon, and operators must never reach
    // the tokenizer raw — they would otherwise produce `SQL logic error
    // — fts5: syntax error`.
    expect(buildFtsMatchExpression('foo" OR "bar')).toBe("foo* or* bar*");
    expect(buildFtsMatchExpression("foo(NEAR)bar")).toBe("foo* near* bar*");
    expect(buildFtsMatchExpression("a*b")).toBe("a* b*");
  });

  it("returns null when the input is empty or whitespace only", () => {
    expect(buildFtsMatchExpression("")).toBeNull();
    expect(buildFtsMatchExpression("    ")).toBeNull();
  });

  it("returns null when input has nothing but punctuation", () => {
    expect(buildFtsMatchExpression("!!!")).toBeNull();
    expect(buildFtsMatchExpression(",.;:'\"")).toBeNull();
  });

  it("caps the number of tokens at the documented MAX_TOKENS", () => {
    const many = Array.from({ length: 20 }, (_, i) => `tok${i}`).join(" ");
    const out = buildFtsMatchExpression(many);
    expect(out?.split(" ").length).toBe(6);
  });

  it("caps a single oversized token to MAX_TOKEN_LEN (32 chars + '*')", () => {
    const huge = "a".repeat(120);
    const out = buildFtsMatchExpression(huge);
    expect(out).toBe("a".repeat(32) + "*");
  });

  it("emits Cyrillic + Latin OR-branch when the query has Cyrillic letters", () => {
    // ru: "маникюр" → Latin "manikyur" — we cannot know the exact
    // transliteration mapping here, but we can assert the shape.
    const out = buildFtsMatchExpression("маникюр");
    expect(out).toMatch(/маникюр\*/);
    expect(out).toContain(" OR ");
    // After OR there must be a non-empty Latin-only prefix term.
    const [, latin] = out!.split(" OR ");
    expect(latin).toMatch(/^[a-z*\s]+$/i);
  });

  it("does not emit an OR-branch when input is purely Latin", () => {
    expect(buildFtsMatchExpression("manicure")).toBe("manicure*");
    expect(buildFtsMatchExpression("manicure")).not.toContain(" OR ");
  });

  it("preserves Polish diacritics in the primary branch (FTS5 fold-on-store handles it)", () => {
    // "łańcuch" must reach the tokenizer with diacritics intact — the
    // unicode61 tokenizer folds during indexing, not during input
    // sanitisation. Trimming diacritics ourselves would make the input
    // unsearchable when content was stored *with* them.
    expect(buildFtsMatchExpression("łańcuch")).toBe("łańcuch*");
    expect(buildFtsMatchExpression("Żelazo Polski")).toBe("żelazo* polski*");
  });
});

describe("PUBLIC_CACHEABLE_PROCEDURES", () => {
  it("contains exactly the three public salon read endpoints", () => {
    expect(PUBLIC_CACHEABLE_PROCEDURES).toEqual([
      "publicSalon.getProfile",
      "publicSalon.getCities",
      "publicSalon.autocomplete",
    ]);
  });
});

describe("PUBLIC_CACHE_CONTROL", () => {
  it("uses the relax.md §4 P2-9 recommended values (60s edge, 5min SWR)", () => {
    expect(PUBLIC_CACHE_CONTROL).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });
});

describe("shouldCacheTrpcPath", () => {
  it("returns true for a single allow-listed procedure", () => {
    expect(shouldCacheTrpcPath("publicSalon.getProfile")).toBe(true);
    expect(shouldCacheTrpcPath("publicSalon.getCities")).toBe(true);
    expect(shouldCacheTrpcPath("publicSalon.autocomplete")).toBe(true);
  });

  it("returns true for a batched request where every procedure is allow-listed", () => {
    expect(
      shouldCacheTrpcPath("publicSalon.getCities,publicSalon.autocomplete"),
    ).toBe(true);
  });

  it("returns false for a batch that mixes a private procedure", () => {
    // Caching a batch that includes `auth.getMyRole` would freeze the
    // user's login state at the edge — never allowed.
    expect(
      shouldCacheTrpcPath("publicSalon.getCities,auth.getMyRole"),
    ).toBe(false);
  });

  it("returns false for non-allow-listed procedures (publicSalon.search is intentionally not cached)", () => {
    // search is a personalised result (lat/lng can be passed by the
    // caller) — caching it at the edge would leak per-user distance
    // calculations to other users. Excluded by design.
    expect(shouldCacheTrpcPath("publicSalon.search")).toBe(false);
    expect(shouldCacheTrpcPath("publicSalon.searchMasters")).toBe(false);
  });

  it("returns false on empty / null / unknown input", () => {
    expect(shouldCacheTrpcPath(null)).toBe(false);
    expect(shouldCacheTrpcPath(undefined)).toBe(false);
    expect(shouldCacheTrpcPath("")).toBe(false);
    expect(shouldCacheTrpcPath("unknown.proc")).toBe(false);
  });

  it("trims whitespace around path entries", () => {
    expect(
      shouldCacheTrpcPath(" publicSalon.getCities , publicSalon.autocomplete "),
    ).toBe(true);
  });
});
