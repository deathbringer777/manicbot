// ══════════════════════════════════════════════════════════════
// ManicBot 💅 — Telegram-бот для записи на маникюр
// Платформа: Cloudflare Workers + KV Storage
// 4 языка: RU / UA / EN / PL
//
// НАСТРОЙКА:
// 1. Создай KV namespace: Workers & Pages → KV → Create → имя MANICBOT
// 2. Привяжи к воркеру: Settings → Variables → KV Bindings
//    Variable name: MANICBOT → выбери namespace MANICBOT
// 3. Добавь секреты (Settings → Variables → Secrets):
//    BOT_TOKEN       = токен от @BotFather
//    ADMIN_KEY       = произвольный ключ для /admin и /setup
//    WEBHOOK_SECRET  = произвольная строка (openssl rand -hex 20)
// 4. Вставь код → Deploy
// 5. Admin: https://<worker>.workers.dev/admin (Basic Auth: admin / ADMIN_KEY)
// 6. Setup: https://<worker>.workers.dev/setup?key=YOUR_ADMIN_KEY
// 7. Для напоминаний: Triggers → Cron → */15 * * * *
// ══════════════════════════════════════════════════════════════

// Secrets: wrangler secret put BOT_TOKEN / ADMIN_KEY / WEBHOOK_SECRET

function buildCtx(env) {
  if (!env.BOT_TOKEN) throw new Error('Missing secret: BOT_TOKEN');
  if (!env.ADMIN_KEY) throw new Error('Missing secret: ADMIN_KEY');
  if (!env.WEBHOOK_SECRET) throw new Error('Missing secret: WEBHOOK_SECRET');
  return {
    TG: `https://api.telegram.org/bot${env.BOT_TOKEN}`,
    ADMIN_KEY: env.ADMIN_KEY,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    kv: env.MANICBOT,
  };
}

function checkAdmin(request, adminKey) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    return idx >= 0 && decoded.slice(idx + 1) === adminKey;
  } catch { return false; }
}

