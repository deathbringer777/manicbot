/**
 * SEO audit 2026-05-20 P1-9 — FAQPage + Quick-Answer block for blog posts.
 *
 * Every blog detail page emits a `FAQPage` JSON-LD payload and renders
 * a "Quick answers" block at the bottom of the article. Google's FAQ
 * rich-result snippet pulls these Q&A pairs verbatim — free SERP real
 * estate for the 10 long-form posts (1100-1300 words each).
 *
 * Two-tier strategy:
 *   1. `commonBlogFaqs(lang)` — universal Q&A (cost, channels, languages)
 *      that hold for any post topic. Used as the floor when an article
 *      doesn't ship its own FAQ.
 *   2. `slugBlogFaqs(slug, lang)` — per-slug overrides for posts that
 *      have natural FAQ content (e.g. reduce-no-shows answers "how much
 *      does a deposit help?"). When present, they REPLACE the common
 *      set so the schema stays topical and not generic.
 *
 * Authors add a per-slug entry below as articles ship; the common floor
 * means every post ships valid FAQPage schema from day one.
 */

import type { Lang } from "~/lib/i18n";

export interface BlogFaq {
  q: string;
  a: string;
}

const COMMON_FAQS: Record<Lang, BlogFaq[]> = {
  pl: [
    {
      q: "Ile kosztuje ManicBot?",
      a: "Start — 45 PLN/miesiąc (1 mistrz), Pro — 60 PLN/miesiąc (5 mistrzów + AI + Google Calendar), Max — 90 PLN/miesiąc (bez limitu). 14-dniowy okres próbny. 0% prowizji od rezerwacji.",
    },
    {
      q: "Przez jakie kanały klient może się zarezerwować?",
      a: "Telegram, Instagram Direct, WhatsApp Business i widget czatu na stronie salonu. Wszystkie cztery kanały obsługiwane są przez jeden AI-recepcjonista ze wspólną historią rozmowy.",
    },
    {
      q: "Czy AI rozumie język polski?",
      a: "Tak — AI-recepcjonista odpowiada po polsku, rosyjsku, ukraińsku i angielsku. Język jest rozpoznawany z pierwszej wiadomości klienta.",
    },
  ],
  ru: [
    {
      q: "Сколько стоит ManicBot?",
      a: "Start — 45 PLN/мес (1 мастер), Pro — 60 PLN/мес (5 мастеров + AI + Google Calendar), Max — 90 PLN/мес (без лимита). 14 дней бесплатного триала. 0% комиссии с записей.",
    },
    {
      q: "Через какие каналы клиент может записаться?",
      a: "Telegram, Instagram Direct, WhatsApp Business и виджет чата на сайте салона. Все четыре канала ведёт один AI-ресепшен с общей историей переписки.",
    },
    {
      q: "Понимает ли AI русский язык?",
      a: "Да — AI-ресепшен отвечает на польском, русском, украинском и английском. Язык определяется с первого сообщения клиента.",
    },
  ],
  ua: [
    {
      q: "Скільки коштує ManicBot?",
      a: "Start — 45 PLN/міс (1 майстер), Pro — 60 PLN/міс (5 майстрів + AI + Google Calendar), Max — 90 PLN/міс (без ліміту). 14 днів безкоштовної пробної версії. 0% комісії з записів.",
    },
    {
      q: "Через які канали клієнт може записатися?",
      a: "Telegram, Instagram Direct, WhatsApp Business та віджет чату на сайті салону. Усі чотири канали веде один AI-ресепшен зі спільною історією листування.",
    },
    {
      q: "Чи розуміє AI українську мову?",
      a: "Так — AI-ресепшен відповідає польською, російською, українською та англійською. Мова визначається з першого повідомлення клієнта.",
    },
  ],
  en: [
    {
      q: "How much does ManicBot cost?",
      a: "Start — 45 PLN/mo (1 master), Pro — 60 PLN/mo (5 masters + AI + Google Calendar), Max — 90 PLN/mo (unlimited). 14-day free trial. 0% commission on bookings, ever.",
    },
    {
      q: "Which channels can clients book through?",
      a: "Telegram, Instagram Direct, WhatsApp Business, and a chat widget on the salon's website. All four channels are served by one AI receptionist with a shared conversation history.",
    },
    {
      q: "Which languages does the AI receptionist understand?",
      a: "Polish, Russian, Ukrainian, and English. The language is detected from the client's first message.",
    },
  ],
};

/**
 * Per-slug FAQ overrides. When a slug is in this map, its Q&A REPLACES
 * the common floor for that article — keeping the schema topical.
 *
 * Add a slug here when a post has natural questions it answers in the
 * body. The Q&A should mirror the body content so Google's FAQ snippet
 * gives the reader what's actually on the page.
 *
 * @see commonBlogFaqs for the universal fallback.
 */
