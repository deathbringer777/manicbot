export const runtime = "edge";

import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "~/components/public/JsonLd";
import { buildSeo, breadcrumbJsonLd, langToOgLocale, SITE_URL } from "~/lib/seo";
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
  pl: "Cennik ManicBot — od 45 PLN/miesiąc, 0% prowizji",
  ru: "Цены ManicBot — от 45 PLN/месяц, 0% комиссии",
  ua: "Ціни ManicBot — від 45 PLN/місяць, 0% комісії",
  en: "ManicBot pricing — from 45 PLN/mo, 0% commission",
};

const DESCRIPTIONS: Record<Lang, string> = {
  pl: "Cennik ManicBot dla salonów paznokci: Start 45 PLN/mc (1 mistrz), Pro 60 PLN/mc (5 mistrzów + AI), Max 90 PLN/mc (bez limitu). 14-dniowy okres próbny. 0% prowizji od rezerwacji.",
  ru: "Цены ManicBot для nail-салонов: Start 45 PLN/мес (1 мастер), Pro 60 PLN/мес (5 мастеров + AI), Max 90 PLN/мес (без лимита). 14 дней триала. 0% комиссии с записей.",
  ua: "Ціни ManicBot для nail-салонів: Start 45 PLN/міс (1 майстер), Pro 60 PLN/міс (5 майстрів + AI), Max 90 PLN/міс (без ліміту). 14 днів пробної версії. 0% комісії з записів.",
  en: "ManicBot pricing for nail salons: Start 45 PLN/mo (1 master), Pro 60 PLN/mo (5 masters + AI), Max 90 PLN/mo (unlimited). 14-day free trial. 0% commission on bookings.",
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  return buildSeo({
    title: TITLES[lang],
    description: DESCRIPTIONS[lang],
    path: "/pricing",
    keywords: [
      "ManicBot ceny", "ManicBot cennik", "ile kosztuje ManicBot",
      "ManicBot цена", "сколько стоит ManicBot",
      "salon paznokci cennik", "цены салон маникюра",
      "Booksy alternatywa cena", "альтернатива Booksy цена",
    ],
    locale: langToOgLocale(langRaw),
  });
}

interface Plan {
  id: "start" | "pro" | "max";
  price: number;
  features: Record<Lang, string[]>;
  highlight?: boolean;
}

const PLANS: Plan[] = [
  {
    id: "start",
    price: 45,
    features: {
      pl: [
        "1 mistrz",
        "Rezerwacja przez Telegram + Instagram + WhatsApp + web",
        "Unified inbox dla wszystkich kanałów",
        "Podstawowe statystyki",
        "Wsparcie e-mail",
      ],
      ru: [
        "1 мастер",
        "Запись через Telegram + Instagram + WhatsApp + web",
        "Единый inbox для всех каналов",
        "Базовая статистика",
        "Поддержка по e-mail",
      ],
      ua: [
        "1 майстер",
        "Запис через Telegram + Instagram + WhatsApp + web",
        "Єдиний inbox для всіх каналів",
        "Базова статистика",
        "Підтримка через e-mail",
      ],
      en: [
        "1 master",
        "Booking via Telegram + Instagram + WhatsApp + web",
        "Unified inbox across all channels",
        "Basic statistics",
        "Email support",
      ],
    },
  },
  {
    id: "pro",
    highlight: true,
    price: 60,
    features: {
      pl: [
        "Do 5 mistrzów",
        "AI-recepcjonista (PL/RU/UK/EN, 24/7)",
        "Dwukierunkowa synchronizacja Google Calendar",
        "Automatyczne przypomnienia + follow-upy",
        "Dashboard z analityką + raporty no-show",
        "Wsparcie e-mail + Telegram",
      ],
      ru: [
        "До 5 мастеров",
        "AI-ресепшен (PL/RU/UK/EN, 24/7)",
        "Двусторонняя синхронизация Google Calendar",
        "Автоматические напоминания + follow-up",
        "Dashboard с аналитикой + отчёты no-show",
        "Поддержка e-mail + Telegram",
      ],
      ua: [
        "До 5 майстрів",
        "AI-ресепшен (PL/RU/UK/EN, 24/7)",
        "Двостороння синхронізація Google Calendar",
        "Автоматичні нагадування + follow-up",
        "Dashboard з аналітикою + звіти no-show",
        "Підтримка e-mail + Telegram",
      ],
      en: [
        "Up to 5 masters",
        "AI receptionist (PL/RU/UK/EN, 24/7)",
        "Two-way Google Calendar sync",
        "Automated reminders + follow-ups",
        "Analytics dashboard + no-show reports",
        "Email + Telegram support",
      ],
    },
  },
  {
    id: "max",
    price: 90,
    features: {
      pl: [
        "Bez limitu mistrzów",
        "Wszystko z planu Pro",
        "White-label (Twoja marka, nie ManicBot)",
        "Wsparcie priorytetowe (response &lt; 1h)",
        "Eksport danych + API",
        "Onboarding z konsultantem",
      ],
      ru: [
        "Без лимита мастеров",
        "Всё из плана Pro",
        "White-label (ваш бренд, не ManicBot)",
        "Приоритетная поддержка (отклик &lt; 1ч)",
        "Экспорт данных + API",
        "Onboarding с консультантом",
      ],
      ua: [
        "Без ліміту майстрів",
        "Все з плану Pro",
        "White-label (ваш бренд, не ManicBot)",
        "Пріоритетна підтримка (відгук &lt; 1г)",
        "Експорт даних + API",
        "Onboarding з консультантом",
      ],
      en: [
        "Unlimited masters",
        "Everything in Pro",
        "White-label (your brand, not ManicBot)",
        "Priority support (response &lt; 1h)",
        "Data export + API",
        "Onboarding with a consultant",
      ],
    },
  },
];

