export const runtime = "edge";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { JsonLd } from "~/components/public/JsonLd";
import {
  buildSeo,
  canonicalUrl,
  breadcrumbJsonLd,
  ogLocaleForCity,
  SITE_URL,
} from "~/lib/seo";
import { cityNameFromSlug, POPULAR_CITIES, citySlug } from "~/lib/popularCities";

/**
 * SEO audit 2026-05-20 P1-1 — Programmatic city directory pages.
 * Booksy's primary ranking lever is `/en-us/s/nail-salon/{city-id}_{slug}`
 * ranking #1 for "[city] nail salons". ManicBot exposes the same data
 * (publicSalon.search by city) but had no URL pattern for Google to index.
 * This route closes that gap.
 *
 * URL shape: `/salons/{city-slug}` (e.g. `/salons/warszawa`). Allowlist is
 * POPULAR_CITIES — unknown slugs 404 (notFound()). Add a city to the
 * allowlist by adding it to `~/lib/popularCities` (also surfaces in the
 * sitemap automatically).
 */

interface Props {
  params: Promise<{ city: string }>;
}

const CITY_DESCRIPTIONS: Record<string, string> = {
  Warszawa:
    "Каталог nail-салонов в Варшаве. Найдите салон рядом, выберите мастера и запишитесь онлайн через Telegram. Маникюр, педикюр, гель-лак, наращивание, nail-арт.",
  "Gdańsk":
    "Каталог nail-салонов в Гданьске. Найдите салон рядом, выберите мастера и запишитесь онлайн через Telegram. Маникюр, педикюр, гель-лак, наращивание, nail-арт.",
  "Wrocław":
    "Каталог nail-салонов во Вроцлаве. Найдите салон рядом, выберите мастера и запишитесь онлайн через Telegram. Маникюр, педикюр, гель-лак, наращивание, nail-арт.",
};

const CITY_DESCRIPTIONS_PL: Record<string, string> = {
  Warszawa:
    "Salony paznokci w Warszawie — rezerwacja online przez Telegram, znajdź salon w pobliżu i wybierz mistrza. Manicure, pedicure, hybrydy, przedłużanie, zdobienia.",
  "Gdańsk":
    "Salony paznokci w Gdańsku — rezerwacja online przez Telegram, znajdź salon w pobliżu i wybierz mistrza. Manicure, pedicure, hybrydy, przedłużanie, zdobienia.",
  "Wrocław":
    "Salony paznokci we Wrocławiu — rezerwacja online przez Telegram, znajdź salon w pobliżu i wybierz mistrza. Manicure, pedicure, hybrydy, przedłużanie, zdobienia.",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params;
  const cityName = cityNameFromSlug(slug);
  if (!cityName) {
    return {
      title: "Город не найден",
      robots: { index: false, follow: false },
    };
  }
  const description =
    CITY_DESCRIPTIONS_PL[cityName] ??
    CITY_DESCRIPTIONS[cityName] ??
    `Salony paznokci w ${cityName} — rezerwacja online.`;
  return buildSeo({
    title: `Salon paznokci ${cityName} — rezerwacja online`,
    description,
    path: `/salons/${citySlug(cityName)}`,
    keywords: [
      `nail salon ${cityName}`,
      `salon paznokci ${cityName}`,
      `manicure ${cityName}`,
      `pedicure ${cityName}`,
      `маникюр ${cityName}`,
      "ManicBot",
    ],
    ogLocale: ogLocaleForCity(cityName),
  });
}

/**
 * Generate the param set at build time so the route is statically
 * pre-rendered for every popular city (edge runtime still requires the
 * param list to be enumerable).
 */
export async function generateStaticParams() {
  return POPULAR_CITIES.map((city) => ({ city: citySlug(city) }));
}

