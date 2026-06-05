/**
 * Starter pack of pre-built email/SMS templates.
 *
 * Pulled from real salon flows — pre-localised in 4 languages (ru/ua/en/pl).
 * The user picks a card, the modal pre-fills name + subject + body, and the
 * user tweaks. This is the "templates of templates" idea: just as services
 * have category presets (manicure / pedicure / etc.), marketing templates
 * have purpose presets.
 *
 * Merge variables follow the same convention as TemplateFormModal:
 *   {{name}}, {{first_name}}, {{email}}, {{phone}}, {{salon}}, {{unsubscribe_url}}
 */

export type TemplateChannel = "email" | "sms";
export type TemplateLocale = "ru" | "ua" | "en" | "pl";

export interface StarterTemplate {
  id: string;
  /** Localized labels: title shown on the card, blurb beneath. */
  i18n: Record<TemplateLocale, { title: string; blurb: string; subject?: string; body: string }>;
  channel: TemplateChannel;
  /** Suggested name when applied (localized). */
  defaultName: Record<TemplateLocale, string>;
  /** Lucide icon name (rendered in the catalog card). */
  icon: "Mail" | "Gift" | "Star" | "Calendar" | "Sparkles" | "MessageSquare" | "Bell" | "HeartHandshake";
  /** Used to filter the catalog by purpose tag. */
  tags: Array<"welcome" | "birthday" | "loyalty" | "reminder" | "win_back" | "promo" | "post_visit">;
}

const SALON_VAR = "{{salon}}";
const NAME_VAR = "{{first_name}}";
const UNSUB = "{{unsubscribe_url}}";

