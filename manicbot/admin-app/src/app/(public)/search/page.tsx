export const runtime = "edge";

import type { Metadata } from "next";
import Link from "next/link";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { JsonLd } from "~/components/public/JsonLd";
import { buildSeo, canonicalUrl, langToOgLocale, SITE_URL } from "~/lib/seo";
import SearchClient from "./SearchClient";

interface Props {
  searchParams: Promise<{ city?: string; q?: string; page?: string; lang?: string | string[] }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
    title: "Поиск салонов красоты",
    description:
      "Найдите nail-салон рядом. Поиск по городу, услуге, мастеру. Маникюр, педикюр, наращивание, nail-арт. Онлайн-запись через Telegram.",
    path: "/search",
    keywords: [
      "поиск салонов красоты",
      "nail салон рядом",
      "маникюр рядом",
      "педикюр рядом",
      "записаться онлайн",
      "каталог салонов",
    ],
    locale: langToOgLocale(lang),
  });
}

/**
 * Server-rendered shell for /search.
 *
 * Why this exists (relax.md §3 P1):
 * The old /search page was 100% client-side. Crawlers (especially Bing,
 * Yandex, and AI agents) saw an empty `<div id="root">` shell, the most
 * important commercial-intent page on the directory carrying *zero* salon
 * links. Now we SSR the top results + JSON-LD ItemList so the page is
 * crawlable even with JS disabled, while still mounting the live filter UI
 * for users.
 */
export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const city = sp.city?.slice(0, 80) || undefined;
  const query = sp.q?.slice(0, 80) || undefined;
  const page = Math.max(1, Math.min(50, parseInt(sp.page ?? "1", 10) || 1));

  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const result = await caller.publicSalon
    .search({ query, city, page, limit: 20 })
    .catch(() => ({ items: [] as Array<{ id: string; slug: string | null; name: string; city: string | null; address: string | null }> }));

  const items = result.items ?? [];

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: city ? `Салоны красоты в ${city}` : "Каталог nail-салонов",
    numberOfItems: items.length,
    itemListElement: items
      .filter((s) => s.slug)
      .map((s, idx) => ({
        "@type": "ListItem",
        position: idx + 1,
        url: canonicalUrl(`/salon/${s.slug}`),
        name: s.name,
      })),
  };

  return (
    <>
      <JsonLd data={itemListJsonLd} />
      {/* SSR shadow listing: invisible to users (the client UI takes over),
          but present in the source HTML so crawlers and AI agents see the
          actual salon links. Plain anchors with semantic markup.
          SEO audit 2026-05-20 P1-8: was rendering its own <h1>, colliding
          with the client-side <h1> in SearchClient. Demoted to <h2> here so
          the page never ships two H1s in a crawler-visible response. */}
      <noscript>
        <div className="mx-auto max-w-6xl px-4 py-8">
          <h2>Каталог nail-салонов</h2>
          {/* SEO audit 2026-05-20 P1-8 — featured-snippet intro.
              Google extracts featured snippets from the first 40-60 words
              after the heading. Without this, /search jumped from H2
              straight to the salon list — nothing to extract. */}
          <p>
            Znajdź najlepszy salon paznokci w Polsce. Katalog salonów manicure i pedicure z rezerwacją online przez Telegram, Instagram, WhatsApp i widget na stronie. Wszystkie salony w katalogu obsługiwane są przez AI-recepcjonistę, który przyjmuje rezerwacje 24 godziny na dobę w czterech językach.
          </p>
          {city && <p>Город: {city}</p>}
          {items.length === 0 ? (
            <p>Салоны не найдены.</p>
          ) : (
            <ul>
              {items.filter((s) => s.slug).map((s) => (
                <li key={s.id}>
                  <a href={`${SITE_URL}/salon/${s.slug}`}>{s.name}</a>
                  {s.city && <> — {s.city}</>}
                  {s.address && <>, {s.address}</>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </noscript>
      {/* Hidden-but-in-DOM crawl bait: rendered server-side, sr-only so it
          doesn't disrupt layout. Googlebot reads this directly without
          executing JS. */}
      <ul className="sr-only" aria-hidden="true" data-ssr-salon-list>
        {items.filter((s) => s.slug).map((s) => (
          <li key={s.id}>
            <Link href={`/salon/${s.slug}`}>{s.name}{s.city ? ` — ${s.city}` : ""}</Link>
          </li>
        ))}
      </ul>
      {/* SEO audit 2026-05-20 P1-8 — featured-snippet intro. Server-
          rendered so it's in source HTML for crawlers + LLM bots. Sits
          ABOVE the client-side filter UI so Google extracts the first
          40-60 words after the H1 from here, not from the deep page
          structure. Polish primary (the platform operates in PL); the
          client-side H1+subtitle handles per-language rendering via i18n
          for human visitors. */}
      <p className="sr-only" aria-hidden="true" data-ssr-intro>
        Znajdź najlepszy salon paznokci w Polsce. Katalog salonów manicure i pedicure z rezerwacją online przez Telegram, Instagram, WhatsApp i widget na stronie. Каталог nail-салонов и независимых мастеров маникюра по городам Польши с онлайн-записью 24/7 через мессенджеры. Wszystkie salony w katalogu obsługiwane są przez AI-recepcjonistę, który przyjmuje rezerwacje 24 godziny na dobę w czterech językach (polski, rosyjski, ukraiński, angielski).
      </p>
      <SearchClient />
    </>
  );
}
