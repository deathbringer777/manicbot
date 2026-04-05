import type { Lang } from "~/lib/i18n";

export type HelpArticle = {
  id: string;
  slug: string;
  categoryKey: "booking" | "salon" | "support" | "channels" | "billing";
  keywords: string[];
  titles: Record<Lang, string>;
  excerpts: Record<Lang, string>;
  bodies: Record<Lang, string>;
};

export const HELP_CATEGORY_LABELS: Record<HelpArticle["categoryKey"], Record<Lang, string>> = {
  booking: {
    ru: "Запись и отмена",
    ua: "Запис і скасування",
    en: "Booking & cancellation",
    pl: "Rezerwacja i anulowanie",
  },
  salon: {
    ru: "Салон и услуги",
    ua: "Салон і послуги",
    en: "Salon & services",
    pl: "Salon i usługi",
  },
  support: {
    ru: "Поддержка и тикеты",
    ua: "Підтримка та тикети",
    en: "Support & tickets",
    pl: "Wsparcie i zgłoszenia",
  },
  channels: {
    ru: "Каналы и медиа",
    ua: "Канали та медіа",
    en: "Channels & media",
    pl: "Kanały i media",
  },
  billing: {
    ru: "Тарифы и оплата",
    ua: "Тарифи та оплата",
    en: "Plans & billing",
    pl: "Plany i płatności",
  },
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "1",
    slug: "cancel-appointment",
    categoryKey: "booking",
    keywords: ["отмена", "отменить", "скасування", "cancel", "anuluj", "запись", "appointment", "wizyta"],
    titles: {
      ru: "Как отменить запись",
      ua: "Як скасувати запис",
      en: "How to cancel an appointment",
      pl: "Jak anulować wizytę",
    },
    excerpts: {
      ru: "Отмена из кабинета и со стороны клиента.",
      ua: "Скасування з кабінету та з боку клієнта.",
      en: "Cancelling from the dashboard and from the client side.",
      pl: "Anulowanie z panelu i po stronie klientki.",
    },
    bodies: {
      ru: "В кабинете салона откройте раздел «Записи», выберите дату и статус записи. Для отмены используйте действие «Отменить» на карточке. Клиент получит уведомление в том канале, где записывался (Telegram / Instagram / WhatsApp).",
      ua: "У кабінеті салону відкрийте «Записи», оберіть дату та статус. Для скасування натисніть дію на картці запису. Клієнт отримає повідомлення в каналі, де оформлював запис.",
      en: "In the salon dashboard open Appointments, pick the date, then use the cancel action on the booking card. The client is notified in the same channel they used to book (Telegram, Instagram, or WhatsApp).",
      pl: "W panelu salonu wejdź w Wizyty, wybierz datę i użyj akcji anulowania na karcie. Klientka dostanie powiadomienie w kanale, z którego rezerwowała.",
    },
  },
  {
    id: "2",
    slug: "new-booking-flow",
    categoryKey: "booking",
    keywords: ["запись", "booking", "клиент", "client", "termin", "слот", "slot", "calendar"],
    titles: {
      ru: "Как клиент записывается",
      ua: "Як клієнт записується",
      en: "How clients book",
      pl: "Jak klientki rezerwują",
    },
    excerpts: {
      ru: "Бот, слоты и подтверждение.",
      ua: "Бот, слоти та підтвердження.",
      en: "Bot flow, slots, and confirmation.",
      pl: "Bot, sloty i potwierdzenie.",
    },
    bodies: {
      ru: "Клиент пишет в подключённый канал. Бот предлагает услуги, мастера и свободное время. После выбора слота запись попадает в календарь салона и в кабинет в разделе «Записи».",
      ua: "Клієнт пише в підключений канал. Бот пропонує послуги, майстра та час. Після вибору слоту запис з’являється в календарі та в кабінеті.",
      en: "The client chats in your connected channel. The bot offers services, masters, and free slots. After a slot is chosen, the booking appears in the salon calendar and under Appointments.",
      pl: "Klientka pisze na podłączonym kanale. Bot proponuje usługi, stylistkę i wolne terminy. Po wyborze slotu wizyta trafia do kalendarza i do panelu.",
    },
  },
  {
    id: "3",
    slug: "services-catalog",
    categoryKey: "salon",
    keywords: ["услуги", "services", "цена", "price", "длительность", "duration", "каталог"],
    titles: {
      ru: "Услуги и цены",
      ua: "Послуги та ціни",
      en: "Services & pricing",
      pl: "Usługi i ceny",
    },
    excerpts: {
      ru: "Как завести и скрыть услугу.",
      ua: "Як додати та приховати послугу.",
      en: "Creating and hiding services.",
      pl: "Dodawanie i ukrywanie usług.",
    },
    bodies: {
      ru: "В кабинете откройте вкладку «Услуги». Добавьте название, цену, длительность и эмодзи. Неактивные услуги не показываются клиентам в боте. Изменения сохраняются сразу после нажатия «Сохранить».",
      ua: "У кабінеті відкрийте «Послуги». Додайте назву, ціну, тривалість та емодзі. Неактивні послуги не показуються в боті.",
      en: "Open the Services tab in the dashboard. Set name, price, duration, and emoji. Hidden services are not offered to clients in the bot. Save to apply changes.",
      pl: "W panelu otwórz zakładkę Usługi. Ustaw nazwę, cenę, czas i emoji. Ukryte usługi nie są widoczne klientkom w bocie.",
    },
  },
  {
    id: "4",
    slug: "support-ticket",
    categoryKey: "support",
    keywords: ["тикет", "ticket", "саппорт", "support", "поддержка", "help", "platform"],
    titles: {
      ru: "Тикеты поддержки",
      ua: "Тикети підтримки",
      en: "Support tickets",
      pl: "Zgłoszenia do wsparcia",
    },
    excerpts: {
      ru: "Когда писать в платформенную поддержку.",
      ua: "Коли звертатися до підтримки платформи.",
      en: "When to use platform support.",
      pl: "Kiedy pisać na platformę.",
    },
    bodies: {
      ru: "Платформенные тикеты — для вопросов по работе ManicBot, оплате и доступу. В кабинете поддержки агент видит очередь, может взять тикет в работу, ответить и закрыть обращение. Для вопросов конкретного салона клиенты обычно пишут в бот салона.",
      ua: "Тикети платформи — для питань про ManicBot, оплату та доступ. Агент бачить чергу, бере тикет у роботу та відповідає.",
      en: "Platform tickets cover ManicBot product issues, billing, and access. Support agents claim tickets from the queue, reply, and close threads. Salon-specific questions usually go to the salon bot.",
      pl: "Zgłoszenia platformowe dotyczą produktu, płatności i dostępu. Agenci przejmują je z kolejki, odpowiadają i zamykają. Sprawy konkretnego salonu — zwykle przez bota salonu.",
    },
  },
  {
    id: "5",
    slug: "images-attachments",
    categoryKey: "channels",
    keywords: ["картинка", "image", "фото", "photo", "вложение", "attachment", "медиа", "media"],
    titles: {
      ru: "Фото и вложения",
      ua: "Фото та вкладення",
      en: "Photos & attachments",
      pl: "Zdjęcia i załączniki",
    },
    excerpts: {
      ru: "Что видит бот и где хранятся ссылки.",
      ua: "Що бачить бот і де зберігаються посилання.",
      en: "What the bot sees and link handling.",
      pl: "Co widzi bot i linki do mediów.",
    },
    bodies: {
      ru: "В каналах клиенты могут присылать изображения. В зависимости от канала бот может сохранить ссылку на медиа или подсказать открыть диалог в Telegram. В тикете поддержки можно приложить URL вложения при ответе.",
      ua: "У каналах клієнти надсилають зображення. У тикеті підтримки можна додати URL вкладення у відповіді.",
      en: "Clients may send images in connected channels. Depending on the channel, the bot stores a reference or asks to open Telegram for full media. In support replies you can attach an image URL when the form allows it.",
      pl: "Klientki mogą wysyłać zdjęcia na kanałach. W zależności od kanału bot zapisuje odnośnik lub prosi o dialog w Telegramie. W odpowiedzi na zgłoszenie możesz podać URL załącznika.",
    },
  },
  {
    id: "6",
    slug: "google-calendar",
    categoryKey: "salon",
    keywords: ["google", "календарь", "calendar", "sync", "синхронизация", "busy"],
    titles: {
      ru: "Google Календарь",
      ua: "Google Календар",
      en: "Google Calendar",
      pl: "Kalendarz Google",
    },
    excerpts: {
      ru: "Подключение и занятость.",
      ua: "Підключення та зайнятість.",
      en: "Connect and busy times.",
      pl: "Połączenie i blokada terminów.",
    },
    bodies: {
      ru: "В настройках салона откройте блок Google Calendar и следуйте ссылке через бота — OAuth проходит на защищённой стороне воркера. После выбора календаря внешние занятые слоты учитываются при записи.",
      ua: "У налаштуваннях салону відкрийте Google Calendar і перейдіть за посиланням з бота. OAuth на стороні воркера. Зовнішня зайнятість враховується у слотах.",
      en: "In salon settings open Google Calendar and use the link from the bot; OAuth runs on the Worker. After you pick a calendar, external busy times block conflicting slots.",
      pl: "W ustawieniach salonu otwórz Google Calendar i przejdź przez link z bota. OAuth na Workerze. Zajętość z zewnątrz blokuje sloty.",
    },
  },
  {
    id: "7",
    slug: "channels-omni",
    categoryKey: "channels",
    keywords: ["канал", "channel", "telegram", "instagram", "whatsapp", "омниканал", "inbox"],
    titles: {
      ru: "Омниканал",
      ua: "Омніканал",
      en: "Omnichannel inbox",
      pl: "Omnichannel",
    },
    excerpts: {
      ru: "Telegram, Instagram и WhatsApp в одном потоке.",
      ua: "Telegram, Instagram і WhatsApp в одному потоці.",
      en: "One stream for Telegram, Instagram, and WhatsApp.",
      pl: "Jeden strumień dla Telegram, Instagram i WhatsApp.",
    },
    bodies: {
      ru: "Подключите каналы в настройках. Входящие сообщения попадают в единую ленту разговоров (в God Mode — «Омниканал»). Ответы уходят обратно в тот канал, откуда написал клиент, с учётом окон WhatsApp/Instagram.",
      ua: "Підключіть канали в налаштуваннях. Вхідні повідомлення збираються в одній стрічці.",
      en: "Connect channels in settings. Inbound chats land in one conversation list (God Mode: Inbox). Replies go back on the originating channel, respecting WhatsApp/Instagram messaging windows.",
      pl: "Podłącz kanały w ustawieniach. Wiadomości trafiają do jednej listy. Odpowiedzi wracają tym samym kanałem, z zasadami okien WA/IG.",
    },
  },
  {
    id: "8",
    slug: "billing-plans",
    categoryKey: "billing",
    keywords: ["тариф", "plan", "billing", "оплата", "stripe", "подписка", "subscription"],
    titles: {
      ru: "Тарифы и биллинг",
      ua: "Тарифи та білінг",
      en: "Plans & billing",
      pl: "Plany i rozliczenia",
    },
    excerpts: {
      ru: "Статусы подписки и лимиты.",
      ua: "Статуси підписки та ліміти.",
      en: "Subscription status and limits.",
      pl: "Status subskrypcji i limity.",
    },
    bodies: {
      ru: "Вкладка «Биллинг» в кабинете салона показывает текущий план и статус (trial, active, grace, expired). Оплата проходит через Stripe. При проблемах с картой включается короткий grace-период; после него ограничиваются функции для персонала, клиенты по-прежнему могут записываться.",
      ua: "У «Білінгу» видно план і статус. Оплата через Stripe. Grace-період при збої картки.",
      en: "The Billing tab shows your plan and status (trialing, active, grace, expired). Payments use Stripe. On card failure a short grace period applies; then staff features may be limited while clients can still book.",
      pl: "Zakładka rozliczeń pokazuje plan i status. Płatności Stripe. Po błędzie karty jest krótki grace, potem mogą zostać ograniczone funkcje personelu.",
    },
  },
];

