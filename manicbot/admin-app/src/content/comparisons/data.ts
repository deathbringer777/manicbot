/**
 * SEO audit 2026-05-20 P1 — comparison page data.
 *
 * Source: SearchFit.ai competitor research, May 2026 (full report
 * archived alongside this PR). Every numeric claim is cited; pages
 * that ship a "verify before publishing" tag in the research are
 * marked here with `pricingVerifiedManual: false` so the live page
 * carries a clear "starting from" disclaimer instead of committing
 * to a single tier price.
 *
 * To add a competitor: extend the COMPARISONS array. The route file
 * `/comparisons/[competitor]/page.tsx` consumes this directly.
 */

import type { Lang } from "~/lib/i18n";

export interface ComparisonRow {
  /** Dimension label per locale (e.g. "Cena", "Цена"). */
  label: Record<Lang, string>;
  /** ManicBot's value (verbatim). */
  manicbot: string;
  /** Competitor's value (verbatim). */
  competitor: string;
  /** When true, render the row with an emphasised winner accent on the
   *  ManicBot side (used for the "0% commission" line + price line). */
  winnerLeft?: boolean;
}

export interface ComparisonFaq {
  q: string;
  a: string;
}

export interface ComparisonPage {
  /** URL slug — page lives at /comparisons/{slug}. */
  slug: "manicbot-vs-booksy" | "manicbot-vs-yclients" | "manicbot-vs-fresha" | "manicbot-vs-versum";
  competitorName: string;
  /** Year founded + HQ for E-E-A-T context. */
  competitorEstablished: string;
  /** Source URL for the pricing data. Shown as a small-print citation. */
  pricingSourceUrl: string;
  /** False when the cited numbers came from a third-party aggregator
   *  rather than the competitor's live pricing page. The page shows a
   *  "starting from" disclaimer instead of committing to a tier price. */
  pricingVerifiedManual: boolean;
  /** Hero summary (the "winning angle" the page argues). */
  heroSummary: Record<Lang, string>;
  /** Side-by-side comparison rows. */
  rows: ComparisonRow[];
  /** 3 winning angles for the ManicBot side. */
  whyManicbot: Record<Lang, string[]>;
  /** 3 FAQs specific to this comparison. */
  faqs: Record<Lang, ComparisonFaq[]>;
}

const LABELS = {
  entryPrice:   { pl: "Cena startowa", ru: "Начальная цена", ua: "Початкова ціна", en: "Entry price" },
  trial:        { pl: "Okres próbny",  ru: "Триал",          ua: "Пробний період", en: "Free trial" },
  commission:   { pl: "Prowizja od rezerwacji", ru: "Комиссия с записей", ua: "Комісія з записів", en: "Booking commission" },
  telegram:     { pl: "Rezerwacja przez Telegram", ru: "Запись через Telegram", ua: "Запис через Telegram", en: "Telegram booking" },
  whatsapp:     { pl: "WhatsApp Business",         ru: "WhatsApp Business",      ua: "WhatsApp Business",     en: "WhatsApp Business" },
  instagram:    { pl: "Instagram DM",              ru: "Instagram DM",           ua: "Instagram DM",          en: "Instagram DM" },
  ai24:         { pl: "AI-recepcjonista 24/7",     ru: "AI-ресепшен 24/7",       ua: "AI-ресепшен 24/7",      en: "24/7 AI receptionist" },
  gcal:         { pl: "Synchronizacja Google Calendar", ru: "Синхронизация Google Calendar", ua: "Синхронізація Google Calendar", en: "Google Calendar sync" },
  hq:           { pl: "Siedziba",                  ru: "Юрисдикция",             ua: "Юрисдикція",            en: "HQ" },
  langs:        { pl: "Języki",                    ru: "Языки",                  ua: "Мови",                  en: "Languages" },
};

