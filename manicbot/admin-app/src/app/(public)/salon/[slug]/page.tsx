export const runtime = "edge";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { SalonProfileClient } from "./SalonProfileClient";
import { JsonLd } from "~/components/public/JsonLd";
import {
  buildSeo,
  beautySalonJsonLd,
  breadcrumbJsonLd,
  ogLocaleForCity,
  SITE_URL,
} from "~/lib/seo";
import { citySlug } from "~/lib/popularCities";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const ATTRIBUTION_TOKEN_RE = /^[A-Za-z0-9_.\-]{1,64}$/;

function pickAttrToken(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || typeof v !== "string") return undefined;
  return ATTRIBUTION_TOKEN_RE.test(v) ? v : undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const profile = await caller.publicSalon.getProfile({ slug }).catch(() => null);
  if (!profile) {
    return {
      title: "Салон не найден",
      robots: { index: false, follow: false },
    };
  }
  const cityPart = profile.city ? ` (${profile.city})` : "";
  // SEO audit 2026-05-20 P1-4: fall back to a Polish meta description for
  // PL salons (the platform's primary market) instead of always RU. The
  // Polish meta description is the one Google indexes for `paznokcie
  // Warszawa`-class queries; RU on a PL salon is a free penalty.
  // `ogLocaleForCity` already returns "pl_PL" for Polish cities AND for
  // unknown cities (Poland-only platform), so we treat anything not
  // explicitly Ukrainian / English / Russian as PL.
  const ogLocale = ogLocaleForCity(profile.city);
  const localizedFallback =
    ogLocale === "pl_PL"
      ? `Salon paznokci ${profile.name}${cityPart}. Manicure, pedicure, hybryda, zdobienia. Zarezerwuj online przez Telegram w minutę.`
      : ogLocale === "uk_UA"
      ? `Онлайн-запис у ${profile.name}${cityPart}. Манікюр, педикюр, nail-арт. Запишіться через Telegram за хвилину.`
      : ogLocale === "en_US"
      ? `Book ${profile.name}${cityPart} online. Manicure, pedicure, gel, nail art. Reserve via Telegram in under a minute.`
      : `Онлайн-запись в ${profile.name}${cityPart}. Маникюр, педикюр, nail-арт. Запишитесь через Telegram за минуту.`;
  const description = profile.description ?? localizedFallback;
  const seo = buildSeo({
    title: `${profile.name}${cityPart}`,
    description,
    path: `/salon/${slug}`,
    image: profile.photos?.[0] ?? undefined,
    imageAlt: profile.name
      ? `${profile.name}${profile.city ? ` — salon paznokci ${profile.city}` : ""}`
      : profile.name,
    ogLocale,
    keywords: [
      profile.name,
      profile.city ?? "nail салон",
      profile.city ? `salon paznokci ${profile.city}` : "salon paznokci",
      "маникюр",
      "педикюр",
      "manicure",
      "pedicure",
      "онлайн-запись",
      "салон красоты",
    ],
  });
  if (profile.publicActive !== 1) {
    seo.robots = { index: false, follow: false };
  }
  return seo;
}

