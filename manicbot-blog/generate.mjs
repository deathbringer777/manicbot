import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTEGRATED =
  process.env.BLOG_INTEGRATED === "1" || process.env.BLOG_INTEGRATED === "true";
const OUT = process.env.BLOG_OUT
  ? process.env.BLOG_OUT
  : INTEGRATED
    ? join(__dirname, "..", "manicbot-analysis", "public", "blog")
    : join(__dirname, "dist");
/** Public URL prefix (path on manicbot.com — no separate subdomain/DNS). */
const SITE = "https://manicbot.com/blog";
const MAIN = "https://manicbot.com";
const OG_IMG = "https://manicbot.com/og-image.png";

const langs = [
  { code: "ru", hreflang: "ru", og: "ru_RU" },
  { code: "en", hreflang: "en", og: "en_US" },
  { code: "ua", hreflang: "uk", og: "uk_UA" },
  { code: "pl", hreflang: "pl", og: "pl_PL" },
];

/** @type {Record<string, Record<string, { title: string; description: string; h1: string; body: string[] }>>} */
const articles = {
  "manicbot-telegram-booking": {
    ru: {
      title: "ManicBot: запись клиентов в Telegram для салонов красоты",
      description:
        "Как Telegram-бот ManicBot снижает нагрузку на администраторов: запись 24/7, напоминания, Google Calendar и мультиязычность для салонов в ЕС.",
      h1: "ManicBot — запись в Telegram, которую любят гости и владельцы салонов",
      body: [
        "Салоны красоты в Европе сталкиваются с одним и тем же: гости пишут в Instagram, в WhatsApp, звонят вечером и в выходные. Пока студия закрыта, заявки теряются, а администратор тратит часы на переписку с одними и теми же вопросами о ценах и свободных слотах.",
        "ManicBot переносит сценарий записи в привычный Telegram. Клиент не устанавливает новое приложение: он ведёт себя так же, как в обычном чате, а бот последовательно проводит его через выбор услуги, мастера и времени. Владелец получает структурированное подтверждение без хаоса в личных сообщениях.",
        "Для европейского рынка важны дисциплина календаря и отсутствие двойных броней. Интеграция с Google Calendar позволяет держать расписание в одном источнике правды. Автоматические напоминания снижают количество неявок — а это прямая экономия времени мастеров и кресла.",
        "ManicBot поддерживает несколько языков интерфейса, что особенно полезно в Польше и приграничных регионах, где клиенты говорят на разных языках. ИИ-помощник отвечает на типовые вопросы о прайсе и услугах, разгружая персонал и ускоряя путь от интереса к записи.",
        "Итог: меньше ручной рутины, больше предсказуемой загрузки и спокойный сервис для гостей. Попробовать сценарий можно с главной страницы ManicBot — без лишних интеграций на старте.",
      ],
    },
    en: {
      title: "ManicBot: Telegram client booking for beauty salons",
      description:
        "How ManicBot reduces admin load: 24/7 booking, reminders, Google Calendar sync, and multilingual UX for salons across the EU.",
      h1: "ManicBot — Telegram booking guests already understand",
      body: [
        "Beauty businesses across Europe see the same pattern: DMs on Instagram, WhatsApp threads, and late-night calls. When the desk is closed, leads go cold, while staff spend hours repeating prices and availability.",
        "ManicBot moves the entire flow into Telegram. Guests do not install a new app; they chat naturally while the bot guides them through service, stylist, and time. Owners get clean confirmations instead of fragmented messages.",
        "For EU operations, calendar discipline matters. Google Calendar sync keeps one source of truth and helps avoid double bookings. Automated reminders cut no-shows — directly protecting chair time and revenue.",
        "Multilingual interfaces fit Poland and border cities where clients switch languages. An AI assistant answers repetitive pricing questions so your team can focus on craft and hospitality.",
        "The outcome is less manual work, more predictable occupancy, and a calmer guest experience. You can try the flow from the ManicBot homepage without a heavy setup project.",
      ],
    },
    ua: {
      title: "ManicBot: запис клієнтів у Telegram для салонів краси",
      description:
        "Як бот ManicBot зменшує навантаження на адміністраторів: запис цілодобово, нагадування, Google Calendar і кілька мов для салонів у ЄС.",
      h1: "ManicBot — запис у Telegram, зручний для гостей і власників",
      body: [
        "Салони в Європі щодня отримують звернення з різних каналів: соцмережі, месенджери, дзвінки після годин роботи. Частина запитів губиться, а адміністратори повторюють одні й ті самі відповіді про ціни та вільний час.",
        "ManicBot переносить запис у Telegram. Клієнту не потрібне нове застосунок: він спілкується у звичному форматі, а бот веде по кроках — послуга, майстер, час. Ви отримуєте чітке підтвердження без хаосу в особистих повідомленнях.",
        "Для роботи в ЄС критично мати єдиний календар. Синхронізація з Google Calendar зменшує ризик подвійних бронювань. Автоматичні нагадування знижують неявки — це економія часу майстрів і завантаження крісел.",
        "Кілька мов інтерфейсу доречні в Польщі та містах зі змішаною аудиторією. ШІ допомагає з типовими питаннями про прайс і послуги, щоб команда могла зосередитися на сервісі.",
        "Результат — менше ручної рутини, стабільніше завантаження та спокійніший досвід для гостей. Почати можна з головної сторінки ManicBot без складного старту.",
      ],
    },
    pl: {
      title: "ManicBot: rezerwacje klientów w Telegramie dla salonów beauty",
      description:
        "Jak ManicBot odciąża recepcję: rezerwacje 24/7, przypomnienia, Google Calendar i wielojęzyczność dla salonów w UE.",
      h1: "ManicBot — rezerwacja w Telegramie, którą goście już znają",
      body: [
        "Salony w Europie codziennie odbierają zapytania z social mediów, komunikatorów i telefonu po godzinach. Część leadów znika, a zespół powtarza te same informacje o cenniku i wolnych terminach.",
        "ManicBot przenosi proces do Telegrama. Klient nie instaluje nowej aplikacji — pisze jak zwykle, a bot prowadzi przez wybór usługi, stylisty i godziny. Właściciel dostaje czytelne potwierdzenie bez bałaganu w wiadomościach prywatnych.",
        "W UE liczy się dyscyplina kalendarza. Synchronizacja z Google Calendar daje jedno źródło prawdy i ogranicza podwójne rezerwacje. Automatyczne przypomnienia zmniejszają no-show, chroniąc czas pracy stanowisk.",
        "Wielojęzykowy interfejs sprawdza się w Polsce i przygranicznych miastach, gdzie goście mówią różnymi językami. Asystent AI odpowiada na powtarzalne pytania o ceny, więc zespół może skupić się na obsłudze.",
        "Efekt: mniej ręcznej pracy, bardziej przewidywalne obłożenie i spokojniejszy customer journey. Scenariusz można przetestować ze strony głównej ManicBot bez skomplikowanego wdrożenia.",
      ],
    },
  },
  "ai-beauty-europe-poland": {
    ru: {
      title: "ИИ и beauty в Европе и Польше: тренды 2026",
      description:
        "Как искусственный интеллект меняет салоны красоты: от чат-ботов до персонализации. Фокус на Польше и рынке ЕС.",
      h1: "Как ИИ меняет beauty-индустрию в Европе и Польше",
      body: [
        "Европейский рынок beauty стал зрелым: клиенты ожидают мгновенных ответов, прозрачных цен и уважения к времени. В Польше, где конкуренция салонов высока в городах вроде Варшавы, Кракова и Вроцлава, побеждает тот, кто снимает трение на этапе записи и коммуникации.",
        "ИИ здесь не заменяет мастера, а закрывает первую линию: прайс-листы, доступность слотов, политика отмены, напоминания. Это снижает нагрузку на ресепшен и уменьшает количество «потерянных» диалогов в соцсетях.",
        "Регуляторный контекст ЕС напоминает о приватности и прозрачной коммуникации. Хороший сценарий — когда бот явно обозначает, что это автоматизация, даёт путь к человеку и не собирает лишние данные.",
        "Для польских салонов мультиязычность — конкурентное преимущество: туристы, экспаты и билингвальные районы. Боты с локализацией и календарной синхронизацией дают единый стандарт сервиса без найма дополнительных администраторов.",
        "ManicBot как раз про такой прагматичный ИИ: запись в Telegram, синхронизация с Google Calendar и языки, которые подстраиваются под гостя. Это инфраструктурный слой, который усиливает бренд салона, а не гаджет ради хайпа.",
      ],
    },
    en: {
      title: "AI and the beauty industry in Europe & Poland — 2026 trends",
      description:
        "How AI reshapes salons: chat automation, personalization, and calendar discipline. A practical look at Poland and the wider EU market.",
      h1: "How AI is changing the European beauty sector — with a lens on Poland",
      body: [
        "European clients expect fast answers, clear pricing, and respect for their time. In Poland’s competitive cities — Warsaw, Kraków, Wrocław — salons win when they remove friction at booking and first contact.",
        "AI does not replace craft; it handles tier-one work: price lists, slot availability, cancellation policy, reminders. That lowers front-desk load and stops valuable DMs from going stale.",
        "The EU context pushes privacy-aware design. Strong automation states when a bot is involved, offers a human escalation path, and avoids collecting data you do not need.",
        "Polish salons benefit from multilingual experiences serving tourists, expats, and mixed-language neighborhoods. Calendar-backed bots create a consistent service standard without extra headcount.",
        "ManicBot embodies pragmatic AI: Telegram-native booking, Google Calendar sync, and locale-aware UX. It is infrastructure that strengthens your brand instead of novelty for its own sake.",
      ],
    },
    ua: {
      title: "ШІ та beauty в Європі й Польщі: тренди 2026",
      description:
        "Як штучний інтелект змінює салони: чат-автоматизація, персоналізація та календарна дисципліна. Польща та ринок ЄС.",
      h1: "Як ШІ змінює beauty-галузь у Європі та Польщі",
      body: [
        "Європейські клієнти очікують швидких відповідей і прозорих цін. У конкурентних польських містах перемагає той, хто спрощує запис і перше звернення.",
        "ШІ не замінює майстра — він закриває першу лінію: ціни, вільні слоти, політика скасування, нагадування. Це зменшує навантаження на адміністрацію та зменшує втрату звернень у соцмережах.",
        "У контексті ЄС важливі приватність і чесна комунікація. Добре, коли бот прозоро позначає автоматизацію, дає вихід до людини й не збирає зайві дані.",
        "Для салонів у Польщі багатомовність — перевага: туристи, експати, змішані мови в одному районі. Боти з локалізацією та синхронізацією календаря вирівнюють сервіс без нових наймів.",
        "ManicBot — практичний ШІ: запис у Telegram, Google Calendar і мови під гостя. Це інфраструктура для бренду, а не хайп ради хайпу.",
      ],
    },
    pl: {
      title: "AI a branża beauty w Europie i Polsce — trendy 2026",
      description:
        "Jak sztuczna inteligencja zmienia salony: automatyzacja czatu, personalizacja i kalendarz. Polska i rynek UE.",
      h1: "Jak AI zmienia europejski sektor beauty — ze szczególnym uwzględnieniem Polski",
      body: [
        "Klienci w Europie oczekują szybkich odpowiedzi i jasnych cen. W polskich miastach o wysokiej konkurencji wygrywa ten, kto usuwa tarcie przy pierwszym kontakcie i rezerwacji.",
        "AI nie zastępuje mistrzyni zawodu — przejmuje pierwszą linię: cennik, dostępność terminów, politykę anulowań, przypomnienia. To odciąża recepcję i zapobiega „zgnięciu” leadów w social media.",
        "Kontekst UE podkreśla prywatność i transparentność. Dobry bot jasno komunikuje automatyzację, oferuje eskalację do człowieka i nie zbiera zbędnych danych.",
        "W Polsce wielojęzyczność to przewaga: turyści, expaci, mieszane środowiska językowe. Boty z lokalizacją i synchronizacją kalendarza utrzymują spójny standard bez dokładania etatów.",
        "ManicBot to pragmatyczne AI: rezerwacje w Telegramie, Google Calendar i języki dopasowane do gościa. To infrastruktura dla marki, a nie gadżet bez strategii.",
      ],
    },
  },
  "automation-sales-europe": {
    ru: {
      title: "Автоматизация и продажи в beauty: опыт Европы",
      description:
        "Почему автоматизация записи и коммуникаций увеличивает конверсию в салонах ЕС: скорость ответа, меньше no-show, прозрачная воронка.",
      h1: "Как автоматизация усиливает продажи в европейском beauty-сегменте",
      body: [
        "В продажах услуг решает скорость и предсказуемость. Исследования рынка сервисов показывают: чем быстрее клиент получает подтверждение слота, тем выше вероятность визита. В Европе, где графики плотные, задержка в несколько часов часто означает потерю брони в пользу конкурента.",
        "Автоматизация записи закрывает окно «салон не ответил». Бот в мессенджере работает ночью и в выходные, превращая отложенный интерес в конкретную дату и время. Это особенно важно для частных мастеров без выделенной администрации.",
        "Напоминания и лёгкое перенесение визита снижают no-show — один из главных скрытых убытков индустрии. Когда клиент может подтвердить или отменить в один тап, загрузка кресла становится более честной и планируемой.",
        "Интеграция с календарём даёт аналитику загрузки: какие услуги «забивают» прайм-тайм, где есть дыры. Владелец видит воронку от первого сообщения до оплаченного визита и может точечно усиливать маркетинг.",
        "ManicBot объединяет эти элементы: Telegram как канал с низким порогом входа, Google Calendar как операционная правда, мультиязычие и ИИ для типовых вопросов. Так автоматизация напрямую поддерживает выручку, а не только «цифровизацию ради отчёта».",
      ],
    },
    en: {
      title: "Automation and sales growth in European beauty businesses",
      description:
        "Why booking automation lifts conversion: faster replies, fewer no-shows, and a transparent funnel for EU salons and solo artists.",
      h1: "How automation improves sales across the European beauty market",
      body: [
        "Service sales hinge on speed and certainty. When guests receive a confirmed slot quickly, show rates improve. Across Europe’s dense calendars, a few hours of silence often means the booking goes elsewhere.",
        "Automated booking removes the “nobody replied” gap. A messenger bot captures interest at night or on weekends and converts it into a concrete time — crucial for solo pros without a front desk.",
        "Reminders plus easy reschedule flows reduce no-shows, one of the industry’s quietest profit leaks. One-tap confirm or cancel makes chair utilization honest and forecastable.",
        "Calendar integration surfaces utilization patterns: which services fill prime time and where gaps persist. Owners can see the path from first message to paid visit and tune marketing precisely.",
        "ManicBot bundles these levers: Telegram for low-friction access, Google Calendar as operational truth, multilingual UX, and AI for repetitive Q&A. The result is automation tied to revenue, not checkbox modernization.",
      ],
    },
    ua: {
      title: "Автоматизація та продажі в beauty: досвід Європи",
      description:
        "Чому автоматизація запису підвищує конверсію: швидкі відповіді, менше неявок, прозора воронка для салонів ЄС.",
      h1: "Як автоматизація посилює продажі в європейському beauty-сегменті",
      body: [
        "У продажу послуг вирішують швидкість і передбачуваність. Коли клієнт швидко отримує підтвердження слоту, зростає ймовірність візиту. У Європі з щільними графіками кілька годин мовчання часто означають втрату броні.",
        "Автоматизація прибирає вікно «салон не відповів». Бот у месенджері працює вночі та у вихідні, перетворюючи інтерес на конкретний час — це критично для майстрів без адміністратора.",
        "Нагадування та просте перенесення зменшують неявки — приховані втрати індустрії. Підтвердження або скасування в один дотик робить завантаження крісла прогнозованим.",
        "Інтеграція з календарем показує завантаження: які послуги заповнюють прайм-тайм, де дірки. Власник бачить шлях від першого повідомлення до оплаченого візиту.",
        "ManicBot поєднує Telegram, Google Calendar, багатомовність і ШІ для типових питань — автоматизація, яка підтримує виручку, а не лише «цифровізацію в звіті».",
      ],
    },
    pl: {
      title: "Automatyzacja a wzrost sprzedaży w europejskim beauty",
      description:
        "Dlaczego automatyzacja rezerwacji podnosi konwersję: szybkie odpowiedzi, mniej no-show, przejrzysty lejek w salonach UE.",
      h1: "Jak automatyzacja wzmacnia sprzedaż w europejskim segmencie beauty",
      body: [
        "W sprzedaży usług liczy się szybkość i przewidywalność. Im szybciej gość dostaje potwierdzony termin, tym wyższa frekwencja. W europejskich kalendarzach kilka godzin ciszy często oznacza utratę rezerwacji na rzecz konkurencji.",
        "Automatyzacja usuwa okno „nikt nie odpisał”. Bot w komunikatorze działa nocą i w weekend, zamieniając zainteresowanie w konkretną godzinę — kluczowe dla samodzielnych stylistek bez recepcji.",
        "Przypomnienia i prosta zmiana terminu ograniczają no-show — cichy koszt branży. Potwierdzenie lub anulowanie jednym dotknięciem stabilizuje obłożenie stanowisk.",
        "Integracja z kalendarzem pokazuje wykorzystanie: które usługi zapełniają prime time i gdzie są luki. Właściciel widzi ścieżkę od pierwszej wiadomości do opłaconej wizyty.",
        "ManicBot łączy Telegram, Google Calendar, wielojęzyczność i AI na powtarzalne pytania — automatyzację powiązaną z przychodem, nie tylko „cyfryzację dla raportu”.",
      ],
    },
  },
};

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function pageHtml({ slug, lang, data }) {
  const url = `${SITE}/${lang.code}/${slug}.html`;
  const alternates = langs
    .map(
      (l) =>
        `    <link rel="alternate" hreflang="${l.hreflang}" href="${SITE}/${l.code}/${slug}.html" />`
    )
    .join("\n");

  const paragraphs = data.body.map((p) => `      <p>${esc(p)}</p>`).join("\n");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: data.h1,
    description: data.description,
    inLanguage: lang.hreflang,
    author: { "@type": "Organization", name: "ManicBot" },
    publisher: {
      "@type": "Organization",
      name: "ManicBot",
      logo: { "@type": "ImageObject", url: OG_IMG },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: [OG_IMG],
  };

  return `<!DOCTYPE html>
<html lang="${lang.code}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(data.title)}</title>
  <meta name="description" content="${esc(data.description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href="${url}" />
${alternates}
  <link rel="alternate" hreflang="x-default" href="${SITE}/ru/${slug}.html" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="ManicBot Blog" />
  <meta property="og:title" content="${esc(data.title)}" />
  <meta property="og:description" content="${esc(data.description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${OG_IMG}" />
  <meta property="og:locale" content="${lang.og}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(data.title)}" />
  <meta name="twitter:description" content="${esc(data.description)}" />
  <meta name="twitter:image" content="${OG_IMG}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>
    :root { color-scheme: light dark; --fg: #0f172a; --muted: #64748b; --accent: #7c3aed; --accent2: #06b6d4; --bg: #f8fafc; }
    @media (prefers-color-scheme: dark) {
      :root { --fg: #f1f5f9; --muted: #94a3b8; --bg: #050812; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.65; }
    header { padding: 1.25rem 1.5rem; border-bottom: 1px solid rgba(124,58,237,0.15); }
    .wrap { max-width: 42rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { font-size: 1.75rem; line-height: 1.2; margin: 0 0 1rem; letter-spacing: -0.02em; }
    p { margin: 0 0 1rem; color: var(--muted); }
    .langs { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1.5rem; font-size: 0.875rem; }
    .langs a { color: var(--accent); text-decoration: none; }
    .langs a:hover { text-decoration: underline; }
    .home { font-size: 0.875rem; }
    .home a {
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      font-weight: 700;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <header>
    <div class="home"><a href="${MAIN}/">ManicBot</a> — blog</div>
  </header>
  <article class="wrap">
    <h1>${esc(data.h1)}</h1>
${paragraphs}
    <nav class="langs" aria-label="Languages">
${langs
  .map(
    (l) =>
      `      <a href="${SITE}/${l.code}/${slug}.html" hreflang="${l.hreflang}">${l.code.toUpperCase()}</a>`
  )
  .join("\n")}
    </nav>
  </article>
</body>
</html>`;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  for (const l of langs) {
    await mkdir(join(OUT, l.code), { recursive: true });
  }

  const urls = [`${SITE}/`];

  for (const slug of Object.keys(articles)) {
    for (const lang of langs) {
      const data = articles[slug][lang.code];
      const html = pageHtml({ slug, lang, data });
      const path = join(OUT, lang.code, `${slug}.html`);
      await writeFile(path, html, "utf8");
      urls.push(`${SITE}/${lang.code}/${slug}.html`);
    }
  }

  const hub = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ManicBot Blog — материалы о записи, ИИ и автоматизации в beauty</title>
  <meta name="description" content="Статьи ManicBot: Telegram-запись для салонов, ИИ в beauty в Европе и Польше, автоматизация продаж. EN/RU/UA/PL." />
  <link rel="canonical" href="${SITE}/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="ManicBot Blog" />
  <meta property="og:url" content="${SITE}/" />
  <meta property="og:image" content="${OG_IMG}" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #0f172a; }
    @media (prefers-color-scheme: dark) { body { background: #050812; color: #e2e8f0; } }
    a { color: #7c3aed; }
    ul { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <p><a href="${MAIN}/">ManicBot</a></p>
  <h1>Blog</h1>
  <p>Материалы для SEO и владельцев салонов (RU/EN/UA/PL).</p>
  <ul>
    <li><a href="${SITE}/ru/manicbot-telegram-booking.html">ManicBot и запись в Telegram (RU)</a> — <a href="${SITE}/en/manicbot-telegram-booking.html">EN</a>, <a href="${SITE}/ua/manicbot-telegram-booking.html">UA</a>, <a href="${SITE}/pl/manicbot-telegram-booking.html">PL</a></li>
    <li><a href="${SITE}/ru/ai-beauty-europe-poland.html">ИИ и beauty в Европе и Польше (RU)</a> — <a href="${SITE}/en/ai-beauty-europe-poland.html">EN</a>, <a href="${SITE}/ua/ai-beauty-europe-poland.html">UA</a>, <a href="${SITE}/pl/ai-beauty-europe-poland.html">PL</a></li>
    <li><a href="${SITE}/ru/automation-sales-europe.html">Автоматизация и продажи (RU)</a> — <a href="${SITE}/en/automation-sales-europe.html">EN</a>, <a href="${SITE}/ua/automation-sales-europe.html">UA</a>, <a href="${SITE}/pl/automation-sales-europe.html">PL</a></li>
  </ul>
</body>
</html>`;
  await writeFile(join(OUT, "index.html"), hub, "utf8");

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((loc) => `  <url><loc>${loc}</loc></url>`).join("\n")}
</urlset>`;
  await writeFile(join(OUT, "sitemap.xml"), sitemap, "utf8");

  await writeFile(
    join(OUT, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
    "utf8"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