async function kvListAll(kv, opts) {
  const keys = [];
  let cursor;
  do {
    const res = await kv.list({ ...opts, cursor });
    keys.push(...res.keys);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return keys;
}

// ─── Security ────────────────────────────────────────────────
const MAX_APTS = 10;                // макс. активных записей на пользователя
const API_TIMEOUT_MS = 10000;       // таймаут Telegram API (мс)
const VALID_LANGS = new Set(['ru', 'ua', 'en', 'pl']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const TIMEZONE = 'Europe/Warsaw';
const SALON = 'ManicBot 💅';
const ADDRESS = 'ul. Marszałkowska 27, Warszawa';
const PHONE = '+48 22 123 45 67';
const WORK = { from: 9, to: 19 };

const SVC = [
  { id: 'classic',  e: '💅', dur: 60,  price: 80   },
  { id: 'gel',      e: '💎', dur: 90,  price: 140  },
  { id: 'pedi',     e: '🦶', dur: 90,  price: 120  },
  { id: 'ext',      e: '✨', dur: 120, price: 250  },
  { id: 'design',   e: '🎨', dur: 30,  price: 50   },
  { id: 'combo',    e: '👑', dur: 150, price: 220  },
];
const SVC_IDS = new Set(SVC.map(s => s.id));

// ─── Фото каталога (замени URL на свои) ─────────────────────
const PHOTOS = {
  classic: [
    'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600',
    'https://images.pexels.com/photos/3997391/pexels-photo-3997391.jpeg?w=600',
    'https://images.pexels.com/photos/704815/pexels-photo-704815.jpeg?w=600',
  ],
  gel: [
    'https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600',
    'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?w=600',
    'https://images.pexels.com/photos/3997393/pexels-photo-3997393.jpeg?w=600',
  ],
  pedi: [
    'https://images.pexels.com/photos/1204464/pexels-photo-1204464.jpeg?w=600',
    'https://images.pexels.com/photos/5765783/pexels-photo-5765783.jpeg?w=600',
  ],
  ext: [
    'https://images.pexels.com/photos/939836/pexels-photo-939836.jpeg?w=600',
    'https://images.pexels.com/photos/1115128/pexels-photo-1115128.jpeg?w=600',
  ],
  design: [
    'https://images.pexels.com/photos/1484808/pexels-photo-1484808.jpeg?w=600',
    'https://images.pexels.com/photos/3997383/pexels-photo-3997383.jpeg?w=600',
  ],
  combo: [
    'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600',
    'https://images.pexels.com/photos/1204464/pexels-photo-1204464.jpeg?w=600',
  ],
};

// ══════════════════════════════════════════════════════════════
//  ПЕРЕВОДЫ — 4 языка
// ══════════════════════════════════════════════════════════════

const L = {
// ── РУССКИЙ ──────────────────────────────────────────────────
ru: {
  flag: '🇷🇺', lname: 'Русский', cur: 'zł',
  days: ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'],
  daysH: ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],
  mon: ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'],
  monG: ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'],

  svc_classic: 'Классический маникюр',
  svc_gel: 'Маникюр с гель-лаком',
  svc_pedi: 'Педикюр',
  svc_ext: 'Наращивание ногтей',
  svc_design: 'Дизайн ногтей',
  svc_combo: 'Комбо: маникюр + педикюр',

  m_book: '📝 Записаться',
  m_my: '📋 Мои записи',
  m_prices: '💰 Прайс-лист',
  m_cat: '📸 Каталог работ',
  m_rev: '⭐ Отзывы',
  m_about: 'ℹ️ О нас',
  m_cont: '📞 Контакты',
  m_lang: '🌐 Язык',
  back: '◀️ Назад',
  back_m: '◀️ Главное меню',
  min: 'мин',

  welcome: [
    '💅 <b>Добро пожаловать в {s}!</b>',
    '', 'Привет, <b>{n}</b>! 👋',
    '', 'Я помогу тебе записаться на маникюр быстро и удобно.',
    '', '🌸 <b>Что я умею:</b>',
    '• Онлайн-запись 24/7',
    '• Каталог работ с фото',
    '• Напоминания о визите',
    '• Файл для Google / Apple календаря',
    '', 'Выбери, что тебя интересует:'
  ],
  lang_set: '✅ Язык установлен: Русский 🇷🇺',
  help: [
    '📖 <b>Помощь</b>', '',
    '/start — Главное меню', '/book — Записаться',
    '/my — Мои записи', '/prices — Прайс-лист',
    '/catalog — Каталог', '/contacts — Контакты',
    '', 'Или используй кнопки! 😊'
  ],
  unknown: '🤔 Не понимаю. Нажми /start чтобы открыть меню!',

  reg_confirm_name: '📝 Для записи нужна регистрация.\n\nТвоё имя в Telegram: <b>{n}</b>\n\nВсё верно?',
  reg_yes: '✅ Да, верно',
  reg_change: '✏️ Изменить имя',
  reg_enter_name: '✏️ Введи своё имя:',
  reg_name_err: '❌ Введи корректное имя (2-50 символов):',
  reg_phone: 'Отлично, <b>{n}</b>! 😊\n\n📱 Введи номер телефона или нажми кнопку:',
  reg_phone_btn: '📱 Отправить номер',
  reg_phone_err: '❌ Введи корректный номер телефона:',
  reg_done: '✅ <b>Регистрация завершена!</b>\n\n👤 Имя: <b>{n}</b>\n📱 Телефон: <b>{p}</b>',
  now_choose: '💅 Теперь выбери услугу:',

  choose_svc: '💅 <b>Выбери услугу:</b>',
  choose_date: '📅 Выбери дату:',
  no_slots: '😔 На <b>{d}</b> нет свободных мест.\n\n📅 Выбери другую дату:',
  choose_time: '🕐 Выбери время:',
  other_svc: '◀️ Другая услуга',
  other_date: '◀️ Другая дата',
  chosen: '✅ Выбрано: <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}',

  confirm_title: '📋 <b>Подтверждение записи</b>',
  confirm_yes: '✅ Подтвердить',
  confirm_no: '❌ Отменить',
  booked: [
    '🎉 <b>Запись подтверждена!</b>', '',
    '{svc}', '📅 {dt}', '⏱ {dur} {min}', '💵 {p} {c}', '📍 {addr}',
    '', '⏰ Напомню тебе:', '• За 24 часа', '• За 12 часов', '• За 1 час',
    '', '📅 Файл для календаря ⬇️'
  ],
  book_cancelled: '❌ Запись отменена.\n\nВыбери, что тебя интересует:',
  book_err: '❌ Ошибка. Начни запись сначала.',
  book_limit: '⚠️ Достигнут лимит записей ({n}). Отмени одну из текущих, чтобы создать новую.',
  ics_cap: '📅 Добавь в Google / Apple календарь',

  my_title: '📋 <b>Мои записи</b>',
  my_empty: 'У тебя нет предстоящих записей.\n\n💅 Хочешь записаться?',
  my_cancel: '❌ Отменить: {d} {t}',
  cancel_ok: '❌ <b>Запись отменена:</b>\n\n{svc}\n📅 {dt}\n\nХочешь перезаписаться?',
  cancel_err: '❌ Запись не найдена или уже отменена.',
  rebook: '📝 Записаться заново',

  prices_t: '💰 <b>Прайс-лист</b>\n\n',
  cont_t: [
    '📞 <b>Контакты</b>', '',
    '🏠 <b>Адрес:</b> {addr}',
    '📱 <b>Телефон:</b> {ph}',
    '🕐 <b>Режим работы:</b> {h}',
    '', '💬 По всем вопросам пишите в бот!'
  ],
  rev_t: [
    '⭐ <b>Отзывы наших клиентов</b>', '',
    '⭐⭐⭐⭐⭐', '<i>"Лучший маникюр в городе! Хожу уже полгода."</i>', '— Анна К.', '',
    '⭐⭐⭐⭐⭐', '<i>"Очень аккуратная работа, приятная атмосфера."</i>', '— Мария С.', '',
    '⭐⭐⭐⭐⭐', '<i>"Записалась через бот — супер удобно!"</i>', '— Ольга В.', '',
    '⭐⭐⭐⭐⭐', '<i>"Наращивание — идеально! Держится 3 недели."</i>', '— Катерина Д.'
  ],
  about_t: [
    '🌸 <b>О нас — {s}</b>', '',
    'Команда профессионалов! 💖', '',
    '✅ Опыт более 5 лет', '✅ Качественные материалы',
    '✅ Стерильные инструменты', '✅ Индивидуальный подход',
    '✅ Уютная атмосфера', '',
    '📍 {addr}', '🕐 {h}'
  ],
  cat_title: '📸 <b>Каталог работ</b>\n\nВыбери категорию:',
  cat_cap: '{e} <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}\n\n📷 {i} / {total}',
  cat_book: '📝 Записаться на эту услугу',
  cat_back: '◀️ К категориям',
  cat_empty: '🖼 Фото пока нет',

  rem_24: ['⏰ <b>Напоминание!</b>','','Завтра у тебя запись:','','{svc}','📅 {dt}','📍 {addr}','','До встречи! 💅'],
  rem_12: ['⏰ <b>Напоминание!</b>','','Через 12 часов:','','{svc}','📅 {dt}','📍 {addr}','','Ждём тебя! 😊'],
  rem_1:  ['⏰ <b>Напоминание!</b>','','Через 1 час:','','{svc}','📅 {dt}','📍 {addr}','','Уже скоро! 💖'],
},

// ── УКРАЇНСЬКА ───────────────────────────────────────────────
ua: {
  flag: '🇺🇦', lname: 'Українська', cur: 'zł',
  days: ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'],
  daysH: ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'],
  mon: ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'],
  monG: ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'],

  svc_classic: 'Класичний манікюр',
  svc_gel: 'Манікюр з гель-лаком',
  svc_pedi: 'Педикюр',
  svc_ext: 'Нарощування нігтів',
  svc_design: 'Дизайн нігтів',
  svc_combo: 'Комбо: манікюр + педикюр',

  m_book: '📝 Записатися',
  m_my: '📋 Мої записи',
  m_prices: '💰 Прайс-лист',
  m_cat: '📸 Каталог робіт',
  m_rev: '⭐ Відгуки',
  m_about: 'ℹ️ Про нас',
  m_cont: '📞 Контакти',
  m_lang: '🌐 Мова',
  back: '◀️ Назад',
  back_m: '◀️ Головне меню',
  min: 'хв',

  welcome: [
    '💅 <b>Ласкаво просимо до {s}!</b>',
    '', 'Привіт, <b>{n}</b>! 👋',
    '', 'Я допоможу записатися на манікюр швидко та зручно.',
    '', '🌸 <b>Що я вмію:</b>',
    '• Онлайн-запис 24/7', '• Каталог робіт з фото',
    '• Нагадування про візит', '• Файл для Google / Apple календаря',
    '', 'Обери, що тебе цікавить:'
  ],
  lang_set: '✅ Мову встановлено: Українська 🇺🇦',
  help: [
    '📖 <b>Допомога</b>', '',
    '/start — Головне меню', '/book — Записатися',
    '/my — Мої записи', '/prices — Прайс-лист',
    '/catalog — Каталог', '/contacts — Контакти',
    '', 'Або використовуй кнопки! 😊'
  ],
  unknown: '🤔 Не зрозумів. Натисни /start щоб відкрити меню!',

  reg_confirm_name: '📝 Для запису потрібна реєстрація.\n\nТвоє ім\'я в Telegram: <b>{n}</b>\n\nВсе вірно?',
  reg_yes: '✅ Так, вірно',
  reg_change: '✏️ Змінити ім\'я',
  reg_enter_name: '✏️ Введи своє ім\'я:',
  reg_name_err: '❌ Введи коректне ім\'я (2-50 символів):',
  reg_phone: 'Чудово, <b>{n}</b>! 😊\n\n📱 Введи номер телефону або натисни кнопку:',
  reg_phone_btn: '📱 Надіслати номер',
  reg_phone_err: '❌ Введи коректний номер телефону:',
  reg_done: '✅ <b>Реєстрація завершена!</b>\n\n👤 Ім\'я: <b>{n}</b>\n📱 Телефон: <b>{p}</b>',
  now_choose: '💅 Тепер обери послугу:',

  choose_svc: '💅 <b>Обери послугу:</b>',
  choose_date: '📅 Обери дату:',
  no_slots: '😔 На <b>{d}</b> немає вільних місць.\n\n📅 Обери іншу дату:',
  choose_time: '🕐 Обери час:',
  other_svc: '◀️ Інша послуга',
  other_date: '◀️ Інша дата',
  chosen: '✅ Обрано: <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}',

  confirm_title: '📋 <b>Підтвердження запису</b>',
  confirm_yes: '✅ Підтвердити',
  confirm_no: '❌ Скасувати',
  booked: [
    '🎉 <b>Запис підтверджено!</b>', '',
    '{svc}', '📅 {dt}', '⏱ {dur} {min}', '💵 {p} {c}', '📍 {addr}',
    '', '⏰ Нагадаю тобі:', '• За 24 години', '• За 12 годин', '• За 1 годину',
    '', '📅 Файл для календаря ⬇️'
  ],
  book_cancelled: '❌ Запис скасовано.\n\nОбери, що тебе цікавить:',
  book_err: '❌ Помилка. Почни запис спочатку.',
  book_limit: '⚠️ Досягнуто ліміт записів ({n}). Скасуй одну з поточних.',
  ics_cap: '📅 Додай у Google / Apple календар',

  my_title: '📋 <b>Мої записи</b>',
  my_empty: 'У тебе немає майбутніх записів.\n\n💅 Хочеш записатися?',
  my_cancel: '❌ Скасувати: {d} {t}',
  cancel_ok: '❌ <b>Запис скасовано:</b>\n\n{svc}\n📅 {dt}\n\nХочеш перезаписатися?',
  cancel_err: '❌ Запис не знайдено або вже скасовано.',
  rebook: '📝 Записатися знову',

  prices_t: '💰 <b>Прайс-лист</b>\n\n',
  cont_t: [
    '📞 <b>Контакти</b>', '',
    '🏠 <b>Адреса:</b> {addr}', '📱 <b>Телефон:</b> {ph}',
    '🕐 <b>Графік:</b> {h}', '', '💬 Пишіть у бот або телефонуйте!'
  ],
  rev_t: [
    '⭐ <b>Відгуки наших клієнтів</b>', '',
    '⭐⭐⭐⭐⭐', '<i>"Найкращий манікюр у місті!"</i>', '— Анна К.', '',
    '⭐⭐⭐⭐⭐', '<i>"Дуже акуратна робота."</i>', '— Марія С.', '',
    '⭐⭐⭐⭐⭐', '<i>"Записалася через бот — зручно!"</i>', '— Ольга В.', '',
    '⭐⭐⭐⭐⭐', '<i>"Нарощування — ідеально!"</i>', '— Катерина Д.'
  ],
  about_t: [
    '🌸 <b>Про нас — {s}</b>', '',
    'Команда професіоналів! 💖', '',
    '✅ Досвід понад 5 років', '✅ Якісні матеріали',
    '✅ Стерильні інструменти', '✅ Індивідуальний підхід',
    '✅ Затишна атмосфера', '', '📍 {addr}', '🕐 {h}'
  ],
  cat_title: '📸 <b>Каталог робіт</b>\n\nОбери категорію:',
  cat_cap: '{e} <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}\n\n📷 {i} / {total}',
  cat_book: '📝 Записатися на цю послугу',
  cat_back: '◀️ До категорій',
  cat_empty: '🖼 Фото поки немає',

  rem_24: ['⏰ <b>Нагадування!</b>','','Завтра у тебе запис:','','{svc}','📅 {dt}','📍 {addr}','','До зустрічі! 💅'],
  rem_12: ['⏰ <b>Нагадування!</b>','','Через 12 годин:','','{svc}','📅 {dt}','📍 {addr}','','Чекаємо! 😊'],
  rem_1:  ['⏰ <b>Нагадування!</b>','','Через 1 годину:','','{svc}','📅 {dt}','📍 {addr}','','Вже скоро! 💖'],
},

// ── ENGLISH ──────────────────────────────────────────────────
en: {
  flag: '🇬🇧', lname: 'English', cur: 'zł',
  days: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],
  daysH: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  mon: ['January','February','March','April','May','June','July','August','September','October','November','December'],
  monG: ['January','February','March','April','May','June','July','August','September','October','November','December'],

  svc_classic: 'Classic Manicure',
  svc_gel: 'Gel Polish Manicure',
  svc_pedi: 'Pedicure',
  svc_ext: 'Nail Extensions',
  svc_design: 'Nail Art Design',
  svc_combo: 'Combo: Manicure + Pedicure',

  m_book: '📝 Book Now',
  m_my: '📋 My Appointments',
  m_prices: '💰 Price List',
  m_cat: '📸 Portfolio',
  m_rev: '⭐ Reviews',
  m_about: 'ℹ️ About Us',
  m_cont: '📞 Contacts',
  m_lang: '🌐 Language',
  back: '◀️ Back',
  back_m: '◀️ Main Menu',
  min: 'min',

  welcome: [
    '💅 <b>Welcome to {s}!</b>',
    '', 'Hi, <b>{n}</b>! 👋',
    '', 'I\'ll help you book a manicure appointment quickly and easily.',
    '', '🌸 <b>What I can do:</b>',
    '• Online booking 24/7', '• Portfolio with photos',
    '• Appointment reminders', '• Google / Apple calendar file',
    '', 'Choose what interests you:'
  ],
  lang_set: '✅ Language set: English 🇬🇧',
  help: [
    '📖 <b>Help</b>', '',
    '/start — Main menu', '/book — Book appointment',
    '/my — My appointments', '/prices — Price list',
    '/catalog — Portfolio', '/contacts — Contacts',
    '', 'Or just use the buttons! 😊'
  ],
  unknown: '🤔 I didn\'t understand. Press /start to open the menu!',

  reg_confirm_name: '📝 Registration required to book.\n\nYour Telegram name: <b>{n}</b>\n\nIs this correct?',
  reg_yes: '✅ Yes, correct',
  reg_change: '✏️ Change name',
  reg_enter_name: '✏️ Enter your name:',
  reg_name_err: '❌ Please enter a valid name (2-50 characters):',
  reg_phone: 'Great, <b>{n}</b>! 😊\n\n📱 Enter your phone number or tap the button:',
  reg_phone_btn: '📱 Send Phone Number',
  reg_phone_err: '❌ Enter a valid phone number:',
  reg_done: '✅ <b>Registration complete!</b>\n\n👤 Name: <b>{n}</b>\n📱 Phone: <b>{p}</b>',
  now_choose: '💅 Now choose a service:',

  choose_svc: '💅 <b>Choose a service:</b>',
  choose_date: '📅 Choose a date:',
  no_slots: '😔 No available slots on <b>{d}</b>.\n\n📅 Choose another date:',
  choose_time: '🕐 Choose a time:',
  other_svc: '◀️ Other service',
  other_date: '◀️ Other date',
  chosen: '✅ Selected: <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}',

  confirm_title: '📋 <b>Booking Confirmation</b>',
  confirm_yes: '✅ Confirm',
  confirm_no: '❌ Cancel',
  booked: [
    '🎉 <b>Booking confirmed!</b>', '',
    '{svc}', '📅 {dt}', '⏱ {dur} {min}', '💵 {p} {c}', '📍 {addr}',
    '', '⏰ I\'ll remind you:', '• 24 hours before', '• 12 hours before', '• 1 hour before',
    '', '📅 Calendar file below ⬇️'
  ],
  book_cancelled: '❌ Booking cancelled.\n\nChoose what interests you:',
  book_err: '❌ Error. Please start booking again.',
  book_limit: '⚠️ Appointment limit reached ({n}). Cancel an existing one first.',
  ics_cap: '📅 Add to Google / Apple Calendar',

  my_title: '📋 <b>My Appointments</b>',
  my_empty: 'You have no upcoming appointments.\n\n💅 Want to book?',
  my_cancel: '❌ Cancel: {d} {t}',
  cancel_ok: '❌ <b>Appointment cancelled:</b>\n\n{svc}\n📅 {dt}\n\nWant to rebook?',
  cancel_err: '❌ Appointment not found or already cancelled.',
  rebook: '📝 Book Again',

  prices_t: '💰 <b>Price List</b>\n\n',
  cont_t: [
    '📞 <b>Contacts</b>', '',
    '🏠 <b>Address:</b> {addr}', '📱 <b>Phone:</b> {ph}',
    '🕐 <b>Hours:</b> {h}', '', '💬 Message us anytime!'
  ],
  rev_t: [
    '⭐ <b>Client Reviews</b>', '',
    '⭐⭐⭐⭐⭐', '<i>"Best manicure in town!"</i>', '— Anna K.', '',
    '⭐⭐⭐⭐⭐', '<i>"Very neat work, lovely atmosphere."</i>', '— Maria S.', '',
    '⭐⭐⭐⭐⭐', '<i>"Booked via bot — super convenient!"</i>', '— Olga V.', '',
    '⭐⭐⭐⭐⭐', '<i>"Extensions are perfect! Lasted 3 weeks."</i>', '— Kate D.'
  ],
  about_t: [
    '🌸 <b>About Us — {s}</b>', '',
    'A team of professionals! 💖', '',
    '✅ 5+ years of experience', '✅ Quality materials',
    '✅ Sterile instruments', '✅ Personal approach',
    '✅ Cozy atmosphere', '', '📍 {addr}', '🕐 {h}'
  ],
  cat_title: '📸 <b>Portfolio</b>\n\nChoose a category:',
  cat_cap: '{e} <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}\n\n📷 {i} / {total}',
  cat_book: '📝 Book this service',
  cat_back: '◀️ Categories',
  cat_empty: '🖼 No photos yet',

  rem_24: ['⏰ <b>Reminder!</b>','','Tomorrow you have:','','{svc}','📅 {dt}','📍 {addr}','','See you! 💅'],
  rem_12: ['⏰ <b>Reminder!</b>','','In 12 hours:','','{svc}','📅 {dt}','📍 {addr}','','See you soon! 😊'],
  rem_1:  ['⏰ <b>Reminder!</b>','','In 1 hour:','','{svc}','📅 {dt}','📍 {addr}','','Almost time! 💖'],
},

// ── POLSKI ───────────────────────────────────────────────────
pl: {
  flag: '🇵🇱', lname: 'Polski', cur: 'zł',
  days: ['Nd','Pn','Wt','Śr','Cz','Pt','So'],
  daysH: ['Pn','Wt','Śr','Cz','Pt','So','Nd'],
  mon: ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'],
  monG: ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'],

  svc_classic: 'Klasyczny manicure',
  svc_gel: 'Manicure z żelem',
  svc_pedi: 'Pedicure',
  svc_ext: 'Przedłużanie paznokci',
  svc_design: 'Zdobienie paznokci',
  svc_combo: 'Combo: manicure + pedicure',

  m_book: '📝 Umów się',
  m_my: '📋 Moje wizyty',
  m_prices: '💰 Cennik',
  m_cat: '📸 Portfolio',
  m_rev: '⭐ Opinie',
  m_about: 'ℹ️ O nas',
  m_cont: '📞 Kontakt',
  m_lang: '🌐 Język',
  back: '◀️ Wstecz',
  back_m: '◀️ Menu główne',
  min: 'min',

  welcome: [
    '💅 <b>Witamy w {s}!</b>',
    '', 'Cześć, <b>{n}</b>! 👋',
    '', 'Pomogę Ci umówić się na manicure szybko i wygodnie.',
    '', '🌸 <b>Co potrafię:</b>',
    '• Rezerwacja online 24/7', '• Portfolio ze zdjęciami',
    '• Przypomnienia o wizycie', '• Plik do Google / Apple Calendar',
    '', 'Wybierz co Cię interesuje:'
  ],
  lang_set: '✅ Język ustawiony: Polski 🇵🇱',
  help: [
    '📖 <b>Pomoc</b>', '',
    '/start — Menu główne', '/book — Umów wizytę',
    '/my — Moje wizyty', '/prices — Cennik',
    '/catalog — Portfolio', '/contacts — Kontakt',
    '', 'Lub po prostu użyj przycisków! 😊'
  ],
  unknown: '🤔 Nie rozumiem. Naciśnij /start żeby otworzyć menu!',

  reg_confirm_name: '📝 Wymagana rejestracja.\n\nTwoje imię w Telegram: <b>{n}</b>\n\nCzy to poprawne?',
  reg_yes: '✅ Tak, poprawne',
  reg_change: '✏️ Zmień imię',
  reg_enter_name: '✏️ Podaj swoje imię:',
  reg_name_err: '❌ Podaj poprawne imię (2-50 znaków):',
  reg_phone: 'Świetnie, <b>{n}</b>! 😊\n\n📱 Podaj numer telefonu lub naciśnij przycisk:',
  reg_phone_btn: '📱 Wyślij numer',
  reg_phone_err: '❌ Podaj poprawny numer telefonu:',
  reg_done: '✅ <b>Rejestracja zakończona!</b>\n\n👤 Imię: <b>{n}</b>\n📱 Telefon: <b>{p}</b>',
  now_choose: '💅 Teraz wybierz usługę:',

  choose_svc: '💅 <b>Wybierz usługę:</b>',
  choose_date: '📅 Wybierz datę:',
  no_slots: '😔 Brak wolnych miejsc na <b>{d}</b>.\n\n📅 Wybierz inną datę:',
  choose_time: '🕐 Wybierz godzinę:',
  other_svc: '◀️ Inna usługa',
  other_date: '◀️ Inna data',
  chosen: '✅ Wybrano: <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}',

  confirm_title: '📋 <b>Potwierdzenie rezerwacji</b>',
  confirm_yes: '✅ Potwierdź',
  confirm_no: '❌ Anuluj',
  booked: [
    '🎉 <b>Wizyta potwierdzona!</b>', '',
    '{svc}', '📅 {dt}', '⏱ {dur} {min}', '💵 {p} {c}', '📍 {addr}',
    '', '⏰ Przypomnę Ci:', '• 24 godziny przed', '• 12 godzin przed', '• 1 godzinę przed',
    '', '📅 Plik kalendarza poniżej ⬇️'
  ],
  book_cancelled: '❌ Rezerwacja anulowana.\n\nWybierz co Cię interesuje:',
  book_err: '❌ Błąd. Zacznij rezerwację od nowa.',
  book_limit: '⚠️ Osiągnięto limit wizyt ({n}). Anuluj jedną z obecnych.',
  ics_cap: '📅 Dodaj do Google / Apple Calendar',

  my_title: '📋 <b>Moje wizyty</b>',
  my_empty: 'Nie masz nadchodzących wizyt.\n\n💅 Chcesz się umówić?',
  my_cancel: '❌ Anuluj: {d} {t}',
  cancel_ok: '❌ <b>Wizyta anulowana:</b>\n\n{svc}\n📅 {dt}\n\nChcesz umówić się ponownie?',
  cancel_err: '❌ Wizyta nie znaleziona lub już anulowana.',
  rebook: '📝 Umów ponownie',

  prices_t: '💰 <b>Cennik</b>\n\n',
  cont_t: [
    '📞 <b>Kontakt</b>', '',
    '🏠 <b>Adres:</b> {addr}', '📱 <b>Telefon:</b> {ph}',
    '🕐 <b>Godziny:</b> {h}', '', '💬 Napisz do nas!'
  ],
  rev_t: [
    '⭐ <b>Opinie klientów</b>', '',
    '⭐⭐⭐⭐⭐', '<i>"Najlepszy manicure w mieście!"</i>', '— Anna K.', '',
    '⭐⭐⭐⭐⭐', '<i>"Bardzo staranna praca."</i>', '— Maria S.', '',
    '⭐⭐⭐⭐⭐', '<i>"Rezerwacja przez bota — super wygodne!"</i>', '— Olga V.', '',
    '⭐⭐⭐⭐⭐', '<i>"Przedłużanie — idealnie!"</i>', '— Katarzyna D.'
  ],
  about_t: [
    '🌸 <b>O nas — {s}</b>', '',
    'Zespół profesjonalistów! 💖', '',
    '✅ Ponad 5 lat doświadczenia', '✅ Wysokiej jakości materiały',
    '✅ Sterylne narzędzia', '✅ Indywidualne podejście',
    '✅ Przytulna atmosfera', '', '📍 {addr}', '🕐 {h}'
  ],
  cat_title: '📸 <b>Portfolio</b>\n\nWybierz kategorię:',
  cat_cap: '{e} <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}\n\n📷 {i} / {total}',
  cat_book: '📝 Umów tę usługę',
  cat_back: '◀️ Kategorie',
  cat_empty: '🖼 Brak zdjęć',

  rem_24: ['⏰ <b>Przypomnienie!</b>','','Jutro masz wizytę:','','{svc}','📅 {dt}','📍 {addr}','','Do zobaczenia! 💅'],
  rem_12: ['⏰ <b>Przypomnienie!</b>','','Za 12 godzin:','','{svc}','📅 {dt}','📍 {addr}','','Czekamy! 😊'],
  rem_1:  ['⏰ <b>Przypomnienie!</b>','','Za 1 godzinę:','','{svc}','📅 {dt}','📍 {addr}','','Już niedługo! 💖'],
},
};