export const COMPARISONS: ComparisonPage[] = [
  {
    slug: "manicbot-vs-booksy",
    competitorName: "Booksy",
    competitorEstablished: "2014, Warsaw → Chicago",
    pricingSourceUrl: "https://biz.booksy.com/en-us/pricing",
    pricingVerifiedManual: true,
    heroSummary: {
      pl: "Booksy to największy marketplace beauty w Polsce — i najdroższa droga do rezerwacji online. ManicBot jest 3× tańszy, nie bierze prowizji 30% od nowych klientów, i obsługuje Telegram + Instagram + WhatsApp jako natywne kanały rezerwacji.",
      ru: "Booksy — крупнейший beauty-marketplace в Польше и самый дорогой способ принимать записи онлайн. ManicBot в 3× дешевле, не берёт 30% комиссию с новых клиентов и обслуживает Telegram + Instagram + WhatsApp как нативные каналы записи.",
      ua: "Booksy — найбільший beauty-marketplace у Польщі та найдорожчий спосіб приймати записи онлайн. ManicBot у 3× дешевший, не бере 30% комісію з нових клієнтів і обслуговує Telegram + Instagram + WhatsApp як нативні канали запису.",
      en: "Booksy is the biggest beauty marketplace in Poland — and the most expensive way to take online bookings. ManicBot is 3× cheaper, doesn't take a 30% new-client commission, and handles Telegram + Instagram + WhatsApp as native booking channels.",
    },
    rows: [
      { label: LABELS.entryPrice,  manicbot: "45 PLN / mo", competitor: "~145 PLN / mo (PL)",                     winnerLeft: true },
      { label: LABELS.trial,       manicbot: "14 days",      competitor: "7 days" },
      { label: LABELS.commission,  manicbot: "0% forever",   competitor: "30% Boost on new clients (one-time per client)", winnerLeft: true },
      { label: LABELS.telegram,    manicbot: "✓ native + AI",competitor: "✗" },
      { label: LABELS.whatsapp,    manicbot: "✓ native",     competitor: "Outbound reminders only (some markets)" },
      { label: LABELS.instagram,   manicbot: "✓ native + AI",competitor: "✗" },
      { label: LABELS.ai24,        manicbot: "✓ PL/RU/UK/EN",competitor: "✗" },
      { label: LABELS.gcal,        manicbot: "✓ two-way",    competitor: "Limited" },
      { label: LABELS.hq,          manicbot: "Poland / EU",  competitor: "Chicago, USA" },
      { label: LABELS.langs,       manicbot: "PL, RU, UK, EN",competitor: "30+ but US-first product" },
    ],
    whyManicbot: {
      pl: [
        "Realny koszt. 145 PLN/mc Booksy plus 30% Boost od nowych klientów to typowo 1500–3000 PLN/mc dla rosnącego salonu. ManicBot 45–90 PLN/mc, flat, na zawsze.",
        "Kanały, w których są klienci. Polki piszą do salonów na Instagramie i WhatsAppie. Booksy każe im pobrać kolejną aplikację. ManicBot odpowiada w tych samych DM-ach.",
        "Twoi klienci są Twoi. Booksy marketuje Twój salon w swojej apce, a potem bierze 30% od pierwszej wizyty — klient «należy» do Booksy. ManicBot booking lata przez Twój własny bot, IG i numer.",
      ],
      ru: [
        "Реальная стоимость. 145 PLN/мес Booksy + 30% Boost с новых клиентов — это типично 1500–3000 PLN/мес для растущего салона. ManicBot 45–90 PLN/мес flat, навсегда.",
        "Каналы, где клиенты на самом деле есть. Польские клиенты пишут салонам в Instagram и WhatsApp. Booksy заставляет скачать ещё одно приложение. ManicBot отвечает в тех же DM.",
        "Ваши клиенты — ваши. Booksy продвигает ваш салон в своём приложении, а затем берёт 30% с первой записи — клиент «принадлежит» Booksy. ManicBot booking идёт через ВАШ бот, IG и номер.",
      ],
      ua: [
        "Реальна вартість. 145 PLN/міс Booksy + 30% Boost з нових клієнтів — типово 1500–3000 PLN/міс для зростаючого салону. ManicBot 45–90 PLN/міс flat, назавжди.",
        "Канали, де клієнти насправді є. Польські клієнти пишуть салонам в Instagram і WhatsApp. Booksy змушує завантажити ще один додаток. ManicBot відповідає в тих самих DM.",
        "Ваші клієнти — ваші. Booksy просуває ваш салон у своєму додатку, а потім бере 30% з першого запису — клієнт «належить» Booksy. ManicBot booking іде через ВАШ бот, IG і номер.",
      ],
      en: [
        "Real total cost. 145 PLN/mo Booksy plus 30% Boost on new clients is typically 1,500–3,000 PLN/mo for a growing salon. ManicBot is 45–90 PLN/mo flat, forever.",
        "Channels where clients actually live. Polish nail clients message salons on Instagram and WhatsApp. Booksy makes them download yet another app. ManicBot answers in those same DMs.",
        "Your clients are yours. Booksy markets your salon in its app and then takes 30% on the first visit — the client \"belongs\" to Booksy. ManicBot bookings flow through your own bot, IG account, and phone number.",
      ],
    },
    faqs: {
      pl: [
        { q: "Czy ManicBot zastąpi Booksy bez utraty istniejących klientów?", a: "Tak — możesz prowadzić oba systemy równolegle przez 30–60 dni. Klienci z Booksy nadal Cię znajdują przez marketplace; nowi rezerwują przez ManicBot na Telegramie/IG/WhatsAppie bez 30% prowizji. Po sezonowym cyklu większość salonów rezygnuje z Booksy." },
        { q: "Czy są klienci, którzy WOLĄ rezerwować przez Booksy?", a: "Tak — głównie ci, którzy używają Booksy jako «odkrywaczy» (znajdują nowy salon w obcym mieście). Dla regularnych klientów, którzy już Cię znają, Telegram/IG/WhatsApp są wygodniejsze." },
        { q: "Co z tym, że Booksy promuje mój salon w marketplace?", a: "Promocja nie jest darmowa — to dokładnie ten 30% Boost który płacisz. Wielu właścicieli liczy ROI i odkrywa, że ten sam budżet na Instagram Ads daje więcej nowych klientów bez stałego haraczu." },
      ],
      ru: [
        { q: "Можно ли заменить Booksy на ManicBot, не теряя существующих клиентов?", a: "Да — можно вести оба системы параллельно 30–60 дней. Клиенты из Booksy продолжают находить вас через marketplace; новые записываются через ManicBot в Telegram/IG/WhatsApp без 30% комиссии. После сезонного цикла большинство салонов уходят с Booksy." },
        { q: "Есть ли клиенты, которые ПРЕДПОЧИТАЮТ Booksy?", a: "Да — в основном те, кто использует Booksy как «discovery» (находит новый салон в чужом городе). Для постоянных клиентов, которые вас уже знают, Telegram/IG/WhatsApp удобнее." },
        { q: "А как же продвижение моего салона в Booksy marketplace?", a: "Продвижение не бесплатное — это именно тот 30% Boost, который вы платите. Многие владельцы считают ROI и обнаруживают, что тот же бюджет на Instagram Ads даёт больше новых клиентов без постоянной дани." },
      ],
      ua: [
        { q: "Чи можна замінити Booksy на ManicBot, не втрачаючи існуючих клієнтів?", a: "Так — можна вести обидві системи паралельно 30–60 днів. Клієнти з Booksy продовжують знаходити вас через marketplace; нові записуються через ManicBot у Telegram/IG/WhatsApp без 30% комісії. Після сезонного циклу більшість салонів йдуть з Booksy." },
        { q: "Чи є клієнти, які НАДАЮТЬ ПЕРЕВАГУ Booksy?", a: "Так — переважно ті, хто використовує Booksy як «discovery» (знаходить новий салон у чужому місті). Для постійних клієнтів, які вас уже знають, Telegram/IG/WhatsApp зручніші." },
        { q: "А як же просування мого салону у Booksy marketplace?", a: "Просування не безкоштовне — це саме той 30% Boost, який ви платите. Багато власників рахують ROI і виявляють, що той самий бюджет на Instagram Ads дає більше нових клієнтів без постійної данини." },
      ],
      en: [
        { q: "Can I replace Booksy with ManicBot without losing existing clients?", a: "Yes — run both for 30–60 days. Booksy-discovered clients keep finding you through the marketplace; new clients book via ManicBot on Telegram/IG/WhatsApp without the 30% commission. After one seasonal cycle most salons drop Booksy." },
        { q: "Are there clients who actually prefer Booksy?", a: "Yes — mostly those who use Booksy as a discovery tool (finding a new salon in an unfamiliar city). For regulars who already know you, Telegram/IG/WhatsApp is more convenient." },
        { q: "What about Booksy promoting my salon in the marketplace?", a: "The promotion isn't free — it's exactly the 30% Boost you pay. Many owners run the ROI math and find that the same budget spent on Instagram Ads brings more new clients without a recurring cut." },
      ],
    },
  },
  {
    slug: "manicbot-vs-fresha",
    competitorName: "Fresha",
    competitorEstablished: "2015, London UK",
    pricingSourceUrl: "https://www.fresha.com/pricing",
    pricingVerifiedManual: true,
    heroSummary: {
      pl: "Fresha reklamuje się jako «darmowa» — ale weź 20% prowizję od nowych klientów i opłatę za każdy WhatsApp i SMS, i rosnący salon płaci Freshę 5–10× więcej niż ManicBota. Plus brak Telegrama i konwersacyjnego AI.",
      ru: "Fresha рекламируется как «бесплатная» — но добавьте 20% комиссию с новых клиентов плюс оплату за каждый WhatsApp и SMS, и растущий салон платит Fresha в 5–10× больше чем ManicBot. Плюс нет Telegram и conversational AI.",
      ua: "Fresha рекламується як «безкоштовна» — але додайте 20% комісію з нових клієнтів плюс оплату за кожен WhatsApp і SMS, і зростаючий салон платить Fresha в 5–10× більше ніж ManicBot. Плюс немає Telegram і conversational AI.",
      en: "Fresha advertises itself as «free» — but add the 20% new-client commission plus a per-WhatsApp and per-SMS fee, and a growing salon pays Fresha 5–10× more than ManicBot. Plus no Telegram and no conversational AI.",
    },
    rows: [
      { label: LABELS.entryPrice,  manicbot: "45 PLN / mo flat", competitor: "29 PLN / mo (Independent)" },
      { label: LABELS.trial,       manicbot: "14 days",          competitor: "7 days" },
      { label: LABELS.commission,  manicbot: "0% forever",       competitor: "20% on every new client (min 6 USD)",            winnerLeft: true },
      { label: LABELS.telegram,    manicbot: "✓ native + AI",    competitor: "✗" },
      { label: LABELS.whatsapp,    manicbot: "✓ native + AI",    competitor: "Pay-per-message: 0.45–1.30 PLN per WhatsApp" },
      { label: LABELS.instagram,   manicbot: "✓ native + AI",    competitor: "Marketplace button only" },
      { label: LABELS.ai24,        manicbot: "✓ PL/RU/UK/EN",    competitor: "✗" },
      { label: LABELS.gcal,        manicbot: "✓ two-way",        competitor: "✓ two-way" },
      { label: LABELS.hq,          manicbot: "Poland / EU",      competitor: "London, UK" },
      { label: LABELS.langs,       manicbot: "PL, RU, UK, EN",   competitor: "15+ including PL" },
    ],
    whyManicbot: {
      pl: [
        "Realny koszt. Fresha 29 PLN/mc + 20% nowych klientów + 0.45–1.30 PLN za każdy WhatsApp = typowo 500–2000 PLN/mc. ManicBot 45 PLN/mc flat, koniec.",
        "Telegram + AI-recepcjonista. Żaden konkurent nie ma natywnego Telegrama z conversational AI w jednym pakiecie. Fresha to forwarding wiadomości Instagram/Facebook — to nie konwersacja.",
        "Twoi klienci są Twoi. Fresha filtruje nowe rezerwacje przez swój marketplace i bierze 20%. ManicBot rezerwacje lecą bezpośrednio przez Twoje konto Telegram/IG/WhatsApp — Fresha nigdy się tam nie wciska.",
      ],
      ru: [
        "Реальная стоимость. Fresha 29 PLN/мес + 20% новых клиентов + 0.45–1.30 PLN за каждый WhatsApp = типично 500–2000 PLN/мес. ManicBot 45 PLN/мес flat, точка.",
        "Telegram + AI-ресепшен. Ни один конкурент не имеет нативного Telegram с conversational AI в одном пакете. Fresha — это форвардинг сообщений Instagram/Facebook, не разговор.",
        "Ваши клиенты — ваши. Fresha фильтрует новые записи через свой marketplace и берёт 20%. ManicBot записи идут напрямую через ВАШ Telegram/IG/WhatsApp — Fresha никогда туда не лезет.",
      ],
      ua: [
        "Реальна вартість. Fresha 29 PLN/міс + 20% нових клієнтів + 0.45–1.30 PLN за кожен WhatsApp = типово 500–2000 PLN/міс. ManicBot 45 PLN/міс flat, крапка.",
        "Telegram + AI-ресепшен. Жоден конкурент не має нативного Telegram з conversational AI в одному пакеті. Fresha — це форвардинг повідомлень Instagram/Facebook, не розмова.",
        "Ваші клієнти — ваші. Fresha фільтрує нові записи через свій marketplace і бере 20%. ManicBot записи йдуть напряму через ВАШ Telegram/IG/WhatsApp.",
      ],
      en: [
        "Real total cost. Fresha's 29 PLN/mo sticker plus 20% new-client commission plus 0.45–1.30 PLN per WhatsApp adds up to 500–2,000 PLN/mo for a growing salon. ManicBot is 45 PLN/mo flat, period.",
        "Telegram + AI receptionist. No competitor has Telegram booking and conversational AI in one package. Fresha is Instagram/Facebook DM forwarding — not a conversation.",
        "Your clients are yours. Fresha funnels new bookings through its marketplace and skims 20%. ManicBot bookings flow directly through your Telegram, IG, and WhatsApp — Fresha never inserts itself.",
      ],
    },
    faqs: {
      pl: [
        { q: "Czy 29 PLN/mc Freshy NAPRAWDĘ jest tańsze niż 45 PLN/mc ManicBota?", a: "Nominalnie tak — przez pierwszy miesiąc bez nowych klientów. Z 10 nowymi klientami miesięcznie przy avg wizyta 150 PLN dolicz 300 PLN prowizji Fresha → 329 PLN łącznie. ManicBot wciąż 45 PLN flat. Im więcej rośniesz, tym droższy staje się model Freshy." },
        { q: "Czy mogę używać własnego WhatsAppa zamiast płaconego przez Freshę?", a: "Fresha wymaga aby SMS/WhatsApp przechodziły przez ich gateway. ManicBot łączy się bezpośrednio z Twoim WhatsApp Business API — koszty wiadomości to standardowe ceny Meta, nie markup Freshy." },
        { q: "Czy AI-recepcjonista ManicBota faktycznie odpisuje sensownie?", a: "Tak. Możesz przetestować na demo salonie (link na stronie głównej) — AI obsługuje cały booking flow PL/RU/UK/EN, eskaluje nietypowe pytania do właściciela, działa 24/7." },
      ],
      ru: [
        { q: "29 PLN/мес Fresha ДЕЙСТВИТЕЛЬНО дешевле чем 45 PLN/мес ManicBot?", a: "Номинально — да, в первый месяц без новых клиентов. С 10 новыми клиентами в месяц при avg визит 150 PLN добавьте 300 PLN комиссии Fresha → 329 PLN итого. ManicBot всё ещё 45 PLN flat. Чем больше растёте, тем дороже модель Fresha." },
        { q: "Могу ли я использовать свой WhatsApp вместо платного через Fresha?", a: "Fresha требует, чтобы SMS/WhatsApp шли через их gateway. ManicBot подключается напрямую к вашему WhatsApp Business API — стоимость сообщений = стандартные цены Meta, без markup." },
        { q: "AI-ресепшен ManicBot реально нормально отвечает?", a: "Да. Можно протестировать на демо-салоне (ссылка на главной) — AI ведёт весь booking flow на PL/RU/UK/EN, эскалирует нестандартные вопросы владельцу, работает 24/7." },
      ],
      ua: [
        { q: "29 PLN/міс Fresha ДІЙСНО дешевша ніж 45 PLN/міс ManicBot?", a: "Номінально — так, у перший місяць без нових клієнтів. З 10 новими клієнтами щомісяця при avg візит 150 PLN додайте 300 PLN комісії Fresha → 329 PLN разом. ManicBot все ще 45 PLN flat." },
        { q: "Чи можу я використовувати свій WhatsApp замість платного через Fresha?", a: "Fresha вимагає, щоб SMS/WhatsApp йшли через їхній gateway. ManicBot під'єднується напряму до вашого WhatsApp Business API." },
        { q: "AI-ресепшен ManicBot реально нормально відповідає?", a: "Так. Можна протестувати на демо-салоні — AI веде весь booking flow PL/RU/UK/EN, ескалює нестандартні питання власнику, працює 24/7." },
      ],
      en: [
        { q: "Is Fresha's 29 PLN/mo REALLY cheaper than ManicBot's 45 PLN/mo?", a: "On the sticker, yes — for the first month with zero new clients. Add 10 new clients per month at avg 150 PLN per visit and you owe Fresha 300 PLN in commission → 329 PLN total. ManicBot is still 45 PLN flat. The more you grow, the more expensive Fresha gets." },
        { q: "Can I use my own WhatsApp instead of paying per-message through Fresha?", a: "Fresha routes all SMS/WhatsApp through its own gateway. ManicBot connects directly to your WhatsApp Business API — message costs are Meta's standard rates, not Fresha's markup." },
        { q: "Does the ManicBot AI receptionist actually respond sensibly?", a: "Yes. Test it on the demo salon (link on the homepage) — the AI handles the entire booking flow in PL/RU/UK/EN, escalates unusual questions to the owner, runs 24/7." },
      ],
    },
  },
  {
    slug: "manicbot-vs-yclients",
    competitorName: "Yclients",
    competitorEstablished: "2010, Moscow",
    pricingSourceUrl: "https://yclients.com/en/info/pricing",
    pricingVerifiedManual: false,
    heroSummary: {
      pl: "Yclients to dojrzała platforma rosyjska. Dla salonu w Polsce: jurysdykcja rosyjska, kanały WhatsApp/Instagram/Telegram tylko przez płatne integracje 3rd party, brak AI-recepcjonisty, polski tylko jako tłumaczenie. ManicBot jest natywnie polski, EU-region, AI w pakiecie.",
      ru: "Yclients — зрелая российская платформа. Для салона в Польше: российская юрисдикция, каналы WhatsApp/Instagram/Telegram только через платные 3rd-party интеграции, без AI-ресепшена, польский только как перевод. ManicBot нативно польский, EU-region, AI в пакете.",
      ua: "Yclients — зріла російська платформа. Для салону в Польщі: російська юрисдикція, канали WhatsApp/Instagram/Telegram лише через платні 3rd-party інтеграції, без AI-ресепшена, польська лише як переклад.",
      en: "Yclients is a mature Russian platform. For a salon in Poland: Russia-domiciled, WhatsApp/Instagram/Telegram are paid 3rd-party integrations, no AI receptionist, Polish only as a translation layer. ManicBot is Polish-native, EU-region, AI in the bundle.",
    },
    rows: [
      { label: LABELS.entryPrice,  manicbot: "45 PLN / mo",      competitor: "~$8 / mo (5 employees)" },
      { label: LABELS.trial,       manicbot: "14 days",          competitor: "7 days" },
      { label: LABELS.commission,  manicbot: "0% forever",       competitor: "0%" },
      { label: LABELS.telegram,    manicbot: "✓ native + AI",    competitor: "Via paid 3rd-party (Wazzup etc.)" },
      { label: LABELS.whatsapp,    manicbot: "✓ native + AI",    competitor: "Via paid 3rd-party" },
      { label: LABELS.instagram,   manicbot: "✓ native + AI",    competitor: "Via paid 3rd-party" },
      { label: LABELS.ai24,        manicbot: "✓ PL/RU/UK/EN",    competitor: "✗" },
      { label: LABELS.gcal,        manicbot: "✓ two-way",        competitor: "✓ two-way" },
      { label: LABELS.hq,          manicbot: "Poland / EU",      competitor: "Russia",                  winnerLeft: true },
      { label: LABELS.langs,       manicbot: "PL, RU, UK, EN",   competitor: "RU primary; PL partial" },
    ],
    whyManicbot: {
      pl: [
        "Zbudowany dla EU. Cloudflare D1 w regionie EU, polski-pierwszy UX, rozliczanie Stripe w PLN, GDPR-natywny. Yclients to rosyjski produkt w angielskiej skórce.",
        "Kanały są natywne, nie wkręcone. Telegram + IG + WhatsApp + web w jednym AI-recepcjonistce z jednym inboxem. W Yclients sklejasz Wazzup + chatbota + dostawcę SMS i płacisz każdemu osobno.",
        "AI prowadzi rozmowę. Yclients to kalendarz + formularze. ManicBot to kalendarz + AI-recepcjonista, który 24/7 odpowiada w PL/RU/UK/EN, eskaluje tylko gdy trzeba.",
      ],
      ru: [
        "Построен для EU. Cloudflare D1 в EU-регионе, польский-первый UX, расчёты Stripe в PLN, GDPR-нативный. Yclients — российский продукт в английской обложке.",
        "Каналы нативные, не прикрученные. Telegram + IG + WhatsApp + web в одном AI-ресепшене с одним inbox. В Yclients вы склеиваете Wazzup + чатбот + SMS-провайдер и платите каждому отдельно.",
        "AI ведёт разговор. Yclients — это календарь + формы. ManicBot — это календарь + AI-ресепшен, который 24/7 отвечает на PL/RU/UK/EN, эскалирует только когда нужно.",
      ],
      ua: [
        "Побудований для EU. Cloudflare D1 в EU-регіоні, польський-перший UX, розрахунки Stripe у PLN, GDPR-нативний. Yclients — російський продукт в англійській обкладинці.",
        "Канали нативні, не прикручені. Telegram + IG + WhatsApp + web в одному AI-ресепшені з одним inbox. У Yclients ви склеюєте Wazzup + чатбот + SMS-провайдер і платите кожному окремо.",
        "AI веде розмову. Yclients — це календар + форми. ManicBot — це календар + AI-ресепшен, який 24/7 відповідає PL/RU/UK/EN.",
      ],
      en: [
        "Built for the EU. Cloudflare D1 in the EU region, Polish-first UX, Stripe billing in PLN, GDPR-native (cookie consent log, marketing consent log, role-based access). Yclients is a Russian product wearing an English skin.",
        "Channels are native, not bolted on. Telegram + IG + WhatsApp + web in one AI receptionist with one unified inbox. With Yclients you glue together Wazzup + a chatbot + an SMS provider and pay each separately.",
        "AI drives the conversation. Yclients is calendars + forms. ManicBot is calendars + a 24/7 multilingual AI receptionist that only escalates when it should.",
      ],
    },
    faqs: {
      pl: [
        { q: "Czy Yclients jest legalny w Polsce po 2022?", a: "Yclients sam działa technicznie, ale Twoje dane salonu i klientów lecą do rosyjskiej infrastruktury. To budzi pytania GDPR i rezydencji danych dla wielu polskich salonów. Altegio (spin-off Yclients) ma siedzibę EU/Cypr i jest preferowany — ale wciąż nie ma natywnych kanałów WA/IG/TG ani AI." },
        { q: "Czy mogę zaimportować klientów z Yclients?", a: "Tak — ManicBot importuje CSV/Excel ze standardowymi polami klienta. Skontaktuj się z supportem, pomożemy z mapowaniem pól z eksportu Yclients." },
        { q: "Co z analityką salonową? Yclients ma bogate raporty.", a: "ManicBot ma raporty no-show, revenue per master, conversion z poszczególnych kanałów, daily/weekly/monthly. To 90% tego, co większość salonów rzeczywiście używa z Yclients. Pełna księgowość + payroll — w roadmapie Q3 2026." },
      ],
      ru: [
        { q: "Yclients легален в Польше после 2022?", a: "Сам Yclients технически работает, но ваши данные салона и клиентов улетают в российскую инфраструктуру. Это вызывает вопросы GDPR и резидентства данных у многих польских салонов. Altegio (спин-офф Yclients) с EU/Кипр-юрисдикцией предпочтительнее — но всё ещё без нативных каналов WA/IG/TG и AI." },
        { q: "Можно ли импортировать клиентов из Yclients?", a: "Да — ManicBot импортирует CSV/Excel со стандартными полями клиента. Свяжитесь с support — поможем с маппингом полей из экспорта Yclients." },
        { q: "А что с аналитикой? У Yclients богатые отчёты.", a: "ManicBot имеет отчёты no-show, выручка по мастерам, конверсия по каналам, daily/weekly/monthly. Это 90% того, что большинство салонов реально используют из Yclients. Полная бухгалтерия + payroll — в roadmap на Q3 2026." },
      ],
      ua: [
        { q: "Yclients легальний у Польщі після 2022?", a: "Сам Yclients технічно працює, але ваші дані салону і клієнтів летять у російську інфраструктуру. Це викликає питання GDPR і резидентства даних. Altegio (спін-офф Yclients) з EU/Кіпр-юрисдикцією переважніший — але все ще без нативних каналів WA/IG/TG і AI." },
        { q: "Чи можна імпортувати клієнтів з Yclients?", a: "Так — ManicBot імпортує CSV/Excel зі стандартними полями клієнта. Зв'яжіться з support — допоможемо з маппінгом полів з експорту Yclients." },
        { q: "А що з аналітикою? У Yclients багаті звіти.", a: "ManicBot має звіти no-show, виручка по майстрах, конверсія по каналах, daily/weekly/monthly. Це 90% того, що більшість салонів реально використовують з Yclients." },
      ],
      en: [
        { q: "Is Yclients legal in Poland post-2022?", a: "Yclients itself works technically, but your salon and client data lives on Russian infrastructure — that raises GDPR and data-residency questions for many Polish salons. Altegio (the Yclients spin-off) is EU/Cyprus-domiciled and is the preferred fork — but it still has no native WA/IG/TG channels and no AI." },
        { q: "Can I import clients from Yclients?", a: "Yes — ManicBot imports CSV/Excel with standard client fields. Contact support and we'll help map the fields from your Yclients export." },
        { q: "What about reporting? Yclients has rich analytics.", a: "ManicBot has no-show reports, revenue per master, conversion per channel, daily/weekly/monthly. That's 90% of what most salons actually use from Yclients. Full accounting + payroll is on the Q3 2026 roadmap." },
      ],
    },
  },
  {
    slug: "manicbot-vs-versum",
    competitorName: "Versum",
    competitorEstablished: "2010 Poland, acquired by Booksy 2020",
    pricingSourceUrl: "https://www.versum.com/m/",
    pricingVerifiedManual: false,
    heroSummary: {
      pl: "Versum to dojrzały polski produkt — przejęty przez Booksy w 2020. Roadmap w rękach Booksy oznacza, że długoterminowy kierunek jest niepewny. Brak Telegrama, brak konwersacyjnego AI, ceny ukryte za demo. ManicBot ma jasny cennik, niezależny roadmap i AI z kanałami w pakiecie.",
      ru: "Versum — зрелый польский продукт, поглощённый Booksy в 2020. Roadmap в руках Booksy означает, что долгосрочное направление неопределённо. Нет Telegram, нет conversational AI, цены спрятаны за демо. ManicBot имеет ясный прайсинг, независимый roadmap и AI с каналами в пакете.",
      ua: "Versum — зрілий польський продукт, поглинутий Booksy в 2020. Roadmap у руках Booksy означає, що довгостроковий напрямок невизначений. Немає Telegram, немає conversational AI, ціни сховані за демо.",
      en: "Versum is a mature Polish product — acquired by Booksy in 2020. Roadmap owned by Booksy means long-term direction is uncertain. No Telegram, no conversational AI, pricing hidden behind a demo. ManicBot has transparent pricing, independent roadmap, and AI + channels in the bundle.",
    },
    rows: [
      { label: LABELS.entryPrice,  manicbot: "45 PLN / mo (transparent)", competitor: "Demo only (~$25 / mo reported)", winnerLeft: true },
      { label: LABELS.trial,       manicbot: "14 days",                   competitor: "Unspecified" },
      { label: LABELS.commission,  manicbot: "0% forever",                competitor: "0% (but roadmap owned by Booksy)" },
      { label: LABELS.telegram,    manicbot: "✓ native + AI",             competitor: "✗" },
      { label: LABELS.whatsapp,    manicbot: "✓ native + AI",             competitor: "✗" },
      { label: LABELS.instagram,   manicbot: "✓ native + AI",             competitor: "✗" },
      { label: LABELS.ai24,        manicbot: "✓ PL/RU/UK/EN",             competitor: "✗" },
      { label: LABELS.gcal,        manicbot: "✓ two-way",                 competitor: "✓" },
      { label: LABELS.hq,          manicbot: "Poland / EU",               competitor: "Poland (now Booksy)" },
      { label: LABELS.langs,       manicbot: "PL, RU, UK, EN",            competitor: "10+ including PL" },
    ],
    whyManicbot: {
      pl: [
        "Nowoczesne kanały. Versum to produkt z lat 2010-tych — SMS + formularze online. ManicBot spotyka klientów w aplikacjach, których już używają: Telegram, IG, WhatsApp, z AI 24/7.",
        "Przejrzysty cennik. 45/60/90 PLN opublikowane na stronie głównej. Versum każe zarezerwować demo, żeby zobaczyć liczby — kolor flagi dla większości SMB.",
        "Niezależny roadmap. Przyszłość Versum to cokolwiek zdecyduje Booksy. ManicBot to własny produkt z własnym roadmapem i własnym założycielem.",
      ],
      ru: [
        "Современные каналы. Versum — продукт из 2010-х: SMS + онлайн-формы. ManicBot встречает клиентов в приложениях, которые они уже используют: Telegram, IG, WhatsApp, с AI 24/7.",
        "Прозрачный прайсинг. 45/60/90 PLN опубликованы на главной. Versum заставляет резервировать демо, чтобы увидеть цифры — красный флаг для большинства SMB.",
        "Независимый roadmap. Будущее Versum — то, что решит Booksy. ManicBot — собственный продукт со своим roadmap и основателем.",
      ],
      ua: [
        "Сучасні канали. Versum — продукт з 2010-х: SMS + онлайн-форми. ManicBot зустрічає клієнтів у додатках, які вони вже використовують: Telegram, IG, WhatsApp, з AI 24/7.",
        "Прозорий прайсинг. 45/60/90 PLN опубліковані на головній. Versum змушує резервувати демо, щоб побачити цифри.",
        "Незалежний roadmap. Майбутнє Versum — те, що вирішить Booksy. ManicBot — власний продукт зі своїм roadmap і засновником.",
      ],
      en: [
        "Modern channels. Versum is a 2010s salon-software product — SMS + online forms. ManicBot meets clients in the apps they already use: Telegram, IG, WhatsApp, with 24/7 AI.",
        "Transparent pricing. 45/60/90 PLN published on the homepage. Versum makes you book a demo just to see numbers — red flag for most SMBs.",
        "Independent roadmap. Versum's future is whatever Booksy decides. ManicBot is its own product with its own roadmap and its own founder.",
      ],
    },
    faqs: {
      pl: [
        { q: "Czy Versum jest jeszcze rozwijany?", a: "Versum jest własnością Booksy od 2020. Otrzymuje krytyczne fixy, ale nowe funkcje (AI, kanały messenger, nowoczesne integracje) idą do Booksy, nie do Versum. Wiele istniejących klientów Versum jest cicho migrowanych na Booksy." },
        { q: "Czy mogę zmigrować dane salonowe z Versum do ManicBota?", a: "Tak — ManicBot importuje listy klientów, katalog usług i historię rezerwacji z eksportów CSV. Skontaktuj się z supportem, pomożemy z mapowaniem schemy Versum." },
        { q: "Czy Versum nie ma AI w jakiejś formie?", a: "Versum ma automatyczne przypomnienia SMS i potwierdzenia, ale to nie jest AI w sensie rozmowy z klientem — to wysłanie szablonu w odpowiedniej chwili. ManicBot AI prowadzi pełną konwersację: rozumie pytania, dobiera termin, eskaluje gdy trzeba." },
      ],
      ru: [
        { q: "Versum ещё развивается?", a: "Versum принадлежит Booksy с 2020. Получает критические фиксы, но новые функции (AI, messenger-каналы, современные интеграции) идут в Booksy, не в Versum. Многих существующих клиентов Versum тихо мигрируют на Booksy." },
        { q: "Можно ли мигрировать данные салона из Versum в ManicBot?", a: "Да — ManicBot импортирует списки клиентов, каталог услуг и историю записей из CSV-экспортов. Свяжитесь с support — поможем с маппингом схемы Versum." },
        { q: "У Versum нет AI в каком-то виде?", a: "У Versum есть автоматические SMS-напоминания и подтверждения, но это не AI в смысле разговора с клиентом — это отправка шаблона в нужный момент. AI ManicBot ведёт полную конверсацию: понимает вопросы, подбирает время, эскалирует когда нужно." },
      ],
      ua: [
        { q: "Versum ще розвивається?", a: "Versum належить Booksy з 2020. Отримує критичні фікси, але нові функції (AI, messenger-канали, сучасні інтеграції) йдуть у Booksy, не у Versum." },
        { q: "Чи можна мігрувати дані салону з Versum до ManicBot?", a: "Так — ManicBot імпортує списки клієнтів, каталог послуг та історію записів з CSV-експортів." },
        { q: "У Versum немає AI в якомусь вигляді?", a: "У Versum є автоматичні SMS-нагадування і підтвердження, але це не AI у сенсі розмови з клієнтом. AI ManicBot веде повну конверсацію." },
      ],
      en: [
        { q: "Is Versum still being developed?", a: "Versum has been owned by Booksy since 2020. It gets critical fixes, but new features (AI, messenger channels, modern integrations) go to Booksy, not Versum. Many existing Versum customers are quietly being migrated to Booksy." },
        { q: "Can I migrate salon data from Versum to ManicBot?", a: "Yes — ManicBot imports client lists, service catalogs, and booking history from CSV exports. Contact support and we'll help map the Versum schema." },
        { q: "Doesn't Versum have some kind of AI?", a: "Versum has automated SMS reminders and confirmations, but that's not AI as in conversing with the client — it's sending a template at the right moment. The ManicBot AI runs a full conversation: understands questions, picks a slot, escalates when needed." },
      ],
    },
  },
];

export function findComparison(slug: string): ComparisonPage | undefined {
  return COMPARISONS.find((c) => c.slug === slug);
}
