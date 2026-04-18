import type { Lang } from "~/lib/i18n";

export type HelpUiFigure =
  | {
      kind: "telegram_chat";
      caption?: Record<Lang, string>;
      chatTitle: Record<Lang, string>;
      messages: { side: "user" | "bot"; text: Record<Lang, string> }[];
    }
  | {
      kind: "mini_app";
      caption?: Record<Lang, string>;
      title: Record<Lang, string>;
      rows: { label: Record<Lang, string>; hint?: Record<Lang, string> }[];
    }
  | {
      kind: "dashboard_nav";
      caption?: Record<Lang, string>;
      items: Record<Lang, string[]>;
      activeIndex?: number;
    }
  | {
      kind: "data_card";
      caption?: Record<Lang, string>;
      cardTitle: Record<Lang, string>;
      fields: Record<Lang, { label: string; value: string }[]>;
      actionLabel?: Record<Lang, string>;
    }
  | {
      kind: "inbox_list";
      caption?: Record<Lang, string>;
      rows: Record<Lang, { title: string; channel: string; time?: string }[]>;
    }
  | {
      kind: "channel_bars";
      caption?: Record<Lang, string>;
      channels: Record<Lang, { name: string; active: boolean }[]>;
    }
  | {
      kind: "form_mock";
      caption?: Record<Lang, string>;
      fields: Record<Lang, { label: string; placeholder: string }[]>;
      button: Record<Lang, string>;
      oauthHint?: Record<Lang, string>;
    }
  | {
      kind: "ticket_strip";
      caption?: Record<Lang, string>;
      subject: Record<Lang, string>;
      status: Record<Lang, string>;
      actions: Record<Lang, string[]>;
    }
  | {
      kind: "checklist";
      caption?: Record<Lang, string>;
      items: Record<Lang, string[]>;
    }
  | {
      kind: "split_screen";
      caption?: Record<Lang, string>;
      leftTitle: Record<Lang, string>;
      rightTitle: Record<Lang, string>;
      leftItems: Record<Lang, string[]>;
      rightItems: Record<Lang, string[]>;
    };