export type HelpFaq = {
  keywords: string[];
  questions: Record<Lang, string>;
  answers: Record<Lang, string>;
};

export const HELP_FAQS: HelpFaq[] = [
  {
    keywords: ["запись", "booking", "как записаться"],
    questions: {
      ru: "Как записаться к нам?",
      ua: "Як записатися?",
      en: "How do I book?",
      pl: "Jak się zapisać?",
    },
    answers: {
      ru: "Напишите боту салона в Telegram или в подключённый Instagram/WhatsApp и следуйте шагам бота.",
      ua: "Напишіть боту салону в Telegram або в Instagram/WhatsApp і дотримуйтесь кроків.",
      en: "Message the salon bot on Telegram or the connected Instagram/WhatsApp and follow the prompts.",
      pl: "Napisz do bota salonu na Telegramie lub podłączonym Instagramie/WhatsAppie i postępuj zgodnie z komunikatami.",
    },
  },
  {
    keywords: ["отмена", "cancel", "анул"],
    questions: {
      ru: "Как отменить визит?",
      ua: "Як скасувати візит?",
      en: "How do I cancel?",
      pl: "Jak anulować wizytę?",
    },
    answers: {
      ru: "Напишите боту «отмена» или откройте запись в мини-приложении, если салон это включил. Владелец может отменить из кабинета.",
      ua: "Напишіть боту про скасування або скористайтесь міні-додатком, якщо салон увімкнув. Власник може скасувати з кабінету.",
      en: "Tell the bot you want to cancel, or use the mini app if the salon enabled it. Owners can cancel from the dashboard.",
      pl: "Napisz do bota o anulowanie lub użyj mini aplikacji, jeśli salon ją włączył. Właścicielka może anulować z panelu.",
    },
  },
  {
    keywords: ["тикет", "ticket", "поддержка", "support"],
    questions: {
      ru: "Где написать в поддержку ManicBot?",
      ua: "Куди писати в підтримку ManicBot?",
      en: "Where is ManicBot support?",
      pl: "Gdzie jest wsparcie ManicBot?",
    },
    answers: {
      ru: "Агенты платформы работают через тикеты в панели поддержки. Если вы клиент салона — пишите в бот этого салона.",
      ua: "Агенти платформи працюють через тикети. Якщо ви клієнт — пишіть у бот салону.",
      en: "Platform agents use the support ticket console. If you are a salon client, contact that salon’s bot.",
      pl: "Agenci platformy używają zgłoszeń. Jeśli jesteś klientką salonu, napisz do bota tego salonu.",
    },
  },
];

export function normalizeHelpQuery(q: string): string[] {
  return q
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

export function scoreArticle(a: HelpArticle, lang: Lang, words: string[]): number {
  if (words.length === 0) return 1;
  const hay = [
    ...a.keywords,
    a.titles[lang],
    a.excerpts[lang],
    a.bodies[lang],
    HELP_CATEGORY_LABELS[a.categoryKey][lang],
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const w of words) {
    if (hay.includes(w)) score += 2;
    if (a.keywords.some((k) => k.includes(w) || w.includes(k))) score += 3;
  }
  return score;
}

export function scoreFaq(f: HelpFaq, lang: Lang, words: string[]): number {
  if (words.length === 0) return 1;
  const hay = [
    ...f.keywords,
    f.questions[lang],
    f.answers[lang],
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const w of words) {
    if (hay.includes(w)) score += 2;
  }
  return score;
}