export const STARTER_TEMPLATES: StarterTemplate[] = [
  // ─── EMAIL ──────────────────────────────────────────────────────────────
  {
    id: "welcome_email",
    channel: "email",
    icon: "HeartHandshake",
    tags: ["welcome"],
    defaultName: {
      ru: "Приветствие новому клиенту",
      ua: "Привітання нового клієнта",
      en: "Welcome new client",
      pl: "Powitanie nowego klienta",
    },
    i18n: {
      ru: {
        title: "Приветственное письмо",
        blurb: "Первое касание после записи или регистрации",
        subject: `Добро пожаловать в ${SALON_VAR} ✨`,
        body: `Привет, ${NAME_VAR}!\n\nСпасибо, что выбрали ${SALON_VAR}. Мы уже готовим для вас лучший сервис.\n\nЕсли у вас есть вопросы — просто ответьте на это письмо.\n\nДо встречи!\nКоманда ${SALON_VAR}\n\n— \nОтписаться: ${UNSUB}`,
      },
      ua: {
        title: "Вітальний лист",
        blurb: "Перший контакт після запису або реєстрації",
        subject: `Ласкаво просимо до ${SALON_VAR} ✨`,
        body: `Привіт, ${NAME_VAR}!\n\nДякуємо, що обрали ${SALON_VAR}. Ми вже готуємо для вас найкращий сервіс.\n\nЯкщо є запитання — просто дайте відповідь на цей лист.\n\nДо зустрічі!\nКоманда ${SALON_VAR}\n\n— \nВідписатись: ${UNSUB}`,
      },
      en: {
        title: "Welcome email",
        blurb: "First touch after booking or sign-up",
        subject: `Welcome to ${SALON_VAR} ✨`,
        body: `Hi ${NAME_VAR},\n\nThanks for choosing ${SALON_VAR}. We're getting things ready for you.\n\nAny questions? Just reply to this email.\n\nSee you soon!\nThe ${SALON_VAR} team\n\n— \nUnsubscribe: ${UNSUB}`,
      },
      pl: {
        title: "E-mail powitalny",
        blurb: "Pierwszy kontakt po rezerwacji lub rejestracji",
        subject: `Witamy w ${SALON_VAR} ✨`,
        body: `Cześć ${NAME_VAR},\n\nDziękujemy, że wybrałaś ${SALON_VAR}. Już szykujemy dla Ciebie najlepszą obsługę.\n\nMasz pytanie? Po prostu odpisz na ten e-mail.\n\nDo zobaczenia!\nZespół ${SALON_VAR}\n\n— \nWypisz się: ${UNSUB}`,
      },
    },
  },
  {
    id: "birthday_email",
    channel: "email",
    icon: "Gift",
    tags: ["birthday", "loyalty"],
    defaultName: {
      ru: "С днём рождения — подарок",
      ua: "З днем народження — подарунок",
      en: "Birthday gift",
      pl: "Prezent urodzinowy",
    },
    i18n: {
      ru: {
        title: "Поздравление с днём рождения",
        blurb: "Промокод-подарок именинникам — высокий open rate",
        subject: `${NAME_VAR}, с днём рождения! 🎉`,
        body: `Дорогая ${NAME_VAR},\n\nС днём рождения! Желаем счастья, здоровья и красоты.\n\nВ подарок от ${SALON_VAR} — скидка 20% на любую услугу в течение 7 дней. Просто скажите при записи: «Я именинница».\n\nЖдём вас!\n\n— \nОтписаться: ${UNSUB}`,
      },
      ua: {
        title: "Привітання з днем народження",
        blurb: "Промокод іменинникам — високий open rate",
        subject: `${NAME_VAR}, з днем народження! 🎉`,
        body: `Дорога ${NAME_VAR},\n\nЗ днем народження! Бажаємо щастя, здоров'я і краси.\n\nПодарунок від ${SALON_VAR} — знижка 20% на будь-яку послугу протягом 7 днів. Просто скажіть при записі: «Я іменинниця».\n\nЧекаємо вас!\n\n— \nВідписатись: ${UNSUB}`,
      },
      en: {
        title: "Birthday greeting",
        blurb: "Gift promo code for birthdays — high open rate",
        subject: `Happy birthday, ${NAME_VAR}! 🎉`,
        body: `Dear ${NAME_VAR},\n\nHappy birthday! Wishing you joy, health, and beauty.\n\nAs a gift from ${SALON_VAR} — 20% off any service for the next 7 days. Just mention "It's my birthday" when booking.\n\nSee you soon!\n\n— \nUnsubscribe: ${UNSUB}`,
      },
      pl: {
        title: "Życzenia urodzinowe",
        blurb: "Kod promocyjny dla solenizantów — wysoki open rate",
        subject: `${NAME_VAR}, wszystkiego najlepszego! 🎉`,
        body: `Droga ${NAME_VAR},\n\nWszystkiego najlepszego z okazji urodzin! Życzymy radości, zdrowia i urody.\n\nPrezent od ${SALON_VAR} — 20% zniżki na dowolną usługę przez 7 dni. Wystarczy powiedzieć przy rezerwacji: «Mam urodziny».\n\nDo zobaczenia!\n\n— \nWypisz się: ${UNSUB}`,
      },
    },
  },
  {
    id: "post_visit_email",
    channel: "email",
    icon: "Sparkles",
    tags: ["post_visit", "loyalty"],
    defaultName: {
      ru: "Спасибо за визит + просьба об отзыве",
      ua: "Дякуємо за візит + прохання про відгук",
      en: "Thanks + review request",
      pl: "Podziękowanie + prośba o opinię",
    },
    i18n: {
      ru: {
        title: "После визита",
        blurb: "Запрос отзыва через 24 часа — собирает соцдоказательство",
        subject: `Спасибо за визит, ${NAME_VAR}!`,
        body: `Привет, ${NAME_VAR}!\n\nСпасибо, что были у нас в ${SALON_VAR}. Очень надеемся, что результат вам понравился.\n\nЕсли есть минута — поделитесь впечатлением в Google или Instagram. Это очень помогает.\n\nЖдём вас снова!\n\n— \nОтписаться: ${UNSUB}`,
      },
      ua: {
        title: "Після візиту",
        blurb: "Запит відгуку через 24 години — збирає соцдоказ",
        subject: `Дякуємо за візит, ${NAME_VAR}!`,
        body: `Привіт, ${NAME_VAR}!\n\nДякуємо, що були у нас в ${SALON_VAR}. Дуже сподіваємось, що результат вам сподобався.\n\nЯкщо є хвилинка — поділіться враженням в Google або Instagram. Це дуже допомагає.\n\nЧекаємо вас знову!\n\n— \nВідписатись: ${UNSUB}`,
      },
      en: {
        title: "After visit",
        blurb: "Review request 24h later — builds social proof",
        subject: `Thanks for visiting, ${NAME_VAR}!`,
        body: `Hi ${NAME_VAR},\n\nThanks for visiting ${SALON_VAR}. We hope you loved the result.\n\nIf you have a minute — share your experience on Google or Instagram. It really helps us.\n\nSee you again soon!\n\n— \nUnsubscribe: ${UNSUB}`,
      },
      pl: {
        title: "Po wizycie",
        blurb: "Prośba o opinię po 24h — buduje social proof",
        subject: `Dziękujemy za wizytę, ${NAME_VAR}!`,
        body: `Cześć ${NAME_VAR},\n\nDziękujemy za wizytę w ${SALON_VAR}. Mamy nadzieję, że efekt przypadł Ci do gustu.\n\nJeśli masz chwilę — podziel się opinią na Google lub Instagramie. To naprawdę pomaga.\n\nDo zobaczenia!\n\n— \nWypisz się: ${UNSUB}`,
      },
    },
  },
  {
    id: "win_back_email",
    channel: "email",
    icon: "HeartHandshake",
    tags: ["win_back"],
    defaultName: {
      ru: "Возврат уходящих клиентов",
      ua: "Повернення клієнтів, що пішли",
      en: "Win-back lapsed clients",
      pl: "Odzyskiwanie utraconych klientów",
    },
    i18n: {
      ru: {
        title: "Мы скучаем",
        blurb: "Для клиентов, которых не было больше 60 дней",
        subject: `${NAME_VAR}, мы скучаем 💜`,
        body: `${NAME_VAR}, давно вас не видели в ${SALON_VAR}.\n\nЧтобы было удобнее вернуться — дарим 15% на любую услугу. Действует 14 дней.\n\nНажмите, чтобы записаться, или просто ответьте на это письмо — мы подберём время.\n\n— \nОтписаться: ${UNSUB}`,
      },
      ua: {
        title: "Ми сумуємо",
        blurb: "Для клієнтів, яких не було більше 60 днів",
        subject: `${NAME_VAR}, ми сумуємо 💜`,
        body: `${NAME_VAR}, давно вас не бачили в ${SALON_VAR}.\n\nЩоб було зручніше повернутись — даруємо 15% на будь-яку послугу. Діє 14 днів.\n\nНатисніть, щоб записатись, або просто дайте відповідь на цей лист — підберемо час.\n\n— \nВідписатись: ${UNSUB}`,
      },
      en: {
        title: "We miss you",
        blurb: "For clients who haven't visited in 60+ days",
        subject: `${NAME_VAR}, we miss you 💜`,
        body: `${NAME_VAR}, it's been a while since we've seen you at ${SALON_VAR}.\n\nTo welcome you back — here's 15% off any service. Valid for 14 days.\n\nTap to book, or just reply to this email and we'll find a time.\n\n— \nUnsubscribe: ${UNSUB}`,
      },
      pl: {
        title: "Tęsknimy",
        blurb: "Dla klientów, których nie było ponad 60 dni",
        subject: `${NAME_VAR}, tęsknimy 💜`,
        body: `${NAME_VAR}, dawno Cię u nas nie było w ${SALON_VAR}.\n\nW prezencie na powrót — 15% zniżki na dowolną usługę. Ważne 14 dni.\n\nKliknij, żeby zarezerwować, lub odpisz na ten e-mail — dopasujemy termin.\n\n— \nWypisz się: ${UNSUB}`,
      },
    },
  },
  {
    id: "promo_seasonal_email",
    channel: "email",
    icon: "Star",
    tags: ["promo"],
    defaultName: {
      ru: "Сезонное промо",
      ua: "Сезонна промо",
      en: "Seasonal promo",
      pl: "Promocja sezonowa",
    },
    i18n: {
      ru: {
        title: "Сезонная акция",
        blurb: "Анонс новой коллекции, лимитированной услуги",
        subject: `Новая коллекция в ${SALON_VAR}`,
        body: `Привет, ${NAME_VAR}!\n\nУ нас в ${SALON_VAR} новая коллекция дизайнов на сезон. Записывайтесь, пока есть свободные окна.\n\nЗабронировать: [вставьте ссылку]\n\n— \nОтписаться: ${UNSUB}`,
      },
      ua: {
        title: "Сезонна акція",
        blurb: "Анонс нової колекції, лімітованої послуги",
        subject: `Нова колекція в ${SALON_VAR}`,
        body: `Привіт, ${NAME_VAR}!\n\nУ нас в ${SALON_VAR} нова колекція дизайнів на сезон. Записуйтесь, поки є вільні вікна.\n\nЗабронювати: [вставте посилання]\n\n— \nВідписатись: ${UNSUB}`,
      },
      en: {
        title: "Seasonal promo",
        blurb: "Announce a new collection or limited service",
        subject: `New collection at ${SALON_VAR}`,
        body: `Hi ${NAME_VAR},\n\n${SALON_VAR} just launched a new seasonal collection. Book while there are open slots.\n\nReserve: [insert link]\n\n— \nUnsubscribe: ${UNSUB}`,
      },
      pl: {
        title: "Promocja sezonowa",
        blurb: "Ogłoszenie nowej kolekcji lub usługi limitowanej",
        subject: `Nowa kolekcja w ${SALON_VAR}`,
        body: `Cześć ${NAME_VAR},\n\nW ${SALON_VAR} ruszyła nowa kolekcja sezonowa. Zarezerwuj, póki są wolne terminy.\n\nRezerwacja: [wstaw link]\n\n— \nWypisz się: ${UNSUB}`,
      },
    },
  },

  // ─── SMS ────────────────────────────────────────────────────────────────
  {
    id: "reminder_sms",
    channel: "sms",
    icon: "Bell",
    tags: ["reminder"],
    defaultName: {
      ru: "Напоминание о записи",
      ua: "Нагадування про запис",
      en: "Appointment reminder",
      pl: "Przypomnienie o wizycie",
    },
    i18n: {
      ru: {
        title: "Напоминание (SMS)",
        blurb: "Короткое напоминание за 24 часа до визита",
        body: `Привет, ${NAME_VAR}! Напоминаем: завтра вас ждут в ${SALON_VAR}. Не можете прийти? Ответьте OTM, чтобы перенести.`,
      },
      ua: {
        title: "Нагадування (SMS)",
        blurb: "Коротке нагадування за 24 години до візиту",
        body: `Привіт, ${NAME_VAR}! Нагадуємо: завтра на вас чекають у ${SALON_VAR}. Не можете прийти? Дайте відповідь OTM, щоб перенести.`,
      },
      en: {
        title: "Reminder (SMS)",
        blurb: "Short reminder 24h before the appointment",
        body: `Hi ${NAME_VAR}! Reminder: ${SALON_VAR} is expecting you tomorrow. Can't make it? Reply RESCHED.`,
      },
      pl: {
        title: "Przypomnienie (SMS)",
        blurb: "Krótkie przypomnienie 24h przed wizytą",
        body: `Cześć ${NAME_VAR}! Przypomnienie: jutro czekamy na Ciebie w ${SALON_VAR}. Nie możesz przyjść? Odpowiedz PRZE, żeby przełożyć.`,
      },
    },
  },
  {
    id: "promo_sms",
    channel: "sms",
    icon: "MessageSquare",
    tags: ["promo"],
    defaultName: {
      ru: "Промо-SMS",
      ua: "Промо-SMS",
      en: "Promo SMS",
      pl: "Promo SMS",
    },
    i18n: {
      ru: {
        title: "Короткое промо (SMS)",
        blurb: "Лаконичный месседж — 160 символов хватает",
        body: `${SALON_VAR}: скидка 20% на маникюр до конца недели. Записаться: [ссылка]. Отписаться: STOP.`,
      },
      ua: {
        title: "Коротке промо (SMS)",
        blurb: "Лаконічне повідомлення — 160 символів вистачає",
        body: `${SALON_VAR}: знижка 20% на манікюр до кінця тижня. Записатись: [посилання]. Відписатись: STOP.`,
      },
      en: {
        title: "Short promo (SMS)",
        blurb: "Concise message — 160 chars is enough",
        body: `${SALON_VAR}: 20% off manicure until end of week. Book: [link]. Reply STOP to unsubscribe.`,
      },
      pl: {
        title: "Krótkie promo (SMS)",
        blurb: "Lakoniczna wiadomość — 160 znaków wystarcza",
        body: `${SALON_VAR}: 20% zniżki na manicure do końca tygodnia. Rezerwacja: [link]. STOP, by się wypisać.`,
      },
    },
  },
];

export function getStarterForLocale(t: StarterTemplate, locale: TemplateLocale | string) {
  const l = (locale as TemplateLocale) in t.i18n ? (locale as TemplateLocale) : "ru";
  return { ...t.i18n[l], name: t.defaultName[l] };
}

/** IDs surfaced as default example tiles on the Templates page (Pro/Max), in display order. */
export const EXAMPLE_TEMPLATE_IDS = [
  "welcome_email",
  "reminder_sms",
  "birthday_email",
  "post_visit_email",
  "win_back_email",
] as const;

/**
 * Resolve the curated example templates, localized to `locale`, preserving
 * EXAMPLE_TEMPLATE_IDS order. Powers the "example" tiles shown to Pro/Max
 * tenants on the Templates page so the section is never empty. Unknown ids are
 * skipped defensively; unknown locales fall back to ru (via getStarterForLocale).
 */
export function getExampleTemplates(locale: TemplateLocale | string) {
  return EXAMPLE_TEMPLATE_IDS
    .map((id) => STARTER_TEMPLATES.find((s) => s.id === id))
    .filter((s): s is StarterTemplate => Boolean(s))
    .map((s) => ({ id: s.id, channel: s.channel, icon: s.icon, ...getStarterForLocale(s, locale) }));
}