export const HELP_FIGURES_BY_SLUG: Record<string, HelpUiFigure[]> = {
  "cancel-appointment": [
    {
      kind: "dashboard_nav",
      caption: {
        ru: "Кабинет владельца: раздел с записями",
        ua: "Кабінет власника: записи",
        en: "Owner dashboard: appointments area",
        pl: "Panel właścicielki: wizyty",
      },
      items: {
        ru: ["Обзор", "Записи", "Мастера", "Услуги", "Клиенты", "Биллинг", "Настройки"],
        ua: ["Огляд", "Записи", "Майстри", "Послуги", "Клієнти", "Білінг", "Налаштування"],
        en: ["Overview", "Appointments", "Masters", "Services", "Clients", "Billing", "Settings"],
        pl: ["Przegląd", "Wizyty", "Stylistki", "Usługi", "Klientki", "Rozliczenia", "Ustawienia"],
      },
      activeIndex: 1,
    },
    {
      kind: "data_card",
      caption: {
        ru: "Карточка записи — действие «Отменить»",
        ua: "Картка запису — дія «Скасувати»",
        en: "Booking card — Cancel action",
        pl: "Karta wizyty — Anuluj",
      },
      cardTitle: { ru: "Пт, 12:30 · Маникюр", ua: "Пт, 12:30 · Манікюр", en: "Fri, 12:30 · Manicure", pl: "Pt, 12:30 · Manicure" },
      fields: {
        ru: [
          { label: "Мастер", value: "Анна" },
          { label: "Клиент", value: "Мария · Telegram" },
          { label: "Статус", value: "Подтверждена" },
        ],
        ua: [
          { label: "Майстер", value: "Анна" },
          { label: "Клієнт", value: "Марія · Telegram" },
          { label: "Статус", value: "Підтверджено" },
        ],
        en: [
          { label: "Master", value: "Anna" },
          { label: "Client", value: "Maria · Telegram" },
          { label: "Status", value: "Confirmed" },
        ],
        pl: [
          { label: "Stylistka", value: "Anna" },
          { label: "Klientka", value: "Maria · Telegram" },
          { label: "Status", value: "Potwierdzona" },
        ],
      },
      actionLabel: { ru: "Отменить запись", ua: "Скасувати запис", en: "Cancel booking", pl: "Anuluj wizytę" },
    },
  ],
  "new-booking-flow": [
    {
      kind: "telegram_chat",
      caption: {
        ru: "Диалог клиента с ботом салона",
        ua: "Діалог клієнта з ботом",
        en: "Client chat with the salon bot",
        pl: "Czat klientki z botem salonu",
      },
      chatTitle: { ru: "Nail Studio · бот", ua: "Nail Studio · бот", en: "Nail Studio · bot", pl: "Nail Studio · bot" },
      messages: [
        { side: "bot", text: { ru: "Выберите услугу:", ua: "Оберіть послугу:", en: "Pick a service:", pl: "Wybierz usługę:" } },
        { side: "user", text: { ru: "Маникюр", ua: "Манікюр", en: "Manicure", pl: "Manicure" } },
        { side: "bot", text: { ru: "Свободно: 14:00, 15:30. Нажмите слот.", ua: "Вільно: 14:00, 15:30.", en: "Free: 2:00 PM, 3:30 PM.", pl: "Wolne: 14:00, 15:30." } },
        { side: "user", text: { ru: "15:30", ua: "15:30", en: "3:30 PM", pl: "15:30" } },
        { side: "bot", text: { ru: "Запись создана ✓", ua: "Запис створено ✓", en: "Booked ✓", pl: "Zarezerwowano ✓" } },
      ],
    },
  ],
  "services-catalog": [
    {
      kind: "dashboard_nav",
      caption: {
        ru: "Вкладка «Услуги»",
        ua: "Вкладка «Послуги»",
        en: "Services tab",
        pl: "Zakładka Usługi",
      },
      items: {
        ru: ["Обзор", "Записи", "Мастера", "Услуги", "Клиенты"],
        ua: ["Огляд", "Записи", "Майстри", "Послуги", "Клієнти"],
        en: ["Overview", "Appointments", "Masters", "Services", "Clients"],
        pl: ["Przegląd", "Wizyty", "Stylistki", "Usługi", "Klientki"],
      },
      activeIndex: 3,
    },
    {
      kind: "mini_app",
      caption: {
        ru: "Как список услуг видит клиент в боте",
        ua: "Список послуг у боті",
        en: "How services appear to clients",
        pl: "Lista usług w bocie",
      },
      title: { ru: "Услуги", ua: "Послуги", en: "Services", pl: "Usługi" },
      rows: [
        { label: { ru: "💅 Маникюр · 120 zł", ua: "💅 Манікюр · 120 zł", en: "💅 Manicure · 120 zł", pl: "💅 Manicure · 120 zł" }, hint: { ru: "60 мин", ua: "60 хв", en: "60 min", pl: "60 min" } },
        { label: { ru: "✨ Педикюр · 180 zł", ua: "✨ Педикюр · 180 zł", en: "✨ Pedicure · 180 zł", pl: "✨ Pedicure · 180 zł" } },
      ],
    },
  ],
  "support-ticket": [
    {
      kind: "split_screen",
      caption: {
        ru: "Куда писать: платформа vs салон",
        ua: "Куди писати: платформа vs салон",
        en: "Where to write: platform vs salon",
        pl: "Gdzie pisać: platforma vs salon",
      },
      leftTitle: { ru: "Платформа ManicBot", ua: "Платформа ManicBot", en: "ManicBot platform", pl: "Platforma ManicBot" },
      rightTitle: { ru: "Бот вашего салона", ua: "Бот вашого салону", en: "Your salon bot", pl: "Bot Twojego salonu" },
      leftItems: {
        ru: ["Оплата подписки", "Доступ в кабинет", "Баг продукта"],
        ua: ["Оплата підписки", "Доступ до кабінету", "Баг продукту"],
        en: ["Subscription billing", "Dashboard access", "Product bug"],
        pl: ["Rozliczenia", "Dostęp do panelu", "Błąd produktu"],
      },
      rightItems: {
        ru: ["Перенос записи", "Цены услуг", "Адрес салона"],
        ua: ["Перенесення запису", "Ціни", "Адреса"],
        en: ["Reschedule visit", "Service prices", "Salon address"],
        pl: ["Zmiana terminu", "Ceny usług", "Adres salonu"],
      },
    },
    {
      kind: "inbox_list",
      caption: {
        ru: "Очередь тикетов (поддержка)",
        ua: "Черга тикетів",
        en: "Ticket queue (support)",
        pl: "Kolejka zgłoszeń",
      },
      rows: {
        ru: [
          { title: "Не приходит чек Stripe", channel: "Биллинг", time: "12:04" },
          { title: "Не вижу мастера в боте", channel: "Продукт", time: "11:40" },
        ],
        ua: [
          { title: "Не надходить чек Stripe", channel: "Білінг", time: "12:04" },
          { title: "Не бачу майстра в боті", channel: "Продукт", time: "11:40" },
        ],
        en: [
          { title: "Stripe receipt missing", channel: "Billing", time: "12:04" },
          { title: "Master missing in bot", channel: "Product", time: "11:40" },
        ],
        pl: [
          { title: "Brak paragonu Stripe", channel: "Rozliczenia", time: "12:04" },
          { title: "Brak stylistki w bocie", channel: "Produkt", time: "11:40" },
        ],
      },
    },
  ],
  "images-attachments": [
    {
      kind: "telegram_chat",
      caption: {
        ru: "Клиент прислал фото — бот фиксирует вложение",
        ua: "Клієнт надіслав фото",
        en: "Client sends a photo reference",
        pl: "Klientka wysyła zdjęcie",
      },
      chatTitle: { ru: "Диалог", ua: "Діалог", en: "Chat", pl: "Czat" },
      messages: [
        { side: "user", text: { ru: "[Фото]", ua: "[Фото]", en: "[Photo]", pl: "[Zdjęcie]" } },
        { side: "bot", text: { ru: "Принято. Покажите мастеру перед визитом.", ua: "Прийнято. Покажіть майстру.", en: "Got it — show your master before the visit.", pl: "Przyjęto — pokaż stylistce przed wizytą." } },
      ],
    },
  ],
  "google-calendar": [
    {
      kind: "mini_app",
      caption: {
        ru: "Настройки → блок Google (упрощённо)",
        ua: "Налаштування → Google",
        en: "Settings → Google block (simplified)",
        pl: "Ustawienia → Google",
      },
      title: { ru: "Настройки салона", ua: "Налаштування салону", en: "Salon settings", pl: "Ustawienia salonu" },
      rows: [
        {
          label: { ru: "Google Календарь", ua: "Google Календар", en: "Google Calendar", pl: "Kalendarz Google" },
          hint: { ru: "Подключено · занятость учитывается", ua: "Підключено", en: "Connected · busy times used", pl: "Połączono" },
        },
        {
          label: { ru: "Открыть OAuth в боте", ua: "Відкрити OAuth у боті", en: "Open OAuth link from bot", pl: "OAuth z linku w bocie" },
        },
      ],
    },
  ],
  "channels-omni": [
    {
      kind: "channel_bars",
      caption: {
        ru: "Подключённые каналы в настройках",
        ua: "Підключені канали",
        en: "Connected channels in settings",
        pl: "Podłączone kanały",
      },
      channels: {
        ru: [
          { name: "Telegram · @nailstudio_bot", active: true },
          { name: "Instagram DM", active: true },
          { name: "WhatsApp Business", active: false },
        ],
        ua: [
          { name: "Telegram · @nailstudio_bot", active: true },
          { name: "Instagram DM", active: true },
          { name: "WhatsApp Business", active: false },
        ],
        en: [
          { name: "Telegram · @nailstudio_bot", active: true },
          { name: "Instagram DM", active: true },
          { name: "WhatsApp Business", active: false },
        ],
        pl: [
          { name: "Telegram · @nailstudio_bot", active: true },
          { name: "Instagram DM", active: true },
          { name: "WhatsApp Business", active: false },
        ],
      },
    },
    {
      kind: "inbox_list",
      caption: {
        ru: "Единая лента разговоров",
        ua: "Єдина стрічка діалогів",
        en: "Single conversation stream",
        pl: "Jedna lista rozmów",
      },
      rows: {
        ru: [
          { title: "Мария — запись на сб", channel: "TG", time: "2 мин" },
          { title: "Вопрос по цене", channel: "IG", time: "12 мин" },
        ],
        ua: [
          { title: "Марія — запис на сб", channel: "TG", time: "2 хв" },
          { title: "Питання по ціні", channel: "IG", time: "12 хв" },
        ],
        en: [
          { title: "Maria — Sat booking", channel: "TG", time: "2m" },
          { title: "Price question", channel: "IG", time: "12m" },
        ],
        pl: [
          { title: "Maria — sobota", channel: "TG", time: "2 min" },
          { title: "Pytanie o cenę", channel: "IG", time: "12 min" },
        ],
      },
    },
  ],
  "billing-plans": [
    {
      kind: "data_card",
      caption: {
        ru: "Вкладка «Биллинг»",
        ua: "Вкладка «Білінг»",
        en: "Billing tab",
        pl: "Rozliczenia",
      },
      cardTitle: { ru: "Текущий план", ua: "Поточний тариф", en: "Current plan", pl: "Obecny plan" },
      fields: {
        ru: [
          { label: "План", value: "Pro" },
          { label: "Статус", value: "active" },
          { label: "Мастера", value: "до 5" },
        ],
        ua: [
          { label: "Тариф", value: "Pro" },
          { label: "Статус", value: "active" },
          { label: "Майстри", value: "до 5" },
        ],
        en: [
          { label: "Plan", value: "Pro" },
          { label: "Status", value: "active" },
          { label: "Masters", value: "up to 5" },
        ],
        pl: [
          { label: "Plan", value: "Pro" },
          { label: "Status", value: "active" },
          { label: "Stylistki", value: "do 5" },
        ],
      },
      actionLabel: { ru: "Управление в Stripe", ua: "Керування в Stripe", en: "Manage in Stripe", pl: "Zarządzaj w Stripe" },
    },
  ],
  "web-sign-in-password": [
    {
      kind: "form_mock",
      caption: {
        ru: "Экран входа в веб-кабинет",
        ua: "Екран входу",
        en: "Web sign-in screen",
        pl: "Logowanie do panelu",
      },
      fields: {
        ru: [
          { label: "Email", placeholder: "you@salon.com" },
          { label: "Пароль", placeholder: "••••••••" },
        ],
        ua: [
          { label: "Email", placeholder: "you@salon.com" },
          { label: "Пароль", placeholder: "••••••••" },
        ],
        en: [
          { label: "Email", placeholder: "you@salon.com" },
          { label: "Password", placeholder: "••••••••" },
        ],
        pl: [
          { label: "E-mail", placeholder: "you@salon.com" },
          { label: "Hasło", placeholder: "••••••••" },
        ],
      },
      button: { ru: "Войти", ua: "Увійти", en: "Sign in", pl: "Zaloguj" },
    },
  ],
  "web-google-sign-in": [
    {
      kind: "form_mock",
      caption: {
        ru: "Вариант входа через Google",
        ua: "Вхід через Google",
        en: "Google sign-in option",
        pl: "Logowanie Google",
      },
      fields: {
        ru: [{ label: "Email", placeholder: "или войти через Google →" }],
        ua: [{ label: "Email", placeholder: "або Google →" }],
        en: [{ label: "Email", placeholder: "or continue with Google →" }],
        pl: [{ label: "E-mail", placeholder: "lub Google →" }],
      },
      button: { ru: "Продолжить с Google", ua: "Продовжити з Google", en: "Continue with Google", pl: "Kontynuuj z Google" },
      oauthHint: {
        ru: "Откроется окно провайдера; разрешите всплывающие окна",
        ua: "Вікно провайдера; дозвольте pop-up",
        en: "Provider window — allow pop-ups",
        pl: "Okno dostawcy — zezwól na pop-up",
      },
    },
  ],
  "web-register-salon": [
    {
      kind: "form_mock",
      caption: {
        ru: "Регистрация после приглашения",
        ua: "Реєстрація після запрошення",
        en: "Registration after invite",
        pl: "Rejestracja po zaproszeniu",
      },
      fields: {
        ru: [
          { label: "Email", placeholder: "master@salon.com" },
          { label: "Пароль", placeholder: "мин. 8 символов" },
        ],
        ua: [
          { label: "Email", placeholder: "master@salon.com" },
          { label: "Пароль", placeholder: "мін. 8 символів" },
        ],
        en: [
          { label: "Email", placeholder: "master@salon.com" },
          { label: "Password", placeholder: "min. 8 characters" },
        ],
        pl: [
          { label: "E-mail", placeholder: "master@salon.com" },
          { label: "Hasło", placeholder: "min. 8 znaków" },
        ],
      },
      button: { ru: "Создать аккаунт", ua: "Створити акаунт", en: "Create account", pl: "Utwórz konto" },
    },
  ],
  "master-today-and-schedule": [
    {
      kind: "dashboard_nav",
      caption: {
        ru: "Кабинет мастера",
        ua: "Кабінет майстра",
        en: "Master dashboard",
        pl: "Panel stylistki",
      },
      items: {
        ru: ["Сегодня", "Расписание", "Клиенты", "Доходы", "Профиль"],
        ua: ["Сьогодні", "Розклад", "Клієнти", "Заробіток", "Профіль"],
        en: ["Today", "Schedule", "Clients", "Earnings", "Profile"],
        pl: ["Dziś", "Grafik", "Klientki", "Zarobki", "Profil"],
      },
      activeIndex: 0,
    },
    {
      kind: "data_card",
      caption: {
        ru: "Ближайшая запись на «Сегодня»",
        ua: "Найближчий запис",
        en: "Next booking on Today",
        pl: "Najbliższa wizyta",
      },
      cardTitle: { ru: "14:00 — Ольга", ua: "14:00 — Ольга", en: "2:00 PM — Olga", pl: "14:00 — Olga" },
      fields: {
        ru: [
          { label: "Услуга", value: "Гель-лак" },
          { label: "Длительность", value: "90 мин" },
        ],
        ua: [
          { label: "Послуга", value: "Гель-лак" },
          { label: "Тривалість", value: "90 хв" },
        ],
        en: [
          { label: "Service", value: "Gel polish" },
          { label: "Duration", value: "90 min" },
        ],
        pl: [
          { label: "Usługa", value: "Hybryda" },
          { label: "Czas", value: "90 min" },
        ],
      },
    },
  ],
  "master-earnings-profile": [
    {
      kind: "data_card",
      caption: {
        ru: "Сводка доходов (пример)",
        ua: "Зведення заробітку",
        en: "Earnings summary (example)",
        pl: "Podsumowanie zarobków",
      },
      cardTitle: { ru: "Март 2026", ua: "Березень 2026", en: "March 2026", pl: "Marzec 2026" },
      fields: {
        ru: [
          { label: "Визиты", value: "42" },
          { label: "Сумма", value: "… по правилам салона" },
        ],
        ua: [
          { label: "Візити", value: "42" },
          { label: "Сума", value: "… за правилами салону" },
        ],
        en: [
          { label: "Visits", value: "42" },
          { label: "Total", value: "… per salon rules" },
        ],
        pl: [
          { label: "Wizyty", value: "42" },
          { label: "Suma", value: "… wg zasad salonu" },
        ],
      },
    },
  ],
  "owner-add-master": [
    {
      kind: "form_mock",
      caption: {
        ru: "Добавление мастера (поля упрощены)",
        ua: "Додавання майстра",
        en: "Adding a master (simplified)",
        pl: "Dodawanie stylistki",
      },
      fields: {
        ru: [
          { label: "Telegram user ID", placeholder: "123456789" },
          { label: "Имя", placeholder: "Анна" },
        ],
        ua: [
          { label: "Telegram user ID", placeholder: "123456789" },
          { label: "Ім'я", placeholder: "Анна" },
        ],
        en: [
          { label: "Telegram user ID", placeholder: "123456789" },
          { label: "Display name", placeholder: "Anna" },
        ],
        pl: [
          { label: "Telegram user ID", placeholder: "123456789" },
          { label: "Imię", placeholder: "Anna" },
        ],
      },
      button: { ru: "Сохранить", ua: "Зберегти", en: "Save", pl: "Zapisz" },
    },
  ],
  "owner-clients-tab": [
    {
      kind: "dashboard_nav",
      caption: {
        ru: "Раздел «Клиенты»",
        ua: "Розділ «Клієнти»",
        en: "Clients section",
        pl: "Sekcja Klientki",
      },
      items: {
        ru: ["Обзор", "Записи", "Мастера", "Услуги", "Клиенты", "Настройки"],
        ua: ["Огляд", "Записи", "Майстри", "Послуги", "Клієнти", "Налаштування"],
        en: ["Overview", "Appointments", "Masters", "Services", "Clients", "Settings"],
        pl: ["Przegląd", "Wizyty", "Stylistki", "Usługi", "Klientki", "Ustawienia"],
      },
      activeIndex: 4,
    },
    {
      kind: "inbox_list",
      caption: {
        ru: "Список клиентов и последний контакт",
        ua: "Список клієнтів",
        en: "Client list and last touchpoint",
        pl: "Lista klientek",
      },
      rows: {
        ru: [
          { title: "Мария К. · @maria_n", channel: "TG", time: "3 записи" },
          { title: "Инста: nails_fan", channel: "IG", time: "вчера" },
        ],
        ua: [
          { title: "Марія К. · @maria_n", channel: "TG", time: "3 записи" },
          { title: "Інста: nails_fan", channel: "IG", time: "вчора" },
        ],
        en: [
          { title: "Maria K. · @maria_n", channel: "TG", time: "3 bookings" },
          { title: "IG: nails_fan", channel: "IG", time: "yesterday" },
        ],
        pl: [
          { title: "Maria K. · @maria_n", channel: "TG", time: "3 wizyty" },
          { title: "IG: nails_fan", channel: "IG", time: "wczoraj" },
        ],
      },
    },
  ],
  "owner-work-hours-slots": [
    {
      kind: "data_card",
      caption: {
        ru: "Часы работы влияют на сетку слотов",
        ua: "Години роботи та слоти",
        en: "Work hours shape the slot grid",
        pl: "Godziny a siatka slotów",
      },
      cardTitle: { ru: "Пн — Сб", ua: "Пн — Сб", en: "Mon — Sat", pl: "Pn — Sob" },
      fields: {
        ru: [
          { label: "Открытие", value: "10:00" },
          { label: "Закрытие", value: "21:00" },
          { label: "Перерыв", value: "14:00–15:00" },
        ],
        ua: [
          { label: "Відкриття", value: "10:00" },
          { label: "Закриття", value: "21:00" },
          { label: "Перерва", value: "14:00–15:00" },
        ],
        en: [
          { label: "Opens", value: "10:00" },
          { label: "Closes", value: "21:00" },
          { label: "Break", value: "2:00–3:00 PM" },
        ],
        pl: [
          { label: "Otwarcie", value: "10:00" },
          { label: "Zamknięcie", value: "21:00" },
          { label: "Przerwa", value: "14:00–15:00" },
        ],
      },
    },
    {
      kind: "mini_app",
      caption: {
        ru: "Клиент видит только свободные слоты",
        ua: "Клієнт бачить вільні слоти",
        en: "Clients only see free slots",
        pl: "Klientka widzi wolne sloty",
      },
      title: { ru: "Выберите время", ua: "Оберіть час", en: "Pick a time", pl: "Wybierz godzinę" },
      rows: [
        { label: { ru: "10:00", ua: "10:00", en: "10:00 AM", pl: "10:00" } },
        { label: { ru: "10:30 · занято (Google)", ua: "10:30 · зайнято", en: "10:30 · busy (Google)", pl: "10:30 · zajęte (Google)" } },
        { label: { ru: "11:00", ua: "11:00", en: "11:00 AM", pl: "11:00" } },
      ],
    },
  ],
  "support-ticket-lifecycle": [
    {
      kind: "ticket_strip",
      caption: {
        ru: "Карточка тикета и действия агента",
        ua: "Картка тикета",
        en: "Ticket card and agent actions",
        pl: "Karta zgłoszenia",
      },
      subject: {
        ru: "Не открывается биллинг после оплаты",
        ua: "Не відкривається білінг після оплати",
        en: "Billing tab won’t open after payment",
        pl: "Rozliczenia nie otwierają się po płatności",
      },
      status: { ru: "В работе · Агент Юлия", ua: "В роботі", en: "In progress · Agent Yulia", pl: "W toku" },
      actions: {
        ru: ["Закрыть", "Эскалировать", "Ответить"],
        ua: ["Закрити", "Ескалювати", "Відповісти"],
        en: ["Close", "Escalate", "Reply"],
        pl: ["Zamknij", "Eskaluj", "Odpowiedz"],
      },
    },
  ],
  "client-open-mini-app": [
    {
      kind: "telegram_chat",
      caption: {
        ru: "Меню бота с кнопкой кабинета",
        ua: "Меню бота з кнопкою кабінету",
        en: "Bot menu with dashboard entry",
        pl: "Menu bota z wejściem do panelu",
      },
      chatTitle: { ru: "Nail Studio", ua: "Nail Studio", en: "Nail Studio", pl: "Nail Studio" },
      messages: [
        {
          side: "bot",
          text: {
            ru: "Ниже кнопка «Открыть салон» / «Кабинет» — нажмите, чтобы открыть мини-приложение.",
            ua: "Кнопка «Відкрити салон» нижче.",
            en: "Use the “Open salon” / Dashboard button below to launch the mini app.",
            pl: "Przycisk „Otwórz salon” uruchamia mini aplikację.",
          },
        },
      ],
    },
    {
      kind: "mini_app",
      caption: {
        ru: "Мини-приложение внутри Telegram",
        ua: "Міні-додаток у Telegram",
        en: "Mini app inside Telegram",
        pl: "Mini aplikacja w Telegramie",
      },
      title: { ru: "Кабинет", ua: "Кабінет", en: "Dashboard", pl: "Panel" },
      rows: [
        { label: { ru: "Мои записи", ua: "Мої записи", en: "My bookings", pl: "Moje wizyty" } },
        { label: { ru: "История визитов", ua: "Історія візитів", en: "Visit history", pl: "Historia" } },
      ],
    },
  ],
  "client-find-salon-bot": [
    {
      kind: "channel_bars",
      caption: {
        ru: "Типичные точки входа",
        ua: "Точки входу",
        en: "Typical entry points",
        pl: "Punkty wejścia",
      },
      channels: {
        ru: [
          { name: "t.me/nailstudio_bot", active: true },
          { name: "Instagram · Кнопка «Написать»", active: true },
          { name: "WhatsApp · по ссылке из профиля", active: true },
        ],
        ua: [
          { name: "t.me/nailstudio_bot", active: true },
          { name: "Instagram · «Написати»", active: true },
          { name: "WhatsApp · посилання з профілю", active: true },
        ],
        en: [
          { name: "t.me/nailstudio_bot", active: true },
          { name: "Instagram · Message button", active: true },
          { name: "WhatsApp · link in profile", active: true },
        ],
        pl: [
          { name: "t.me/nailstudio_bot", active: true },
          { name: "Instagram · Wiadomość", active: true },
          { name: "WhatsApp · link w profilu", active: true },
        ],
      },
    },
  ],
  "billing-grace-and-limits": [
    {
      kind: "data_card",
      caption: {
        ru: "Статус при проблеме с картой",
        ua: "Статус при збої картки",
        en: "Status after a card failure",
        pl: "Status po błędzie karty",
      },
      cardTitle: { ru: "Подписка", ua: "Підписка", en: "Subscription", pl: "Subskrypcja" },
      fields: {
        ru: [
          { label: "Статус", value: "grace" },
          { label: "Клиентская запись", value: "доступна" },
          { label: "ИИ / Google (пример)", value: "может быть ограничено" },
        ],
        ua: [
          { label: "Статус", value: "grace" },
          { label: "Запис клієнтів", value: "доступна" },
          { label: "ІІ / Google", value: "можуть бути обмежені" },
        ],
        en: [
          { label: "Status", value: "grace" },
          { label: "Client booking", value: "still on" },
          { label: "AI / Google (e.g.)", value: "may be limited" },
        ],
        pl: [
          { label: "Status", value: "grace" },
          { label: "Rezerwacje klientek", value: "działają" },
          { label: "AI / Google", value: "mogą być ograniczone" },
        ],
      },
      actionLabel: { ru: "Обновить карту", ua: "Оновити картку", en: "Update card", pl: "Zaktualizuj kartę" },
    },
  ],
  "salon-ai-assistant": [
    {
      kind: "telegram_chat",
      caption: {
        ru: "ИИ отвечает в рамках сценария бота",
        ua: "ІІ відповідає в боті",
        en: "AI replies inside the bot flow",
        pl: "AI odpowiada w botcie",
      },
      chatTitle: { ru: "Салон · бот", ua: "Салон · бот", en: "Salon · bot", pl: "Salon · bot" },
      messages: [
        { side: "user", text: { ru: "Сколько стоит педикюр?", ua: "Скільки коштує педикюр?", en: "How much is a pedicure?", pl: "Ile kosztuje pedicure?" } },
        {
          side: "bot",
          text: {
            ru: "Педикюр от 180 zł (уточните в каталоге). Записаться?",
            ua: "Педикюр від 180 zł (див. каталог). Записатися?",
            en: "Pedicure from 180 zł (see catalog). Want to book?",
            pl: "Pedicure od 180 zł (zobacz katalog). Zarezerwować?",
          },
        },
      ],
    },
  ],
  "platform-multitenant-overview": [
    {
      kind: "split_screen",
      caption: {
        ru: "Изоляция данных между салонами",
        ua: "Ізоляція даних між салонами",
        en: "Data isolation between salons",
        pl: "Izolacja danych między salonami",
      },
      leftTitle: { ru: "Салон A", ua: "Салон A", en: "Salon A", pl: "Salon A" },
      rightTitle: { ru: "Салон B", ua: "Салон B", en: "Salon B", pl: "Salon B" },
      leftItems: {
        ru: ["Свои боты", "Свои клиенты", "Свой биллинг"],
        ua: ["Свої боти", "Свої клієнти", "Свій білінг"],
        en: ["Own bots", "Own clients", "Own billing"],
        pl: ["Własne boty", "Własne klientki", "Własne rozliczenia"],
      },
      rightItems: {
        ru: ["Другие ID ботов", "Нет пересечения", "Отдельные роли"],
        ua: ["Інші bot ID", "Без перетину", "Окремі ролі"],
        en: ["Different bot IDs", "No cross-tenant mix", "Separate roles"],
        pl: ["Inne bot ID", "Bez mieszania", "Osobne role"],
      },
    },
  ],
  "platform-god-mode-safety": [
    {
      kind: "dashboard_nav",
      caption: {
        ru: "Расширенная панель только для доверенных ролей",
        ua: "Розширена панель лише для довірених ролей",
        en: "Elevated console for trusted roles only",
        pl: "Pełny panel tylko dla zaufanych ról",
      },
      items: {
        ru: ["Тенанты", "Метрики", "Биллинг", "Входящие", "Настройки"],
        ua: ["Тенанти", "Метрики", "Білінг", "Вхідні", "Налаштування"],
        en: ["Tenants", "Metrics", "Billing", "Inbox", "Settings"],
        pl: ["Tenanty", "Metryki", "Rozliczenia", "Inbox", "Ustawienia"],
      },
      activeIndex: 0,
    },
  ],
  "troubleshooting-bot-silent": [
    {
      kind: "checklist",
      caption: {
        ru: "Порядок проверки",
        ua: "Порядок перевірки",
        en: "Check order",
        pl: "Kolejność kontroli",
      },
      items: {
        ru: [
          "Правильный бот и канал?",
          "Тариф / grace для персонала?",
          "Webhook с botId (мультитенант)?",
          "В поддержку: время + bot id (без токена)",
        ],
        ua: [
          "Правильний бот і канал?",
          "Тариф / grace?",
          "Webhook з botId?",
          "У підтримку: час + bot id (без токена)",
        ],
        en: [
          "Correct bot & channel?",
          "Billing / grace for staff?",
          "Webhook URL includes bot id?",
          "To support: timestamp + bot id (no token)",
        ],
        pl: [
          "Właściwy bot i kanał?",
          "Rozliczenia / grace?",
          "Webhook z botId?",
          "Do wsparcia: czas + bot id (bez tokena)",
        ],
      },
    },
  ],
};

export function getHelpFiguresForSlug(slug: string): HelpUiFigure[] {
  return HELP_FIGURES_BY_SLUG[slug] ?? [];
}