const PRICING_FAQS: Record<Lang, Array<{ q: string; a: string }>> = {
  pl: [
    { q: "Czy jest okres próbny?", a: "Tak — 14 dni za darmo, bez podawania karty. Po próbnym okresie wybierasz plan; do tego momentu nic nie pobieramy." },
    { q: "Czy są jakieś prowizje od rezerwacji?", a: "Nie. Płacisz tylko miesięczną subskrypcję. Brak prowizji od rezerwacji, brak opłaty za nowych klientów, brak marketplace cut. Booksy bierze 30% od nowych klientów, Fresha 20% — ManicBot 0% na zawsze." },
    { q: "Jak zmieniam plan?", a: "W każdej chwili w panelu salonu. Zmiana na wyższy plan jest natychmiastowa; na niższy — od następnego okresu rozliczeniowego. Bez kar, bez umów wieloletnich." },
    { q: "Co jeśli mam więcej niż 5 mistrzów ale plan Pro mi wystarcza?", a: "Wtedy potrzebny jest plan Max (90 PLN/mc). Limit mistrzów na planie Pro to twardy limit; przekroczenie go nie pozwoli dodać nowego mistrza w panelu." },
    { q: "Co dzieje się po anulowaniu subskrypcji?", a: "Dane salonu zostają przez 90 dni — możesz przywrócić bez utraty historii. Po 90 dniach dane są bezpowrotnie usuwane zgodnie z GDPR." },
    { q: "Czy ManicBot działa dla niezależnego mistrza bez salonu?", a: "Tak — niezależny mistrz tworzy osobiste konto z tymi samymi planami 45/60/90 PLN. Pełna funkcjonalność dla solowych mistrzów." },
  ],
  ru: [
    { q: "Есть ли пробный период?", a: "Да — 14 дней бесплатно, без привязки карты. После пробного периода выбираете план; до этого мы ничего не списываем." },
    { q: "Берёте ли вы комиссию с записей?", a: "Нет. Платите только месячную подписку. 0% комиссии с записей, 0% за новых клиентов, никакой marketplace доли. Booksy берёт 30% с новых клиентов, Fresha 20% — ManicBot 0% навсегда." },
    { q: "Как сменить план?", a: "В любой момент в панели салона. Переход на старший план — мгновенный; на младший — со следующего расчётного периода. Без штрафов, без долгосрочных контрактов." },
    { q: "Что если у меня больше 5 мастеров?", a: "Тогда нужен план Max (90 PLN/мес). Лимит мастеров на плане Pro — жёсткий; превышение не даст добавить нового мастера в панели." },
    { q: "Что происходит после отмены подписки?", a: "Данные салона остаются 90 дней — можно восстановить без потери истории. После 90 дней данные удаляются безвозвратно (требование GDPR)." },
    { q: "Работает ли ManicBot для независимого мастера без салона?", a: "Да — независимый мастер создаёт личный аккаунт на тех же планах 45/60/90 PLN. Полная функциональность для соло-мастеров." },
  ],
  ua: [
    { q: "Чи є пробний період?", a: "Так — 14 днів безкоштовно, без прив'язки картки. Після пробного періоду обираєте план; до цього моменту ми нічого не списуємо." },
    { q: "Чи берете комісію з записів?", a: "Ні. Платите лише місячну підписку. 0% комісії з записів, 0% за нових клієнтів. Booksy бере 30% з нових клієнтів, Fresha 20% — ManicBot 0% назавжди." },
    { q: "Як змінити план?", a: "У будь-який момент у панелі салону. Перехід на старший план — миттєвий; на молодший — з наступного розрахункового періоду. Без штрафів." },
    { q: "Що якщо в мене більше 5 майстрів?", a: "Тоді потрібен план Max (90 PLN/міс). Ліміт майстрів на плані Pro — жорсткий." },
    { q: "Що відбувається після скасування підписки?", a: "Дані салону залишаються 90 днів — можна відновити без втрати історії. Після 90 днів дані видаляються безповоротно (вимога GDPR)." },
    { q: "Чи працює ManicBot для незалежного майстра без салону?", a: "Так — незалежний майстер створює особистий акаунт на тих самих планах 45/60/90 PLN." },
  ],
  en: [
    { q: "Is there a free trial?", a: "Yes — 14 days, no card required. You pick a plan after the trial; we don't charge anything until then." },
    { q: "Do you take a commission on bookings?", a: "No. You pay the monthly subscription only. Zero commission on bookings, zero new-client fees, zero marketplace cut. Booksy takes 30% on new clients, Fresha takes 20% — ManicBot is 0% forever." },
    { q: "How do I change plans?", a: "Anytime in the salon panel. Upgrades are instant; downgrades take effect at the next billing period. No penalties, no multi-year contracts." },
    { q: "What if I have more than 5 masters?", a: "You need the Max plan (90 PLN/mo). The master limit on Pro is a hard cap — exceeding it prevents adding a new master from the panel." },
    { q: "What happens after I cancel?", a: "Your salon data is retained for 90 days — you can restore without losing history. After 90 days the data is permanently deleted (GDPR requirement)." },
    { q: "Does ManicBot work for an independent master without a salon?", a: "Yes — independent masters create a personal account on the same 45/60/90 PLN plans. Full functionality for solo masters." },
  ],
};