// ══════════════════════════════════════════════════════════════
//  HELPERS (security-hardened)
// ══════════════════════════════════════════════════════════════

function t(lang, key) { return L[lang]?.[key] ?? L.ru[key] ?? key; }
function p2(n) { return String(n).padStart(2, '0'); }

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function svcName(lang, id) {
  const s = SVC.find(x => x.id === id);
  if (!s) return escHtml(id);
  return `${s.e} ${t(lang, 'svc_' + id)}`;
}

function fill(str, vars) {
  let r = typeof str === 'string' ? str : str.join('\n');
  for (const [k, v] of Object.entries(vars)) r = r.replaceAll(`{${k}}`, v);
  return r;
}

function isValidDate(ds) {
  if (!DATE_RE.test(ds)) return false;
  const [y, m, d] = ds.split('-').map(Number);
  if (y < 2024 || y > 2030 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function isValidTime(ts) {
  if (!TIME_RE.test(ts)) return false;
  const [h, m] = ts.split(':').map(Number);
  return h >= 0 && h <= 23 && (m === 0 || m === 30);
}

function warsawNow() {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())) p[type] = value;
  return {
    year: parseInt(p.year), month: parseInt(p.month), day: parseInt(p.day),
    hour: parseInt(p.hour), minute: parseInt(p.minute),
  };
}