export default async function CityDirectoryPage({ params }: Props) {
  const { city: slug } = await params;
  const cityName = cityNameFromSlug(slug);
  if (!cityName) notFound();

  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const result = await caller.publicSalon
    .search({ city: cityName, page: 1, limit: 50 })
    .catch(() => ({ items: [] as Array<{ id: string; slug: string | null; name: string; city: string | null; address: string | null; coverPhoto: string | null }>, hasMore: false, page: 1, total: 0 }));

  const salons = (result.items ?? []).filter((s) => s.slug);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Salony paznokci w ${cityName}`,
    description: CITY_DESCRIPTIONS_PL[cityName] ?? "",
    numberOfItems: salons.length,
    itemListElement: salons.map((s, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      item: {
        "@type": "BeautySalon",
        "@id": canonicalUrl(`/salon/${s.slug}`),
        name: s.name,
        ...(s.address ? { address: { "@type": "PostalAddress", streetAddress: s.address, addressLocality: cityName, addressCountry: "PL" } } : {}),
        url: canonicalUrl(`/salon/${s.slug}`),
      },
    })),
  };

  const description = CITY_DESCRIPTIONS_PL[cityName] ?? CITY_DESCRIPTIONS[cityName] ?? "";

  // FAQ schema for the city page — covers the top 3 commercial questions
  // ("how do I book?", "what's the price range?", "is there an English-
  // speaking salon?"). Free snippet rich-result wins (P1-9).
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `Jak zarezerwować wizytę w salonie paznokci w ${cityName}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Wybierz salon z poniższej listy, kliknij «Rezerwuj», wybierz mistrza, usługę i wolny termin. Cała rezerwacja zajmuje około minuty i odbywa się przez Telegram, WhatsApp lub Instagram — bez telefonów i bez czekania w kolejce.`,
        },
      },
      {
        "@type": "Question",
        name: `Ile kosztuje manicure w ${cityName}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Ceny zależą od salonu i wybranych usług. Większość salonów w katalogu ManicBot oferuje manicure klasyczny od 60 PLN, hybrydę od 100 PLN, pedicure SPA od 150 PLN. Dokładne ceny każdego salonu znajdziesz na jego profilu.`,
        },
      },
      {
        "@type": "Question",
        name: `Czy mogę zarezerwować wizytę w nocy lub w weekend?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Tak. ManicBot AI-receptionist działa 24/7 — rezerwacje są przyjmowane o każdej porze, również w nocy i w święta. Salon potwierdza wizytę automatycznie, jeśli wolny termin jest dostępny.`,
        },
      },
      {
        "@type": "Question",
        name: `W jakich językach mogę zarezerwować wizytę?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Asystent AI rozumie polski, rosyjski, ukraiński i angielski. Możesz pisać w dowolnym z tych języków, a salon otrzyma rezerwację w swoim języku roboczym.`,
        },
      },
    ],
  };

  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Salony", path: "/search" },
            { name: cityName, path: `/salons/${citySlug(cityName)}` },
          ]),
          itemListJsonLd,
          faqJsonLd,
        ]}
      />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-500 dark:text-slate-400">
          <Link href="/" className="hover:underline">
            ManicBot
          </Link>{" "}
          /{" "}
          <Link href="/search" className="hover:underline">
            Salony
          </Link>{" "}
          / <span className="text-slate-700 dark:text-slate-200">{cityName}</span>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">
            Salony paznokci w {cityName}
          </h1>
          {description ? (
            <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-300">
              {description}
            </p>
          ) : null}
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Znaleziono <strong>{salons.length}</strong> {salons.length === 1 ? "salon" : "salonów"} w
            kategorii ManicBot.
          </p>
        </header>

        {salons.length === 0 ? (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
            <p className="text-slate-700 dark:text-slate-300">
              W tym momencie nie mamy aktywnych salonów w {cityName}. Sprawdź{" "}
              <Link href="/search" className="font-medium text-violet-600 hover:underline dark:text-brand-400">
                pełny katalog
              </Link>{" "}
              lub wybierz inne miasto.
            </p>
            <ul className="mt-4 flex flex-wrap justify-center gap-2">
              {POPULAR_CITIES.filter((c) => c !== cityName).map((c) => (
                <li key={c}>
                  <Link
                    href={`/salons/${citySlug(c)}`}
                    className="rounded-full bg-violet-50 px-3 py-1 text-sm text-violet-700 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300"
                  >
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {salons.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/salon/${s.slug}`}
                    className="block rounded-2xl border border-slate-200/80 bg-white p-4 transition hover:border-violet-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
                  >
                    {s.coverPhoto ? (
                      <img
                        src={s.coverPhoto}
                        alt={`${s.name} — salon paznokci w ${cityName}`}
                        className="mb-3 h-40 w-full rounded-xl object-cover"
                      />
                    ) : null}
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                      {s.name}
                    </h2>
                    {s.address ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.address}</p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-12 border-t border-slate-200 pt-8 dark:border-slate-800">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            Inne miasta
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {POPULAR_CITIES.filter((c) => c !== cityName).map((c) => (
              <li key={c}>
                <Link
                  href={`/salons/${citySlug(c)}`}
                  className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Salony w {c}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 border-t border-slate-200 pt-8 dark:border-slate-800">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">FAQ</h2>
          <div className="mt-4 space-y-4 text-slate-600 dark:text-slate-300">
            <details>
              <summary className="cursor-pointer font-medium text-slate-900 dark:text-white">
                Jak zarezerwować wizytę w salonie paznokci w {cityName}?
              </summary>
              <p className="mt-2 text-sm">
                Wybierz salon z powyższej listy, kliknij «Rezerwuj», wybierz mistrza, usługę i wolny
                termin. Cała rezerwacja zajmuje około minuty i odbywa się przez Telegram, WhatsApp
                lub Instagram.
              </p>
            </details>
            <details>
              <summary className="cursor-pointer font-medium text-slate-900 dark:text-white">
                Ile kosztuje manicure w {cityName}?
              </summary>
              <p className="mt-2 text-sm">
                Większość salonów oferuje manicure klasyczny od 60 PLN, hybrydę od 100 PLN, pedicure
                SPA od 150 PLN. Dokładne ceny każdego salonu znajdziesz na jego profilu.
              </p>
            </details>
            <details>
              <summary className="cursor-pointer font-medium text-slate-900 dark:text-white">
                Czy mogę zarezerwować wizytę w nocy lub w weekend?
              </summary>
              <p className="mt-2 text-sm">
                Tak. AI-receptionist działa 24/7. Salon potwierdza wizytę automatycznie, jeśli wolny
                termin jest dostępny.
              </p>
            </details>
            <details>
              <summary className="cursor-pointer font-medium text-slate-900 dark:text-white">
                W jakich językach mogę zarezerwować wizytę?
              </summary>
              <p className="mt-2 text-sm">
                Asystent AI rozumie polski, rosyjski, ukraiński i angielski.
              </p>
            </details>
          </div>
        </section>

        {/* Hidden machine-readable salon list. Keeps the link graph dense
            for crawlers even when the visible list is empty. */}
        <ul className="sr-only" aria-hidden="true" data-ssr-salon-list>
          {salons.map((s) => (
            <li key={s.id}>
              <a href={`${SITE_URL}/salon/${s.slug}`}>{s.name}</a>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
