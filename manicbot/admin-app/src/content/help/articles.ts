import type { Lang } from "~/lib/i18n";

export type HelpArticle = {
  id: string;
  slug: string;
  categoryKey:
    | "booking"
    | "client"
    | "salon"
    | "master_role"
    | "web_cabinet"
    | "support"
    | "channels"
    | "billing"
    | "platform_admin";
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
  client: {
    ru: "Клиентам",
    ua: "Клієнтам",
    en: "For clients",
    pl: "Dla klientek",
  },
  salon: {
    ru: "Салон и услуги",
    ua: "Салон і послуги",
    en: "Salon & services",
    pl: "Salon i usługi",
  },
  master_role: {
    ru: "Кабинет мастера",
    ua: "Кабінет майстра",
    en: "Master dashboard",
    pl: "Panel stylistki",
  },
  web_cabinet: {
    ru: "Веб-кабинет и вход",
    ua: "Веб-кабінет і вхід",
    en: "Web cabinet & sign-in",
    pl: "Panel web i logowanie",
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
  platform_admin: {
    ru: "Платформа и администрирование",
    ua: "Платформа та адміністрування",
    en: "Platform administration",
    pl: "Administracja platformy",
  },
};

/** Order of collections on the help page (Claude-style sections). */
export const HELP_CATEGORY_ORDER: HelpArticle["categoryKey"][] = [
  "booking",
  "client",
  "salon",
  "master_role",
  "web_cabinet",
  "channels",
  "billing",
  "support",
  "platform_admin",
];

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
  {
    id: "9",
    slug: "web-sign-in-password",
    categoryKey: "web_cabinet",
    keywords: [
      "вход",
      "логин",
      "пароль",
      "email",
      "sign in",
      "password",
      "logowanie",
      "hasło",
      "увійти",
    ],
    titles: {
      ru: "Вход по email и пароль",
      ua: "Вхід за email і паролем",
      en: "Sign in with email and password",
      pl: "Logowanie e‑mailem i hasłem",
    },
    excerpts: {
      ru: "Веб-кабинет салона, мастера и поддержки.",
      ua: "Веб-кабінет салону, майстра та підтримки.",
      en: "Web access for salon, master, and support roles.",
      pl: "Dostęp web dla salonu, stylistki i wsparcia.",
    },
    bodies: {
      ru: "Откройте мини-приложение или прямую ссылку на кабинет, выберите «Войти», введите email и пароль. Роль (владелец, мастер, поддержка) определяется после входа. При неверном пароле используйте восстановление на экране входа.",
      ua: "Відкрийте міні-додаток або пряме посилання, увійдіть за email і паролем. Роль визначається після входу.",
      en: "Open the mini app or the cabinet URL, choose Sign in, enter email and password. Your dashboard depends on your assigned role. Use the reset flow if you forgot your password.",
      pl: "Otwórz mini aplikację lub adres panelu, zaloguj się e‑mailem i hasłem. Widok zależy od przypisanej roli. Przy błędzie użyj resetu hasła.",
    },
  },
  {
    id: "10",
    slug: "web-google-sign-in",
    categoryKey: "web_cabinet",
    keywords: ["google", "oauth", "гугл", "gmail", "sso", "вхід google"],
    titles: {
      ru: "Вход через Google",
      ua: "Вхід через Google",
      en: "Sign in with Google",
      pl: "Logowanie przez Google",
    },
    excerpts: {
      ru: "OAuth и новый аккаунт.",
      ua: "OAuth і новий обліковий запис.",
      en: "OAuth flow and first-time account.",
      pl: "OAuth i pierwsze konto.",
    },
    bodies: {
      ru: "На экране входа выберите Google. Если аккаунта ещё нет, после OAuth вы можете попасть на регистрацию с предзаполненными данными (если салон это включил). Убедитесь, что в браузере не блокируются всплывающие окна и сторонние cookies для домена кабинета.",
      ua: "Оберіть Google на екрані входу. Новий користувач може потрапити на реєстрацію з префілом після OAuth.",
      en: "Pick Google on the sign-in screen. If you are new, you may be redirected to registration with prefilled fields. Allow pop-ups and third-party cookies for the cabinet domain if the provider flow opens in a new window.",
      pl: "Wybierz Google. Nowy użytkownik może trafić na rejestrację z prefillem. Zezwól na okna i cookies dla domeny panelu.",
    },
  },
  {
    id: "11",
    slug: "web-register-salon",
    categoryKey: "web_cabinet",
    keywords: ["регистрация", "rejestracja", "register", "signup", "створити акаунт", "аккаунт"],
    titles: {
      ru: "Регистрация веб-пользователя салона",
      ua: "Реєстрація веб-користувача салону",
      en: "Registering a salon web user",
      pl: "Rejestracja użytkowniczki panelu salonu",
    },
    excerpts: {
      ru: "Приглашение владельца и роль.",
      ua: "Запрошення власника та роль.",
      en: "Owner invite and role assignment.",
      pl: "Zaproszenie właścicielki i rola.",
    },
    bodies: {
      ru: "Обычно владелец салона создаёт аккаунты мастеров или отправляет ссылку-приглашение. При регистрации укажите тот же email, что в приглашении, и задайте пароль. Если письмо не приходит, проверьте спам и корректность адреса.",
      ua: "Власник надсилає запрошення або створює облікові записи. Використовуйте email із запрошення.",
      en: "Owners usually invite staff or create accounts for them. Use the invited email and set a password. Check spam if the invite email is missing.",
      pl: "Właścicielka zaprasza personel lub zakłada konta. Użyj e‑maila z zaproszenia i ustaw hasło.",
    },
  },
  {
    id: "12",
    slug: "master-today-and-schedule",
    categoryKey: "master_role",
    keywords: ["мастер", "master", "schedule", "сьогодні", "dzisiaj", "today", "графік", "расписание"],
    titles: {
      ru: "Расписание мастера",
      ua: "Розклад майстра",
      en: "Master schedule",
      pl: "Grafik stylistki",
    },
    excerpts: {
      ru: "Сегодня, календарь и записи.",
      ua: "Сьогодні, календар і записи.",
      en: "Today view, calendar, and bookings.",
      pl: "Dziś, kalendarz i wizyty.",
    },
    bodies: {
      ru: "В кабинете мастера откройте «Сегодня» для ближайших записей и «Расписание» для недели. Записи, созданные клиентами в боте или омниканале, отображаются здесь же. Если слот пустой, проверьте часы работы салона и привязку мастера к услугам.",
      ua: "У кабінеті майстра — «Сьогодні» та «Розклад». Записи з бота видно тут. Перевірте години та послуги, якщо слотів немає.",
      en: "Use Today for your next bookings and Schedule for the week. Bookings from the bot or omnichannel appear here. If slots look wrong, ask the owner to check work hours and which services you offer.",
      pl: "Zakładki Dziś i Grafik. Rezerwacje z bota są widoczne tutaj. Gdy sloty są puste, poproś właścicielkę o godziny i przypisanie usług.",
    },
  },
  {
    id: "13",
    slug: "master-earnings-profile",
    categoryKey: "master_role",
    keywords: ["доход", "earnings", "zarobki", "заробіток", "профиль", "profile"],
    titles: {
      ru: "Доходы и профиль мастера",
      ua: "Заробіток і профіль майстра",
      en: "Earnings & master profile",
      pl: "Zarobki i profil stylistki",
    },
    excerpts: {
      ru: "Где смотреть суммы и данные.",
      ua: "Де дивитися суми та дані.",
      en: "Where totals and profile data live.",
      pl: "Gdzie są sumy i dane profilu.",
    },
    bodies: {
      ru: "Раздел «Доходы» агрегирует выполненные записи согласно настройкам салона. В «Профиле» обновите имя, фото и контакты — они могут отображаться клиентам при выборе мастера. Спорные суммы согласуйте с владельцем салона.",
      ua: "«Заробіток» зводить виконані візити. У «Профілі» — ім’я та фото для клієнтів.",
      en: "Earnings summarizes completed visits based on salon rules. Profile holds the name and photo clients may see when picking a master. Reconcile totals with the owner if something looks off.",
      pl: "Zarobki sumują zakończone wizyty. Profil — dane widoczne klientkom. W razie wątpliwości skontaktuj się z właścicielką.",
    },
  },
  {
    id: "14",
    slug: "owner-add-master",
    categoryKey: "salon",
    keywords: ["добавить мастера", "add master", "telegram id", "персонал", "staff", "майстер"],
    titles: {
      ru: "Как добавить мастера",
      ua: "Як додати майстра",
      en: "Adding a master",
      pl: "Dodawanie stylistki",
    },
    excerpts: {
      ru: "Роль в тенанте и доступ к кабинету.",
      ua: "Роль у тенанті та доступ до кабінету.",
      en: "Tenant role and dashboard access.",
      pl: "Rola w tenant i dostęp do panelu.",
    },
    bodies: {
      ru: "В кабинете владельца откройте «Мастера» и добавьте пользователя по Telegram ID или приглашению. Назначьте роль «мастер» и привяжите услуги. Без привязки к услугам бот может не показывать мастера в выборе.",
      ua: "У «Майстри» додайте користувача за Telegram ID або запрошенням. Призначте роль і послуги.",
      en: "Under Masters, add the user by Telegram ID or invite. Assign the master role and link services. Unlinked masters may not appear in the client booking flow.",
      pl: "W sekcji Stylistki dodaj użytkowniczkę po Telegram ID lub zaproszeniu. Przypisz rolę i usługi.",
    },
  },
  {
    id: "15",
    slug: "owner-clients-tab",
    categoryKey: "salon",
    keywords: ["клиенты", "clients", "klienci", "клієнти", "база", "crm"],
    titles: {
      ru: "Клиенты в кабинете салона",
      ua: "Клієнти в кабінеті салону",
      en: "Clients in the salon dashboard",
      pl: "Klientki w panelu salonu",
    },
    excerpts: {
      ru: "История визитов и контакты.",
      ua: "Історія візитів і контакти.",
      en: "Visit history and contacts.",
      pl: "Historia wizyt i kontakty.",
    },
    bodies: {
      ru: "Вкладка «Клиенты» показывает людей, которые писали в бот или записывались. Используйте поиск по имени или ID канала. Данные зависят от того, что клиент указал в мессенджере; для GDPR-запросов обращайтесь по процедуре вашего салона.",
      ua: "«Клієнти» збирають звернення та записи. Пошук за іменем або ID каналу.",
      en: "Clients lists people who chatted or booked. Search by name or channel id. Fields reflect what clients shared in chat; handle GDPR requests per your salon policy.",
      pl: "Lista klientek z czatu i rezerwacji. Szukaj po nazwie lub ID kanału.",
    },
  },
  {
    id: "16",
    slug: "owner-work-hours-slots",
    categoryKey: "salon",
    keywords: ["часы", "hours", "godziny", "години", "слоты", "slots", "графік роботи"],
    titles: {
      ru: "Часы работы и слоты записи",
      ua: "Години роботи та слоти",
      en: "Work hours & booking slots",
      pl: "Godziny pracy i sloty",
    },
    excerpts: {
      ru: "Почему нет свободного времени.",
      ua: "Чому немає вільного часу.",
      en: "Why no free time appears.",
      pl: "Dlaczego brak wolnych terminów.",
    },
    bodies: {
      ru: "Задайте часы работы салона и перерывы в настройках. Слоты строятся из длительности услуг и занятости мастеров; Google Calendar может блокировать время как занятое. Если клиенты видят пустой день, проверьте выходной, лимит мастеров по тарифу и синхронизацию календаря.",
      ua: "Години, перерви та зайнятість майстрів формують слоти. Google Calendar може блокувати час.",
      en: "Set salon hours and breaks in settings. Slots use service duration and master availability; Google Calendar may mark time busy. Empty days often mean a day off, plan limits, or calendar sync blocking times.",
      pl: "Ustaw godziny i przerwy. Sloty zależą od usług i zajętości; Kalendarz Google może blokować terminy.",
    },
  },
  {
    id: "17",
    slug: "support-ticket-lifecycle",
    categoryKey: "support",
    keywords: ["claim", "escalate", "close", "взять", "ескалація", "закрити", "ticket", "тикет", "агент"],
    titles: {
      ru: "Тикет: взять в работу, эскалация, закрытие",
      ua: "Тикет: взяти в роботу, ескалація, закриття",
      en: "Tickets: claim, escalate, close",
      pl: "Zgłoszenie: przejęcie, eskalacja, zamknięcie",
    },
    excerpts: {
      ru: "Сценарии агента поддержки.",
      ua: "Сценарії агента підтримки.",
      en: "Support agent workflows.",
      pl: "Praca agenta wsparcia.",
    },
    bodies: {
      ru: "Откройте тикет из очереди и нажмите «Взять в работу», чтобы зафиксировать ответственного. Эскалация передаёт сложный случай техподдержке или владельцу процесса. Перед закрытием убедитесь, что клиент получил решение или следующий шаг; черновики ответов сохраняйте до отправки.",
      ua: "«Взяти в роботу» фіксує відповідального. Ескалація — для складніших кейсів. Перед закриттям перевірте відповідь клієнту.",
      en: "Claim a ticket to own the thread. Escalate when you need engineering or billing help. Before closing, confirm the customer has a clear resolution or follow-up. Save drafts carefully before sending.",
      pl: "Przejmij zgłoszenie, aby je prowadzić. Eskaluj przy problemach technicznych lub rozliczeniach. Przed zamknięciem upewnij się co do rozwiązania.",
    },
  },
  {
    id: "18",
    slug: "client-open-mini-app",
    categoryKey: "client",
    keywords: ["мини", "mini app", "telegram", "відкрити", "открыть", "zapis"],
    titles: {
      ru: "Как открыть мини-приложение салона",
      ua: "Як відкрити міні-додаток салону",
      en: "Opening the salon mini app",
      pl: "Otwieranie mini aplikacji salonu",
    },
    excerpts: {
      ru: "Кнопка в боте и прямая ссылка.",
      ua: "Кнопка в боті та пряме посилання.",
      en: "Bot button and deep link.",
      pl: "Przycisk w bocie i link.",
    },
    bodies: {
      ru: "В Telegram откройте бот салона и нажмите кнопку меню или ссылку «Кабинет» / «Записи», если салон её добавил. Мини-приложение открывается внутри Telegram; войдите тем же аккаунтом. Если кнопки нет, напишите владельцу салона — возможно, меню ещё не настроено.",
      ua: "У боті салону шукайте кнопку меню або посилання на міні-додаток. Якщо немає — напишіть салону.",
      en: "In the salon bot, open the menu button or the dashboard link the owner configured. The mini app runs inside Telegram; sign in with the same account. If you do not see a button, ask the salon to publish it.",
      pl: "W bocie salonu użyj menu lub linku do mini aplikacji. Jeśli go brakuje, napisz do salonu.",
    },
  },
  {
    id: "19",
    slug: "client-find-salon-bot",
    categoryKey: "client",
    keywords: ["бот", "bot", "instagram", "whatsapp", "канал", "link", "посилання"],
    titles: {
      ru: "Где найти бота или канал салона",
      ua: "Де знайти бота або канал салону",
      en: "Finding the salon bot or channel",
      pl: "Gdzie znaleźć bota lub kanał salonu",
    },
    excerpts: {
      ru: "Telegram, Instagram, WhatsApp.",
      ua: "Telegram, Instagram, WhatsApp.",
      en: "Telegram, Instagram, WhatsApp.",
      pl: "Telegram, Instagram, WhatsApp.",
    },
    bodies: {
      ru: "Обычно салон публикует ссылку t.me/… в соцсетях или на сайте. Для Instagram и WhatsApp используйте кнопки «Написать» из профиля бизнеса — ответ идёт в подключённый к ManicBot канал. Не делитесь одноразовыми кодами и паролями в чате.",
      ua: "Шукайте посилання t.me у соцмережах. У Instagram/WhatsApp пишіть через кнопки профілю.",
      en: "Look for a t.me link on the salon site or social bio. On Instagram or WhatsApp use the business chat entry points. Never send passwords or recovery codes in chat.",
      pl: "Szukaj linku t.me u salonu. Na Instagramie/WhatsApp użyj czatu firmowego. Nie wysyłaj haseł na czacie.",
    },
  },
  {
    id: "20",
    slug: "billing-grace-and-limits",
    categoryKey: "billing",
    keywords: ["grace", "просроч", "expired", "karta", "card", "лимит", "limit", "staff"],
    titles: {
      ru: "Grace-период и ограничения для персонала",
      ua: "Grace та обмеження для персоналу",
      en: "Grace period & staff limits",
      pl: "Grace i ograniczenia personelu",
    },
    excerpts: {
      ru: "Что отключается при проблеме с оплатой.",
      ua: "Що вимикається при проблемі з оплатою.",
      en: "What turns off when billing fails.",
      pl: "Co jest wyłączane przy błędzie płatności.",
    },
    bodies: {
      ru: "При ошибке карты Stripe включается короткий grace: персонал ещё может работать в кабинете. После grace часть функций (ИИ, календарь Google, расширенные панели) может быть ограничена — клиентская запись обычно остаётся. Обновите способ оплаты во вкладке «Биллинг» как можно раньше.",
      ua: "Після збою картки є короткий grace, далі можуть обмежити функції для персоналу, а запис клієнтів часто лишається.",
      en: "After a failed charge you get a short grace window. Later, staff-only features like AI or Google sync may pause while clients can often still book. Update your card in Billing promptly.",
      pl: "Po błędzie płatności jest krótki grace, potem mogą paść funkcje personelu, a klienci często dalej mogą rezerwować. Zaktualizuj kartę w rozliczeniach.",
    },
  },
  {
    id: "21",
    slug: "salon-ai-assistant",
    categoryKey: "salon",
    keywords: ["ии", "ai", "штучний інтелект", "asystent", "чат", "chat", "gpt"],
    titles: {
      ru: "ИИ-помощник в боте",
      ua: "ІІ-помічник у боті",
      en: "AI assistant in the bot",
      pl: "Asystent AI w bocie",
    },
    excerpts: {
      ru: "Доступность по тарифу и лимиты.",
      ua: "Доступність за тарифом і ліміти.",
      en: "Plan gating and safe use.",
      pl: "Dostępność wg planu.",
    },
    bodies: {
      ru: "На тарифах Pro/Studio бот может отвечать с помощью ИИ на общие вопросы и подсказки по записи. ИИ не заменяет политику салона: проверяйте цены и условия вручную. При странных ответах отключите ИИ в настройках или обратитесь в поддержку платформы.",
      ua: "На вищих тарифах бот може використовувати ІІ. Перевіряйте ціни вручну; при аномаліях зверніться до підтримки.",
      en: "On higher plans the bot may use AI for FAQs and booking hints. Always verify pricing and policies manually. If replies look wrong, disable AI in settings or contact platform support.",
      pl: "Na wyższych planach bot może używać AI. Ceny weryfikuj ręcznie; przy błędach wyłącz AI lub napisz na wsparcie.",
    },
  },
  {
    id: "22",
    slug: "platform-multitenant-overview",
    categoryKey: "platform_admin",
    keywords: ["тенант", "tenant", "бот", "multitenant", "d1", "registry"],
    titles: {
      ru: "Мультитенантность: салоны и боты",
      ua: "Мультитенантність: салони та боти",
      en: "Multi-tenant salons & bots",
      pl: "Wielu najemców — salony i boty",
    },
    excerpts: {
      ru: "Как устроена платформа без доступа к секретам.",
      ua: "Як влаштована платформа без секретів.",
      en: "How the platform fits together.",
      pl: "Jak działa platforma.",
    },
    bodies: {
      ru: "Каждый салон — отдельный тенант с собственными ботами, пользователями и биллингом. Вебхуки Telegram приходят на Worker с идентификатором бота; контекст поднимается из базы. Секреты (токены, ключи) хранятся только в защищённом хранилище — в интерфейсе God Mode их не видно в открытом виде.",
      ua: "Кожен салон — окремий тенант. Вебхуки йдуть з ID бота; секрети не показуються у відкритому вигляді.",
      en: "Each salon is an isolated tenant with its own bots, users, and billing. Telegram hits the Worker with a bot id; context loads from the database. Secrets stay in secure storage and are not shown in plain text in admin tools.",
      pl: "Każdy salon to tenant z botami i rozliczeniami. Worker rozpoznaje bota po ID; sekrety nie są widoczne jawnie.",
    },
  },
  {
    id: "23",
    slug: "platform-god-mode-safety",
    categoryKey: "platform_admin",
    keywords: ["god", "админ", "admin", "creator", "безопасность", "security", "audit"],
    titles: {
      ru: "God Mode и безопасность действий",
      ua: "God Mode і безпека дій",
      en: "God Mode & safe operations",
      pl: "God Mode i bezpieczne działania",
    },
    excerpts: {
      ru: "Кому доступна расширенная панель.",
      ua: "Кому доступна розширена панель.",
      en: "Who gets the elevated console.",
      pl: "Kto ma pełny panel.",
    },
    bodies: {
      ru: "Расширенная панель платформы доступна только доверенным ролям (создатель, системные администраторы). Любые массовые операции (просмотр тенантов, настройки биллинга) должны выполняться осознанно и с журналированием в вашем процессе. Не используйте God Mode для рутинных задач салона — для этого есть кабинет владельца.",
      ua: "Повний доступ лише для довірених ролей. Масові зміни робіть обережно; для щоденної роботи салону — кабінет власника.",
      en: "The elevated console is for trusted platform roles only. Treat bulk changes to tenants or billing as high risk and log them in your runbooks. Day-to-day salon work belongs in the owner dashboard, not God Mode.",
      pl: "Pełny panel tylko dla zaufanych ról platformy. Zmiany masowe traktuj jak ryzykowne; codzienna praca salonu — w panelu właścicielki.",
    },
  },
  {
    id: "24",
    slug: "troubleshooting-bot-silent",
    categoryKey: "support",
    keywords: ["молчит", "silent", "не отвечает", "404", "webhook", "debug", "troubleshoot"],
    titles: {
      ru: "Бот не отвечает — что проверить",
      ua: "Бот не відповідає — що перевірити",
      en: "Bot is silent — checklist",
      pl: "Bot nie odpowiada — lista kontrolna",
    },
    excerpts: {
      ru: "Вебхук, тариф и контекст бота.",
      ua: "Вебхук, тариф і контекст бота.",
      en: "Webhook, billing, and bot routing.",
      pl: "Webhook, rozliczenia, routing bota.",
    },
    bodies: {
      ru: "1) Убедитесь, что используете актуальный бот и канал. 2) Проверьте, не истёк ли тарифный grace и не отключены ли функции канала. 3) Для мультитенанта webhook должен указывать на URL с ID бота. 4) Если проблема сохраняется, соберите время сообщения и идентификатор бота для поддержки — без публикации токенов.",
      ua: "Перевірте правильний бот, тариф, URL вебхука з bot ID. Для підтримки надайте час і ID без токенів.",
      en: "1) Confirm you message the correct bot. 2) Check billing/grace for staff features. 3) Multi-tenant setups need the /webhook/{botId} URL. 4) For support, share timestamps and bot id — never post bot tokens.",
      pl: "Sprawdź właściwego bota, rozliczenia, URL webhooka z botId. W zgłoszeniu podaj czas i ID bez tokenów.",
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
  {
    keywords: ["тариф", "plan", "лимит", "masters", "майстри", "лимиты"],
    questions: {
      ru: "Сколько мастеров доступно на моём тарифе?",
      ua: "Скільки майстрів доступно на моєму тарифі?",
      en: "How many masters does my plan include?",
      pl: "Ile stylistek obejmuje mój plan?",
    },
    answers: {
      ru: "Start — один мастер, Pro — до пяти, Studio — без лимита по мастерам (см. описание плана в биллинге). Лимиты касаются персонала в кабинете; клиентская запись не тарифицируется по количеству клиентов.",
      ua: "Start — один майстер, Pro — до п’яти, Studio — без ліміту. Деталі — у білінгу.",
      en: "Start allows one master, Pro up to five, Studio is unlimited for masters (see Billing). Limits apply to staff dashboards, not to how many clients can book.",
      pl: "Start: jedna stylistka, Pro: do pięciu, Studio: bez limitu osób — szczegóły w rozliczeniach.",
    },
  },
  {
    keywords: ["instagram", "whatsapp", "24", "окно", "window", "политика", "meta"],
    questions: {
      ru: "Почему в Instagram/WhatsApp нет ответа сразу?",
      ua: "Чому в Instagram/WhatsApp немає відповіді одразу?",
      en: "Why is Instagram/WhatsApp messaging delayed?",
      pl: "Dlaczego Instagram/WhatsApp odpowiada z opóźnieniem?",
    },
    answers: {
      ru: "У Meta действуют окна обмена сообщениями. После простоя бот может отправлять только шаблоны или ждать нового сообщения клиента. Настройте приветствие и напоминания внутри правил канала.",
      ua: "У Meta є вікна повідомлень. Після паузи бот може бути обмежений політикою каналу.",
      en: "Meta channels enforce messaging windows. After a quiet period the bot may need a fresh client message or an approved template. Tune greetings and reminders within channel rules.",
      pl: "Kanały Meta mają okna wiadomości. Po przerwie bot może wymagać nowej wiadomości klientki lub szablonu.",
    },
  },
  {
    keywords: ["пароль", "password", "сброс", "reset", "забыл", "forgot"],
    questions: {
      ru: "Забыл пароль от веб-кабинета",
      ua: "Забув пароль від веб-кабінету",
      en: "I forgot my web password",
      pl: "Zapomniałam hasła do panelu",
    },
    answers: {
      ru: "На экране входа используйте «Забыли пароль» и проверьте почту (включая спам). Если письма нет, убедитесь, что вводите тот же email, что при регистрации, и что домен почты не блокирует рассылку.",
      ua: "На екрані входу — «Забули пароль». Перевірте пошту та спам.",
      en: "Use Forgot password on the sign-in screen and check spam. Make sure you use the same email you registered with.",
      pl: "Użyj „Nie pamiętam hasła” i sprawdź spam. Email musi być ten sam co przy rejestracji.",
    },
  },
  {
    keywords: ["данные", "privacy", "gdpr", "персональні", "dane"],
    questions: {
      ru: "Где хранятся данные клиентов?",
      ua: "Де зберігаються дані клієнтів?",
      en: "Where is client data stored?",
      pl: "Gdzie są dane klientek?",
    },
    answers: {
      ru: "Данные тенанта хранятся в инфраструктуре ManicBot (Cloudflare D1/KV) в рамках изоляции салона. Владелец салона отвечает перед своими клиентами за локальные юридические требования; при запросе на удаление обработайте его по внутренней процедуре салона и обратитесь в поддержку платформы при необходимости массовых операций.",
      ua: "Дані ізольовані по тенанту в інфраструктурі ManicBot. Юридична відповідальність перед клієнтами — у салону.",
      en: "Tenant data is isolated in ManicBot infrastructure. Salon owners remain responsible to their clients under local law; for erasure requests follow your salon policy and involve platform support for bulk technical actions.",
      pl: "Dane są izolowane per tenant w infrastrukturze ManicBot. Salon odpowiada wobec klientek wg lokalnego prawa.",
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

/** True when the help UI should filter (substring / token search), not show the full catalog. */
export function helpHasActiveSearch(q: string): boolean {
  const raw = q.trim().toLowerCase();
  if (raw.length >= 2) return true;
  return normalizeHelpQuery(q).length > 0;
}

/** Ranking for autocomplete: prefix and substring over title, keywords, body (current language). */
export function suggestionScoreArticle(a: HelpArticle, lang: Lang, raw: string): number {
  if (raw.length < 2) return 0;
  const title = a.titles[lang].toLowerCase();
  const excerpt = a.excerpts[lang].toLowerCase();
  const body = a.bodies[lang].toLowerCase();
  const cat = HELP_CATEGORY_LABELS[a.categoryKey][lang].toLowerCase();
  let s = 0;
  if (title.startsWith(raw)) s += 60;
  else if (title.includes(raw)) s += 35;
  for (const k of a.keywords) {
    const kl = k.toLowerCase();
    if (kl.startsWith(raw)) s += 28;
    else if (kl.includes(raw)) s += 14;
  }
  if (excerpt.includes(raw)) s += 10;
  if (body.includes(raw)) s += 5;
  if (cat.includes(raw)) s += 6;
  return s;
}

export function suggestionScoreFaq(f: HelpFaq, lang: Lang, raw: string): number {
  if (raw.length < 2) return 0;
  const q = f.questions[lang].toLowerCase();
  const a = f.answers[lang].toLowerCase();
  let s = 0;
  if (q.startsWith(raw)) s += 55;
  else if (q.includes(raw)) s += 32;
  if (a.includes(raw)) s += 8;
  for (const k of f.keywords) {
    const kl = k.toLowerCase();
    if (kl.startsWith(raw)) s += 24;
    else if (kl.includes(raw)) s += 12;
  }
  return s;
}

export function scoreArticle(a: HelpArticle, lang: Lang, words: string[]): number {
  if (words.length === 0) return 0;
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
  if (words.length === 0) return 0;
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

/** Combined score for filtering articles when the search box is active. */
export function filterScoreArticle(a: HelpArticle, lang: Lang, q: string): number {
  if (!helpHasActiveSearch(q)) return 1;
  const words = normalizeHelpQuery(q);
  const raw = q.trim().toLowerCase();
  const fromWords = words.length > 0 ? scoreArticle(a, lang, words) : 0;
  const fromRaw = raw.length >= 2 ? suggestionScoreArticle(a, lang, raw) : 0;
  return Math.max(fromWords, fromRaw);
}

export function filterScoreFaq(f: HelpFaq, lang: Lang, q: string): number {
  if (!helpHasActiveSearch(q)) return 1;
  const words = normalizeHelpQuery(q);
  const raw = q.trim().toLowerCase();
  const fromWords = words.length > 0 ? scoreFaq(f, lang, words) : 0;
  const fromRaw = raw.length >= 2 ? suggestionScoreFaq(f, lang, raw) : 0;
  return Math.max(fromWords, fromRaw);
}

export type HelpSuggestion =
  | {
      kind: "article";
      slug: string;
      categoryKey: HelpArticle["categoryKey"];
      title: string;
      subtitle: string;
      score: number;
    }
  | { kind: "faq"; index: number; title: string; subtitle: string; score: number };

/** Live dropdown: substring / prefix match in the active language (articles + FAQ). */
export function getHelpSuggestions(lang: Lang, q: string, limit = 12): HelpSuggestion[] {
  const raw = q.trim().toLowerCase();
  if (raw.length < 2) return [];
  const out: HelpSuggestion[] = [];
  for (const a of HELP_ARTICLES) {
    const score = suggestionScoreArticle(a, lang, raw);
    if (score > 0) {
      out.push({
        kind: "article",
        slug: a.slug,
        categoryKey: a.categoryKey,
        title: a.titles[lang],
        subtitle: a.excerpts[lang],
        score,
      });
    }
  }
  HELP_FAQS.forEach((f, index) => {
    const score = suggestionScoreFaq(f, lang, raw);
    if (score > 0) {
      const ans = f.answers[lang];
      out.push({
        kind: "faq",
        index,
        title: f.questions[lang],
        subtitle: ans.length > 140 ? `${ans.slice(0, 137)}…` : ans,
        score,
      });
    }
  });
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}