function warsawToUTC(year, month, day, hour, minute) {
  for (const offset of [1, 2]) {
    const utc = new Date(Date.UTC(year, month - 1, day, hour - offset, minute));
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(utc)) p[type] = value;
    if (parseInt(p.hour) === hour && parseInt(p.day) === day && parseInt(p.month) === month)
      return utc;
  }
  return new Date(Date.UTC(year, month - 1, day, hour - 1, minute));
}

function todayStr() {
  const w = warsawNow();
  return `${w.year}-${p2(w.month)}-${p2(w.day)}`;
}

function fmtDate(lang, ds) {
  if (!isValidDate(ds)) return ds;
  const [y, m, d] = ds.split('-').map(Number);
  const dow = t(lang, 'days')[new Date(y, m-1, d).getDay()];
  return `${d} ${t(lang, 'monG')[m-1]} (${dow})`;
}
function fmtDT(lang, ds, ts) { return `${fmtDate(lang, ds)} ${ts}`; }

const hours = () => `${WORK.from}:00 — ${WORK.to}:00`;

// ─── Telegram API (with timeout) ─────────────────────────────

async function api(ctx, method, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const r = await fetch(`${ctx.TG}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    try { return JSON.parse(text); }
    catch { return { ok: false, description: `Non-JSON response: ${text.slice(0, 200)}` }; }
  } catch (e) {
    console.error('TG API error:', method, e.message);
    return { ok: false, description: e.message };
  } finally {
    clearTimeout(timer);
  }
}

function send(ctx, chatId, text, extra = {}) {
  return api(ctx, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}
function edit(ctx, chatId, msgId, text, extra = {}) {
  return api(ctx, 'editMessageText', { chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML', ...extra });
}
function answerCb(ctx, cbId, text = '') {
  return api(ctx, 'answerCallbackQuery', { callback_query_id: cbId, text });
}

async function sendPhoto(ctx, chatId, url, caption, extra = {}) {
  const res = await api(ctx, 'sendPhoto', { chat_id: chatId, photo: url, caption, parse_mode: 'HTML', ...extra });
  if (res.ok) return res;
  return send(ctx, chatId, `🖼 ${caption}`, extra);
}

async function editPhoto(ctx, chatId, msgId, url, caption, extra = {}) {
  try {
    const res = await api(ctx, 'editMessageMedia', {
      chat_id: chatId, message_id: msgId,
      media: { type: 'photo', media: url, caption, parse_mode: 'HTML' },
      ...extra,
    });
    if (res.ok) return res;
  } catch (_) { /* fallback below */ }
  return null;
}

async function sendIcs(ctx, chatId, content, fname, caption) {
  try {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('document', new Blob([content], { type: 'text/calendar' }), fname);
    fd.append('caption', caption);
    fd.append('parse_mode', 'HTML');
    const r = await fetch(`${ctx.TG}/sendDocument`, { method: 'POST', body: fd });
    if (!r.ok) console.error('sendIcs HTTP', r.status, await r.text().catch(() => ''));
    return r;
  } catch (e) {
    console.error('sendIcs error:', e.message);
    return null;
  }
}

// ─── KV (all wrapped in try-catch) ───────────────────────────

async function kvGet(ctx, k) {
  try { return await ctx.kv.get(k, 'json'); }
  catch (e) { console.error('KV GET fail:', k, e.message); return null; }
}

async function kvPut(ctx, k, v, o) {
  try { await ctx.kv.put(k, JSON.stringify(v), o); return true; }
  catch (e) { console.error('KV PUT fail:', k, e.message); return false; }
}

async function kvDel(ctx, k) {
  try { await ctx.kv.delete(k); }
  catch (e) { console.error('KV DEL fail:', k, e.message); }
}

async function getLang(ctx, cid) {
  try { return (await ctx.kv.get(`lang:${cid}`)) || null; }
  catch { return null; }
}
async function setLang(ctx, cid, lang) {
  if (!VALID_LANGS.has(lang)) return;
  try { await ctx.kv.put(`lang:${cid}`, lang); } catch {}
}

async function getState(ctx, cid) { return (await kvGet(ctx, `st:${cid}`)) || { step: 'idle' }; }
async function setState(ctx, cid, s) { await kvPut(ctx, `st:${cid}`, s, { expirationTtl: 7200 }); }
async function clearState(ctx, cid) { await kvDel(ctx, `st:${cid}`); }

async function getUser(ctx, cid) { return kvGet(ctx, `u:${cid}`); }
async function saveUser(ctx, cid, d) { await kvPut(ctx, `u:${cid}`, d); }

async function saveApt(ctx, apt) {
  const ul = (await kvGet(ctx, `ua:${apt.chatId}`)) || [];

  let active = 0;
  for (const id of ul) {
    const a = await kvGet(ctx, `ap:${id}`);
    if (a && !a.cx && a.ts > Date.now()) active++;
  }
  if (active >= MAX_APTS) return null;

  const id = `a${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  apt.id = id;
  apt.createdAt = Date.now();
  apt.rem = { h24: false, h12: false, h1: false };
  await kvPut(ctx, `ap:${id}`, apt);
  ul.push(id);
  await kvPut(ctx, `ua:${apt.chatId}`, ul);
  const dl = (await kvGet(ctx, `d:${apt.date}`)) || [];
  dl.push(id);
  await kvPut(ctx, `d:${apt.date}`, dl);
  const al = (await kvGet(ctx, 'all')) || [];
  al.push(id);
  await kvPut(ctx, 'all', al);
  return apt;
}

async function getApts(ctx, cid) {
  const ids = (await kvGet(ctx, `ua:${cid}`)) || [];
  const r = [];
  for (const id of ids) {
    const a = await kvGet(ctx, `ap:${id}`);
    if (a && !a.cx && a.ts > Date.now() - 3600000) r.push(a);
  }
  return r.sort((a, b) => a.ts - b.ts);
}

async function cancelApt(ctx, id, ownerChatId) {
  if (!/^a\d+_\w+$/.test(id)) return null;
  const a = await kvGet(ctx, `ap:${id}`);
  if (!a || a.chatId !== ownerChatId) return null;
  a.cx = true;
  await kvPut(ctx, `ap:${id}`, a);
  const dl = (await kvGet(ctx, `d:${a.date}`)) || [];
  const nl = dl.filter(x => x !== id);
  if (nl.length !== dl.length) {
    if (nl.length === 0) await kvDel(ctx, `d:${a.date}`);
    else await kvPut(ctx, `d:${a.date}`, nl);
  }
  return a;
}

// ─── Available Slots ─────────────────────────────────────────

async function getSlots(ctx, date, svcId) {
  const svc = SVC.find(s => s.id === svcId);
  if (!svc) return [];
  const ids = (await kvGet(ctx, `d:${date}`)) || [];
  const booked = [];
  for (const id of ids) {
    const a = await kvGet(ctx, `ap:${id}`);
    if (a && !a.cx) booked.push(a);
  }
  const td = todayStr();
  const w = warsawNow();
  const ch = w.hour, cm = w.minute;
  const slots = [];
  for (let h = WORK.from; h < WORK.to; h++) {
    for (const m of [0, 30]) {
      const ss = h + m / 60, se = ss + svc.dur / 60;
      if (se > WORK.to) continue;
      if (date === td && (h < ch || (h === ch && m <= cm))) continue;
      let ok = true;
      for (const a of booked) {
        const bs = SVC.find(s => s.id === a.svcId);
        if (!bs) continue;
        const [ah, am] = a.time.split(':').map(Number);
        const as = ah + am / 60, ae = as + bs.dur / 60;
        if (ss < ae && se > as) { ok = false; break; }
      }
      if (ok) slots.push(`${p2(h)}:${p2(m)}`);
    }
  }
  return slots;
}

// ─── ICS ─────────────────────────────────────────────────────

function escIcs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function makeICS(apt, lang) {
  const svc = SVC.find(s => s.id === apt.svcId);
  if (!svc) return '';
  const name = svcName(lang, apt.svcId);
  const [y, mo, d] = apt.date.split('-').map(Number);
  const [h, mi] = apt.time.split(':').map(Number);
  const start = warsawToUTC(y, mo, d, h, mi);
  const end = new Date(start.getTime() + svc.dur * 60000);
  const f = dt => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const safeName = name.replace(/[^\w\sа-яА-ЯёЁіІїЇєЄґҐa-zA-Zżźćńółęąś']/gui, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ManicBot//Bot', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${apt.id}@manicbot`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
    `SUMMARY:${escIcs(safeName)}`,
    `DESCRIPTION:${escIcs(safeName)}\\n${escIcs(apt.userName)}`,
    `LOCATION:${escIcs(ADDRESS)}`, 'STATUS:CONFIRMED',
    'BEGIN:VALARM', 'TRIGGER:-PT24H', 'ACTION:DISPLAY', 'DESCRIPTION:24h', 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', 'DESCRIPTION:12h', 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:1h', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

// ─── Keyboards ───────────────────────────────────────────────

function mainKb(lg) {
  return { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: 'book' }],
    [{ text: t(lg, 'm_cat'), callback_data: 'cat' },
     { text: t(lg, 'm_prices'), callback_data: 'prices' }],
    [{ text: t(lg, 'm_my'), callback_data: 'my' }],
    [{ text: t(lg, 'm_rev'), callback_data: 'rev' },
     { text: t(lg, 'm_about'), callback_data: 'about' }],
    [{ text: t(lg, 'm_cont'), callback_data: 'cont' },
     { text: t(lg, 'm_lang'), callback_data: 'lang' }],
  ] } };
}

function langKb() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '🇷🇺 Русский', callback_data: 'sl:ru' },
     { text: '🇺🇦 Українська', callback_data: 'sl:ua' }],
    [{ text: '🇬🇧 English', callback_data: 'sl:en' },
     { text: '🇵🇱 Polski', callback_data: 'sl:pl' }],
  ] } };
}

function svcKb(lg) {
  const rows = SVC.map(s => [{
    text: `${s.e} ${t(lg, 'svc_' + s.id)} — ${s.price} ${t(lg, 'cur')}`,
    callback_data: `sv:${s.id}`,
  }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: 'main' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function calKb(lg, mo = 0) {
  mo = Math.max(0, Math.min(2, mo));
  const w = warsawNow();
  const vd = new Date(Date.UTC(w.year, w.month - 1 + mo, 1));
  const vy = vd.getUTCFullYear(), vm = vd.getUTCMonth();
  const dim = new Date(Date.UTC(vy, vm + 1, 0)).getUTCDate();
  const fd = new Date(Date.UTC(vy, vm, 1)).getUTCDay();
  const f = fd === 0 ? 6 : fd - 1;
  const rows = [];

  const nav = [];
  nav.push(mo > 0 ? { text: '◀️', callback_data: `cm:${mo - 1}` } : { text: ' ', callback_data: '_' });
  nav.push({ text: `${t(lg, 'mon')[vm]} ${vy}`, callback_data: '_' });
  nav.push(mo < 2 ? { text: '▶️', callback_data: `cm:${mo + 1}` } : { text: ' ', callback_data: '_' });
  rows.push(nav);

  rows.push(t(lg, 'daysH').map(d => ({ text: d, callback_data: '_' })));

  const td = todayStr();
  let wk = Array.from({ length: f }, () => ({ text: ' ', callback_data: '_' }));
  for (let day = 1; day <= dim; day++) {
    const ds = `${vy}-${p2(vm + 1)}-${p2(day)}`;
    if (ds < td) wk.push({ text: '·', callback_data: '_' });
    else wk.push({ text: ds === td ? `[${day}]` : `${day}`, callback_data: `dt:${ds}` });
    if (wk.length === 7) { rows.push(wk); wk = []; }
  }
  if (wk.length) { while (wk.length < 7) wk.push({ text: ' ', callback_data: '_' }); rows.push(wk); }

  rows.push([{ text: t(lg, 'other_svc'), callback_data: 'book' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function timeKb(slots, lg) {
  const rows = [];
  for (let i = 0; i < slots.length; i += 3)
    rows.push(slots.slice(i, i + 3).map(x => ({ text: `🕐 ${x}`, callback_data: `tm:${x}` })));
  rows.push([{ text: t(lg, 'other_date'), callback_data: 'bcal' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function catListKb(lg) {
  const rows = SVC.map(s => [{
    text: `${s.e} ${t(lg, 'svc_' + s.id)}`,
    callback_data: `cc:${s.id}:0`,
  }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: 'main' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function catPhotoKb(lg, svcId, idx, total) {
  const nav = [];
  if (idx > 0) nav.push({ text: '◀️', callback_data: `cc:${svcId}:${idx - 1}` });
  nav.push({ text: `${idx + 1} / ${total}`, callback_data: '_' });
  if (idx < total - 1) nav.push({ text: '▶️', callback_data: `cc:${svcId}:${idx + 1}` });
  return { reply_markup: { inline_keyboard: [
    nav,
    [{ text: t(lg, 'cat_book'), callback_data: `sv:${svcId}` }],
    [{ text: t(lg, 'cat_back'), callback_data: 'cat' }],
  ] } };
}

// ─── Screens ─────────────────────────────────────────────────

async function showLangPick(ctx, chatId) {
  await send(ctx, chatId,
    '🌍 Выберите язык / Оберіть мову / Choose language / Wybierz język',
    langKb());
}

async function showWelcome(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  await clearState(ctx, cid);
  await send(ctx, cid, fill(t(lg, 'welcome'), { s: SALON, n: escHtml(name) }), mainKb(lg));
}

async function showPrices(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  let txt = t(lg, 'prices_t');
  for (const s of SVC)
    txt += `${s.e} <b>${t(lg, 'svc_' + s.id)}</b>\n   💵 ${s.price} ${t(lg, 'cur')} · ⏱ ${s.dur} ${t(lg, 'min')}\n\n`;
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: 'book' }],
    [{ text: t(lg, 'back_m'), callback_data: 'main' }],
  ] } });
}

async function showContacts(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, fill(t(lg, 'cont_t'), { addr: ADDRESS, ph: PHONE, h: hours() }), { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: 'book' }],
    [{ text: t(lg, 'back_m'), callback_data: 'main' }],
  ] } });
}

async function showReviews(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, fill(t(lg, 'rev_t'), {}), { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: 'book' }],
    [{ text: t(lg, 'back_m'), callback_data: 'main' }],
  ] } });
}

async function showAbout(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, fill(t(lg, 'about_t'), { s: SALON, addr: ADDRESS, h: hours() }), { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: 'book' }],
    [{ text: t(lg, 'back_m'), callback_data: 'main' }],
  ] } });
}

async function showCatalog(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, t(lg, 'cat_title'), catListKb(lg));
}

async function showCatPhoto(ctx, cid, svcId, idx, msgId) {
  const lg = await getLang(ctx, cid) || 'ru';
  const photos = PHOTOS[svcId] || [];
  if (!photos.length) {
    return send(ctx, cid, `${svcName(lg, svcId)}\n\n${t(lg, 'cat_empty')}`, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cat_back'), callback_data: 'cat' }],
    ] } });
  }
  const safeIdx = Math.max(0, Math.min(idx, photos.length - 1));
  const s = SVC.find(x => x.id === svcId);
  if (!s) return;
  const cap = fill(t(lg, 'cat_cap'), {
    e: s.e, svc: t(lg, 'svc_' + svcId),
    p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min'),
    i: String(safeIdx + 1), total: String(photos.length),
  });
  const kb = catPhotoKb(lg, svcId, safeIdx, photos.length);

  if (msgId) {
    const res = await editPhoto(ctx, cid, msgId, photos[safeIdx], cap, kb);
    if (res) return;
  }
  await sendPhoto(ctx, cid, photos[safeIdx], cap, kb);
}

async function showMyApts(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = await getApts(ctx, cid);
  if (!apts.length) {
    return send(ctx, cid, `${t(lg, 'my_title')}\n\n${t(lg, 'my_empty')}`, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'm_book'), callback_data: 'book' }],
      [{ text: t(lg, 'back_m'), callback_data: 'main' }],
    ] } });
  }
  let txt = `${t(lg, 'my_title')}\n\n`;
  const btns = [];
  for (const a of apts) {
    const sv = SVC.find(x => x.id === a.svcId);
    if (!sv) continue;
    txt += `${svcName(lg, a.svcId)}\n📅 ${fmtDT(lg, a.date, a.time)}\n💵 ${sv.price} ${t(lg, 'cur')}\n\n`;
    btns.push([{
      text: fill(t(lg, 'my_cancel'), { d: fmtDate(lg, a.date), t: a.time }),
      callback_data: `cx:${a.id}`,
    }]);
  }
  btns.push([{ text: t(lg, 'back_m'), callback_data: 'main' }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

async function startBooking(ctx, cid, from) {
  const lg = await getLang(ctx, cid) || 'ru';
  const user = await getUser(ctx, cid);
  if (!user) {
    const tgName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || '?';
    await setState(ctx, cid, {
      step: 'rc', flow: 'book', tgName,
      tgUser: from?.username || null,
      tgLang: from?.language_code || null,
    });
    return send(ctx, cid, fill(t(lg, 'reg_confirm_name'), { n: escHtml(tgName) }), {
      reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'reg_yes'), callback_data: 'rg:y' }],
        [{ text: t(lg, 'reg_change'), callback_data: 'rg:c' }],
      ] },
    });
  }
  await send(ctx, cid, t(lg, 'choose_svc'), svcKb(lg));
}

// ─── Message handler (with validation) ───────────────────────

async function onMsg(ctx, msg) {
  if (!msg?.chat?.id || !msg?.from) return;
  if (msg.chat.type !== 'private') return;

  const cid = msg.chat.id;
  const rawName = msg.from.first_name || '';
  const name = escHtml(rawName.slice(0, 64)) || '👋';
  const st = await getState(ctx, cid);
  const lg = (await getLang(ctx, cid)) || 'ru';

  if (msg.contact && st.step === 'rp') {
    const phone = String(msg.contact.phone_number || '').slice(0, 20);
    return finishPhone(ctx, cid, phone, st);
  }

  const txt = (msg.text || '').trim().slice(0, 200);

  if (txt === '/start') {
    const hasLang = await getLang(ctx, cid);
    if (!hasLang) return showLangPick(ctx, cid);
    return showWelcome(ctx, cid, name);
  }
  if (txt === '/book')     return startBooking(ctx, cid, msg.from);
  if (txt === '/my')       return showMyApts(ctx, cid);
  if (txt === '/prices')   return showPrices(ctx, cid);
  if (txt === '/catalog')  return showCatalog(ctx, cid);
  if (txt === '/contacts') return showContacts(ctx, cid);
  if (txt === '/lang')     return showLangPick(ctx, cid);
  if (txt === '/help')     return send(ctx, cid, fill(t(lg, 'help'), {}));

  if (st.step === 'rn') {
    const cleaned = txt.replace(/<[^>]*>/g, '').trim();
    if (cleaned.length < 2 || cleaned.length > 50) return send(ctx, cid, t(lg, 'reg_name_err'));
    st.step = 'rp';
    st.name = cleaned;
    await setState(ctx, cid, st);
    return send(ctx, cid, fill(t(lg, 'reg_phone'), { n: escHtml(cleaned) }), {
      reply_markup: { keyboard: [[{ text: t(lg, 'reg_phone_btn'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }

  if (st.step === 'rc') {
    await send(ctx, cid, t(lg, 'unknown'));
    return;
  }

  if (st.step === 'rp') return finishPhone(ctx, cid, txt, st);

  await send(ctx, cid, t(lg, 'unknown'));
}

async function finishPhone(ctx, cid, phone, st) {
  const lg = (await getLang(ctx, cid)) || 'ru';
  const cl = phone.replace(/[^\d+]/g, '').slice(0, 20);
  if (cl.length < 7) return send(ctx, cid, t(lg, 'reg_phone_err'));
  const safeName = escHtml(st.name || '');
  await saveUser(ctx, cid, {
    chatId: cid,
    name: st.name,
    phone: cl,
    tgUsername: st.tgUser || null,
    tgLang: st.tgLang || null,
    registeredAt: Date.now(),
  });
  await clearState(ctx, cid);
  await send(ctx, cid, fill(t(lg, 'reg_done'), { n: safeName, p: escHtml(cl) }), { reply_markup: { remove_keyboard: true } });
  await send(ctx, cid, t(lg, 'now_choose'), svcKb(lg));
}

// ─── Callback handler (with validation) ──────────────────────

async function onCb(ctx, cb) {
  if (!cb?.message?.chat?.id || !cb?.from || !cb?.data) return;
  if (cb.message.chat.type !== 'private') return;

  const cid = cb.message.chat.id;
  const mid = cb.message.message_id;
  const d = cb.data;
  const rawName = cb.from.first_name || '';
  const name = escHtml(rawName.slice(0, 64)) || '👋';
  await answerCb(ctx, cb.id);

  if (d === '_') return;

  if (d.startsWith('sl:')) {
    const lang = d.slice(3);
    if (!VALID_LANGS.has(lang)) return;
    await setLang(ctx, cid, lang);
    await send(ctx, cid, t(lang, 'lang_set'));
    return showWelcome(ctx, cid, name);
  }

  const lg = (await getLang(ctx, cid)) || 'ru';

  if (d === 'main') return showWelcome(ctx, cid, name);
  if (d === 'lang') return showLangPick(ctx, cid);
  if (d === 'book') return startBooking(ctx, cid, cb.from);

  if (d === 'rg:y') {
    const st = await getState(ctx, cid);
    if (st.step !== 'rc') return;
    st.step = 'rp';
    st.name = st.tgName;
    await setState(ctx, cid, st);
    return send(ctx, cid, fill(t(lg, 'reg_phone'), { n: escHtml(st.tgName) }), {
      reply_markup: { keyboard: [[{ text: t(lg, 'reg_phone_btn'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }

  if (d === 'rg:c') {
    const st = await getState(ctx, cid);
    if (st.step !== 'rc') return;
    st.step = 'rn';
    await setState(ctx, cid, st);
    return send(ctx, cid, t(lg, 'reg_enter_name'));
  }
  if (d === 'my')   return showMyApts(ctx, cid);
  if (d === 'prices') return showPrices(ctx, cid);
  if (d === 'cont') return showContacts(ctx, cid);
  if (d === 'rev')  return showReviews(ctx, cid);
  if (d === 'about') return showAbout(ctx, cid);
  if (d === 'cat')  return showCatalog(ctx, cid);

  if (d.startsWith('cc:')) {
    const parts = d.slice(3).split(':');
    const svcId = parts[0];
    if (!SVC_IDS.has(svcId)) return;
    const idx = Math.max(0, parseInt(parts[1]) || 0);
    return showCatPhoto(ctx, cid, svcId, idx, mid);
  }

  if (d.startsWith('sv:')) {
    const sid = d.slice(3);
    if (!SVC_IDS.has(sid)) return;
    const s = SVC.find(x => x.id === sid);
    const user = await getUser(ctx, cid);
    if (!user) {
      return startBooking(ctx, cid, cb.from);
    }
    await setState(ctx, cid, { step: 'date', svcId: sid });
    await send(ctx, cid, fill(t(lg, 'chosen'), {
      svc: svcName(lg, sid), p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min'),
    }) + '\n\n' + t(lg, 'choose_date'), calKb(lg, 0));
    return;
  }

  if (d.startsWith('cm:')) {
    const off = Math.max(0, Math.min(2, parseInt(d.slice(3)) || 0));
    return edit(ctx, cid, mid, t(lg, 'choose_date'), calKb(lg, off));
  }

  if (d.startsWith('dt:')) {
    const date = d.slice(3);
    if (!isValidDate(date)) return;
    if (date < todayStr()) return;
    const st = await getState(ctx, cid);
    if (!st.svcId || !SVC_IDS.has(st.svcId)) return send(ctx, cid, t(lg, 'book_err'), svcKb(lg));
    const slots = await getSlots(ctx, date, st.svcId);
    if (!slots.length) return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, date) }), calKb(lg, 0));
    st.step = 'time';
    st.date = date;
    await setState(ctx, cid, st);
    await send(ctx, cid, `📅 <b>${fmtDate(lg, date)}</b>\n${svcName(lg, st.svcId)}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
    return;
  }

  if (d === 'bcal') return send(ctx, cid, t(lg, 'choose_date'), calKb(lg, 0));

  if (d.startsWith('tm:')) {
    const time = d.slice(3);
    if (!isValidTime(time)) return;
    const st = await getState(ctx, cid);
    if (!st.svcId || !st.date || !SVC_IDS.has(st.svcId) || !isValidDate(st.date)) {
      return send(ctx, cid, t(lg, 'book_err'), svcKb(lg));
    }
    st.step = 'conf';
    st.time = time;
    await setState(ctx, cid, st);
    const s = SVC.find(x => x.id === st.svcId);
    const user = await getUser(ctx, cid);
    await send(ctx, cid, [
      t(lg, 'confirm_title'), '',
      svcName(lg, st.svcId),
      `📅 ${fmtDT(lg, st.date, time)}`,
      `⏱ ${s.dur} ${t(lg, 'min')}`,
      `💵 ${s.price} ${t(lg, 'cur')}`, '',
      `👤 ${escHtml(user?.name || '—')}`,
      `📱 ${escHtml(user?.phone || '—')}`,
    ].join('\n'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'confirm_yes'), callback_data: 'ok' }],
      [{ text: t(lg, 'confirm_no'), callback_data: 'no' }],
    ] } });
    return;
  }

  if (d === 'ok') {
    const st = await getState(ctx, cid);
    if (st.step !== 'conf' || !st.svcId || !st.date || !st.time) {
      return send(ctx, cid, t(lg, 'book_err'), mainKb(lg));
    }
    if (!SVC_IDS.has(st.svcId) || !isValidDate(st.date) || !isValidTime(st.time)) {
      return send(ctx, cid, t(lg, 'book_err'), mainKb(lg));
    }
    await clearState(ctx, cid);

    const s = SVC.find(x => x.id === st.svcId);
    const user = await getUser(ctx, cid);
    const [y, mo, dd] = st.date.split('-').map(Number);
    const [h, mi] = st.time.split(':').map(Number);
    const ts = warsawToUTC(y, mo, dd, h, mi).getTime();

    const apt = await saveApt(ctx, {
      chatId: cid, svcId: st.svcId, date: st.date, time: st.time, ts,
      userName: user?.name || '?', userPhone: user?.phone || '?',
    });

    if (!apt) {
      return send(ctx, cid, fill(t(lg, 'book_limit'), { n: String(MAX_APTS) }), mainKb(lg));
    }

    await send(ctx, cid, fill(t(lg, 'booked'), {
      svc: svcName(lg, st.svcId), dt: fmtDT(lg, st.date, st.time),
      dur: String(s.dur), min: t(lg, 'min'), p: String(s.price), c: t(lg, 'cur'), addr: ADDRESS,
    }), mainKb(lg));
    const ics = makeICS(apt, lg);
    if (ics) await sendIcs(ctx, cid, ics, `manicure_${st.date}_${st.time.replace(':', '')}.ics`, t(lg, 'ics_cap'));
    return;
  }

  if (d === 'no') {
    await clearState(ctx, cid);
    return send(ctx, cid, t(lg, 'book_cancelled'), mainKb(lg));
  }

  if (d.startsWith('cx:')) {
    const aptId = d.slice(3);
    const apt = await cancelApt(ctx, aptId, cid);
    if (apt) {
      await send(ctx, cid, fill(t(lg, 'cancel_ok'), {
        svc: svcName(lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'rebook'), callback_data: 'book' }],
        [{ text: t(lg, 'back_m'), callback_data: 'main' }],
      ] } });
    } else {
      await send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    return;
  }
}

