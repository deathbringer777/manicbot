/**
 * dtoToArticle — DB DTO → legacy static `BlogArticle` shape, used by the
 * public `/blog` + `/blog/[slug]` pages. Renderers expect `Record<Lang, string>`
 * with no missing keys; this helper guarantees that contract using the
 * `coalesceLang` fallback chain.
 */
import { describe, it, expect } from "vitest";
import { dtoToArticle } from "~/server/blog/dtoToArticle";
import type { BlogPostDto } from "~/server/blog/serialize";

const fullDto: BlogPostDto = {
  id: "bp_1",
  slug: "hello",
  status: "published",
  category: "tips",
  coverImage: { url: "https://cdn/c.jpg", alt: { ru: "Обложка", en: "Cover" }, credit: "Unsplash" },
  titles: { ru: "Привет", en: "Hello" },
  excerpts: { ru: "Лид", en: "Lede" },
  bodies: { ru: "Тело", en: "Body" },
  keywords: { ru: ["авто"], en: ["auto"] },
  relatedSlugs: ["other-post"],
  publishedDate: "2026-05-21",
  updatedDate: null,
  createdAt: 1700000000,
  updatedAt: 1700000100,
  publishedAt: 1700000200,
  archivedAt: null,
  createdByWebUserId: null,
  updatedByWebUserId: null,
};

describe("dtoToArticle", () => {
  it("returns all 4 languages, backfilling missing ones via the fallback chain", () => {
    const article = dtoToArticle(fullDto);
    expect(article.titles.ru).toBe("Привет");
    expect(article.titles.en).toBe("Hello");
    // ua + pl missing in DTO → fall back to en first, then ru.
    expect(article.titles.ua).toBe("Hello");
    expect(article.titles.pl).toBe("Hello");
  });

  it("preserves slug, date, category, relatedSlugs", () => {
    const article = dtoToArticle(fullDto);
    expect(article.slug).toBe("hello");
    expect(article.date).toBe("2026-05-21");
    expect(article.categoryKey).toBe("tips");
    expect(article.relatedSlugs).toEqual(["other-post"]);
  });

  it("maps cover image including alt + credit", () => {
    const article = dtoToArticle(fullDto);
    expect(article.coverImage.url).toBe("https://cdn/c.jpg");
    expect(article.coverImage.alt.ru).toBe("Обложка");
    expect(article.coverImage.alt.en).toBe("Cover");
    expect(article.coverImage.alt.ua).toBe("Cover"); // fallback
    expect(article.coverImage.credit).toBe("Unsplash");
  });

  it("returns undefined keywords when DTO has no keywords", () => {
    const article = dtoToArticle({ ...fullDto, keywords: {} });
    expect(article.keywords).toBeUndefined();
  });

  it("returns undefined relatedSlugs when DTO has no related", () => {
    const article = dtoToArticle({ ...fullDto, relatedSlugs: [] });
    expect(article.relatedSlugs).toBeUndefined();
  });

  it("derives date from createdAt when publishedDate is null", () => {
    const article = dtoToArticle({ ...fullDto, publishedDate: null });
    expect(article.date).toBe(new Date(1700000000 * 1000).toISOString().slice(0, 10));
  });

  it("handles empty cover URL gracefully", () => {
    const article = dtoToArticle({ ...fullDto, coverImage: null });
    expect(article.coverImage.url).toBe("");
    expect(article.coverImage.alt.ru).toBe("");
  });
});