const HEADINGS: Record<Lang, { h1: string; intro: string; plansHeading: string; whyHeading: string; faqHeading: string; ctaTrial: string; ctaContact: string; mostPopular: string; perMonth: string }> = {
  pl: {
    h1: "Cennik ManicBot — od 45 PLN/mc, 0% prowizji",
    intro: "ManicBot ma trzy plany subskrypcyjne. Wszystkie kanały (Telegram, Instagram, WhatsApp, web) są dostępne na każdym planie — różnice są w liczbie mistrzów, AI-asystencie i white-labelu. Brak prowizji od rezerwacji niezależnie od planu.",
    plansHeading: "Plany",
    whyHeading: "Dlaczego ManicBot opłaca się bardziej niż konkurencja",
    faqHeading: "Najczęściej zadawane pytania o cennik",
    ctaTrial: "Zacznij 14-dniowy okres próbny",
    ctaContact: "Skontaktuj się z nami",
    mostPopular: "Najczęściej wybierany",
    perMonth: "PLN / miesiąc",
  },
  ru: {
    h1: "Цены ManicBot — от 45 PLN/мес, 0% комиссии",
    intro: "У ManicBot три плана подписки. Все каналы (Telegram, Instagram, WhatsApp, web) доступны на каждом плане — различия в количестве мастеров, AI-ассистенте и white-label. Никаких комиссий с записей, независимо от плана.",
    plansHeading: "Планы",
    whyHeading: "Почему ManicBot выгоднее конкурентов",
    faqHeading: "Часто задаваемые вопросы о ценах",
    ctaTrial: "Начать 14-дневный триал",
    ctaContact: "Связаться с нами",
    mostPopular: "Самый популярный",
    perMonth: "PLN / месяц",
  },
  ua: {
    h1: "Ціни ManicBot — від 45 PLN/міс, 0% комісії",
    intro: "У ManicBot три плани підписки. Всі канали (Telegram, Instagram, WhatsApp, web) доступні на кожному плані — різниця у кількості майстрів, AI-асистенті та white-label. Жодних комісій із записів, незалежно від плану.",
    plansHeading: "Плани",
    whyHeading: "Чому ManicBot вигідніший за конкурентів",
    faqHeading: "Часто задавані питання про ціни",
    ctaTrial: "Почати 14-денну пробну версію",
    ctaContact: "Зв'язатися з нами",
    mostPopular: "Найпопулярніший",
    perMonth: "PLN / місяць",
  },
  en: {
    h1: "ManicBot pricing — from 45 PLN/mo, 0% commission",
    intro: "ManicBot has three subscription plans. All channels (Telegram, Instagram, WhatsApp, web) are available on every plan — the differences are master count, AI assistant, and white-label. Zero booking commission regardless of plan.",
    plansHeading: "Plans",
    whyHeading: "Why ManicBot is cheaper than the competition",
    faqHeading: "Pricing FAQ",
    ctaTrial: "Start 14-day free trial",
    ctaContact: "Contact us",
    mostPopular: "Most popular",
    perMonth: "PLN / month",
  },
};

