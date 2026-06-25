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
  "instagram-bookings-2026": {
    pl: [
      { q: "Jak szybko trzeba odpowiadać na wiadomość w Instagram DM?", a: "Zasada 2026 jest twarda: odpowiedz w ciągu 5 minut albo stracisz klienta na rzecz konkurenta, który odpowiedział. AI-recepcjonista ManicBot odpowiada w Direct 24/7 w czterech językach, więc nocne „ile kosztuje?” nie czeka do rana." },
      { q: "Które formaty na Instagramie naprawdę przynoszą rezerwacje?", a: "Reels dla zasięgu (konta z Reels rosną średnio o +35% obserwujących miesięcznie), karuzele pod zapisy oraz słowa kluczowe w opisach pod wyszukiwanie. Aż 54% klientów rezerwuje po obejrzeniu wideo z metamorfozą." },
      { q: "Co wpisać w bio, żeby zamienić obserwujących w rezerwacje?", a: "Kto jesteś, gdzie działasz i jeden link prowadzący prosto do rezerwacji, plus wyzwalacz w stylu „napisz »paznokcie« w DM”. Im mniej kroków między Reelsem a wyborem terminu, tym wyższa konwersja." },
      { q: "Czy automatyzacja DM łapie komentarze pod Reelsami?", a: "Tak — ustawiasz słowo kluczowe, a komentującym automatycznie wysyłany jest link do rezerwacji w Direct. ManicBot domyka rozmowę w samym DM, bez wychodzenia z aplikacji, i pamięta klienta między Instagramem, Telegramem i WhatsAppem." },
    ],
    ru: [
      { q: "Как быстро нужно отвечать на сообщение в Instagram Direct?", a: "Правило 2026 жёсткое: ответьте в течение 5 минут или потеряете клиента конкуренту, который ответил. AI-ресепшен ManicBot отвечает в Direct 24/7 на четырёх языках, поэтому ночное «сколько стоит?» не ждёт до утра." },
      { q: "Какие форматы в Instagram реально приводят записи?", a: "Reels для охвата (аккаунты с Reels растут в среднем на +35% подписчиков в месяц), карусели под сохранения и ключевые слова в подписях под поиск. 54% клиентов записываются после видео-трансформации." },
      { q: "Что писать в bio, чтобы превратить подписчиков в записи?", a: "Кто вы, где вы и одна ссылка прямо на запись, плюс триггер вроде «напиши »ногти« в Direct». Чем меньше шагов между Reels и выбором слота, тем выше конверсия." },
      { q: "Ловит ли автоответ комментарии под Reels?", a: "Да — вы задаёте ключевое слово, и комментатору автоматически уходит ссылка на запись в Direct. ManicBot закрывает запись прямо в переписке, без выхода из приложения, и помнит клиента между Instagram, Telegram и WhatsApp." },
    ],
    ua: [
      { q: "Як швидко треба відповідати на повідомлення в Instagram Direct?", a: "Правило 2026 жорстке: відповідайте протягом 5 хвилин або втратите клієнта конкуренту, який відповів. AI-ресепшен ManicBot відповідає в Direct 24/7 чотирма мовами, тож нічне «скільки коштує?» не чекає до ранку." },
      { q: "Які формати в Instagram реально приводять записи?", a: "Reels для охоплення (акаунти з Reels зростають у середньому на +35% підписників на місяць), каруселі під збереження та ключові слова в підписах під пошук. 54% клієнтів записуються після відео-трансформації." },
      { q: "Що писати в bio, щоб перетворити підписників на записи?", a: "Хто ви, де ви та одне посилання прямо на запис, плюс тригер на кшталт «напиши »нігті« в Direct». Чим менше кроків між Reels і вибором слота, тим вища конверсія." },
      { q: "Чи ловить автовідповідь коментарі під Reels?", a: "Так — ви задаєте ключове слово, і коментатору автоматично надходить посилання на запис у Direct. ManicBot закриває запис прямо в переписці, без виходу з застосунку, і пам'ятає клієнта між Instagram, Telegram і WhatsApp." },
    ],
    en: [
      { q: "How fast must I reply to an Instagram DM?", a: "The 2026 rule is brutal: reply within 5 minutes or lose the client to a competitor who answered. ManicBot's AI receptionist replies in Direct 24/7 in four languages, so a midnight «how much?» doesn't wait until morning." },
      { q: "Which Instagram formats actually drive bookings?", a: "Reels for reach (accounts posting Reels grow ~+35% followers per month), carousels for saves, and keyword captions for search. 54% of clients book after seeing a transformation video." },
      { q: "What should my bio say to turn followers into bookings?", a: "Who you are, where you are, and one link straight to booking, plus a trigger like «DM the word nails». The fewer steps between the Reel and picking a slot, the higher the conversion." },
      { q: "Does DM automation catch comments under Reels?", a: "Yes — you set a keyword and commenters are automatically sent the booking link in Direct. ManicBot closes the booking inside the chat, with no app to leave, and remembers the client across Instagram, Telegram, and WhatsApp." },
    ],
  },
  "tiktok-for-nail-salons": {
    pl: [
      { q: "Czy TikTok naprawdę pomaga salonowi paznokci rosnąć?", a: "Tak — TikTok daje salonom mniej więcej 3× szybszy przyrost obserwujących niż inne platformy, bo algorytm pokazuje krótkie wideo osobom, które jeszcze cię nie obserwują. Ale wyświetlenia zamieniają się w rezerwacje dopiero z jasnym CTA i linkiem w profilu." },
      { q: "Jak długi powinien być klip na TikToku?", a: "Pod dooglądalność trzymaj klip poniżej 30 sekund, a hak „przed/po” w pierwszych 2 sekundach — bez intro i logo. Algorytm premiuje wysoki procent dooglądania, a krótki klip łatwiej obejrzeć do końca." },
      { q: "Dlaczego mam tyle wyświetleń, a tak mało rezerwacji?", a: "Bo wyświetlenia nie konwertują bez jasnego wezwania do działania i linku rezerwacyjnego w profilu. Skieruj link na recepcję AI ManicBota, która łapie nocny i weekendowy skok zainteresowania 24/7, gdy ty jesteś zajęta w fotelu." },
    ],
    ru: [
      { q: "TikTok правда помогает nail-салону расти?", a: "Да — TikTok даёт салонам примерно в 3× более быстрый рост подписчиков, чем другие платформы, потому что алгоритм показывает короткое видео тем, кто ещё на вас не подписан. Но просмотры превращаются в записи только с понятным CTA и ссылкой в профиле." },
      { q: "Какой длины должен быть ролик в TikTok?", a: "Под досматриваемость держите клип короче 30 секунд, а хук «до/после» — в первые 2 секунды, без интро и логотипа. Алгоритм ценит высокий процент досмотра, а короткий ролик легче досмотреть до конца." },
      { q: "Почему у меня много просмотров, но мало записей?", a: "Потому что просмотры не конвертируются без понятного призыва к действию и ссылки на запись в профиле. Ведите ссылку в AI-администратора ManicBot — он ловит ночной и выходной всплеск интереса 24/7, пока вы заняты в кресле." },
    ],
    ua: [
      { q: "TikTok справді допомагає nail-салону рости?", a: "Так — TikTok дає салонам приблизно в 3× швидше зростання підписників, ніж інші платформи, бо алгоритм показує коротке відео тим, хто ще на вас не підписаний. Але перегляди перетворюються на записи лише зі зрозумілим CTA і посиланням у профілі." },
      { q: "Якої довжини має бути ролик у TikTok?", a: "Під досматрюваність тримайте кліп коротше 30 секунд, а хук «до/після» — у перші 2 секунди, без інтро і логотипа. Алгоритм цінує високий відсоток досмотру, а короткий ролик легше додивитися до кінця." },
      { q: "Чому в мене багато переглядів, але мало записів?", a: "Бо перегляди не конвертуються без зрозумілого заклику до дії та посилання на запис у профілі. Ведіть посилання в AI-адміністратора ManicBot — він ловить нічний і вихідний сплеск інтересу 24/7, поки ви зайняті в кріслі." },
    ],
    en: [
      { q: "Does TikTok actually help a nail salon grow?", a: "Yes — TikTok drives roughly 3× faster follower growth for salons than other platforms, because the algorithm pushes short video to people who don't follow you yet. But views only turn into bookings with a clear CTA and a booking link in your profile." },
      { q: "How long should a TikTok clip be?", a: "For completion, keep the clip under 30 seconds and put a before/after hook in the first 2 seconds — no intro, no logo. The algorithm rewards completion rate, and a short clip is easier to watch all the way through." },
      { q: "Why do I get views but few bookings?", a: "Because views don't convert without a clear call to action and a booking link in the profile. Point the link at ManicBot's AI receptionist, which absorbs the night and weekend spike of interest 24/7 while you're busy in the chair." },
    ],
  },
  "local-seo-nail-salon": {
    pl: [
      { q: "Jak trafić do top 3 na „paznokcie w pobliżu”?", a: "Nie potrzebujesz agencji SEO — potrzebujesz w pełni uzupełnionej Wizytówki Google, stałego strumienia świeżych opinii i identycznego NAP (nazwa, adres, telefon) wszędzie. Około 75% klientów zaczyna od lokalnego wyszukiwania." },
      { q: "Co najmocniej wpływa dziś na ranking lokalny?", a: "W 2026 opinie, zdjęcia i świeże posty ważą więcej niż linki i wiek domeny. Najsilniejszy pojedynczy czynnik to opinie: liczba, świeżość i odpowiedzi właściciela." },
      { q: "Ile czeka się na efekty lokalnego SEO?", a: "Zauważalna poprawa pozycji zajmuje 3–6 miesięcy, ale same zmiany w wizytówce potrafią dać wzrost wyświetleń i telefonów w kilka tygodni. To higiena, nie jednorazowa kampania." },
      { q: "Jak ManicBot pomaga w lokalnym SEO?", a: "Każdy salon dostaje publiczny profil i stronę w katalogu miejskim ze spójnym NAP, a automatyczna prośba o opinię odpala się po każdej wizycie — to napędza „koło zamachowe” opinii, czyli czynnik rankingowy numer jeden." },
    ],
    ru: [
      { q: "Как попасть в топ-3 по «маникюр рядом»?", a: "SEO-агентство не нужно — нужны полностью заполненный Google-профиль, поток свежих отзывов и одинаковый NAP (название, адрес, телефон) везде. Около 75% клиентов начинают с локального поиска." },
      { q: "Что сильнее всего влияет на локальное ранжирование сейчас?", a: "В 2026 отзывы, фото и свежие публикации весят больше, чем ссылки и возраст домена. Самый сильный фактор — отзывы: количество, свежесть и ответы владельца." },
      { q: "Сколько ждать результата от локального SEO?", a: "Заметное улучшение позиций занимает 3–6 месяцев, но сами изменения в профиле могут дать рост показов и звонков за недели. Это гигиена, а не разовая кампания." },
      { q: "Чем ManicBot помогает в локальном SEO?", a: "У каждого салона есть публичный профиль и страница в городском каталоге с единым NAP, а автозапрос отзыва срабатывает после каждого визита — это раскручивает «маховик отзывов», то есть фактор ранжирования номер один." },
    ],
    ua: [
      { q: "Як потрапити в топ-3 за «манікюр поруч»?", a: "SEO-агентство не потрібне — потрібні повністю заповнений Google-профіль, потік свіжих відгуків і однаковий NAP (назва, адреса, телефон) усюди. Близько 75% клієнтів починають із локального пошуку." },
      { q: "Що найсильніше впливає на локальне ранжування зараз?", a: "У 2026 відгуки, фото і свіжі публікації важать більше, ніж посилання й вік домену. Найсильніший фактор — відгуки: кількість, свіжість і відповіді власника." },
      { q: "Скільки чекати результату від локального SEO?", a: "Помітне покращення позицій займає 3–6 місяців, але самі зміни в профілі можуть дати зростання показів і дзвінків за тижні. Це гігієна, а не разова кампанія." },
      { q: "Чим ManicBot допомагає в локальному SEO?", a: "У кожного салону є публічний профіль і сторінка в міському каталозі з єдиним NAP, а автозапит відгуку спрацьовує після кожного візиту — це розкручує «маховик відгуків», тобто фактор ранжування номер один." },
    ],
    en: [
      { q: "How do I rank in the top 3 for «nail salon near me»?", a: "You don't need an SEO agency — you need a fully completed Google Business Profile, a steady stream of fresh reviews, and an identical NAP (name, address, phone) everywhere. About 75% of clients start with local search." },
      { q: "What matters most for local ranking now?", a: "In 2026, reviews, photos, and recent posts outweigh backlinks and domain age. The single strongest factor is reviews: count, recency, and owner responses." },
      { q: "How long does local SEO take to work?", a: "A meaningful jump in positions takes 3–6 months, but profile changes themselves can lift views and calls within weeks. It's hygiene, not a one-off campaign." },
      { q: "How does ManicBot help with local SEO?", a: "Every salon gets a public profile and a city-directory page with a single NAP, and the review-request automation fires after every visit — feeding the review flywheel, which is the number-one ranking factor." },
    ],
  },
  "salon-reviews-reputation": {
    pl: [
      { q: "Czy opinie naprawdę wpływają na to, ilu klientów przyjdzie?", a: "Tak. 78% klientów czyta opinie przed rezerwacją, a 49% w ogóle nie rozważa salonu z oceną poniżej 4,5★. Reputacja to filtr, przez który przechodzi prawie połowa twojego ruchu." },
      { q: "Jak zebrać więcej 5-gwiazdkowych opinii?", a: "Po prostu poproś: 77% klientów zostawi opinię, jeśli o to poprosisz. Najlepsze okno to 1–3 godziny po wizycie — ManicBot wysyła wtedy prośbę automatycznie, w tym samym kanale, w którym była rezerwacja." },
      { q: "Jak odpowiadać na negatywną opinię?", a: "Szybko, grzecznie, z empatią i po imieniu: przyznaj, przeproś, zaproponuj rozwiązanie. Dobrze obsłużony negatyw często sprzedaje lepiej niż dziesięć entuzjastycznych piątek." },
      { q: "Jak ManicBot pomaga zarządzać reputacją?", a: "Wysyła automatyczną prośbę o opinię po wizycie, a rozmowy o negatywnym wydźwięku oznacza i przypina na górze skrzynki właściciela — gasisz problem w czacie, zanim stanie się publiczną jedynką." },
    ],
    ru: [
      { q: "Отзывы правда влияют на то, сколько клиентов придёт?", a: "Да. 78% клиентов читают отзывы до записи, а 49% вообще не рассматривают салон с рейтингом ниже 4,5★. Репутация — это фильтр, через который проходит почти половина вашего трафика." },
      { q: "Как собрать больше 5-звёздочных отзывов?", a: "Просто просите: 77% клиентов оставят отзыв, если их попросить. Лучшее окно — 1–3 часа после визита; ManicBot отправляет просьбу автоматически в этот момент, в том же канале, где была запись." },
      { q: "Как отвечать на негативный отзыв?", a: "Быстро, вежливо, с эмпатией и по имени: признать, извиниться, предложить решение. Грамотно отработанный негатив часто продаёт лучше десятка восторженных пятёрок." },
      { q: "Чем ManicBot помогает управлять репутацией?", a: "Отправляет автозапрос отзыва после визита, а переписки с негативным настроением помечает и закрепляет вверху входящих владельца — вы гасите проблему в чате до того, как она станет публичной единицей." },
    ],
    ua: [
      { q: "Відгуки справді впливають на те, скільки клієнтів прийде?", a: "Так. 78% клієнтів читають відгуки до запису, а 49% взагалі не розглядають салон з рейтингом нижче 4,5★. Репутація — це фільтр, крізь який проходить майже половина вашого трафіку." },
      { q: "Як зібрати більше 5-зіркових відгуків?", a: "Просто просіть: 77% клієнтів залишать відгук, якщо їх попросити. Найкраще вікно — 1–3 години після візиту; ManicBot надсилає прохання автоматично в цей момент, у тому самому каналі, де був запис." },
      { q: "Як відповідати на негативний відгук?", a: "Швидко, ввічливо, з емпатією і по імені: визнати, вибачитися, запропонувати рішення. Грамотно відпрацьований негатив часто продає краще за десяток захоплених п'ятірок." },
      { q: "Чим ManicBot допомагає керувати репутацією?", a: "Надсилає автозапит відгуку після візиту, а переписки з негативним настроєм позначає і закріплює вгорі вхідних власника — ви гасите проблему в чаті до того, як вона стане публічною одиницею." },
    ],
    en: [
      { q: "Do reviews really affect how many clients show up?", a: "Yes. 78% of clients read reviews before booking, and 49% won't even consider a salon rated below 4.5★. Reputation is the filter almost half your traffic passes through." },
      { q: "How do I collect more 5-star reviews?", a: "Just ask: 77% of clients will leave a review if you ask. The best window is 1–3 hours after the visit — ManicBot sends the request automatically at that moment, in the same channel the client booked through." },
      { q: "How should I respond to a negative review?", a: "Fast, politely, with empathy, and by name: acknowledge, apologize, offer a solution. A well-handled negative often sells better than a dozen glowing five-stars." },
      { q: "How does ManicBot help manage reputation?", a: "It sends an automated post-visit review request, and flags negative-sentiment chats and pins them to the top of the owner's inbox — so you defuse the problem in chat before it becomes a public one-star." },
    ],
  },
  "nail-salon-pricing-guide": {
    pl: [
      { q: "Ile kosztuje manicure hybrydowy w 2026?", a: "W dużych miastach manicure hybrydowy spokojnie kosztuje 65–85 dolarów, i klienci go płacą, gdy salon ujmuje to jako wartość, a nie linijkę na kartce. Liczy się struktura menu i poziom cen, nie ręce technika." },
      { q: "Jaki narzut stosować na trudne usługi?", a: "Na pracochłonnych pracach — modelowanie akrylem, pełne zestawy żelowe, złożony nail art — i drogich dodatkach zakładaj narzut 90–100% i więcej. Płaski narzut na wszystko to strata na każdej trudnej rezerwacji." },
      { q: "Jak podnieść ceny, nie tracąc klientów?", a: "Podnoś o 3–5% rocznie pod inflację, a stałych klientów uprzedzaj na 30 dni; menu online dla nowych zaktualizuj od razu. ManicBot pokazuje cennik wprost w bocie, więc klient widzi ceny przed rezerwacją." },
    ],
    ru: [
      { q: "Сколько стоит гель-маникюр в 2026?", a: "В крупных городах гель-маникюр спокойно стоит 65–85 долларов, и клиенты его платят, когда салон оформил это как ценность, а не строчку в записке. Решает структура меню и уровень цен, а не руки мастера." },
      { q: "Какую наценку ставить на сложные услуги?", a: "На трудоёмких работах — моделирование акрилом, полные гелевые наборы, сложный nail-арт — и дорогих допах закладывайте наценку 90–100% и выше. Плоская наценка на всё — убыток на каждой сложной записи." },
      { q: "Как поднять цены, не теряя клиентов?", a: "Поднимайте на 3–5% в год под инфляцию, а постоянных клиентов предупреждайте за 30 дней; онлайн-меню для новых обновите сразу. ManicBot показывает прайс прямо в боте, поэтому клиент видит цены до записи." },
    ],
    ua: [
      { q: "Скільки коштує гель-манікюр у 2026?", a: "У великих містах гель-манікюр спокійно коштує 65–85 доларів, і клієнти його платять, коли салон оформив це як цінність, а не рядок у записці. Вирішує структура меню і рівень цін, а не руки майстра." },
      { q: "Яку націнку ставити на складні послуги?", a: "На трудомістких роботах — моделювання акрилом, повні гелеві набори, складний nail-арт — і дорогих допах закладайте націнку 90–100% і вище. Плоска націнка на все — збиток на кожному складному записі." },
      { q: "Як підняти ціни, не втрачаючи клієнтів?", a: "Піднімайте на 3–5% на рік під інфляцію, а постійних клієнтів попереджайте за 30 днів; онлайн-меню для нових оновіть одразу. ManicBot показує прайс прямо в боті, тож клієнт бачить ціни до запису." },
    ],
    en: [
      { q: "How much does a gel manicure cost in 2026?", a: "In metro markets a gel manicure routinely runs $65–85, and clients pay it when the salon frames it as value rather than a line on a scrap of paper. What decides it is menu structure and price level, not the tech's hands." },
      { q: "What markup should I put on complex services?", a: "On labor-intensive work — sculpted acrylics, full gel sets, advanced nail art — and pricey add-ons, build in a 90–100%+ markup. A flat markup on everything loses money on every complex booking." },
      { q: "How do I raise prices without losing clients?", a: "Raise 3–5% a year for inflation, give regulars 30 days' notice, and update the online menu for new clients immediately. ManicBot shows your price list right inside the bot, so clients see prices before booking." },
    ],
  },
  "client-retention-loyalty": {
    pl: [
      { q: "Jaki jest dobry wskaźnik ponownych rezerwacji w salonie?", a: "Najlepsze salony rezerwują ponownie 69% klientów wobec 40% średniej w branży. Różnica to jeden rytuał: nie wypuszczają klienta bez kolejnej daty." },
      { q: "Dlaczego rezerwacja przy kasie tak mocno działa?", a: "Klienci, którzy rezerwują kolejną wizytę przy kasie, są o 30–40% bardziej skłonni stać się stałymi. ManicBot po wizycie automatycznie proponuje kolejny termin dopasowany do cyklu usługi i ulubionego technika." },
      { q: "Dlaczego klienci przestają przychodzić?", a: "Najczęściej nie z niezadowolenia, lecz z ciszy między wizytami. ManicBot oznacza segment „60+ dni bez wizyty” i wysyła automatyczny win-back po 90 dniach — ciepłą, osobistą wiadomość z gotowym przyciskiem rezerwacji." },
      { q: "Czy program lojalnościowy naprawdę zatrzymuje klientów?", a: "Tak — 81% klientów zostaje lojalnych, gdy czują, że są rozpoznawani jako osoby. ManicBot automatycznie zapamiętuje ulubionego technika, typową usługę i historię wizyt, więc rozpoznanie skaluje się bez tabelek." },
    ],
    ru: [
      { q: "Какой процент повторной записи считается хорошим?", a: "Топ-салоны записывают повторно 69% клиентов против 40% по индустрии. Разница — один ритуал: они не отпускают клиента без следующей даты." },
      { q: "Почему запись на кассе так сильно работает?", a: "Клиенты, которые записываются на следующий визит на кассе, на 30–40% чаще становятся постоянными. ManicBot после визита автоматически предлагает следующую дату с учётом цикла услуги и любимого мастера." },
      { q: "Почему клиенты перестают приходить?", a: "Чаще всего не из-за недовольства, а из-за тишины между визитами. ManicBot помечает сегмент «60+ дней без визита» и шлёт автоматический win-back на 90 дней — тёплое личное сообщение с готовой кнопкой записи." },
      { q: "Программа лояльности правда удерживает клиентов?", a: "Да — 81% клиентов остаются лояльными, когда чувствуют, что их узнают как личность. ManicBot автоматически помнит любимого мастера, типичную услугу и историю визитов, поэтому узнавание масштабируется без таблиц." },
    ],
    ua: [
      { q: "Який відсоток повторного запису вважається хорошим?", a: "Топ-салони записують повторно 69% клієнтів проти 40% по індустрії. Різниця — один ритуал: вони не відпускають клієнта без наступної дати." },
      { q: "Чому запис на касі так сильно працює?", a: "Клієнти, які записуються на наступний візит на касі, на 30–40% частіше стають постійними. ManicBot після візиту автоматично пропонує наступну дату з урахуванням циклу послуги й улюбленого майстра." },
      { q: "Чому клієнти перестають приходити?", a: "Найчастіше не через невдоволення, а через тишу між візитами. ManicBot позначає сегмент «60+ днів без візиту» і шле автоматичний win-back на 90 днів — тепле особисте повідомлення з готовою кнопкою запису." },
      { q: "Програма лояльності справді утримує клієнтів?", a: "Так — 81% клієнтів залишаються лояльними, коли відчувають, що їх упізнають як особистість. ManicBot автоматично пам'ятає улюбленого майстра, типову послугу й історію візитів, тож упізнавання масштабується без таблиць." },
    ],
    en: [
      { q: "What's a good rebooking rate for a salon?", a: "Top salons rebook 69% of clients versus a 40% industry average. The difference is one ritual: they don't let a client leave without the next date." },
      { q: "Why does rebooking at checkout work so well?", a: "Clients who pre-book their next visit at checkout are 30–40% more likely to become regulars. After a visit, ManicBot automatically prompts the next date, sized to the service cycle and their favourite tech." },
      { q: "Why do clients stop coming back?", a: "Usually not from dissatisfaction but from silence between visits. ManicBot flags a «60+ days without a visit» segment and sends an automatic 90-day win-back — a warm, personal message with a ready booking button." },
      { q: "Does a loyalty program really retain clients?", a: "Yes — 81% of clients stay loyal when they feel recognized as individuals. ManicBot automatically remembers the preferred tech, typical service, and visit history, so recognition scales without spreadsheets." },
    ],
  },
  "scale-solo-to-team": {
    pl: [
      { q: "Co jest największym wąskim gardłem przy zatrudnianiu technika?", a: "Talent, nie czynsz ani lokal. Dobry technik z własną bazą to zasób deficytowy — sprzedawaj warunki (pełen fotel, sprzęt, szkolenia), a nie sam wakat za procent." },
      { q: "Wynajem fotela czy prowizja — co wybrać?", a: "Wynajem fotela jest prosty, ale daje mało kontroli; prowizja wyrównuje motywacje i daje kontrolę nad ceną i jakością, lecz wymaga dokładnego śledzenia. Większość rosnących salonów wybiera prowizję." },
      { q: "Ile kosztuje zatrudnienie technika?", a: "Realny punkt odniesienia na 2026 to ~2 500–4 000 USD miesięcznie na pracownika plus 500–2 000 USD kosztów ogólnych. Dodawaj fotel dopiero przy udowodnionym popycie, gdy odsyłasz klientki." },
      { q: "Jak ManicBot pomaga zarządzać zespołem?", a: "Grafik wielomistrzowy, indywidualne godziny pracy i analityka per mistrz (obłożenie, przychód, rebooking) czynią salon na kilka foteli zarządzalnym z jednego panelu — bez podwójnych rezerwacji i chaosu." },
    ],
    ru: [
      { q: "Что главное узкое место при найме мастера?", a: "Талант, а не аренда или помещение. Хороший мастер с собственной базой — дефицит; продавайте условия (полное кресло, оборудование, обучение), а не вакансию за процент." },
      { q: "Аренда кресла или комиссия — что выбрать?", a: "Аренда кресла проста, но даёт мало контроля; комиссия выравнивает стимулы и даёт контроль над ценой и качеством, но требует точного учёта. Большинство растущих салонов выбирают комиссию." },
      { q: "Сколько стоит нанять мастера?", a: "Реалистичный ориентир на 2026 — ~$2 500–4 000 в месяц на сотрудника плюс $500–2 000 накладных. Добавляйте кресло только при доказанном спросе, когда вы отказываете клиентам." },
      { q: "Чем ManicBot помогает управлять командой?", a: "Мультимастерское расписание, индивидуальные рабочие часы и аналитика по каждому мастеру (загрузка, выручка, rebooking) делают салон на несколько кресел управляемым из одной панели — без двойных записей и хаоса." },
    ],
    ua: [
      { q: "Що головне вузьке місце при наймі майстра?", a: "Талант, а не оренда чи приміщення. Хороший майстер із власною базою — дефіцит; продавайте умови (повне крісло, обладнання, навчання), а не вакансію за відсоток." },
      { q: "Оренда крісла чи комісія — що обрати?", a: "Оренда крісла проста, але дає мало контролю; комісія вирівнює стимули і дає контроль над ціною та якістю, але потребує точного обліку. Більшість зростаючих салонів обирають комісію." },
      { q: "Скільки коштує найняти майстра?", a: "Реалістичний орієнтир на 2026 — ~$2 500–4 000 на місяць на співробітника плюс $500–2 000 накладних. Додавайте крісло лише за доведеного попиту, коли ви відмовляєте клієнтам." },
      { q: "Чим ManicBot допомагає керувати командою?", a: "Мультимайстерський розклад, індивідуальні робочі години й аналітика по кожному майстру (завантаження, виручка, rebooking) роблять салон на кілька крісел керованим з однієї панелі — без подвійних записів і хаосу." },
    ],
    en: [
      { q: "What's the biggest bottleneck when hiring a tech?", a: "Talent, not rent or premises. A good tech with their own client base is scarce — sell conditions (a full chair, equipment, education), not just a job opening for a percentage." },
      { q: "Booth rent or commission — which should I pick?", a: "Booth rent is simple but gives little control; commission aligns incentives and gives control over price and quality, but needs accurate tracking. Most growing salons pick commission." },
      { q: "How much does hiring a tech cost?", a: "A realistic 2026 benchmark is ~$2,500–4,000 per month per employee plus $500–2,000 of overhead. Only add a chair on proven demand, when you're turning clients away." },
      { q: "How does ManicBot help manage a team?", a: "Multi-master scheduling, per-master working hours, and per-master analytics (utilisation, revenue, rebooking) make a multi-chair salon manageable from one panel — no double-bookings, no chaos." },
    ],
  },
  "seasonal-marketing-calendar": {
    pl: [
      { q: "Które święta najmocniej napędzają przychód salonu paznokci?", a: "Cztery szczyty niosą rok: walentynki, Dzień Matki, studniówki i ukończenie szkoły oraz Boże Narodzenie i Nowy Rok. Wokół tych dat popyt rośnie sam — twoim zadaniem jest być gotowym z ofertą i wiadomością." },
      { q: "Czy bony podarunkowe naprawdę warto promować?", a: "Tak — sprzedaż bonów niemal się podwoiła rok do roku (około +93%), a bon kupiony w grudniu to gwarantowana rezerwacja w styczniu. Klasyczna mechanika to „kup bon za 100, dostań 20 gratis”." },
      { q: "Dlaczego kalendarz bije spontaniczne rabaty?", a: "Spontaniczny rabat tnie cenę wtedy, gdy klient i tak by przyszedł; kalendarz łapie popyt, który i tak rośnie, i kieruje go do kasy z wyprzedzeniem. ManicBot wysyła sezonowe kampanie i przypomnienia automatycznie, więc nie wypadają w gorącym sezonie." },
    ],
    ru: [
      { q: "Какие праздники сильнее всего двигают выручку nail-салона?", a: "Год держат четыре пика: День святого Валентина, День матери, выпускные и Новый год. Вокруг этих дат спрос растёт сам — ваша задача быть готовым с предложением и сообщением." },
      { q: "Подарочные сертификаты правда стоит продвигать?", a: "Да — продажи сертификатов выросли почти вдвое год к году (около +93%), а сертификат, купленный в декабре, — это гарантированная запись в январе. Классическая механика: «купи сертификат на 100, получи 20 в подарок»." },
      { q: "Почему календарь лучше спонтанных скидок?", a: "Спонтанная скидка режет цену тогда, когда клиент и так бы пришёл; календарь ловит спрос, который и так растёт, и направляет его в кассу заранее. ManicBot шлёт сезонные кампании и напоминания автоматически, поэтому они не выпадают в горячий сезон." },
    ],
    ua: [
      { q: "Які свята найсильніше рухають виручку nail-салону?", a: "Рік тримають чотири піки: День святого Валентина, День матері, випускні та Новий рік. Навколо цих дат попит зростає сам — ваше завдання бути готовим із пропозицією і повідомленням." },
      { q: "Подарункові сертифікати справді варто просувати?", a: "Так — продажі сертифікатів зросли майже вдвічі рік до року (близько +93%), а сертифікат, куплений у грудні, — це гарантований запис у січні. Класична механіка: «купи сертифікат на 100, отримай 20 у подарунок»." },
      { q: "Чому календар кращий за спонтанні знижки?", a: "Спонтанна знижка ріже ціну тоді, коли клієнт і так би прийшов; календар ловить попит, який і так зростає, і спрямовує його в касу заздалегідь. ManicBot шле сезонні кампанії і нагадування автоматично, тож вони не випадають у гарячий сезон." },
    ],
    en: [
      { q: "Which holidays drive the most nail-salon revenue?", a: "Four peaks carry the year: Valentine's Day, Mother's Day, prom and graduation, and Christmas/New Year. Demand rises on its own around these dates — your job is to be ready with an offer and a message." },
      { q: "Are gift cards really worth promoting?", a: "Yes — gift-card sales have nearly doubled year over year (about +93%), and a card bought in December is a guaranteed January booking. The classic mechanic is «buy a $100 gift card, get $20 free»." },
      { q: "Why does a calendar beat spontaneous discounts?", a: "A spontaneous discount cuts the price when the client would have come anyway; a calendar catches demand that's already rising and channels it into the till ahead of time. ManicBot sends seasonal campaigns and reminders automatically, so they don't get dropped in the busy season." },
    ],
  },
  "ai-beauty-trends-2026": {
    pl: [
      { q: "Co salony paznokci faktycznie automatyzują w 2026?", a: "Nie „wszystko”, lecz cztery miejsca, w których wyciekają pieniądze: przyjmowanie rezerwacji, odpowiadanie na pytania, pobieranie depozytu i wysyłkę przypomnień. To tam AI daje mierzalny efekt." },
      { q: "Ile salon traci na niestawiennictwie i jak to ograniczyć?", a: "Bez automatycznych przypomnień salony tracą 15–30% rezerwacji na no-show. Same przypomnienia tną je do 60%, a połączenie bota AI z niewielkim depozytem obniża no-show poniżej 5%." },
      { q: "Czy AI zastąpi mojego recepcjonistę?", a: "Nie — AI przejmuje rutynę (powtarzalne pytania, sprawdzanie dostępności, depozyty, przypomnienia), a człowiek zajmuje się trudnymi przypadkami i obsługą na sali. Dla solo-mistrza to recepcja, której nie może zatrudnić." },
      { q: "Które kanały powinna obsługiwać recepcja AI?", a: "Te, gdzie piszą klienci: Instagram Direct, WhatsApp i Telegram plus widget na stronie. ManicBot prowadzi jedną logikę rezerwacji we wszystkich kanałach i rozmawia po polsku, rosyjsku, ukraińsku i angielsku." },
    ],
    ru: [
      { q: "Что nail-салоны реально автоматизируют в 2026?", a: "Не «всё», а четыре места, где утекают деньги: приём записи, ответы на вопросы, сбор депозита и напоминания. Именно там AI даёт измеримый результат." },
      { q: "Сколько салон теряет на неявках и как это снизить?", a: "Без автоматических напоминаний салоны теряют 15–30% записей на no-show. Сами напоминания снижают их до 60%, а связка AI-бота с небольшим депозитом уводит no-show ниже 5%." },
      { q: "Заменит ли AI моего администратора?", a: "Нет — AI забирает рутину (повторяющиеся вопросы, проверку доступности, депозиты, напоминания), а человек занимается сложными случаями и работой в зале. Для соло-мастера это администратор, которого не нанять." },
      { q: "Какие каналы должен закрывать AI-администратор?", a: "Те, где пишут клиенты: Instagram Direct, WhatsApp и Telegram плюс виджет на сайте. ManicBot ведёт единую логику записи во всех каналах и общается на русском, украинском, английском и польском." },
    ],
    ua: [
      { q: "Що nail-салони реально автоматизують у 2026?", a: "Не «все», а чотири місця, де витікають гроші: прийом запису, відповіді на запитання, збір депозиту і нагадування. Саме там AI дає вимірний результат." },
      { q: "Скільки салон втрачає на неявках і як це знизити?", a: "Без автоматичних нагадувань салони втрачають 15–30% записів на no-show. Самі нагадування знижують їх до 60%, а зв'язка AI-бота з невеликим депозитом уводить no-show нижче 5%." },
      { q: "Чи замінить AI мого адміністратора?", a: "Ні — AI забирає рутину (повторювані запитання, перевірку доступності, депозити, нагадування), а людина займається складними випадками і роботою в залі. Для соло-майстра це адміністратор, якого не найняти." },
      { q: "Які канали має закривати AI-адміністратор?", a: "Ті, де пишуть клієнти: Instagram Direct, WhatsApp і Telegram плюс віджет на сайті. ManicBot веде єдину логіку запису в усіх каналах і спілкується російською, українською, англійською та польською." },
    ],
    en: [
      { q: "What do nail salons actually automate in 2026?", a: "Not «everything» — four places where money leaks: taking bookings, answering questions, collecting deposits, and sending reminders. That's where AI delivers measurable results." },
      { q: "How much does a salon lose to no-shows, and how do I cut it?", a: "Without automated reminders, salons lose 15–30% of bookings to no-shows. Reminders alone cut that by up to 60%, and pairing an AI bot with a small deposit drops no-shows below 5%." },
      { q: "Will AI replace my receptionist?", a: "No — AI takes the routine (repetitive questions, availability checks, deposits, reminders) while the human handles tricky cases and the work on the floor. For a solo master it's the receptionist they can't afford to hire." },
      { q: "Which channels should an AI receptionist cover?", a: "The ones where clients message: Instagram Direct, WhatsApp, and Telegram, plus a web widget. ManicBot runs one booking logic across every channel and talks in English, Russian, Ukrainian, and Polish." },
    ],
  },
  "salon-booking-software-poland-2026": {
    pl: [
      { q: "Czy ManicBot zastąpi Booksy?", a: "Niekoniecznie — to różne zadania. Booksy to marketplace, który Cię znajduje (pozyskanie); ManicBot to AI-recepcjonista, który zamienia wejścia z Instagrama i WhatsAppa w rezerwacje (konwersja). Jeśli Booksy realnie przyprowadza nowych klientów, zostaw go i dodaj ManicBot do obsługi DM-ów przy 0% prowizji. Po 30–60 dniach zmierz, skąd faktycznie idą rezerwacje." },
      { q: "Który system jest naprawdę najtańszy?", a: "Zależy, ile rośniesz. ManicBot to płaskie 45–90 PLN/mies, 0% prowizji. Booksy startuje od ~145 PLN/mies plus ~30% Boost od każdego nowego klienta z marketplace. Fresha ma darmową bazę, ale dolicza ~20% od nowych klientów i opłaty za wiadomości. Im więcej wizyt, tym bardziej modele prowizyjne rozjeżdżają się na Twoją niekorzyść." },
      { q: "Skąd ManicBot weźmie nowych klientów bez marketplace?", a: "Nie weźmie ich „z powietrza\" jak Booksy — i to trzeba powiedzieć uczciwie. ManicBot konwertuje ruch, który już masz: Instagram, WhatsApp, Google, polecenia. Po zimne pozyskanie nadal potrzebujesz marketplace (Booksy) albo reklam (Instagram Ads). ManicBot pilnuje, żeby ten ruch nie wyciekał o północy i w weekend." },
      { q: "Co wybrać dla solo-mistrza, do którego klienci piszą na Instagramie?", a: "ManicBot. Solo-mistrz zwykle tonie w DM-ach, a nie w braku zainteresowania — a AI-recepcjonista odpowiada 24/7 i domyka rezerwację bez wynajmowania recepcji. Większy salon z własną bazą i kilkoma fotelami częściej dobierze do tego CRM w stylu Versum." },
    ],
    ru: [
      { q: "Заменит ли ManicBot Booksy?", a: "Не обязательно — это разные задачи. Booksy — маркетплейс, который вас находит (привлечение); ManicBot — AI-ресепшен, который превращает входящие из Instagram и WhatsApp в записи (конверсия). Если Booksy реально приводит новых клиентов, оставьте его и добавьте ManicBot для обработки DM при 0% комиссии. Через 30–60 дней измерьте, откуда фактически идут записи." },
      { q: "Какая система реально самая дешёвая?", a: "Зависит от роста. ManicBot — фиксированные 45–90 PLN/мес, 0% комиссии. Booksy стартует от ~145 PLN/мес плюс ~30% Boost с каждого нового клиента из маркетплейса. Fresha бесплатна на базе, но добавляет ~20% с новых клиентов и плату за сообщения. Чем больше записей, тем сильнее комиссионные модели бьют по карману." },
      { q: "Откуда ManicBot возьмёт новых клиентов без маркетплейса?", a: "Не возьмёт «из воздуха», как Booksy — и это честно надо сказать. ManicBot конвертирует трафик, который у вас уже есть: Instagram, WhatsApp, Google, рекомендации. Для холодного привлечения вам всё ещё нужен маркетплейс (Booksy) или реклама (Instagram Ads). ManicBot следит, чтобы этот трафик не утекал в полночь и на выходных." },
      { q: "Что выбрать соло-мастеру, которому пишут в Instagram?", a: "ManicBot. Соло-мастер обычно тонет в DM, а не в нехватке интереса — а AI-ресепшен отвечает 24/7 и закрывает запись без найма администратора. Крупный салон с собственной базой и несколькими креслами чаще добавит к этому CRM уровня Versum." },
    ],
    ua: [
      { q: "Чи замінить ManicBot Booksy?", a: "Не обов'язково — це різні задачі. Booksy — маркетплейс, який вас знаходить (залучення); ManicBot — AI-ресепшен, який перетворює вхідні з Instagram і WhatsApp на записи (конверсія). Якщо Booksy реально приводить нових клієнтів, залиште його і додайте ManicBot для обробки DM за 0% комісії. Через 30–60 днів виміряйте, звідки фактично йдуть записи." },
      { q: "Яка система реально найдешевша?", a: "Залежить від зростання. ManicBot — фіксовані 45–90 PLN/міс, 0% комісії. Booksy стартує від ~145 PLN/міс плюс ~30% Boost з кожного нового клієнта з маркетплейсу. Fresha безкоштовна на базі, але додає ~20% з нових клієнтів і плату за повідомлення. Чим більше записів, тим сильніше комісійні моделі б'ють по кишені." },
      { q: "Звідки ManicBot візьме нових клієнтів без маркетплейсу?", a: "Не візьме «з повітря», як Booksy — і це чесно треба сказати. ManicBot конвертує трафік, який у вас уже є: Instagram, WhatsApp, Google, рекомендації. Для холодного залучення вам усе ще потрібен маркетплейс (Booksy) або реклама (Instagram Ads). ManicBot стежить, щоб цей трафік не витікав опівночі та на вихідних." },
      { q: "Що обрати соло-майстру, якому пишуть в Instagram?", a: "ManicBot. Соло-майстер зазвичай тоне в DM, а не в браку інтересу — а AI-ресепшен відповідає 24/7 і закриває запис без найму адміністратора. Великий салон із власною базою і кількома кріслами частіше додасть до цього CRM рівня Versum." },
    ],
    en: [
      { q: "Will ManicBot replace Booksy?", a: "Not necessarily — they do different jobs. Booksy is a marketplace that gets you found (discovery); ManicBot is an AI receptionist that turns Instagram and WhatsApp inbound into bookings (conversion). If Booksy genuinely brings you new clients, keep it and add ManicBot to handle your DMs at 0% commission. After 30–60 days, measure where bookings actually come from." },
      { q: "Which system is really the cheapest?", a: "It depends on how much you grow. ManicBot is a flat 45–90 PLN/month, 0% commission. Booksy starts around 145 PLN/month plus a ~30% Boost fee on each new marketplace client. Fresha has a free base but adds ~20% on new clients and per-message fees. The more bookings you run, the more the commission models diverge against you." },
      { q: "Where does ManicBot get new clients without a marketplace?", a: "It doesn't pull them out of thin air like Booksy — and that's worth saying honestly. ManicBot converts the traffic you already have: Instagram, WhatsApp, Google, referrals. For cold discovery you still need a marketplace (Booksy) or ads (Instagram Ads). ManicBot makes sure that traffic doesn't leak away at midnight or on weekends." },
      { q: "What should a solo master whose clients DM on Instagram pick?", a: "ManicBot. A solo master is usually drowning in DMs, not short of interest — and the AI receptionist answers 24/7 and closes the booking without hiring a receptionist. A larger salon with its own base and several chairs more often adds a Versum-style CRM on top." },
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
