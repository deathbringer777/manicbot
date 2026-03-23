import { useEffect } from "react";
import { localeOrder, type Locale, useLanguage } from "@/i18n";

const SITE_ORIGIN = "https://manicbot.com";
const OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;

const htmlLang: Record<Locale, string> = {
  en: "en",
  ru: "ru",
  ua: "uk",
  pl: "pl",
};

const ogLocale: Record<Locale, string> = {
  en: "en_US",
  ru: "ru_RU",
  ua: "uk_UA",
  pl: "pl_PL",
};

function setMeta(attr: "name" | "property", key: string, content: string) {
  const sel = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(sel) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string, hreflang?: string) {
  const id = hreflang ? `link-${rel}-${hreflang}` : `link-${rel}`;
  let el = document.head.querySelector(`link[data-seo="${id}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    el.dataset.seo = id;
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
  if (hreflang) el.setAttribute("hreflang", hreflang);
  else el.removeAttribute("hreflang");
}

export function SeoHead() {
  const { locale, t } = useLanguage();

  useEffect(() => {
    document.documentElement.lang = htmlLang[locale];

    document.title = t.seo.title;
    setMeta("name", "description", t.seo.description);
    setMeta("name", "keywords", t.seo.keywords);
    setMeta("name", "author", "ManicBot");
    setMeta("name", "robots", "index, follow, max-image-preview:large");

    setMeta("property", "og:type", "website");
    setMeta("property", "og:site_name", t.seo.ogSiteName);
    setMeta("property", "og:title", t.seo.title);
    setMeta("property", "og:description", t.seo.description);
    setMeta("property", "og:url", `${SITE_ORIGIN}/?lang=${locale}`);
    setMeta("property", "og:image", OG_IMAGE);
    setMeta("property", "og:image:width", "512");
    setMeta("property", "og:image:height", "512");
    setMeta("property", "og:locale", ogLocale[locale]);

    document.querySelectorAll('meta[property="og:locale:alternate"]').forEach((n) => n.remove());
    for (const l of localeOrder) {
      if (l === locale) continue;
      const m = document.createElement("meta");
      m.setAttribute("property", "og:locale:alternate");
      m.setAttribute("content", ogLocale[l]);
      document.head.appendChild(m);
    }

    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", t.seo.title);
    setMeta("name", "twitter:description", t.seo.description);
    setMeta("name", "twitter:image", OG_IMAGE);

    upsertLink("canonical", `${SITE_ORIGIN}/?lang=${locale}`);

    document.querySelectorAll('link[data-seo^="hreflang-"]').forEach((n) => n.remove());
    for (const l of localeOrder) {
      const link = document.createElement("link");
      link.setAttribute("rel", "alternate");
      link.setAttribute("hreflang", htmlLang[l]);
      link.setAttribute("href", `${SITE_ORIGIN}/?lang=${l}`);
      link.dataset.seo = `hreflang-${l}`;
      document.head.appendChild(link);
    }
    const xdef = document.createElement("link");
    xdef.setAttribute("rel", "alternate");
    xdef.setAttribute("hreflang", "x-default");
    xdef.setAttribute("href", `${SITE_ORIGIN}/?lang=ru`);
    xdef.dataset.seo = "hreflang-x-default";
    document.head.appendChild(xdef);

    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": `${SITE_ORIGIN}/#organization`,
          name: "ManicBot",
          url: SITE_ORIGIN,
          logo: { "@type": "ImageObject", url: OG_IMAGE },
          sameAs: [],
        },
        {
          "@type": "WebSite",
          "@id": `${SITE_ORIGIN}/#website`,
          url: SITE_ORIGIN,
          name: "ManicBot",
          description: t.seo.description,
          publisher: { "@id": `${SITE_ORIGIN}/#organization` },
          inLanguage: Object.values(htmlLang),
        },
      ],
    };

    let script = document.head.querySelector(
      'script[type="application/ld+json"][data-seo="1"]'
    ) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.seo = "1";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);
  }, [locale, t]);

  return null;
}