const SLUG_FAQS: Partial<Record<string, Record<Lang, BlogFaq[]>>> = {
  "reduce-no-shows": {
    pl: [
      { q: "Jaka jest średnia stopa no-show w salonie paznokci?", a: "Branżowa średnia to 12–18% na rezerwacjach bez zadatku. Salony z systemem przypomnień i 50% zadatkiem regularnie schodzą poniżej 5%." },
      { q: "Czy zadatek odstrasza klientów?", a: "Nie, jeśli jest standardem branżowym i wyraźnie komunikowany. W Warszawie zadatek 50 PLN jest oczekiwany; konwersja spada o ~2%, ale realna przychodowość rośnie o 8–12% przez odzyskane sloty." },
      { q: "Kiedy wysyłać przypomnienie o wizycie?", a: "Najlepsze wyniki daje T-24h (potwierdź lub odwołaj) i T-2h (przypomnienie + adres). Salony z dwiema warstwami przypomnień raportują 60–70% redukcję no-show." },
    ],
    ru: [
      { q: "Какой средний уровень no-show в nail-салоне?", a: "Среднее по индустрии — 12–18% на записях без депозита. Салоны с системой напоминаний и 50% депозитом стабильно держат no-show ниже 5%." },
      { q: "Не отпугнёт ли депозит клиентов?", a: "Не отпугнёт, если это стандарт индустрии и об этом сообщают заранее. В Варшаве депозит 50 PLN — норма; конверсия падает на ~2%, но реальная выручка растёт на 8–12% за счёт спасённых слотов." },
      { q: "Когда отправлять напоминание о записи?", a: "Лучший результат: T-24ч (подтверди или отмени) и T-2ч (напоминание + адрес). Салоны с двухслойными напоминаниями снижают no-show на 60–70%." },
    ],
    ua: [
      { q: "Який середній рівень no-show в nail-салоні?", a: "Середнє по індустрії — 12–18% на записах без депозиту. Салони з системою нагадувань і 50% депозитом стабільно тримають no-show нижче 5%." },
      { q: "Чи не відлякає депозит клієнтів?", a: "Не відлякає, якщо це стандарт індустрії і про це повідомляють заздалегідь. У Варшаві депозит 50 PLN — норма; конверсія падає на ~2%, але реальна виручка зростає на 8–12% за рахунок врятованих слотів." },
      { q: "Коли надсилати нагадування про запис?", a: "Найкращий результат: T-24г (підтверди або скасуй) і T-2г (нагадування + адреса). Салони з двошаровими нагадуваннями знижують no-show на 60–70%." },
    ],
    en: [
      { q: "What's the average no-show rate at a nail salon?", a: "Industry average is 12–18% on bookings without a deposit. Salons running reminders + 50% deposit consistently keep no-shows below 5%." },
      { q: "Won't a deposit scare clients away?", a: "Not when it's an industry standard and communicated up-front. In Warsaw a 50 PLN deposit is expected; conversion dips ~2% but real revenue rises 8–12% from rescued slots." },
      { q: "When should I send appointment reminders?", a: "Best results come from a two-step cadence: T-24h (confirm or cancel) and T-2h (reminder + address). Salons running both layers report 60–70% no-show reduction." },
    ],
  },
  "automate-salon-booking": {
    pl: [
      { q: "Jak długo trwa wdrożenie automatyzacji rezerwacji?", a: "Pełna konfiguracja zajmuje 30–60 minut: rejestracja, dodanie usług i mistrzów, podłączenie Telegram + Instagram + Google Calendar. Pierwsze rezerwacje przychodzą tego samego dnia." },
      { q: "Czy AI sam potwierdza rezerwacje czy tylko proponuje?", a: "Można skonfigurować obie ścieżki: auto-potwierdzanie dla powtarzających się klientów, ręczna akceptacja dla nowych, lub odwrotnie. Każdy kanał ma osobny przełącznik." },
      { q: "Co robi AI, gdy nie zna odpowiedzi?", a: "Eskaluje do salonu: oznacza rozmowę flagą «wymaga człowieka», pisze powiadomienie w Telegramie do właściciela, kontynuuje wstrzymanie booking-flow do momentu odpowiedzi." },
    ],
    ru: [
      { q: "Сколько времени занимает внедрение автоматизации?", a: "Полная настройка — 30–60 минут: регистрация, добавление услуг и мастеров, подключение Telegram + Instagram + Google Calendar. Первые записи приходят в тот же день." },
      { q: "AI сам подтверждает записи или только предлагает?", a: "Можно настроить оба варианта: авто-подтверждение для повторных клиентов, ручная проверка для новых, или наоборот. У каждого канала свой переключатель." },
      { q: "Что делает AI, когда не знает ответа?", a: "Эскалирует в салон: помечает разговор флагом «нужен человек», пишет уведомление в Telegram владельцу, приостанавливает booking-flow до ответа." },
    ],
    ua: [
      { q: "Скільки часу займає впровадження автоматизації?", a: "Повне налаштування — 30–60 хвилин: реєстрація, додавання послуг і майстрів, підключення Telegram + Instagram + Google Calendar. Перші записи приходять того ж дня." },
      { q: "AI сам підтверджує записи чи лише пропонує?", a: "Можна налаштувати обидва варіанти: авто-підтвердження для повторних клієнтів, ручна перевірка для нових, або навпаки. У кожного каналу свій перемикач." },
      { q: "Що робить AI, коли не знає відповіді?", a: "Ескалює до салону: позначає розмову прапором «потрібна людина», пише сповіщення в Telegram власнику, призупиняє booking-flow до відповіді." },
    ],
    en: [
      { q: "How long does booking-automation setup take?", a: "Full setup runs 30–60 minutes: register, add services and masters, connect Telegram + Instagram + Google Calendar. First bookings arrive the same day." },
      { q: "Does the AI confirm bookings on its own or only suggest them?", a: "Either — you choose per channel. Auto-confirm for returning clients + manual approval for new clients is the common setup; flip it the other way around if you prefer." },
      { q: "What does the AI do when it doesn't know the answer?", a: "Escalates to the salon: tags the conversation as «needs human», pings the owner on Telegram, holds the booking flow until a human replies." },
    ],
  },
  "ai-receptionist-247": {
    pl: [
      { q: "Czy AI-recepcjonista zastępuje człowieka?", a: "Nie zastępuje — uzupełnia. Obsługuje rutynowe rezerwacje 24/7, eskaluje rozmowy wymagające oceny człowieka (nietypowe pytania, reklamacje, wrażliwe sytuacje)." },
      { q: "Jak AI radzi sobie z klientami trudnymi lub denerwującymi?", a: "Wykrywa ton i automatycznie eskaluje do właściciela. W ManicBot każda rozmowa z negatywnym sentymentem otrzymuje flagę i właściciel widzi ją na górze skrzynki." },
      { q: "Co jeśli klient prosi o coś, co nie jest w katalogu usług?", a: "AI grzecznie informuje, że taka usługa nie jest dostępna, sugeruje najbliższy odpowiednik z katalogu i opcjonalnie zostawia notatkę dla właściciela o popycie na nową usługę." },
    ],
    ru: [
      { q: "AI-ресепшен заменяет человека?", a: "Не заменяет — дополняет. Обрабатывает рутинные записи 24/7, эскалирует разговоры, требующие человеческой оценки (нестандартные вопросы, жалобы, чувствительные ситуации)." },
      { q: "Как AI справляется с трудными или нервными клиентами?", a: "Определяет тон и автоматически эскалирует владельцу. В ManicBot любой разговор с негативным сентиментом получает флаг и владелец видит его в верху inbox." },
      { q: "Что если клиент просит что-то, чего нет в каталоге услуг?", a: "AI вежливо сообщает, что такой услуги нет, предлагает ближайший аналог из каталога, и опционально оставляет заметку владельцу о спросе на новую услугу." },
    ],
    ua: [
      { q: "AI-ресепшен замінює людину?", a: "Не замінює — доповнює. Обробляє рутинні записи 24/7, ескалює розмови, що потребують людської оцінки (нестандартні питання, скарги, чутливі ситуації)." },
      { q: "Як AI справляється з важкими або нервовими клієнтами?", a: "Визначає тон і автоматично ескалює власнику. У ManicBot будь-яка розмова з негативним сентиментом отримує прапор і власник бачить її вгорі inbox." },
      { q: "Що якщо клієнт просить щось, чого немає у каталозі послуг?", a: "AI ввічливо повідомляє, що такої послуги немає, пропонує найближчий аналог із каталогу, і опціонально залишає замітку власнику про попит на нову послугу." },
    ],
    en: [
      { q: "Does the AI receptionist replace humans?", a: "It doesn't replace — it complements. Routine bookings get handled 24/7; anything needing human judgement (unusual requests, complaints, sensitive situations) escalates automatically." },
      { q: "How does the AI handle difficult or upset clients?", a: "Detects tone and auto-escalates to the owner. Every conversation flagged with negative sentiment gets pinned to the top of the salon inbox." },
      { q: "What if a client asks for a service that isn't in the catalog?", a: "The AI politely notes the service isn't available, suggests the closest catalog match, and optionally leaves a note for the owner about new-service demand." },
    ],
  },
};

/**
 * Resolve the FAQ list for a given blog slug + language. Returns the
 * per-slug list when present, otherwise the common fallback.
 *
 * Always returns at least 3 questions — the FAQPage schema requires
 * `mainEntity` to be non-empty for rich-result eligibility.
 */
export function resolveBlogFaqs(slug: string, lang: Lang): BlogFaq[] {
  const perSlug = SLUG_FAQS[slug];
  if (perSlug?.[lang]) return perSlug[lang];
  if (perSlug?.en) return perSlug.en;
  return COMMON_FAQS[lang] ?? COMMON_FAQS.en;
}

/**
 * Build the FAQPage JSON-LD payload for a blog detail page.
 */
export function blogFaqPageJsonLd(slug: string, lang: Lang) {
  const faqs = resolveBlogFaqs(slug, lang);
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
