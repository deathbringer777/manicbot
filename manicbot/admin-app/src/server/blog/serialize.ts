/**
 * Pure serialization helpers for the blog CMS router.
 *
 * Storage shape (D1 `blog_posts`):
 *   - titles/excerpts/bodies/cover_alt/keywords are TEXT columns holding JSON
 *     blobs keyed by `Lang` so a single row serves all 4 languages.
 *
 * This module is the boundary between the JSON-blob storage and the typed
 * `BlogPostDto` consumed by the renderers. Keeping it dependency-free + pure
 * means we can pin it with synchronous unit tests (`blog-serialize.test.ts`).
 *
 * No DB imports here. No tRPC imports. No env reads. If you find yourself
 * reaching for any of those, move that code to the router.
 */
import type { Lang } from "~/lib/i18n";
import type { BlogCategory } from "~/content/blog/types";

// ─── Lang allowlist (defense-in-depth — strip unexpected keys) ────────────

export const SUPPORTED_LANGS: ReadonlyArray<Lang> = ["ru", "ua", "en", "pl"];
const LANG_SET = new Set<string>(SUPPORTED_LANGS);

// ─── Slug helpers ─────────────────────────────────────────────────────────

// Cyrillic → Latin transliteration table. Covers Russian + Ukrainian (Її Єє
// Іі Ґґ are UA-only) so the same function handles both content sources.
const CYRILLIC_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "yo",
  є: "ye", ж: "zh", з: "z", и: "i", і: "i", ї: "yi", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

// Latin diacritics → ASCII (Polish, generic European). NFKD strips combining
// marks but leaves precomposed ł/đ/ø unchanged — handle those explicitly.
const DIACRITIC_OVERRIDES: Record<string, string> = {
  ł: "l", đ: "d", ø: "o", æ: "ae", œ: "oe", ß: "ss", þ: "th", ð: "d",
};

/**
 * Title → URL-safe kebab-case slug. Result is always lowercase, ASCII-only,
 * with single hyphens between segments, no leading/trailing hyphens, and
 * clamped to 100 chars (matches the DB CHECK convention we keep across the
 * codebase for human-readable slugs).
 *
 * Returns "" for empty / whitespace-only input — the caller is responsible
 * for either falling back to a server-generated id or rejecting.
 */
export function slugify(input: string): string {
  if (typeof input !== "string") return "";
  const lowered = input.toLowerCase();

  // Transliterate Cyrillic char-by-char first (faster than a regex per char).
  let translit = "";
  for (const ch of lowered) {
    if (Object.prototype.hasOwnProperty.call(CYRILLIC_MAP, ch)) {
      translit += CYRILLIC_MAP[ch];
    } else if (Object.prototype.hasOwnProperty.call(DIACRITIC_OVERRIDES, ch)) {
      translit += DIACRITIC_OVERRIDES[ch];
    } else {
      translit += ch;
    }
  }

  // NFKD-normalize and drop combining marks (handles Polish ą ć ę ń ó ś ż ź,
  // German ä ö ü, French é etc. that survived the override pass).
  const ascii = translit.normalize("NFKD").replace(/[̀-ͯ]/g, "");

  // Replace anything not [a-z0-9] with hyphens, collapse runs, trim.
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, ""); // re-trim after slice in case it cut mid-run
  return slug;
}

