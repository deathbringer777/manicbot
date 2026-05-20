/**
 * Pure helpers for the blog CMS router.
 *   - slugify: title → URL-safe slug (Cyrillic transliteration)
 *   - coalesceLang: pick a language with fallback (lang → en → ru → first non-empty)
 *   - parseBlogRow: D1 row → public BlogPostDto (decodes JSON blobs)
 *   - serializeBlogInput: tRPC mutation input → D1 column values (encodes JSON)
 *   - validateSlug: lowercase ASCII + digits + hyphens, 1..100 chars
 *
 * Why pin these as pure: they are the boundary between the JSON-blob storage
 * model and the typed DTO the renderers consume. If `coalesceLang` regresses,
 * a post written in ru-only will render empty in pl. If `parseBlogRow` regresses,
 * the public page crashes on Edge runtime. Tests stay synchronous + dep-free.
 */
import { describe, it, expect } from "vitest";
import {
  slugify,
  coalesceLang,
  parseBlogRow,
  serializeBlogInput,
  validateSlug,
  type BlogPostRow,
} from "~/server/blog/serialize";

describe("slugify", () => {
  it("returns lowercase ASCII for plain English titles", () => {
    expect(slugify("How to Reduce No-Shows")).toBe("how-to-reduce-no-shows");
  });

  it("transliterates Cyrillic", () => {
    expect(slugify("Тренды маникюра 2026")).toBe("trendy-manikyura-2026");
  });

  it("transliterates Ukrainian-specific letters", () => {
    expect(slugify("Їжачок і вже")).toBe("yizhachok-i-vzhe");
  });

  it("transliterates Polish diacritics", () => {
    expect(slugify("Ząb żółć")).toBe("zab-zolc");
  });

  it("collapses repeated separators + trims hyphens", () => {
    expect(slugify("--Foo  Bar---Baz--")).toBe("foo-bar-baz");
  });

  it("returns empty string for empty / whitespace input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  it("clamps to 100 chars", () => {
    const long = "a".repeat(250);
    expect(slugify(long).length).toBe(100);
  });
});

