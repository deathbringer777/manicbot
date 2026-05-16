import type { Lang } from "~/lib/i18n";

export type BlogCategory = "tips" | "product" | "business" | "trends";

export interface BlogCoverImage {
  /** Full URL to a 1600×900-ish hero image. Pexels / Unsplash normalized by lib/seo.ts. */
  url: string;
  /** Localized alt text — important for SEO image search. */
  alt: Record<Lang, string>;
  /** Optional photographer/source attribution shown in small print. */
  credit?: string;
}

export interface BlogArticle {
  slug: string;
  /** YYYY-MM-DD. Drives sort order, breadcrumbs, and Article schema. */
  date: string;
  /** Optional — set when content was significantly rewritten after publish. */
  updated?: string;
  categoryKey: BlogCategory;
  coverImage: BlogCoverImage;
  titles: Record<Lang, string>;
  excerpts: Record<Lang, string>;
  bodies: Record<Lang, string>;
  /** Per-language SEO keywords. Falls back to category keywords when absent. */
  keywords?: Record<Lang, string[]>;
  /** Slugs of articles to surface as "Related". When omitted we derive by category. */
  relatedSlugs?: string[];
}

export const BLOG_CATEGORY_LABELS: Record<BlogCategory, Record<Lang, string>> = {
  tips: { ru: "Советы", ua: "Поради", en: "Tips", pl: "Porady" },
  product: { ru: "Продукт", ua: "Продукт", en: "Product", pl: "Produkt" },
  business: { ru: "Бизнес", ua: "Бізнес", en: "Business", pl: "Biznes" },
  trends: { ru: "Тренды", ua: "Тренди", en: "Trends", pl: "Trendy" },
};

export const BLOG_CATEGORY_ORDER: BlogCategory[] = ["tips", "product", "business", "trends"];

/** Category-level fallback keywords; merged with per-article ones. */
export const CATEGORY_KEYWORDS: Record<BlogCategory, Record<Lang, string[]>> = {
  tips: {
    ru: ["советы салону", "автоматизация маникюра", "онлайн-запись"],
    ua: ["поради салону", "автоматизація манікюру", "онлайн-запис"],
    en: ["nail salon tips", "salon automation", "online booking"],
    pl: ["porady dla salonu", "automatyzacja manicure", "rezerwacja online"],
  },
  product: {
    ru: ["ManicBot", "Telegram бот для записи", "омниканальный inbox"],
    ua: ["ManicBot", "Telegram бот для запису", "омніканальний inbox"],
    en: ["ManicBot", "Telegram booking bot", "omnichannel inbox"],
    pl: ["ManicBot", "bot Telegram do rezerwacji", "omnichannel inbox"],
  },
  business: {
    ru: ["unit-экономика салона", "удержание клиентов", "no-show в салоне"],
    ua: ["unit-економіка салону", "утримання клієнтів", "no-show у салоні"],
    en: ["salon unit economics", "client retention", "salon no-shows"],
    pl: ["ekonomia salonu", "retencja klientów", "nieobecności w salonie"],
  },
  trends: {
    ru: ["тренды маникюра 2026", "AI в салоне красоты", "цифровизация бьюти"],
    ua: ["тренди манікюру 2026", "AI у салоні краси", "цифровізація б'юті"],
    en: ["nail trends 2026", "AI in beauty salons", "beauty digitalization"],
    pl: ["trendy paznokci 2026", "AI w salonie urody", "cyfryzacja beauty"],
  },
};

/** Pick related slugs — explicit relatedSlugs win; otherwise same category, recent first. */
export function pickRelated(
  current: BlogArticle,
  all: BlogArticle[],
  limit = 3,
): BlogArticle[] {
  if (current.relatedSlugs?.length) {
    return current.relatedSlugs
      .map((s) => all.find((a) => a.slug === s))
      .filter((a): a is BlogArticle => Boolean(a))
      .slice(0, limit);
  }
  const sameCategory = all
    .filter((a) => a.slug !== current.slug && a.categoryKey === current.categoryKey)
    .sort((a, b) => b.date.localeCompare(a.date));
  const fillers = all
    .filter((a) => a.slug !== current.slug && a.categoryKey !== current.categoryKey)
    .sort((a, b) => b.date.localeCompare(a.date));
  return [...sameCategory, ...fillers].slice(0, limit);
}
