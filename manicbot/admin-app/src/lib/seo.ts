/**
 * Shared SEO helpers for the public-facing Next.js pages.
 *
 * Keep this file in sync with manicbot/src/utils/seo.js (Worker sitemap/robots).
 */

import type { Metadata } from "next";

export const SITE_URL = "https://manicbot.com";
export const SITE_NAME = "ManicBot";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;
export const DEFAULT_OG_LOCALE = "ru_RU";

const LANG_TO_OG_LOCALE: Record<string, string> = {
  en: "en_US",
  pl: "pl_PL",
  ua: "uk_UA",
  uk: "uk_UA",
  ru: "ru_RU",
};

/**
 * Map a `?lang=` query-param value to an Open Graph locale code.
 * Accepts the array shape Next.js exposes via `searchParams` (uses first entry).
 * Unknown / missing values fall back to ru_RU (legacy default).
 */
export function langToOgLocale(
  lang: string | string[] | null | undefined,
): string {
  const raw = Array.isArray(lang) ? lang[0] : lang;
  if (!raw) return DEFAULT_OG_LOCALE;
  const key = String(raw).toLowerCase();
  return LANG_TO_OG_LOCALE[key] ?? DEFAULT_OG_LOCALE;
}

/** Supported UI locales for hreflang alternates. */
export const SUPPORTED_LANGS = ["ru", "ua", "en", "pl"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

/**
 * Map our internal lang code to a BCP 47 hreflang code.
 * `ua` is the local UI code but `uk` is the correct hreflang for Ukrainian.
 */
export const HREFLANG_MAP: Record<Lang, string> = {
  ru: "ru",
  ua: "uk",
  en: "en",
  pl: "pl",
};

/**
 * Build per-language hreflang alternates for a given path.
 *
 * The landing is served with a `?lang=` query param; admin-app pages don't
 * currently switch language via route, so we emit query-param hrefs to stay
 * consistent. `x-default` points at the English variant (not Russian) so
 * users in unmapped locales don't get sent to RU by mistake.
 */
export function buildLanguageAlternates(path: string): Record<string, string> {
  const base = canonicalUrl(path);
  const out: Record<string, string> = {};
  for (const lang of SUPPORTED_LANGS) {
    out[HREFLANG_MAP[lang]] = `${base}?lang=${lang}`;
  }
  out["x-default"] = `${base}?lang=en`;
  return out;
}

/** Canonical URL for a given pathname (no trailing slash unless root). */
export function canonicalUrl(pathname: string): string {
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (p === "/") return SITE_URL;
  return `${SITE_URL}${p.replace(/\/$/, "")}`;
}

export interface PageSeoInput {
  title: string;
  description: string;
  path: string;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
  keywords?: string[];
  noIndex?: boolean;
  /** Open Graph locale code (e.g. "en_US"). Defaults to ru_RU. Use langToOgLocale() to derive from a lang code. */
  locale?: string;
}

/**
 * Normalise third-party image URLs so the served file matches our declared
 * 1200×630 OG dimensions. Pexels URLs ship with `?w=400&h=...` from the API,
 * which loses the social-card preview entirely. Rewriting the query keeps the
 * URL stable and produces a properly sized image.
 *
 * No-op for URLs we don't recognise — better to ship a smaller image than to
 * lie about dimensions; consumers detecting size mismatch downgrade more
 * gracefully than ones detecting a 404 from an over-eager rewrite.
 */
export function normaliseOgImage(src: string): string {
  if (!src) return src;
  try {
    const u = new URL(src);
    if (/(^|\.)pexels\.com$/.test(u.hostname)) {
      u.searchParams.set("auto", "compress");
      u.searchParams.set("cs", "tinysrgb");
      u.searchParams.set("fit", "crop");
      u.searchParams.set("w", "1200");
      u.searchParams.set("h", "630");
      return u.toString();
    }
    if (/(^|\.)unsplash\.com$/.test(u.hostname)) {
      u.searchParams.set("w", "1200");
      u.searchParams.set("h", "630");
      u.searchParams.set("fit", "crop");
      return u.toString();
    }
    return src;
  } catch {
    return src;
  }
}

/** Build a full Next.js Metadata object with OG + Twitter + canonical. */
export function buildSeo(input: PageSeoInput & { ogLocale?: string }): Metadata {
  const url = canonicalUrl(input.path);
  const image = normaliseOgImage(input.image ?? DEFAULT_OG_IMAGE);
  // P0-1 (relax.md §3): return the BARE title here. The root + (public)
  // layouts apply `title.template: "%s — ManicBot"` automatically — appending
  // the suffix again here produced "X — ManicBot — ManicBot" on every page.
  // Pages that want the literal site name as title can pass `title: SITE_NAME`
  // (template only fires for string titles, not absolute ones, but we keep
  // behaviour identical: just return SITE_NAME unsuffixed).
  const bareTitle = input.title;
  // For OG/Twitter we need the full title (no template applies to those).
  const fullTitle =
    input.title === SITE_NAME ? SITE_NAME : `${input.title} — ${SITE_NAME}`;

  return {
    title: bareTitle,
    description: input.description,
    keywords: input.keywords,
    alternates: {
      canonical: url,
      // P0-2 (relax.md §3): emit per-language hreflang alternates so Google
      // doesn't collapse all locales into the Russian variant.
      languages: buildLanguageAlternates(input.path),
    },
    robots: input.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    openGraph: {
      type: input.type ?? "website",
      url,
      siteName: SITE_NAME,
      title: fullTitle,
      description: input.description,
      locale: input.locale ?? input.ogLocale ?? DEFAULT_OG_LOCALE,
      images: [{ url: image, width: 1200, height: 630, alt: input.imageAlt ?? input.title }],
      ...(input.type === "article" && input.publishedTime
        ? { publishedTime: input.publishedTime }
        : {}),
      ...(input.type === "article" && input.modifiedTime
        ? { modifiedTime: input.modifiedTime }
        : {}),
      ...(input.authors ? { authors: input.authors } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: input.description,
      images: [image],
    },
  };
}

/** Build an Organization JSON-LD payload for the site root. */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/manicbot-mark-ui.png`,
    sameAs: [
      "https://t.me/manicbot_com",
    ],
  };
}

/** Build a WebSite JSON-LD payload with SearchAction (enables sitelinks search). */
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?query={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/** Build a BreadcrumbList JSON-LD payload. */
export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  };
}

interface SalonService {
  name: string;
  price?: number | null;
  duration?: number | null;
}

interface LocalBusinessInput {
  name: string;
  slug: string;
  description?: string | null;
  image?: string | null;
  images?: string[] | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: { avg: number; count: number } | null;
  /** Map of weekday -> "HH:MM-HH:MM" or { from, to }; we serialise to schema.org `openingHoursSpecification`. */
  workHours?: unknown;
  services?: SalonService[] | null;
  /** Social profile URLs (Instagram, Facebook, etc.) — emitted as `sameAs`. */
  sameAs?: string[] | null;
  currency?: string | null;
  countryCode?: string | null;
}

const DAY_TO_SCHEMA: Record<string, string> = {
  mon: "Monday", monday: "Monday", "1": "Monday",
  tue: "Tuesday", tuesday: "Tuesday", "2": "Tuesday",
  wed: "Wednesday", wednesday: "Wednesday", "3": "Wednesday",
  thu: "Thursday", thursday: "Thursday", "4": "Thursday",
  fri: "Friday", friday: "Friday", "5": "Friday",
  sat: "Saturday", saturday: "Saturday", "6": "Saturday",
  sun: "Sunday", sunday: "Sunday", "0": "Sunday", "7": "Sunday",
};

/**
 * Normalise an opaque workHours blob into schema.org OpeningHoursSpecification[].
 * Accepts shapes like:
 *   { mon: "09:00-18:00", tue: "09:00-18:00" }
 *   { mon: { from: "09:00", to: "18:00" } }
 *   { monday: { open: "09:00", close: "18:00" } }
 * Returns [] when the input is missing or unrecognised.
 */
export function workHoursToOpeningHoursSpec(raw: unknown): Array<Record<string, string>> {
  if (!raw || typeof raw !== "object") return [];
  const out: Array<Record<string, string>> = [];
  for (const [day, value] of Object.entries(raw as Record<string, unknown>)) {
    const dayOfWeek = DAY_TO_SCHEMA[day.toLowerCase()];
    if (!dayOfWeek) continue;
    let opens: string | undefined;
    let closes: string | undefined;
    if (typeof value === "string") {
      const match = value.match(/^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/);
      if (match) { opens = match[1]; closes = match[2]; }
    } else if (value && typeof value === "object") {
      const v = value as Record<string, unknown>;
      const from = (v.from ?? v.open ?? v.start) as string | undefined;
      const to = (v.to ?? v.close ?? v.end) as string | undefined;
      if (typeof from === "string" && typeof to === "string") { opens = from; closes = to; }
    }
    if (opens && closes) {
      out.push({ "@type": "OpeningHoursSpecification", dayOfWeek, opens, closes });
    }
  }
  return out;
}

/**
 * Map a city name to an `og:locale`. Falls back to `ru_RU` because the bulk
 * of our content + descriptions are still Russian. Cities are matched by
 * lower-case substring so "Warszawa", "warsaw", "Kraków" all resolve to PL.
 */
const CITY_LOCALE_MAP: Array<[RegExp, string]> = [
  [/warsz|warsaw|krak[oó]w|gda[nń]sk|wroc[lł]aw|pozna[nń]|[lł]od[zź]|szczecin|katowice|lublin|poland|polska|pl-pl/i, "pl_PL"],
  [/ki[ey]v|kyiv|kharkiv|odes|lviv|dnipr|ukraine|україна/i, "uk_UA"],
  [/london|manchester|edinburgh|dublin|new york|los angeles|toronto|usa|uk |united kingdom|united states/i, "en_US"],
];

export function ogLocaleForCity(city?: string | null): string {
  if (!city) return "ru_RU";
  for (const [re, locale] of CITY_LOCALE_MAP) {
    if (re.test(city)) return locale;
  }
  return "ru_RU";
}

/** Build a LocalBusiness / BeautySalon JSON-LD payload for a salon profile. */
export function beautySalonJsonLd(input: LocalBusinessInput) {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BeautySalon",
    name: input.name,
    url: canonicalUrl(`/salon/${input.slug}`),
  };
  if (input.description) node.description = input.description;
  // Prefer the multi-image array; fall back to single image; keep schema.org-friendly types.
  const allImages = (input.images && input.images.length > 0 ? input.images : (input.image ? [input.image] : [])).filter(Boolean);
  if (allImages.length === 1) node.image = allImages[0];
  else if (allImages.length > 1) node.image = allImages;
  if (input.phone) node.telephone = input.phone;
  if (input.city || input.address) {
    node.address = {
      "@type": "PostalAddress",
      ...(input.address ? { streetAddress: input.address } : {}),
      ...(input.city ? { addressLocality: input.city } : {}),
      ...(input.countryCode ? { addressCountry: input.countryCode } : {}),
    };
  }
  if (typeof input.lat === "number" && typeof input.lng === "number") {
    node.geo = { "@type": "GeoCoordinates", latitude: input.lat, longitude: input.lng };
  }
  if (input.rating && input.rating.count > 0) {
    node.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: input.rating.avg,
      reviewCount: input.rating.count,
      bestRating: 5,
      worstRating: 1,
    };
  }
  const hours = workHoursToOpeningHoursSpec(input.workHours);
  if (hours.length > 0) node.openingHoursSpecification = hours;
  if (input.services && input.services.length > 0) {
    const prices = input.services
      .map((s) => (typeof s.price === "number" ? s.price : null))
      .filter((p): p is number => p != null && p > 0);
    if (prices.length > 0) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      // `priceRange` is a free-form display string; "$$" / numeric range both legal.
      node.priceRange = min === max ? `${min}` : `${min}-${max}`;
    }
    node.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: "Services",
      itemListElement: input.services.slice(0, 30).map((s) => ({
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: s.name },
        ...(typeof s.price === "number" && s.price > 0
          ? { price: s.price, priceCurrency: input.currency ?? "PLN" }
          : {}),
      })),
    };
    node.currenciesAccepted = input.currency ?? "PLN";
  }
  if (input.sameAs && input.sameAs.length > 0) {
    node.sameAs = input.sameAs.filter(Boolean);
  }
  return node;
}

interface ArticleJsonLdInput {
  title: string;
  description: string;
  slug: string;
  datePublished: string;
  image?: string;
  authors?: string[];
}

/** Build an Article JSON-LD payload for a blog post. */
export function articleJsonLd(input: ArticleJsonLdInput) {
  const url = canonicalUrl(`/blog/${input.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    image: input.image ?? DEFAULT_OG_IMAGE,
    datePublished: input.datePublished,
    dateModified: input.datePublished,
    author: (input.authors && input.authors.length > 0
      ? input.authors.map((name) => ({ "@type": "Person", name }))
      : [{ "@type": "Organization", name: SITE_NAME }]),
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/manicbot-mark-ui.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
  };
}

/** Serialize a JSON-LD object for injection into a <script type="application/ld+json"> tag. */
export function jsonLdScript(data: unknown): string {
  // Escape closing script tags to prevent HTML injection.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