describe("validateSlug", () => {
  it("accepts ASCII kebab-case", () => {
    expect(validateSlug("hello-world")).toBe(true);
    expect(validateSlug("post-2026")).toBe(true);
    expect(validateSlug("a")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(validateSlug("Hello")).toBe(false);
  });

  it("rejects spaces, dots, slashes", () => {
    expect(validateSlug("hello world")).toBe(false);
    expect(validateSlug("hello.world")).toBe(false);
    expect(validateSlug("hello/world")).toBe(false);
  });

  it("rejects Cyrillic (must be pre-transliterated)", () => {
    expect(validateSlug("привет")).toBe(false);
  });

  it("rejects empty + over-100-char", () => {
    expect(validateSlug("")).toBe(false);
    expect(validateSlug("a".repeat(101))).toBe(false);
  });

  it("rejects leading/trailing/double hyphens", () => {
    expect(validateSlug("-leading")).toBe(false);
    expect(validateSlug("trailing-")).toBe(false);
    expect(validateSlug("double--hyphen")).toBe(false);
  });
});

describe("coalesceLang", () => {
  it("returns the requested language when present and non-empty", () => {
    expect(coalesceLang({ ru: "RU", en: "EN" }, "ru")).toBe("RU");
    expect(coalesceLang({ ru: "RU", en: "EN" }, "en")).toBe("EN");
  });

  it("falls back to en when requested lang is empty / missing", () => {
    expect(coalesceLang({ ru: "RU", en: "EN" }, "pl")).toBe("EN");
    expect(coalesceLang({ pl: "", en: "EN" }, "pl")).toBe("EN");
  });

  it("falls back to ru when en is also missing", () => {
    expect(coalesceLang({ ru: "RU" }, "pl")).toBe("RU");
  });

  it("falls back to first non-empty value when ru + en are missing", () => {
    expect(coalesceLang({ ua: "UA only" }, "pl")).toBe("UA only");
  });

  it("returns empty string when blob is empty", () => {
    expect(coalesceLang({}, "ru")).toBe("");
  });

  it("ignores non-string values defensively", () => {
    // JSON blob may have been written with garbage from a bad client.
    // Function must not throw and must skip junk.
    expect(coalesceLang({ ru: 42 as never, en: "EN" }, "ru")).toBe("EN");
  });
});

describe("parseBlogRow", () => {
  const baseRow: BlogPostRow = {
    id: "bp_1",
    slug: "hello-world",
    status: "published",
    category: "tips",
    coverUrl: "https://cdn.example.com/cover.jpg",
    coverAltJson: JSON.stringify({ ru: "Обложка", en: "Cover" }),
    coverCredit: "Unsplash / Foo",
    titlesJson: JSON.stringify({ ru: "Привет", en: "Hello" }),
    excerptsJson: JSON.stringify({ ru: "Это лид", en: "This is the lede" }),
    bodiesJson: JSON.stringify({ ru: "Тело", en: "Body" }),
    keywordsJson: JSON.stringify({ ru: ["авто"], en: ["auto"] }),
    relatedSlugsJson: JSON.stringify(["other-post"]),
    publishedDate: "2026-05-21",
    updatedDate: null,
    createdAt: 1700000000,
    updatedAt: 1700000100,
    publishedAt: 1700000200,
    archivedAt: null,
    createdByWebUserId: "w_admin",
    updatedByWebUserId: "w_admin",
  };

  it("decodes JSON blobs into typed fields", () => {
    const dto = parseBlogRow(baseRow);
    expect(dto.id).toBe("bp_1");
    expect(dto.slug).toBe("hello-world");
    expect(dto.status).toBe("published");
    expect(dto.titles).toEqual({ ru: "Привет", en: "Hello" });
    expect(dto.bodies).toEqual({ ru: "Тело", en: "Body" });
    expect(dto.coverImage).toEqual({
      url: "https://cdn.example.com/cover.jpg",
      alt: { ru: "Обложка", en: "Cover" },
      credit: "Unsplash / Foo",
    });
    expect(dto.keywords).toEqual({ ru: ["авто"], en: ["auto"] });
    expect(dto.relatedSlugs).toEqual(["other-post"]);
  });

  it("returns coverImage=null when coverUrl is empty", () => {
    const dto = parseBlogRow({ ...baseRow, coverUrl: null });
    expect(dto.coverImage).toBeNull();
  });

  it("tolerates malformed JSON in blob columns (returns empty object)", () => {
    const dto = parseBlogRow({
      ...baseRow,
      titlesJson: "not-json!!",
      bodiesJson: null as unknown as string,
    });
    expect(dto.titles).toEqual({});
    expect(dto.bodies).toEqual({});
  });

  it("falls back when keywords/relatedSlugs are absent", () => {
    const dto = parseBlogRow({ ...baseRow, keywordsJson: null, relatedSlugsJson: null });
    expect(dto.keywords).toEqual({});
    expect(dto.relatedSlugs).toEqual([]);
  });
});

describe("serializeBlogInput", () => {
  it("stringifies lang blobs and keeps other columns intact", () => {
    const out = serializeBlogInput({
      slug: "hello",
      category: "tips",
      titles: { ru: "Привет", en: "Hello" },
      excerpts: { ru: "Лид" },
      bodies: { ru: "Тело" },
      coverUrl: "https://cdn.example.com/c.jpg",
      coverAlt: { ru: "Обложка" },
      coverCredit: "Unsplash",
      keywords: { ru: ["k1"] },
      relatedSlugs: ["other"],
      publishedDate: "2026-05-21",
      updatedDate: null,
    });
    expect(out.slug).toBe("hello");
    expect(out.category).toBe("tips");
    expect(JSON.parse(out.titlesJson)).toEqual({ ru: "Привет", en: "Hello" });
    expect(JSON.parse(out.bodiesJson)).toEqual({ ru: "Тело" });
    expect(out.coverUrl).toBe("https://cdn.example.com/c.jpg");
    expect(JSON.parse(out.coverAltJson!)).toEqual({ ru: "Обложка" });
    expect(out.coverCredit).toBe("Unsplash");
    expect(JSON.parse(out.keywordsJson!)).toEqual({ ru: ["k1"] });
    expect(JSON.parse(out.relatedSlugsJson!)).toEqual(["other"]);
    expect(out.publishedDate).toBe("2026-05-21");
    expect(out.updatedDate).toBeNull();
  });

  it("defaults missing optional blobs to '{}'", () => {
    const out = serializeBlogInput({
      slug: "x",
      category: "tips",
      titles: { ru: "Y" },
    });
    expect(out.excerptsJson).toBe("{}");
    expect(out.bodiesJson).toBe("{}");
    expect(out.coverAltJson).toBeNull();
    expect(out.keywordsJson).toBeNull();
    expect(out.relatedSlugsJson).toBeNull();
  });

  it("strips unknown lang keys from blobs (defense-in-depth)", () => {
    const out = serializeBlogInput({
      slug: "x",
      category: "tips",
      // @ts-expect-error — testing runtime guard on bad input
      titles: { ru: "ok", zh: "should-be-stripped", "<script>": "bad" },
    });
    const titles = JSON.parse(out.titlesJson);
    expect(Object.keys(titles).sort()).toEqual(["ru"]);
  });
});