// ─── Cron: Reminders + Cleanup ───────────────────────────────

async function handleCron(ctx) {
  const now = Date.now();
  const w = warsawNow();

  // Phase 1: reminders — only scan today + tomorrow (not all appointments)
  const reminderDates = [];
  for (const off of [0, 1]) {
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + off));
    reminderDates.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`);
  }
  for (const date of reminderDates) {
    const ids = (await kvGet(ctx, `d:${date}`)) || [];
    for (const id of ids) {
      const a = await kvGet(ctx, `ap:${id}`);
      if (!a || a.cx) continue;
      const diffH = (a.ts - now) / 3600000;
      if (diffH < -1 || diffH > 25) continue;
      const lg = (await getLang(ctx, a.chatId)) || 'ru';
      const vars = { svc: svcName(lg, a.svcId), dt: fmtDT(lg, a.date, a.time), addr: ADDRESS };
      let sent = false;
      if (!a.rem.h24 && diffH <= 25 && diffH > 23) { a.rem.h24 = true; sent = true; await send(ctx, a.chatId, fill(t(lg, 'rem_24'), vars)); }
      if (!a.rem.h12 && diffH <= 13 && diffH > 11) { a.rem.h12 = true; sent = true; await send(ctx, a.chatId, fill(t(lg, 'rem_12'), vars)); }
      if (!a.rem.h1  && diffH <= 1.5 && diffH > 0.5) { a.rem.h1 = true; sent = true; await send(ctx, a.chatId, fill(t(lg, 'rem_1'), vars)); }
      if (sent) await kvPut(ctx, `ap:${id}`, a);
    }
  }

  // Phase 2: cleanup — remove expired/cancelled from global list + date indexes
  const allIds = (await kvGet(ctx, 'all')) || [];
  const kept = [];
  for (const id of allIds) {
    const a = await kvGet(ctx, `ap:${id}`);
    if (!a) continue;
    if ((a.ts < now - 48 * 3600000) || a.cx) {
      await kvDel(ctx, `ap:${id}`);
      const dl = (await kvGet(ctx, `d:${a.date}`)) || [];
      const newDl = dl.filter(x => x !== id);
      if (newDl.length !== dl.length) {
        if (newDl.length === 0) await kvDel(ctx, `d:${a.date}`);
        else await kvPut(ctx, `d:${a.date}`, newDl);
      }
      continue;
    }
    kept.push(id);
  }
  if (kept.length !== allIds.length) {
    await kvPut(ctx, 'all', kept);
  }
}

// ─── Main Export ─────────────────────────────────────────────

export default {
  async fetch(request, env) {
    let ctx;
    try { ctx = buildCtx(env); } catch (e) {
      return new Response(e.message, { status: 500 });
    }
    const url = new URL(request.url);
    const ADMIN_401 = new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="ManicBot Admin"' },
    });

    // ── Admin: set webhook (key-protected, curl-friendly)
    if (url.pathname === '/setup') {
      if (url.searchParams.get('key') !== ctx.ADMIN_KEY) {
        return new Response('Forbidden', { status: 403 });
      }
      const wh = `${url.origin}/webhook`;
      const r = await api(ctx, 'setWebhook', {
        url: wh,
        secret_token: ctx.WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
      });
      return Response.json({ webhook: wh, result: r });
    }

    // ── Admin: remove webhook (key-protected, curl-friendly)
    if (url.pathname === '/remove-webhook') {
      if (url.searchParams.get('key') !== ctx.ADMIN_KEY) {
        return new Response('Forbidden', { status: 403 });
      }
      return Response.json({ result: await api(ctx, 'deleteWebhook', {}) });
    }

    // ── Admin panel (Basic Auth)
    if (url.pathname === '/admin') {
      if (!checkAdmin(request, ctx.ADMIN_KEY)) return ADMIN_401;
      if (!ctx.kv) return new Response('KV not bound', { status: 500 });

      const allIds = (await kvGet(ctx, 'all')) || [];
      const clients = [];
      const appointments = [];

      for (const id of allIds) {
        const a = await kvGet(ctx, `ap:${id}`);
        if (!a) continue;
        const svc = SVC.find(x => x.id === a.svcId);
        appointments.push({
          id: a.id,
          client: a.userName,
          chatId: a.chatId,
          service: svc ? `${svc.e} ${a.svcId}` : a.svcId,
          date: a.date,
          time: a.time,
          status: a.cx ? '❌ Отменено' : (a.ts < Date.now() ? '✅ Завершено' : '🕐 Предстоит'),
          created: new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' '),
        });
      }

      const userKeys = await kvListAll(ctx.kv, { prefix: 'u:' });
      for (const k of userKeys) {
        const u = await kvGet(ctx, k.name);
        if (!u) continue;
        clients.push({
          chatId: u.chatId,
          name: u.name,
          phone: u.phone,
          username: u.tgUsername ? `@${u.tgUsername}` : '—',
          lang: u.tgLang || '—',
          registered: u.registeredAt ? new Date(u.registeredAt).toISOString().slice(0, 16).replace('T', ' ') : '—',
        });
      }

      const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>ManicBot Admin</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui;margin:0;padding:20px;background:#fdf2f8;color:#1a1a2e}
h1{color:#831843}h2{color:#9d174d;margin-top:40px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);margin:12px 0}
th{background:#ec4899;color:#fff;padding:10px 12px;text-align:left;font-weight:600;font-size:.85em;text-transform:uppercase}
td{padding:8px 12px;border-bottom:1px solid #fce7f3;font-size:.9em}
tr:hover td{background:#fdf2f8}
.stat{display:inline-block;background:#fff;padding:16px 24px;border-radius:12px;margin:8px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.stat b{font-size:1.5em;display:block;color:#ec4899}
.export{display:inline-block;padding:8px 16px;background:#ec4899;color:#fff;border-radius:8px;text-decoration:none;font-size:.85em;margin:4px}
.export:hover{background:#db2777}
</style></head><body>
<h1>💅 ManicBot — Админ-панель</h1>

<div>
<div class="stat"><b>${clients.length}</b>Клиентов</div>
<div class="stat"><b>${appointments.length}</b>Всего записей</div>
<div class="stat"><b>${appointments.filter(a => a.status === '🕐 Предстоит').length}</b>Предстоит</div>
</div>

<h2>👥 Клиенты</h2>
<a class="export" href="/admin/export/clients.csv">📥 Скачать CSV</a>
<table>
<tr><th>Chat ID</th><th>Имя</th><th>Телефон</th><th>Username</th><th>Язык</th><th>Дата рег.</th></tr>`;
      for (const c of clients) {
        html += `<tr><td>${esc(c.chatId)}</td><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.username)}</td><td>${esc(c.lang)}</td><td>${esc(c.registered)}</td></tr>`;
      }
      html += `</table>

<h2>📋 Записи</h2>
<a class="export" href="/admin/export/appointments.csv">📥 Скачать CSV</a>
<table>
<tr><th>ID</th><th>Клиент</th><th>Chat ID</th><th>Услуга</th><th>Дата</th><th>Время</th><th>Статус</th><th>Создано</th></tr>`;
      for (const a of appointments) {
        html += `<tr><td>${esc(a.id)}</td><td>${esc(a.client)}</td><td>${esc(a.chatId)}</td><td>${esc(a.service)}</td><td>${esc(a.date)}</td><td>${esc(a.time)}</td><td>${a.status}</td><td>${esc(a.created)}</td></tr>`;
      }
      html += `</table></body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    // ── CSV export (Basic Auth)
    if (url.pathname.startsWith('/admin/export/') && ctx.kv) {
      if (!checkAdmin(request, ctx.ADMIN_KEY)) return ADMIN_401;
      const file = url.pathname.split('/').pop();

      if (file === 'clients.csv') {
        const userKeys = await kvListAll(ctx.kv, { prefix: 'u:' });
        let csv = 'Chat ID,Name,Phone,Username,Language,Registered\n';
        for (const k of userKeys) {
          const u = await kvGet(ctx, k.name);
          if (!u) continue;
          csv += `${u.chatId},"${(u.name||'').replace(/"/g,'""')}",${u.phone},${u.tgUsername||''},${u.tgLang||''},${u.registeredAt ? new Date(u.registeredAt).toISOString() : ''}\n`;
        }
        return new Response(csv, { headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="clients.csv"' } });
      }

      if (file === 'appointments.csv') {
        const allIds = (await kvGet(ctx, 'all')) || [];
        let csv = 'ID,Client,Chat ID,Service,Date,Time,Status,Created\n';
        for (const id of allIds) {
          const a = await kvGet(ctx, `ap:${id}`);
          if (!a) continue;
          const status = a.cx ? 'Cancelled' : (a.ts < Date.now() ? 'Completed' : 'Upcoming');
          csv += `${a.id},"${(a.userName||'').replace(/"/g,'""')}",${a.chatId},${a.svcId},${a.date},${a.time},${status},${new Date(a.createdAt).toISOString()}\n`;
        }
        return new Response(csv, { headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="appointments.csv"' } });
      }
    }

    // ── Landing page
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>ManicBot</title>
<style>
body{font-family:system-ui;max-width:600px;margin:60px auto;padding:0 20px;background:#fdf2f8;color:#831843}
h1{font-size:2.5em}
.s{background:#fff;padding:20px;border-radius:12px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.s h3{margin-top:0}
code{background:#fce7f3;padding:2px 6px;border-radius:4px}
</style></head><body>
<h1>💅 ManicBot</h1>
<p>Telegram-бот для записи на маникюр</p>
<div class="s"><h3>Status</h3><p>✅ Worker is running</p></div>
<div class="s"><h3>Setup</h3><p>Use <code>/setup?key=YOUR_KEY</code> to configure webhook</p></div>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    // ── Webhook endpoint (verified by secret header)
    if (request.method === 'POST' && url.pathname === '/webhook') {
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (secret !== ctx.WEBHOOK_SECRET) {
        return new Response('Unauthorized', { status: 403 });
      }

      if (!ctx.kv) {
        console.error('KV MANICBOT not bound');
        return new Response('OK');
      }

      try {
        const upd = await request.json();

        if (upd.message) {
          if (!upd.message.chat?.id || !upd.message.from?.id) {
            return new Response('OK');
          }
          await onMsg(ctx, upd.message);
        }

        if (upd.callback_query) {
          if (!upd.callback_query.message?.chat?.id || !upd.callback_query.from?.id || !upd.callback_query.data) {
            return new Response('OK');
          }
          await onCb(ctx, upd.callback_query);
        }
      } catch (e) {
        console.error('Webhook error:', e.message, e.stack);
      }
      return new Response('OK');
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, _scheduledCtx) {
    const ctx = buildCtx(env);
    _scheduledCtx.waitUntil(handleCron(ctx));
  },
};
