/**
 * Shared SEO helpers for the public-facing Next.js pages.
 *
 * Keep this file in sync with manicbot/src/utils/seo.js (Worker sitemap/robots).
 */

import type { Metadata } from "next";

export const SITE_URL = "https://manicbot.com";
export const SITE_NAME = "ManicBot";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

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
}

/** Build a full Next.js Metadata object with OG + Twitter + canonical. */
export function buildSeo(input: PageSeoInput): Metadata {
  const url = canonicalUrl(input.path);
  const image = input.image ?? DEFAULT_OG_IMAGE;
  const fullTitle =
    input.title === SITE_NAME ? SITE_NAME : `${input.title} — ${SITE_NAME}`;

  return {
    title: fullTitle,
    description: input.description,
    keywords: input.keywords,
    alternates: { canonical: url },
    robots: input.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    openGraph: {
      type: input.type ?? "website",
      url,
      siteName: SITE_NAME,
      title: fullTitle,
      description: input.description,
      locale: "ru_RU",
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

interface LocalBusinessInput {
  name: string;
  slug: string;
  description?: string | null;
  image?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  lat?: number | null;
  lng?: number | null;
  rating?: { avg: number; count: number } | null;
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
  if (input.image) node.image = input.image;
  if (input.phone) node.telephone = input.phone;
  if (input.city || input.address) {
    node.address = {
      "@type": "PostalAddress",
      ...(input.address ? { streetAddress: input.address } : {}),
      ...(input.city ? { addressLocality: input.city } : {}),
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
