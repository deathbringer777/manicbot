export const runtime = "edge";

import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "~/components/public/JsonLd";
import { buildSeo, breadcrumbJsonLd, langToOgLocale, SITE_URL } from "~/lib/seo";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { ABOUT_DEFAULTS, type AboutConfig } from "~/server/api/routers/platformConfig";
import type { Lang } from "~/lib/i18n";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

const SUPPORTED: ReadonlyArray<Lang> = ["ru", "ua", "en", "pl"];

function pickLang(raw: string | string[] | undefined): Lang {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return "pl";
  const lc = String(v).toLowerCase();
  if ((SUPPORTED as readonly string[]).includes(lc)) return lc as Lang;
  if (lc === "uk") return "ua";
  return "pl";
}

const TITLES: Record<Lang, string> = {
  pl: "O ManicBot — kto stoi za platformą",
  ru: "О ManicBot — кто стоит за платформой",
  ua: "Про ManicBot — хто стоїть за платформою",
  en: "About ManicBot — who's behind the platform",
};

const DESCRIPTIONS: Record<Lang, string> = {
  pl: "ManicBot to platforma SaaS dla salonów paznokci. Założona w 2025 w Polsce. Buduje AI-recepcjonistę, który obsługuje rezerwacje 24/7 przez Telegram, Instagram i WhatsApp.",
  ru: "ManicBot — это SaaS-платформа для nail-салонов. Основана в 2025 в Польше. Строит AI-ресепшен, обрабатывающего записи 24/7 через Telegram, Instagram и WhatsApp.",
  ua: "ManicBot — це SaaS-платформа для nail-салонів. Заснована у 2025 у Польщі. Будує AI-ресепшен, що обробляє записи 24/7 через Telegram, Instagram і WhatsApp.",
  en: "ManicBot is a SaaS platform for nail salons. Founded in 2025 in Poland. Building an AI receptionist that handles bookings 24/7 via Telegram, Instagram, and WhatsApp.",
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  return buildSeo({
    title: TITLES[lang],
    description: DESCRIPTIONS[lang],
    path: "/about",
    keywords: [
      "ManicBot kto",
      "ManicBot founders",
      "ManicBot Poland",
      "kontakt ManicBot",
      "контакт ManicBot",
    ],
    locale: langToOgLocale(langRaw),
  });
}

function pickTagline(about: AboutConfig, lang: Lang): string {
  if (lang === "ru") return about.taglineRu;
  if (lang === "ua") return about.taglineUa;
  if (lang === "en") return about.taglineEn;
  return about.taglinePl;
}

function pickMission(about: AboutConfig, lang: Lang): string {
  if (lang === "ru") return about.missionRu;
  if (lang === "ua") return about.missionUa;
  if (lang === "en") return about.missionEn;
  return about.missionPl;
}

const HEADINGS: Record<Lang, { mission: string; basics: string; founderLabel: string; foundedLabel: string; jurisdictionLabel: string; supportLabel: string; telegramLabel: string; contactCta: string }> = {
  pl: {
    mission: "Misja",
    basics: "Podstawowe informacje",
    founderLabel: "Założyciel",
    foundedLabel: "Rok założenia",
    jurisdictionLabel: "Siedziba",
    supportLabel: "E-mail wsparcia",
    telegramLabel: "Telegram",
    contactCta: "Napisz do nas",
  },
  ru: {
    mission: "Миссия",
    basics: "Основная информация",
    founderLabel: "Основатель",
    foundedLabel: "Год основания",
    jurisdictionLabel: "Юрисдикция",
    supportLabel: "E-mail поддержки",
    telegramLabel: "Telegram",
    contactCta: "Написать нам",
  },
  ua: {
    mission: "Місія",
    basics: "Основна інформація",
    founderLabel: "Засновник",
    foundedLabel: "Рік заснування",
    jurisdictionLabel: "Юрисдикція",
    supportLabel: "E-mail підтримки",
    telegramLabel: "Telegram",
    contactCta: "Написати нам",
  },
  en: {
    mission: "Mission",
    basics: "Basic info",
    founderLabel: "Founder",
    foundedLabel: "Founded",
    jurisdictionLabel: "Jurisdiction",
    supportLabel: "Support email",
    telegramLabel: "Telegram",
    contactCta: "Contact us",
  },
};