export default async function SalonProfilePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const profile = await caller.publicSalon.getProfile({ slug }).catch(() => null);
  if (!profile) notFound();

  const sp = (await searchParams) ?? {};
  const attribution = {
    source: pickAttrToken(sp.s),
    campaign: pickAttrToken(sp.c),
    medium: pickAttrToken(sp.m),
    content: pickAttrToken(sp.content),
  };

  // SEO audit 2026-05-20 P2-1 — internal linking. "Other nail salons in
  // {city}" — 3-5 sibling links boost crawl depth and distribute PageRank.
  // Best-effort fetch: failure must not block the salon profile.
  const siblingSalons: Array<{ slug: string; name: string }> = [];
  if (profile.city && profile.publicActive === 1) {
    try {
      const result = await caller.publicSalon.search({
        city: profile.city,
        page: 1,
        limit: 6,
      });
      for (const s of result.items ?? []) {
        if (!s.slug || s.slug === slug) continue;
        siblingSalons.push({ slug: s.slug, name: s.name });
        if (siblingSalons.length >= 4) break;
      }
    } catch {
      /* sibling discovery is best-effort */
    }
  }

  // SEO audit 2026-05-20 P1-6 — FAQ schema. Generic top-buyer questions
  // localized to the salon's likely audience. The 3 questions are all
  // service-agnostic (booking flow, 24/7 availability, supported
  // languages) — they hold for every salon regardless of priced services.
  // Previously gated on `hasPricedServices` which excluded the majority
  // of seed-stage salons from FAQ rich results. Only `publicActive=1`
  // remains as the gate.
  const isPl = ogLocaleForCity(profile.city) === "pl_PL";
  const faqJsonLd = profile.publicActive === 1
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: isPl
          ? [
              {
                "@type": "Question",
                name: `Jak zarezerwować wizytę w ${profile.name}?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Kliknij przycisk «Zarezerwuj» na tej stronie. Wybierz mistrza, usługę i wolny termin — cała rezerwacja zajmuje około minuty i odbywa się przez Telegram lub WhatsApp.`,
                },
              },
              {
                "@type": "Question",
                name: `Czy mogę zarezerwować wizytę w nocy lub w weekend?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Tak. Asystent AI ${profile.name} działa 24/7 — rezerwacje są przyjmowane o każdej porze. Salon potwierdza wizytę automatycznie, jeśli wolny termin jest dostępny.`,
                },
              },
              {
                "@type": "Question",
                name: `W jakich językach mogę zarezerwować wizytę?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Asystent rozumie polski, rosyjski, ukraiński i angielski. Możesz pisać w dowolnym z tych języków.`,
                },
              },
            ]
          : [
              {
                "@type": "Question",
                name: `Как записаться в ${profile.name}?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Нажмите «Записаться» на этой странице. Выберите мастера, услугу и удобное время — вся запись занимает около минуты и проходит через Telegram или WhatsApp.`,
                },
              },
              {
                "@type": "Question",
                name: `Можно ли записаться ночью или в выходной?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Да. AI-ассистент ${profile.name} работает 24/7 — записи принимаются в любое время. Салон подтверждает запись автоматически, если слот свободен.`,
                },
              },
              {
                "@type": "Question",
                name: `На каких языках можно записаться?`,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: `Ассистент понимает русский, польский, украинский и английский.`,
                },
              },
            ],
      }
    : null;

  return (
    <>
      {profile.publicActive === 1 && (
        <JsonLd
          data={[
            beautySalonJsonLd({
              name: profile.name,
              slug: profile.slug ?? slug,
              description: profile.description,
              image: profile.photos?.[0] ?? null,
              images: profile.photos ?? null,
              city: profile.city,
              address: profile.address,
              phone: profile.phone,
              lat: profile.lat,
              lng: profile.lng,
              rating: profile.rating,
              workHours: profile.workHours,
              services: profile.services?.map((s) => ({
                name: s.name,
                price: s.price ?? null,
                duration: s.duration ?? null,
              })) ?? null,
              sameAs: [profile.instagramUrl, profile.mapsUrl].filter((u): u is string => !!u),
              currency: "PLN",
              countryCode: "PL",
            }),
            breadcrumbJsonLd([
              { name: "Главная", path: "/" },
              { name: "Поиск", path: "/search" },
              { name: profile.name, path: `/salon/${slug}` },
            ]),
            ...(faqJsonLd ? [faqJsonLd] : []),
          ]}
        />
      )}
      <SalonProfileClient profile={profile} attribution={attribution} />
      {/* SEO audit P2-1 — SSR sibling-salon links so crawlers see the
          link graph even before the client UI mounts. sr-only because the
          visible UI already surfaces these elsewhere. */}
      {siblingSalons.length > 0 && profile.city ? (
        <aside aria-label="Other nail salons" className="sr-only">
          <h2>Other nail salons in {profile.city}</h2>
          <ul>
            {siblingSalons.map((s) => (
              <li key={s.slug}>
                <Link href={`/salon/${s.slug}`}>{s.name}</Link>
              </li>
            ))}
            <li>
              <Link href={`/salons/${citySlug(profile.city)}`}>All salons in {profile.city}</Link>
            </li>
          </ul>
          {/* Absolute URL fallback to ensure machine-readability without React hydration */}
          <a href={`${SITE_URL}/salons/${citySlug(profile.city)}`}>
            Nail salons in {profile.city}
          </a>
        </aside>
      ) : null}
    </>
  );
}
