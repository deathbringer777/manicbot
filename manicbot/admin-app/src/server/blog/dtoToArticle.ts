/**
 * Map the DB-backed `BlogPostDto` onto the existing static `BlogArticle`
 * shape so the public `BlogClient` / `ArticleClient` renderers stay unchanged.
 *
 * The static shape requires `Record<Lang, string>` (no Partial) for titles /
 * excerpts / bodies / cover alt. The DTO is `Partial<Record<Lang, string>>`.
 * We backfill missing langs with the documented fallback chain:
 *   requested → en → ru → first non-empty → ""
 */
import type { Lang } from "~/lib/i18n";
import type { BlogArticle, BlogCategory } from "~/content/blog/types";
import { coalesceLang, type BlogPostDto } from "./serialize";

const LANGS: ReadonlyArray<Lang> = ["ru", "ua", "en", "pl"];

function fillLangs(blob: Partial<Record<Lang, string>>): Record<Lang, string> {
  const out = {} as Record<Lang, string>;
  for (const l of LANGS) out[l] = coalesceLang(blob, l);
  return out;
}

/** Convert one DTO to the legacy `BlogArticle` shape. */
export function dtoToArticle(dto: BlogPostDto): BlogArticle {
  const keywords =
    dto.keywords && Object.keys(dto.keywords).length > 0
      ? ({
          ru: dto.keywords.ru ?? [],
          ua: dto.keywords.ua ?? [],
          en: dto.keywords.en ?? [],
          pl: dto.keywords.pl ?? [],
        } as Record<Lang, string[]>)
      : undefined;
  return {
    slug: dto.slug,
    date: dto.publishedDate ?? new Date(dto.createdAt * 1000).toISOString().slice(0, 10),
    updated: dto.updatedDate ?? undefined,
    categoryKey: (dto.category ?? "tips") as BlogCategory,
    coverImage: {
      url: dto.coverImage?.url ?? "",
      alt: fillLangs(dto.coverImage?.alt ?? {}),
      credit: dto.coverImage?.credit ?? undefined,
    },
    titles: fillLangs(dto.titles),
    excerpts: fillLangs(dto.excerpts),
    bodies: fillLangs(dto.bodies),
    keywords,
    relatedSlugs: dto.relatedSlugs.length > 0 ? dto.relatedSlugs : undefined,
  };
}
