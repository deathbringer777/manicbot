import { describe, expect, it } from "vitest";
import {
  filterScoreArticle,
  getHelpSuggestions,
  helpHasActiveSearch,
  HELP_ARTICLES,
} from "~/content/help/articles";

describe("helpHasActiveSearch", () => {
  it("is false for empty or single-char query", () => {
    expect(helpHasActiveSearch("")).toBe(false);
    expect(helpHasActiveSearch("z")).toBe(false);
    expect(helpHasActiveSearch(" я ")).toBe(false);
  });

  it("is true from 2+ chars", () => {
    expect(helpHasActiveSearch("зап")).toBe(true);
    expect(helpHasActiveSearch("ab")).toBe(true);
  });
});

describe("getHelpSuggestions", () => {
  it("returns empty for short input", () => {
    expect(getHelpSuggestions("ru", "z", 10)).toEqual([]);
    expect(getHelpSuggestions("ru", "", 10)).toEqual([]);
  });

  it("matches Russian prefix зап to booking articles (запись)", () => {
    const s = getHelpSuggestions("ru", "зап", 20);
    const slugs = s.filter((x) => x.kind === "article").map((x) => x.slug);
    expect(slugs).toContain("new-booking-flow");
    expect(slugs).toContain("cancel-appointment");
  });

  it("matches English book prefix", () => {
    const s = getHelpSuggestions("en", "book", 20);
    const slugs = s.filter((x) => x.kind === "article").map((x) => x.slug);
    expect(slugs.some((slug) => slug.includes("booking") || slug === "new-booking-flow")).toBe(true);
  });
});

describe("filterScoreArticle", () => {
  it("returns 1 when search inactive (browse all)", () => {
    const a = HELP_ARTICLES[0]!;
    expect(filterScoreArticle(a, "ru", "")).toBe(1);
    expect(filterScoreArticle(a, "ru", "x")).toBe(1);
  });

  it("matches substring for active search", () => {
    const booking = HELP_ARTICLES.find((x) => x.slug === "new-booking-flow")!;
    expect(filterScoreArticle(booking, "ru", "зап")).toBeGreaterThan(0);
  });
});