/** Strict validation — must be the canonical kebab-case slug shape. */
export function validateSlug(s: unknown): boolean {
  if (typeof s !== "string") return false;
  if (s.length < 1 || s.length > 100) return false;
  // ^[a-z0-9]+(-[a-z0-9]+)*$ — lowercase alnum segments joined by single hyphens.
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

// ─── Lang-blob helpers ────────────────────────────────────────────────────

export type LangBlob = Partial<Record<Lang, string>>;
export type LangArrayBlob = Partial<Record<Lang, string[]>>;

/**
 * Pick the value for `lang` with a documented fallback chain:
 *   lang → en → ru → first non-empty value → ""
 *
 * The chain is geared for a Russian-first product with English as the
 * "global" backup. Non-string values in the blob are skipped defensively
 * so a malformed write doesn't crash the public renderer.
 */
export function coalesceLang(blob: unknown, lang: Lang): string {
  if (!blob || typeof blob !== "object") return "";
  const b = blob as Record<string, unknown>;
  const tryKey = (k: string): string | null => {
    const v = b[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  const direct = tryKey(lang);
  if (direct) return direct;
  const en = tryKey("en");
  if (en) return en;
  const ru = tryKey("ru");
  if (ru) return ru;
  for (const v of Object.values(b)) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

/** Strip non-supported language keys from a write input. Defense in depth. */
function pruneLangBlob<T>(blob: unknown): Partial<Record<Lang, T>> {
  if (!blob || typeof blob !== "object") return {};
  const out: Partial<Record<Lang, T>> = {};
  for (const [k, v] of Object.entries(blob as Record<string, unknown>)) {
    if (LANG_SET.has(k)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ─── DB row ↔ DTO ─────────────────────────────────────────────────────────

export interface BlogPostRow {
  id: string;
  slug: string;
  status: string;
  category: string;
  coverUrl: string | null;
  coverAltJson: string | null;
  coverCredit: string | null;
  titlesJson: string;
  excerptsJson: string;
  bodiesJson: string;
  keywordsJson: string | null;
  relatedSlugsJson: string | null;
  publishedDate: string | null;
  updatedDate: string | null;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  archivedAt: number | null;
  createdByWebUserId: string | null;
  updatedByWebUserId: string | null;
}

export type BlogStatus = "draft" | "published" | "archived";

export interface BlogPostDto {
  id: string;
  slug: string;
  status: BlogStatus;
  category: BlogCategory;
  coverImage: { url: string; alt: LangBlob; credit?: string | null } | null;
  titles: LangBlob;
  excerpts: LangBlob;
  bodies: LangBlob;
  keywords: LangArrayBlob;
  relatedSlugs: string[];
  publishedDate: string | null;
  updatedDate: string | null;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
  archivedAt: number | null;
  createdByWebUserId: string | null;
  updatedByWebUserId: string | null;
}

function safeParseJson<T>(s: string | null | undefined, fallback: T): T {
  if (s == null || s === "") return fallback;
  try {
    const parsed = JSON.parse(s);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** D1 row → public DTO. Tolerant: malformed JSON degrades to `{}` / `[]`. */
export function parseBlogRow(row: BlogPostRow): BlogPostDto {
  const titles = pruneLangBlob<string>(safeParseJson(row.titlesJson, {}));
  const excerpts = pruneLangBlob<string>(safeParseJson(row.excerptsJson, {}));
  const bodies = pruneLangBlob<string>(safeParseJson(row.bodiesJson, {}));
  const keywords = pruneLangBlob<string[]>(safeParseJson(row.keywordsJson, {}));
  const relatedSlugs = safeParseJson<string[]>(row.relatedSlugsJson, []);
  const altBlob = pruneLangBlob<string>(safeParseJson(row.coverAltJson, {}));

  const coverImage = row.coverUrl
    ? { url: row.coverUrl, alt: altBlob, credit: row.coverCredit }
    : null;

  return {
    id: row.id,
    slug: row.slug,
    status: (row.status === "published" || row.status === "archived" ? row.status : "draft") as BlogStatus,
    category: ((["tips", "product", "business", "trends"] as const).includes(row.category as BlogCategory)
      ? row.category
      : "tips") as BlogCategory,
    coverImage,
    titles,
    excerpts,
    bodies,
    keywords,
    relatedSlugs: Array.isArray(relatedSlugs) ? relatedSlugs.filter((s) => typeof s === "string") : [],
    publishedDate: row.publishedDate,
    updatedDate: row.updatedDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdByWebUserId: row.createdByWebUserId,
    updatedByWebUserId: row.updatedByWebUserId,
  };
}

// ─── Write-side input → DB column values ──────────────────────────────────

export interface BlogPostInput {
  slug: string;
  category: BlogCategory;
  titles: LangBlob;
  excerpts?: LangBlob;
  bodies?: LangBlob;
  coverUrl?: string | null;
  coverAlt?: LangBlob;
  coverCredit?: string | null;
  keywords?: LangArrayBlob;
  relatedSlugs?: string[];
  publishedDate?: string | null;
  updatedDate?: string | null;
}

export interface BlogPostColumnValues {
  slug: string;
  category: BlogCategory;
  coverUrl: string | null;
  coverAltJson: string | null;
  coverCredit: string | null;
  titlesJson: string;
  excerptsJson: string;
  bodiesJson: string;
  keywordsJson: string | null;
  relatedSlugsJson: string | null;
  publishedDate: string | null;
  updatedDate: string | null;
}

/**
 * Convert a tRPC mutation input into the column values the router INSERTs/UPDATEs.
 * Non-blob fields pass through; lang blobs are pruned + JSON-stringified.
 * Optional blob fields collapse to "{}" so the DB row never holds NULL for
 * a required JSON column.
 */
export function serializeBlogInput(input: BlogPostInput): BlogPostColumnValues {
  const titles = pruneLangBlob<string>(input.titles);
  const excerpts = pruneLangBlob<string>(input.excerpts ?? {});
  const bodies = pruneLangBlob<string>(input.bodies ?? {});

  // Optional blobs: keep null when absent so we can distinguish "never set"
  // from "set to empty" if a future migration needs it.
  const coverAlt = input.coverAlt !== undefined ? pruneLangBlob<string>(input.coverAlt) : null;
  const keywords = input.keywords !== undefined ? pruneLangBlob<string[]>(input.keywords) : null;
  const relatedSlugs =
    input.relatedSlugs !== undefined ? input.relatedSlugs.filter((s) => typeof s === "string") : null;

  return {
    slug: input.slug,
    category: input.category,
    coverUrl: input.coverUrl ?? null,
    coverAltJson: coverAlt ? JSON.stringify(coverAlt) : null,
    coverCredit: input.coverCredit ?? null,
    titlesJson: JSON.stringify(titles),
    excerptsJson: JSON.stringify(excerpts),
    bodiesJson: JSON.stringify(bodies),
    keywordsJson: keywords ? JSON.stringify(keywords) : null,
    relatedSlugsJson: relatedSlugs ? JSON.stringify(relatedSlugs) : null,
    publishedDate: input.publishedDate ?? null,
    updatedDate: input.updatedDate ?? null,
  };
}