const COMPETITOR_TABLE: Record<Lang, { competitor: string; entry: string; commission: string }[]> = {
  pl: [
    { competitor: "ManicBot",  entry: "45 PLN/mc",         commission: "0% na zawsze" },
    { competitor: "Booksy",    entry: "~145 PLN/mc (PL)", commission: "30% prowizji Boost od nowych klientów" },
    { competitor: "Fresha",    entry: "29 PLN/mc",         commission: "20% od nowych klientów + opłata za każdy WhatsApp" },
    { competitor: "Versum",    entry: "~$25/mc (brak PLN)",commission: "0% (ale roadmap kontroluje Booksy)" },
    { competitor: "Yclients",  entry: "~$8/mc",            commission: "0% (kanały WA/IG przez płatne 3rd party)" },
  ],
  ru: [
    { competitor: "ManicBot",  entry: "45 PLN/мес",        commission: "0% навсегда" },
    { competitor: "Booksy",    entry: "~145 PLN/мес (PL)",commission: "30% Boost комиссии с новых клиентов" },
    { competitor: "Fresha",    entry: "29 PLN/мес",        commission: "20% с новых клиентов + плата за каждый WhatsApp" },
    { competitor: "Versum",    entry: "~$25/мес (нет PLN)",commission: "0% (но roadmap контролирует Booksy)" },
    { competitor: "Yclients",  entry: "~$8/мес",           commission: "0% (каналы WA/IG через платные 3rd party)" },
  ],
  ua: [
    { competitor: "ManicBot",  entry: "45 PLN/міс",        commission: "0% назавжди" },
    { competitor: "Booksy",    entry: "~145 PLN/міс (PL)",commission: "30% Boost комісії з нових клієнтів" },
    { competitor: "Fresha",    entry: "29 PLN/міс",        commission: "20% з нових клієнтів + плата за кожен WhatsApp" },
    { competitor: "Versum",    entry: "~$25/міс (немає PLN)", commission: "0% (але roadmap контролює Booksy)" },
    { competitor: "Yclients",  entry: "~$8/міс",           commission: "0% (канали WA/IG через платні 3rd party)" },
  ],
  en: [
    { competitor: "ManicBot",  entry: "45 PLN/mo",         commission: "0% forever" },
    { competitor: "Booksy",    entry: "~145 PLN/mo (PL)", commission: "30% Boost on new clients" },
    { competitor: "Fresha",    entry: "29 PLN/mo",         commission: "20% on new clients + per-WhatsApp fee" },
    { competitor: "Versum",    entry: "~$25/mo (no PLN)",  commission: "0% (but roadmap owned by Booksy)" },
    { competitor: "Yclients",  entry: "~$8/mo",            commission: "0% (WA/IG channels via paid 3rd-party)" },
  ],
};

const PLAN_LABEL: Record<Lang, Record<Plan["id"], string>> = {
  pl: { start: "Start", pro: "Pro", max: "Max" },
  ru: { start: "Start", pro: "Pro", max: "Max" },
  ua: { start: "Start", pro: "Pro", max: "Max" },
  en: { start: "Start", pro: "Pro", max: "Max" },
};

const PLAN_TAGLINE: Record<Lang, Record<Plan["id"], string>> = {
  pl: { start: "Dla niezależnego mistrza", pro: "Dla rosnącego salonu", max: "Dla sieci salonów + white-label" },
  ru: { start: "Для независимого мастера", pro: "Для растущего салона", max: "Для сети салонов + white-label" },
  ua: { start: "Для незалежного майстра", pro: "Для зростаючого салону", max: "Для мережі салонів + white-label" },
  en: { start: "For independent masters", pro: "For growing salons", max: "For salon chains + white-label" },
};

function softwareApplicationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "ManicBot",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: `${SITE_URL}/`,
    description: "AI booking platform for nail salons. Multi-channel booking via Telegram, Instagram, WhatsApp and web. 0% commission, plans from 45 PLN/month.",
    inLanguage: ["pl", "ru", "uk", "en"],
    offers: PLANS.map((p) => ({
      "@type": "Offer",
      name: p.id.charAt(0).toUpperCase() + p.id.slice(1),
      price: String(p.price),
      priceCurrency: "PLN",
      category: "Subscription",
      url: `${SITE_URL}/pricing#plan-${p.id}`,
    })),
  };
}

function pricingFaqJsonLd(lang: Lang) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PRICING_FAQS[lang].map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export default async function PricingPage({ searchParams }: Props) {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  const h = HEADINGS[lang];
  return (
    <>
      <JsonLd
        data={[
          softwareApplicationJsonLd(),
          pricingFaqJsonLd(lang),
          breadcrumbJsonLd([
            { name: lang === "pl" ? "Strona główna" : lang === "ru" ? "Главная" : lang === "ua" ? "Головна" : "Home", path: "/" },
            { name: lang === "pl" ? "Cennik" : lang === "ru" ? "Цены" : lang === "ua" ? "Ціни" : "Pricing", path: "/pricing" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <header className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white sm:text-5xl">
            {h.h1}
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-lg text-slate-600 dark:text-slate-300">
            {h.intro}
          </p>
        </header>

        <section aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="sr-only">{h.plansHeading}</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <article
                key={plan.id}
                id={`plan-${plan.id}`}
                className={`relative rounded-2xl border ${plan.highlight ? "border-violet-400 dark:border-violet-500 shadow-lg shadow-violet-500/20 ring-2 ring-violet-400/30" : "border-slate-200 dark:border-slate-800"} bg-white dark:bg-slate-900 p-6 flex flex-col`}
              >
                {plan.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white">
                    {h.mostPopular}
                  </span>
                )}
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{PLAN_LABEL[lang][plan.id]}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{PLAN_TAGLINE[lang][plan.id]}</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-slate-900 dark:text-white">{plan.price}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400">{h.perMonth}</span>
                </div>
                <ul className="mt-6 space-y-2 text-sm text-slate-700 dark:text-slate-300 flex-1">
                  {plan.features[lang].map((feat, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="text-emerald-500" aria-hidden="true">✓</span>
                      <span dangerouslySetInnerHTML={{ __html: feat }} />
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={`mt-6 inline-flex h-11 items-center justify-center rounded-lg font-semibold transition ${plan.highlight ? "bg-violet-600 text-white hover:bg-violet-700" : "border border-slate-200 text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800"}`}
                >
                  {h.ctaTrial}
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16" aria-labelledby="why-heading">
          <h2 id="why-heading" className="text-3xl font-bold text-slate-900 dark:text-white text-center">
            {h.whyHeading}
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="min-w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {lang === "pl" ? "Platforma" : lang === "ru" ? "Платформа" : lang === "ua" ? "Платформа" : "Platform"}
                  </th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {lang === "pl" ? "Plan początkowy" : lang === "ru" ? "Начальный план" : lang === "ua" ? "Початковий план" : "Entry plan"}
                  </th>
                  <th className="py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {lang === "pl" ? "Prowizja od rezerwacji" : lang === "ru" ? "Комиссия с записей" : lang === "ua" ? "Комісія з записів" : "Booking commission"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPETITOR_TABLE[lang].map((row, idx) => (
                  <tr key={idx} className={`border-b border-slate-100 dark:border-slate-800/50 ${row.competitor === "ManicBot" ? "bg-violet-50/50 dark:bg-violet-900/10 font-semibold" : ""}`}>
                    <td className="py-3 px-4 text-slate-900 dark:text-white">{row.competitor}</td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{row.entry}</td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{row.commission}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {lang === "pl"
                ? "Ceny konkurentów zweryfikowane: maj 2026."
                : lang === "ru"
                ? "Цены конкурентов проверены: май 2026."
                : lang === "ua"
                ? "Ціни конкурентів перевірено: травень 2026."
                : "Competitor pricing verified: May 2026."}
            </p>
          </div>
        </section>

        <section className="mt-16" aria-labelledby="pricing-faq-heading">
          <h2
            id="pricing-faq-heading"
            className="text-3xl font-bold text-slate-900 dark:text-white text-center"
          >
            {h.faqHeading}
          </h2>
          <div className="mt-8 mx-auto max-w-3xl space-y-4">
            {PRICING_FAQS[lang].map((faq, idx) => (
              <details
                key={idx}
                className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
              >
                <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">
                  {faq.q}
                </summary>
                <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