function organizationJsonLd(about: AboutConfig) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#org`,
    name: "ManicBot",
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/manicbot-mark-ui.png`,
    foundingDate: String(about.foundedYear),
    founder: { "@type": "Person", name: about.founderName },
    address: { "@type": "PostalAddress", addressCountry: "PL", addressRegion: about.jurisdiction },
    contactPoint: {
      "@type": "ContactPoint",
      email: about.supportEmail,
      contactType: "customer support",
      availableLanguage: ["Polish", "Russian", "Ukrainian", "English"],
    },
    sameAs: [`https://t.me/${about.telegramHandle}`],
  };
}

export default async function AboutPage({ searchParams }: Props) {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  let about: AboutConfig = ABOUT_DEFAULTS;
  try {
    const ctx = await createTRPCContext({ headers: new Headers() });
    const caller = createCaller(ctx);
    about = await caller.platformConfig.getAbout();
  } catch {
    // Defaults already in scope — page renders without DB if needed.
  }
  const h = HEADINGS[lang];
  const tagline = pickTagline(about, lang);
  const mission = pickMission(about, lang);

  return (
    <>
      <JsonLd
        data={[
          organizationJsonLd(about),
          breadcrumbJsonLd([
            { name: lang === "pl" ? "Strona główna" : lang === "ru" ? "Главная" : lang === "ua" ? "Головна" : "Home", path: "/" },
            { name: lang === "pl" ? "O nas" : lang === "ru" ? "О нас" : lang === "ua" ? "Про нас" : "About", path: "/about" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-3xl px-4 py-12">
        <header className="mb-10">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white sm:text-5xl">
            {TITLES[lang]}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-slate-700 dark:text-slate-300">
            {tagline}
          </p>
        </header>

        <section className="mb-10" aria-labelledby="mission-heading">
          <h2 id="mission-heading" className="text-2xl font-bold text-slate-900 dark:text-white">
            {h.mission}
          </h2>
          <p className="mt-3 text-slate-700 dark:text-slate-300 leading-relaxed">
            {mission}
          </p>
        </section>

        <section className="mb-10" aria-labelledby="basics-heading">
          <h2 id="basics-heading" className="text-2xl font-bold text-slate-900 dark:text-white">
            {h.basics}
          </h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {h.founderLabel}
              </dt>
              <dd className="mt-1 text-slate-900 dark:text-white">{about.founderName}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {h.foundedLabel}
              </dt>
              <dd className="mt-1 text-slate-900 dark:text-white">{about.foundedYear}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {h.jurisdictionLabel}
              </dt>
              <dd className="mt-1 text-slate-900 dark:text-white">{about.jurisdiction}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {h.supportLabel}
              </dt>
              <dd className="mt-1">
                <a href={`mailto:${about.supportEmail}`} className="text-violet-600 hover:underline dark:text-violet-400">
                  {about.supportEmail}
                </a>
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {h.telegramLabel}
              </dt>
              <dd className="mt-1">
                <a
                  href={`https://t.me/${about.telegramHandle}`}
                  className="text-violet-600 hover:underline dark:text-violet-400"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @{about.telegramHandle}
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="text-center">
          <Link
            href={`mailto:${about.supportEmail}`}
            className="inline-flex h-12 items-center rounded-lg bg-violet-600 px-6 font-semibold text-white hover:bg-violet-700"
          >
            {h.contactCta}
          </Link>
        </section>
      </main>
    </>
  );
}
