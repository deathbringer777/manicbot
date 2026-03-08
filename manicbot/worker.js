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
// 8. Workers AI: либо binding [ai] в wrangler.toml (env.AI), либо REST по токену — задай секреты WORKERS_AI_API_TOKEN и CLOUDFLARE_ACCOUNT_ID (приоритет у REST).
// 9. Опционально: ADMIN_CHAT_ID — Telegram chat_id для уведомлений о запросе консультанта.
// ══════════════════════════════════════════════════════════════

// Secrets: wrangler secret put BOT_TOKEN / ADMIN_KEY / WEBHOOK_SECRET
// Workers AI по токену (приоритет): wrangler secret put WORKERS_AI_API_TOKEN CLOUDFLARE_ACCOUNT_ID

function buildCtx(env) {
  if (!env.BOT_TOKEN) throw new Error('Missing secret: BOT_TOKEN');
  if (!env.ADMIN_KEY) throw new Error('Missing secret: ADMIN_KEY');
  if (!env.WEBHOOK_SECRET) throw new Error('Missing secret: WEBHOOK_SECRET');
  const botId = env.BOT_TOKEN.split(':')[0];
  return {
    TG: `https://api.telegram.org/bot${env.BOT_TOKEN}`,
    ADMIN_KEY: env.ADMIN_KEY,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    kv: env.MANICBOT,
    adminChatId: env.ADMIN_CHAT_ID || null,
    prefix: `b:${botId}:`,
    AI: env.AI || null,
    WORKERS_AI_API_TOKEN: env.WORKERS_AI_API_TOKEN || null,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || null,
  };
}

function timingSafeEqual(a, b) {
  const ta = new TextEncoder().encode(a);
  const tb = new TextEncoder().encode(b);
  if (ta.length !== tb.length) {
    // Still run the comparison to avoid length-based timing leak
    crypto.subtle.timingSafeEqual(ta, ta);
    return false;
  }
  return crypto.subtle.timingSafeEqual(ta, tb);
}

function checkAdmin(request, adminKey) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    return timingSafeEqual(decoded.slice(idx + 1), adminKey);
  } catch { return false; }
}

async function kvListAll(ctx, opts) {
  const pLen = ctx.prefix.length;
  const prefixedOpts = opts.prefix ? { ...opts, prefix: ctx.prefix + opts.prefix } : opts;
  const keys = [];
  let cursor;
  do {
    const res = await ctx.kv.list({ ...prefixedOpts, cursor });
    for (const k of res.keys) keys.push({ ...k, name: k.name.slice(pLen) });
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

// ─── Callback data prefixes ───────────────────────────────────
const CB = {
  NOOP:      '_',
  MAIN:      'main',
  BOOK:      'book',
  MY:        'my',
  PRICES:    'prices',
  CONTACTS:  'cont',
  REVIEWS:   'rev',
  ABOUT:     'about',
  CATALOG:   'cat',
  CAL_BACK:  'bcal',
  CONFIRM:   'ok',
  CANCEL_BOOK: 'no',
  LANG:      'lang',
  LANG_SET:  'sl:',
  REG_YES:   'rg:y',
  REG_CHANGE:'rg:c',
  SERVICE:   'sv:',
  CAL_MONTH: 'cm:',
  DATE:      'dt:',
  TIME:      'tm:',
  CANCEL_APT:'cx:',
  CANCEL_APT_YES:'cxy:',
  CANCEL_APT_SKIP:'cxs:',
  CANCEL_ALL:    'cxa',
  CANCEL_ALL_YES: 'cxay',
  CAT_PHOTO: 'cc:',
  ABOUT_PHOTO: 'abph:',
  // Admin & Master
  ADM_MAIN:    'adm',
  ADM_TODAY:   'adm:td',
  ADM_TOMORROW:'adm:tm',
  ADM_MASTERS: 'adm:ms',
  ADM_ADD_M:   'adm:am',
  ADM_DEL_M:   'adm:dm:',
  ADM_VACATION:'adm:vac:',
  ADM_SETTINGS:'adm:st',
  ADM_CLIENTS: 'adm:cl',
  ADM_CLIENTS_PAGE: 'adm:clp:',
  MST_MAIN:    'mst',
  MST_TODAY:   'mst:td',
  MST_TOMORROW:'mst:tm',
  // Appointment confirmation flow
  APT_CONFIRM:     'ac:',
  APT_REJECT:      'ar:',
  APT_REJECT_SKIP: 'ars:',
  APT_COUNTER:     'ao:',
  APT_COUNTER_SKIP:'aos:',
  APT_ACCEPT:      'aa:',
  APT_DECLINE:     'adl:',
  APT_REPLY:       'arl:',
  // Admin management
  ADM_BLOCK:       'abk:',
  ADM_UNBLOCK:     'aub:',
  ADM_CANCEL_APT:  'aca:',
  ADM_CANCEL_SKIP: 'acs:',
  ADM_CANCEL_ALL:  'admcxa',
  ADM_CANCEL_ALL_YES: 'admcxay',
  ADM_ABOUT: 'adm:about',
  ADM_ABOUT_PHOTOS: 'adm:abph',
  ADM_ABOUT_PHOTO_ADD: 'adm:abpha',
  ADM_ABOUT_PHOTO_DEL: 'adm:abphd:',
  ADM_ABOUT_DESC: 'adm:abdesc',
  ADM_ABOUT_INSTAGRAM: 'adm:abig',
  // Service management
  SVC_LIST:     'svl',
  SVC_EDIT:     'sve:',
  SVC_NAME:     'svn:',
  SVC_PRICE:    'svp:',
  SVC_DUR:      'svd:',
  SVC_DESC:     'svds:',
  SVC_EMOJI:    'svem:',
  SVC_TOGGLE:   'svt:',
  SVC_DEL:      'svdl:',
  SVC_ADD:      'sva',
  SVC_PHOTOS:   'svph:',
  SVC_PHOTO_DEL:'svpd:',
  SVC_PHOTO_ADD:'svpa:',
  SVC_BACK:     'svbk:',
  CONSULT_REQ:  'consult_req',
  TICKET_TAKE:  'tk:',
  TICKET_DECLINE:'td:',
  TICKET_CLOSE: 'tkc:',
  TICKET_FREE_CORRECTION: 'tfc:',
};

const TIMEZONE = 'Europe/Warsaw';
const SALON = 'ManicBot 💅';
const ADDRESS = 'ul. Marszałkowska 27, Warszawa';
const MAPS_URL = 'https://maps.app.goo.gl/qabutZZG1sEmnwcX7';
const INSTAGRAM_URL = 'https://instagram.com/';
const PHONE = '+48 22 123 45 67';
const WORK = { from: 9, to: 19 };
const HOURS_STR = `${WORK.from}:00 — ${WORK.to}:00`;
const STATE_TTL_SEC = 7200;
const LOCK_TTL_SEC = 30;
const CLEANUP_AFTER_MS = 48 * 3600000;
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_SEC = 60;

const DEFAULT_SVC = [
  { id: 'classic',  e: '💅', dur: 60,  price: 80   },
  { id: 'gel',      e: '💎', dur: 90,  price: 140  },
  { id: 'pedi',     e: '🦶', dur: 90,  price: 120  },
  { id: 'ext',      e: '✨', dur: 120, price: 250  },
  { id: 'design',   e: '🎨', dur: 30,  price: 50   },
  { id: 'combo',    e: '👑', dur: 150, price: 220  },
];

// ─── Фото каталога (значения по умолчанию) ──────────────────
const DEFAULT_PHOTOS = {
  classic: [
    'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600',
    'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600',
    'https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600',
  ],
  gel: [
    'https://images.pexels.com/photos/3997388/pexels-photo-3997388.jpeg?w=600',
    'https://images.pexels.com/photos/3997384/pexels-photo-3997384.jpeg?w=600',
    'https://images.pexels.com/photos/3997393/pexels-photo-3997393.jpeg?w=600',
  ],
  pedi: [
    'https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600',
    'https://images.pexels.com/photos/9789207/pexels-photo-9789207.jpeg?w=600',
    'https://images.pexels.com/photos/4155017/pexels-photo-4155017.jpeg?w=600',
  ],
  ext: [
    'https://images.pexels.com/photos/939836/pexels-photo-939836.jpeg?w=600',
    'https://images.pexels.com/photos/3738375/pexels-photo-3738375.jpeg?w=600',
    'https://images.pexels.com/photos/7320686/pexels-photo-7320686.jpeg?w=600',
  ],
  design: [
    'https://images.pexels.com/photos/704815/pexels-photo-704815.jpeg?w=600',
    'https://images.pexels.com/photos/3997383/pexels-photo-3997383.jpeg?w=600',
    'https://images.pexels.com/photos/4963822/pexels-photo-4963822.jpeg?w=600',
  ],
  combo: [
    'https://images.pexels.com/photos/3997379/pexels-photo-3997379.jpeg?w=600',
    'https://images.pexels.com/photos/5874862/pexels-photo-5874862.jpeg?w=600',
  ],
};

const DEFAULT_ABOUT_PHOTOS = [
  'https://images.pexels.com/photos/7750099/pexels-photo-7750099.jpeg?w=600',
  'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600',
  'https://images.pexels.com/photos/7321747/pexels-photo-7321747.jpeg?w=600',
];

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
  svc_correction: 'Исправление',

  m_book: '📝 Записаться',
  m_my: '📋 Мои записи',
  m_prices: '💰 Прайс-лист',
  m_cat: '📸 Каталог работ',
  m_rev: '⭐ Отзывы',
  m_about: 'ℹ️ О нас',
  m_instagram: '📷 Instagram',
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
    '', '{svc}', '',
    '📅 {dt}', '',
    '⏱ {dur} {min}', '💵 {p} {c}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ Напомню тебе:', '• За 24 часа', '• За 2 часа',
    '', '📅 Добавить в календарь (Google Calendar/Mac) ⬇️'
  ],
  booked_correction: [
    '🎉 <b>Запись подтверждена!</b>', '',
    '', '{svc}', '',
    '📅 {dt}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ Напомню тебе:', '• За 24 часа', '• За 2 часа',
    '', '📅 Добавить в календарь (Google Calendar/Mac) ⬇️'
  ],
  book_cancelled: '❌ Запись отменена.\n\nВыбери, что тебя интересует:',
  book_err: '❌ Ошибка. Начни запись сначала.',
  book_limit: '⚠️ Достигнут лимит записей ({n}). Отмени одну из текущих, чтобы создать новую.',
  slot_taken: '😔 Это время только что заняли. Выбери другое:',
  rate_limit: '⏳ Слишком много запросов. Подожди немного.',

  my_title: '📋 <b>Мои записи</b>',
  my_empty: 'У тебя нет предстоящих записей.\n\n💅 Хочешь записаться?',
  my_cancel: '❌ Отменить: {d} {t}',
  my_cancel_all: '🗑 Отменить все записи',
  cancel_confirm: '⚠️ Точно отменить?\n\n{svc}\n📅 {dt}',
  cancel_all_confirm: '⚠️ Отменить все {n} записей?',
  cancel_yes: '❌ Да, отменить',
  cancel_all_yes: '🗑 Да, отменить все',
  cancel_no: '◀️ Нет, назад',
  cancel_all_ok: '✅ Все записи отменены.',
  cancel_comment_prompt: '💬 Добавь комментарий к отмене для мастера/админа\nили нажми «Пропустить»:',
  cancel_comment_skip: '⏭ Пропустить',
  cancel_ok: '✅ <b>Запись отменена:</b>\n\n{svc}\n📅 {dt}\n\nХочешь перезаписаться на другую дату?',
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
    '{desc}', '',
    '📍 {addr}', '🕐 {h}'
  ],
  about_desc_default: 'Команда профессионалов! 💖\n\n✅ Опыт более 5 лет\n✅ Качественные материалы\n✅ Стерильные инструменты\n✅ Индивидуальный подход\n✅ Уютная атмосфера',
  cat_title: '📸 <b>Каталог работ</b>\n\nВыбери категорию:',
  cat_cap: '{e} <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}\n\n📷 {i} / {total}',
  cat_book: '📝 Записаться на эту услугу',
  cat_back: '◀️ К категориям',
  cat_empty: '🖼 Фото пока нет',

  rem_24: ['⏰ <b>Напоминание!</b>','','Завтра у тебя запись:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','До встречи! 💅'],
  rem_2:  ['⏰ <b>Напоминание!</b>','','Через 2 часа:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','Уже скоро! 💖'],

  adm_welcome: '🔧 <b>Панель администратора</b>\n\nПривет, {n}! Ты — админ.',
  adm_registered: '✅ <b>Ты зарегистрирован как админ!</b>\n\nТеперь у тебя есть доступ к панели управления.',
  adm_already: 'ℹ️ Админ уже зарегистрирован.',
  adm_wrong_key: '❌ Неверный ключ.',
  adm_today: '📋 Записи на сегодня',
  adm_tomorrow: '📅 Записи на завтра',
  adm_masters: '👩‍🎨 Мастера',
  adm_add_master: '➕ Добавить мастера',
  adm_del_master: '❌ Удалить',
  adm_settings: '⚙️ Настройки',
  adm_clients: '👥 Клиенты',
  adm_back: '◀️ Панель админа',
  adm_prev: '◀️ Назад',
  adm_next: 'Вперёд ▶️',
  adm_no_apts: 'Нет записей.',
  confirm_all_done: '✅ Подтверждено {n} заявок.',
  confirm_all_none: 'Нет ожидающих заявок.',
  adm_no_masters: 'Мастеров пока нет.\n\nДобавь первого!',
  adm_enter_master_id: '✏️ Введи ID, @username или телефон мастера\nили перешли его сообщение/контакт:',
  adm_master_added: '✅ Мастер <b>{n}</b> (ID: {id}) добавлен!',
  adm_master_removed: '❌ Мастер удалён.',
  adm_master_exists: 'ℹ️ Этот мастер уже добавлен.',
  adm_master_invalid: '❌ Не удалось найти мастера. Введи ID, @username, телефон или перешли сообщение/контакт.',
  adm_vacation_btn: '🏖 В отпуск',
  adm_vacation_off_btn: '✅ Снять с отпуска',
  adm_vacation_on: '✅ Мастер в отпуске.',
  adm_vacation_off: '✅ Мастер снят с отпуска.',
  adm_vacation_status: 'в отпуске',
  adm_to_client: '💅 Режим клиента',

  mst_welcome: '💅 <b>Панель мастера</b>\n\nПривет, {n}!',
  mst_today: '📋 Мои записи сегодня',
  mst_tomorrow: '📅 Все записи',
  mst_to_client: '💅 Режим клиента',
  mst_back: '◀️ Панель мастера',
  mst_no_apts: 'Нет записей.',
  apt_pending: '⏳ <b>Заявка принята!</b>\n\nМы получили вашу заявку:\n\n{svc}\n📅 {dt}\n\nМастер подтвердит запись в ближайшее время. Мы сообщим! 📲',
  apt_rejected: '❌ <b>Запись не подтверждена</b>\n\n{svc}\n📅 {dt}',
  apt_reject_cmt: '\n\n💬 <i>{comment}</i>',
  apt_rebook: '\n\nЖелаете выбрать другое время?',
  apt_counter: '💬 <b>Мастер предлагает другое время:</b>\n\n{svc}\n📅 {d}\n🕐 <b>{newtime}</b>',
  apt_counter_cmt: '\n\n💬 <i>{comment}</i>',
  apt_accept: '✅ Принять',
  apt_decline: '❌ Отклонить',
  apt_reply_btn: '💬 Ответить',
  apt_accepted: '✅ <b>Новое время принято!</b>',
  apt_enter_reply: '💬 Напиши сообщение мастеру:',
  apt_reply_sent: '✅ Сообщение отправлено.',
  mst_new_apt: '🆕 <b>Новая заявка!</b>\n\n👤 {client}\n📱 {phone}{usernameLine}\n\n💅 {svc}\n\n📅 {dt}\n💵 {price} {cur}',
  mst_new_apt_header: 'Новая заявка!',
  mst_confirm_btn: '✅ Подтвердить',
  mst_reject_btn: '❌ Отклонить',
  mst_counter_btn: '💬 Другое время',
  mst_reject_prompt: '💬 Комментарий для клиента\n(или нажми «Пропустить»):',
  mst_skip: '⏭ Пропустить',
  mst_counter_time: '🕐 Введи новое время (ЧЧ:ММ):',
  mst_counter_cmt_prompt: '💬 Комментарий для клиента\n(или «Пропустить»):',
  mst_apt_confirmed: '✅ Подтверждено!\n👤 {client} · 📅 {dt}',
  mst_apt_rejected: '❌ Отклонено.\n👤 {client} · 📅 {dt}',
  mst_counter_sent: '💬 Предложение отправлено.',
  mst_client_accepted: '✅ Клиент принял {newtime}!\n👤 {client}',
  mst_client_declined: '❌ Клиент отклонил.\n👤 {client}',
  mst_client_msg: '💬 От {client}:\n<i>{msg}</i>',
  mst_already_done: 'ℹ️ Уже обработано.',
  adm_block_btn: '🚫 Блок',
  adm_unblock_btn: '✅ Разблок',
  adm_blocked: '🚫 Клиент заблокирован.',
  adm_unblocked: '✅ Клиент разблокирован.',
  adm_cancel_prompt: '💬 Причина отмены для клиента:',
  adm_cancel_skip: '⏭ Без причины',
  adm_apt_cancelled: '✅ Запись отменена. Клиент уведомлён.',
  adm_cancel_all_confirm: '⚠️ Отменить все {n} записей всех клиентов?',
  adm_cancel_all_yes: '🗑 Да, отменить все',
  adm_cancel_all_done: '✅ Отменено {n} записей. Клиенты уведомлены.',
  client_blocked: '🚫 Доступ к боту ограничен.',
  client_cancelled_admin: '😔 <b>Запись отменена</b>\n\n{svc}\n📅 {dt}\n\n💬 <i>{reason}</i>\n\nПриносим извинения!',
  svc_manage: '⚙️ Услуги',
  adm_about_photos: '📷 Фото «О нас»',
  adm_about_desc: '✏️ Описание «О нас»',
  adm_about_instagram: '📷 Ссылка Instagram',
  adm_enter_about_desc: '✏️ Введи описание для раздела «О нас»\n(или /skip чтобы сбросить на стандартное):',
  adm_enter_instagram: '📷 Введи ссылку на Instagram\n(например https://instagram.com/username):',
  adm_current: 'Текущее',
  svc_list_title: '⚙️ <b>Управление услугами</b>\n\n',
  svc_add: '➕ Добавить услугу',
  svc_edit_title: '✏️ <b>Редактирование: {name}</b>\n\n{e} <b>{name}</b>\n💵 Цена: {price} {cur}\n⏱ Длительность: {dur} мин\n📝 Описание: {desc}\n📷 Фото: {photos}\n🔘 Статус: {status}',
  svc_edit_name: '✏️ Название',
  svc_edit_price: '💵 Цена',
  svc_edit_dur: '⏱ Длительность',
  svc_edit_desc: '📝 Описание',
  svc_edit_emoji: '💅 Эмодзи',
  svc_edit_photos: '📷 Фото',
  svc_toggle_on: '🔘 Вкл',
  svc_toggle_off: '🔘 Выкл',
  svc_delete: '🗑 Удалить',
  svc_enter_name: '✏️ Введи новое название:',
  svc_enter_price: '💵 Введи цену (число):',
  svc_enter_dur: '⏱ Введи длительность в минутах:',
  svc_enter_desc: '📝 Введи описание (или /skip):',
  svc_enter_emoji: '💅 Отправь эмодзи:',
  svc_enter_id: '🆕 Введи ID для новой услуги (латиницей, без пробелов):',
  svc_updated: '✅ Обновлено!',
  svc_deleted: '🗑 Услуга удалена.',
  svc_added: '✅ Услуга добавлена! Настрой цену, название и фото.',
  svc_id_exists: '❌ Услуга с таким ID уже существует.',
  svc_invalid: '❌ Некорректное значение.',
  svc_photo_title: '📷 <b>Фото: {name}</b>\n\nВсего: {count}',
  svc_photo_add: '➕ Добавить фото',
  svc_photo_del: '❌ Удалить',
  svc_enter_photo: '📷 Отправь фото или ссылку на изображение:',
  svc_photo_added: '✅ Фото добавлено!',
  svc_photo_deleted: '✅ Фото удалено.',
  consultant_btn: '👤 Подключить консультанта',
  consultant_btn_hint: '💬 Нажмите кнопку — к вам подключится мастер или админ. В режиме чата пишите сообщения, они дойдут до специалиста. Чтобы завершить — напишите СТОП.',
  consultant_sent: '✅ Заявка передана консультанту. Ожидайте ответа в ближайшее время.',
  ticket_desc: '💬 <b>Режим чата с консультантом</b>\n\nВы подключаетесь к мастеру или админу. Бот перейдёт в режим чата: ваши сообщения будут приходить специалисту, ответы — вам. Чтобы завершить — напишите СТОП (или STOP).',
  ticket_taken_by: '✅ С вами подключился <b>{name}</b>. Пишите сообщения — они дойдут до мастера.',
  ticket_take_btn: '👤 Взять в работу',
  ticket_decline_btn: '❌ Отклонить',
  ticket_close_btn: '🔒 Закрыть тикет',
  ticket_closed: '🔒 Тикет закрыт. Вы снова в обычном режиме бота.',
  ticket_closed_master: '🔒 Тикет закрыт. Клиент снова в обычном режиме.',
  ticket_declined: '🙏 Извините, сейчас все специалисты заняты. Попробуйте через 30 минут или нажмите /start для записи.',
  ticket_from_client: '💬 <b>Клиент:</b>\n{msg}',
  ticket_sent: '✅ Отправлено мастеру.',
  ticket_reply_sent: '✅ Отправлено клиенту.',
  ticket_master_hint: '💬 Чат с клиентом. Пишите сообщения в этот чат — они уйдут клиенту. Нажмите «Закрыть тикет», когда вопрос решён.',
  consultant_notify: '👤 <b>Клиент просит консультанта</b>\n\n👤 {name}\n📱 {phone}\n🔗 {username}\n\nПодключитесь или отклоните — клиент ждёт.',
  consultant_constructive: '🙏 Давайте общаться конструктивно. Если нужна помощь — нажмите /start или кнопку «Подключить консультанта».',
  ticket_internal_note: '📋 <i>Контекст диалога (только для мастера/админа):</i>\n\n{note}',
  ticket_free_correction_btn: '🔧 Бесплатная коррекция',
  correction_offer_msg: '🔧 <b>Мастер предлагает бесплатное исправление</b>\n\nНажмите кнопку, чтобы выбрать дату и время:',
  correction_book_btn: '📝 Записаться на исправление',
  chosen_correction: '✅ Выбрано: <b>{svc}</b>\n\nВыбери дату:',
  confirm_correction: '📋 <b>Подтверждение записи</b>\n\n{svc}\n📅 {dt}\n\n👤 {name}\n📱 {phone}',
  free_label: 'Бесплатно',
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
  svc_correction: 'Виправлення',

  m_book: '📝 Записатися',
  m_my: '📋 Мої записи',
  m_prices: '💰 Прайс-лист',
  m_cat: '📸 Каталог робіт',
  m_rev: '⭐ Відгуки',
  m_about: 'ℹ️ Про нас',
  m_instagram: '📷 Instagram',
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
    '', '{svc}', '',
    '📅 {dt}', '',
    '⏱ {dur} {min}', '💵 {p} {c}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ Нагадаю тобі:', '• За 24 години', '• За 2 години',
    '', '📅 Додати в календар (Google Calendar/Mac) ⬇️'
  ],
  booked_correction: [
    '🎉 <b>Запис підтверджено!</b>', '',
    '', '{svc}', '',
    '📅 {dt}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ Нагадаю тобі:', '• За 24 години', '• За 2 години',
    '', '📅 Додати в календар (Google Calendar/Mac) ⬇️'
  ],
  book_cancelled: '❌ Запис скасовано.\n\nОбери, що тебе цікавить:',
  book_err: '❌ Помилка. Почни запис спочатку.',
  book_limit: '⚠️ Досягнуто ліміт записів ({n}). Скасуй одну з поточних.',
  slot_taken: '😔 Цей час щойно зайняли. Обери інший:',
  rate_limit: '⏳ Забагато запитів. Зачекай трохи.',

  my_title: '📋 <b>Мої записи</b>',
  my_empty: 'У тебе немає майбутніх записів.\n\n💅 Хочеш записатися?',
  my_cancel: '❌ Скасувати: {d} {t}',
  my_cancel_all: '🗑 Скасувати всі записи',
  cancel_confirm: '⚠️ Точно скасувати?\n\n{svc}\n📅 {dt}',
  cancel_all_confirm: '⚠️ Скасувати всі {n} записів?',
  cancel_yes: '❌ Так, скасувати',
  cancel_all_yes: '🗑 Так, скасувати всі',
  cancel_no: '◀️ Ні, назад',
  cancel_all_ok: '✅ Всі записи скасовано.',
  cancel_comment_prompt: '💬 Додай коментар до скасування для майстра/адміна\nабо натисни «Пропустити»:',
  cancel_comment_skip: '⏭ Пропустити',
  cancel_ok: '✅ <b>Запис скасовано:</b>\n\n{svc}\n📅 {dt}\n\nХочеш перезаписатися на іншу дату?',
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
    '{desc}', '',
    '📍 {addr}', '🕐 {h}'
  ],
  about_desc_default: 'Команда професіоналів! 💖\n\n✅ Досвід понад 5 років\n✅ Якісні матеріали\n✅ Стерильні інструменти\n✅ Індивідуальний підхід\n✅ Затишна атмосфера',
  cat_title: '📸 <b>Каталог робіт</b>\n\nОбери категорію:',
  cat_cap: '{e} <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}\n\n📷 {i} / {total}',
  cat_book: '📝 Записатися на цю послугу',
  cat_back: '◀️ До категорій',
  cat_empty: '🖼 Фото поки немає',

  rem_24: ['⏰ <b>Нагадування!</b>','','Завтра у тебе запис:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','До зустрічі! 💅'],
  rem_2:  ['⏰ <b>Нагадування!</b>','','Через 2 години:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','Вже скоро! 💖'],

  adm_welcome: '🔧 <b>Панель адміністратора</b>\n\nПривіт, {n}! Ти — адмін.',
  adm_registered: '✅ <b>Ти зареєстрований як адмін!</b>\n\nТепер у тебе є доступ до панелі керування.',
  adm_already: 'ℹ️ Адмін вже зареєстрований.',
  adm_wrong_key: '❌ Невірний ключ.',
  adm_today: '📋 Записи на сьогодні',
  adm_tomorrow: '📅 Записи на завтра',
  adm_masters: '👩‍🎨 Майстри',
  adm_add_master: '➕ Додати майстра',
  adm_del_master: '❌ Видалити',
  adm_settings: '⚙️ Налаштування',
  adm_clients: '👥 Клієнти',
  adm_back: '◀️ Панель адміна',
  adm_prev: '◀️ Назад',
  adm_next: 'Вперед ▶️',
  adm_no_apts: 'Немає записів.',
  confirm_all_done: '✅ Підтверджено {n} заявок.',
  confirm_all_none: 'Немає заявок, що очікують.',
  adm_no_masters: 'Майстрів поки немає.\n\nДодай першого!',
  adm_enter_master_id: '✏️ Введи ID, @username або телефон майстра\nабо перешли його повідомлення/контакт:',
  adm_master_added: '✅ Майстер <b>{n}</b> (ID: {id}) доданий!',
  adm_master_removed: '❌ Майстра видалено.',
  adm_master_exists: 'ℹ️ Цей майстер вже доданий.',
  adm_master_invalid: '❌ Не вдалося знайти майстра. Введи ID, @username, телефон або перешли повідомлення/контакт.',
  adm_vacation_btn: '🏖 У відпустку',
  adm_vacation_off_btn: '✅ Зняти з відпустки',
  adm_vacation_on: '✅ Майстер у відпустці.',
  adm_vacation_off: '✅ Майстра знято з відпустки.',
  adm_vacation_status: 'у відпустці',
  adm_to_client: '💅 Режим клієнта',

  mst_welcome: '💅 <b>Панель майстра</b>\n\nПривіт, {n}!',
  mst_today: '📋 Мої записи сьогодні',
  mst_tomorrow: '📅 Всі записи',
  mst_to_client: '💅 Режим клієнта',
  mst_back: '◀️ Панель майстра',
  mst_no_apts: 'Немає записів.',
  apt_pending: '⏳ <b>Заявку прийнято!</b>\n\nМи отримали вашу заявку:\n\n{svc}\n📅 {dt}\n\nМайстер підтвердить запис найближчим часом. Ми повідомимо! 📲',
  apt_rejected: '❌ <b>Запис не підтверджено</b>\n\n{svc}\n📅 {dt}',
  apt_reject_cmt: '\n\n💬 <i>{comment}</i>',
  apt_rebook: '\n\nБажаєте обрати інший час?',
  apt_counter: '💬 <b>Майстер пропонує інший час:</b>\n\n{svc}\n📅 {d}\n🕐 <b>{newtime}</b>',
  apt_counter_cmt: '\n\n💬 <i>{comment}</i>',
  apt_accept: '✅ Прийняти',
  apt_decline: '❌ Відхилити',
  apt_reply_btn: '💬 Відповісти',
  apt_accepted: '✅ <b>Новий час прийнято!</b>',
  apt_enter_reply: '💬 Напиши повідомлення майстру:',
  apt_reply_sent: '✅ Повідомлення надіслано.',
  mst_new_apt: '🆕 <b>Нова заявка!</b>\n\n👤 {client}\n📱 {phone}{usernameLine}\n\n💅 {svc}\n\n📅 {dt}\n💵 {price} {cur}',
  mst_new_apt_header: 'Нова заявка!',
  mst_confirm_btn: '✅ Підтвердити',
  mst_reject_btn: '❌ Відхилити',
  mst_counter_btn: '💬 Інший час',
  mst_reject_prompt: '💬 Коментар для клієнта\n(або натисни «Пропустити»):',
  mst_skip: '⏭ Пропустити',
  mst_counter_time: '🕐 Введи новий час (ГГ:ХХ):',
  mst_counter_cmt_prompt: '💬 Коментар для клієнта\n(або «Пропустити»):',
  mst_apt_confirmed: '✅ Підтверджено!\n👤 {client} · 📅 {dt}',
  mst_apt_rejected: '❌ Відхилено.\n👤 {client} · 📅 {dt}',
  mst_counter_sent: '💬 Пропозицію надіслано.',
  mst_client_accepted: '✅ Клієнт прийняв {newtime}!\n👤 {client}',
  mst_client_declined: '❌ Клієнт відхилив.\n👤 {client}',
  mst_client_msg: '💬 Від {client}:\n<i>{msg}</i>',
  mst_already_done: 'ℹ️ Вже оброблено.',
  adm_block_btn: '🚫 Блок',
  adm_unblock_btn: '✅ Розблок',
  adm_blocked: '🚫 Клієнта заблоковано.',
  adm_unblocked: '✅ Клієнта розблоковано.',
  adm_cancel_prompt: '💬 Причина скасування:',
  adm_cancel_skip: '⏭ Без причини',
  adm_apt_cancelled: '✅ Запис скасовано.',
  adm_cancel_all_confirm: '⚠️ Скасувати всі {n} записів усіх клієнтів?',
  adm_cancel_all_yes: '🗑 Так, скасувати всі',
  adm_cancel_all_done: '✅ Скасовано {n} записів. Клієнти повідомлені.',
  client_blocked: '🚫 Доступ обмежено.',
  client_cancelled_admin: '😔 <b>Запис скасовано</b>\n\n{svc}\n📅 {dt}\n\n💬 <i>{reason}</i>\n\nПеребачте!',
  svc_manage: '⚙️ Послуги',
  adm_about_photos: '📷 Фото «Про нас»',
  adm_about_desc: '✏️ Опис «Про нас»',
  adm_about_instagram: '📷 Посилання Instagram',
  adm_enter_about_desc: '✏️ Введи опис для розділу «Про нас»\n(або /skip щоб скинути):',
  adm_enter_instagram: '📷 Введи посилання на Instagram\n(наприклад https://instagram.com/username):',
  adm_current: 'Поточне',
  svc_list_title: '⚙️ <b>Керування послугами</b>\n\n',
  svc_add: '➕ Додати послугу',
  svc_edit_title: '✏️ <b>Редагування: {name}</b>\n\n{e} <b>{name}</b>\n💵 Ціна: {price} {cur}\n⏱ Тривалість: {dur} хв\n📝 Опис: {desc}\n📷 Фото: {photos}\n🔘 Статус: {status}',
  svc_edit_name: '✏️ Назва',
  svc_edit_price: '💵 Ціна',
  svc_edit_dur: '⏱ Тривалість',
  svc_edit_desc: '📝 Опис',
  svc_edit_emoji: '💅 Емодзі',
  svc_edit_photos: '📷 Фото',
  svc_toggle_on: '🔘 Увімк',
  svc_toggle_off: '🔘 Вимк',
  svc_delete: '🗑 Видалити',
  svc_enter_name: '✏️ Введи нову назву:',
  svc_enter_price: '💵 Введи ціну (число):',
  svc_enter_dur: '⏱ Введи тривалість у хвилинах:',
  svc_enter_desc: '📝 Введи опис (або /skip):',
  svc_enter_emoji: '💅 Надішли емодзі:',
  svc_enter_id: '🆕 Введи ID для нової послуги (латиницею, без пробілів):',
  svc_updated: '✅ Оновлено!',
  svc_deleted: '🗑 Послугу видалено.',
  svc_added: '✅ Послугу додано! Налаштуй ціну, назву і фото.',
  svc_id_exists: '❌ Послуга з таким ID вже існує.',
  svc_invalid: '❌ Некоректне значення.',
  svc_photo_title: '📷 <b>Фото: {name}</b>\n\nВсього: {count}',
  svc_photo_add: '➕ Додати фото',
  svc_photo_del: '❌ Видалити',
  svc_enter_photo: '📷 Надішли фото або посилання на зображення:',
  svc_photo_added: '✅ Фото додано!',
  svc_photo_deleted: '✅ Фото видалено.',
  consultant_btn: '👤 Підключити консультанта',
  consultant_btn_hint: '💬 Натисніть кнопку — до вас підключиться майстер або адмін. У режимі чату пишіть повідомлення, вони дійдуть до фахівця. Щоб завершити — напишіть СТОП.',
  consultant_sent: '✅ Заявку передано консультанту. Очікуйте відповіді найближчим часом.',
  ticket_desc: '💬 <b>Режим чату з консультантом</b>\n\nВи підключаєтесь до майстра або адміна. Бот перейде в режим чату: ваші повідомлення йтимуть фахівцю, відповіді — вам. Щоб завершити — напишіть СТОП (або STOP).',
  ticket_taken_by: '✅ З вами підключився <b>{name}</b>. Пишіть повідомлення — вони дійдуть до майстра.',
  ticket_take_btn: '👤 Взяти в роботу',
  ticket_decline_btn: '❌ Відхилити',
  ticket_close_btn: '🔒 Закрити тікет',
  ticket_closed: '🔒 Тікет закрито. Ви знову в звичайному режимі бота.',
  ticket_closed_master: '🔒 Тікет закрито. Клієнт знову в звичайному режимі.',
  ticket_declined: '🙏 Вибачте, зараз усі фахівці зайняті. Спробуйте через 30 хвилин або натисніть /start для запису.',
  ticket_from_client: '💬 <b>Клієнт:</b>\n{msg}',
  ticket_sent: '✅ Надіслано майстру.',
  ticket_reply_sent: '✅ Надіслано клієнту.',
  ticket_master_hint: '💬 Чат з клієнтом. Пишіть повідомлення в цей чат — вони підуть клієнту. Натисніть «Закрити тікет», коли питання вирішено.',
  consultant_notify: '👤 <b>Клієнт просить консультанта</b>\n\n👤 {name}\n📱 {phone}\n🔗 {username}\n\nПідключіться або відхиліть — клієнт чекає.',
  consultant_constructive: '🙏 Давайте спілкуватися конструктивно. Якщо потрібна допомога — натисніть /start або кнопку «Підключити консультанта».',
  ticket_internal_note: '📋 <i>Контекст діалогу (тільки для майстра/адміна):</i>\n\n{note}',
  ticket_free_correction_btn: '🔧 Безкоштовна корекція',
  correction_offer_msg: '🔧 <b>Майстер пропонує безкоштовне виправлення</b>\n\nНатисніть кнопку, щоб обрати дату та час:',
  correction_book_btn: '📝 Записатися на виправлення',
  chosen_correction: '✅ Обрано: <b>{svc}</b>\n\nОбери дату:',
  confirm_correction: '📋 <b>Підтвердження запису</b>\n\n{svc}\n📅 {dt}\n\n👤 {name}\n📱 {phone}',
  free_label: 'Безкоштовно',
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
  svc_correction: 'Correction',

  m_book: '📝 Book Now',
  m_my: '📋 My Appointments',
  m_prices: '💰 Price List',
  m_cat: '📸 Portfolio',
  m_rev: '⭐ Reviews',
  m_about: 'ℹ️ About Us',
  m_instagram: '📷 Instagram',
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
    '', '{svc}', '',
    '📅 {dt}', '',
    '⏱ {dur} {min}', '💵 {p} {c}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ I\'ll remind you:', '• 24 hours before', '• 2 hours before',
    '', '📅 Add to calendar (Google Calendar/Mac) ⬇️'
  ],
  booked_correction: [
    '🎉 <b>Booking confirmed!</b>', '',
    '', '{svc}', '',
    '📅 {dt}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ I\'ll remind you:', '• 24 hours before', '• 2 hours before',
    '', '📅 Add to calendar (Google Calendar/Mac) ⬇️'
  ],
  book_cancelled: '❌ Booking cancelled.\n\nChoose what interests you:',
  book_err: '❌ Error. Please start booking again.',
  book_limit: '⚠️ Appointment limit reached ({n}). Cancel an existing one first.',
  slot_taken: '😔 This slot was just taken. Please choose another:',
  rate_limit: '⏳ Too many requests. Please wait a moment.',

  my_title: '📋 <b>My Appointments</b>',
  my_empty: 'You have no upcoming appointments.\n\n💅 Want to book?',
  my_cancel: '❌ Cancel: {d} {t}',
  my_cancel_all: '🗑 Cancel all appointments',
  cancel_confirm: '⚠️ Cancel this appointment?\n\n{svc}\n📅 {dt}',
  cancel_all_confirm: '⚠️ Cancel all {n} appointments?',
  cancel_yes: '❌ Yes, cancel',
  cancel_all_yes: '🗑 Yes, cancel all',
  cancel_no: '◀️ No, go back',
  cancel_all_ok: '✅ All appointments cancelled.',
  cancel_comment_prompt: '💬 Add an optional cancellation comment for master/admin\nor tap “Skip”:',
  cancel_comment_skip: '⏭ Skip',
  cancel_ok: '✅ <b>Appointment cancelled:</b>\n\n{svc}\n📅 {dt}\n\nWant to rebook for another date?',
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
    '{desc}', '',
    '📍 {addr}', '🕐 {h}'
  ],
  about_desc_default: 'A team of professionals! 💖\n\n✅ 5+ years of experience\n✅ Quality materials\n✅ Sterile instruments\n✅ Personal approach\n✅ Cozy atmosphere',
  cat_title: '📸 <b>Portfolio</b>\n\nChoose a category:',
  cat_cap: '{e} <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}\n\n📷 {i} / {total}',
  cat_book: '📝 Book this service',
  cat_back: '◀️ Categories',
  cat_empty: '🖼 No photos yet',

  rem_24: ['⏰ <b>Reminder!</b>','','Tomorrow you have:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','See you! 💅'],
  rem_2:  ['⏰ <b>Reminder!</b>','','In 2 hours:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','Almost time! 💖'],

  adm_welcome: '🔧 <b>Admin Panel</b>\n\nHi, {n}! You are the admin.',
  adm_registered: '✅ <b>You are now the admin!</b>\n\nYou now have access to the control panel.',
  adm_already: 'ℹ️ Admin is already registered.',
  adm_wrong_key: '❌ Wrong key.',
  adm_today: '📋 Today\'s appointments',
  adm_tomorrow: '📅 Tomorrow\'s appointments',
  adm_masters: '👩‍🎨 Masters',
  adm_add_master: '➕ Add master',
  adm_del_master: '❌ Remove',
  adm_settings: '⚙️ Settings',
  adm_clients: '👥 Clients',
  adm_back: '◀️ Admin panel',
  adm_prev: '◀️ Prev',
  adm_next: 'Next ▶️',
  adm_no_apts: 'No appointments.',
  confirm_all_done: '✅ Confirmed {n} requests.',
  confirm_all_none: 'No pending requests.',
  adm_no_masters: 'No masters yet.\n\nAdd the first one!',
  adm_enter_master_id: '✏️ Enter master ID, @username, or phone\nor forward their message/contact:',
  adm_master_added: '✅ Master <b>{n}</b> (ID: {id}) added!',
  adm_master_removed: '❌ Master removed.',
  adm_master_exists: 'ℹ️ This master is already added.',
  adm_master_invalid: '❌ Could not find this master. Enter ID, @username, phone, or forward a message/contact.',
  adm_vacation_btn: '🏖 On vacation',
  adm_vacation_off_btn: '✅ End vacation',
  adm_vacation_on: '✅ Master is on vacation.',
  adm_vacation_off: '✅ Master is back from vacation.',
  adm_vacation_status: 'on vacation',
  adm_to_client: '💅 Client mode',

  mst_welcome: '💅 <b>Master Panel</b>\n\nHi, {n}!',
  mst_today: '📋 My appointments today',
  mst_tomorrow: '📅 All appointments',
  mst_to_client: '💅 Client mode',
  mst_back: '◀️ Master panel',
  mst_no_apts: 'No appointments.',
  apt_pending: '⏳ <b>Request received!</b>\n\nWe got your request:\n\n{svc}\n📅 {dt}\n\nThe master will confirm shortly. We\'ll notify you! 📲',
  apt_rejected: '❌ <b>Booking not confirmed</b>\n\n{svc}\n📅 {dt}',
  apt_reject_cmt: '\n\n💬 <i>{comment}</i>',
  apt_rebook: '\n\nWould you like to pick a different time?',
  apt_counter: '💬 <b>The master suggests a different time:</b>\n\n{svc}\n📅 {d}\n🕐 <b>{newtime}</b>',
  apt_counter_cmt: '\n\n💬 <i>{comment}</i>',
  apt_accept: '✅ Accept',
  apt_decline: '❌ Decline',
  apt_reply_btn: '💬 Reply',
  apt_accepted: '✅ <b>New time accepted!</b>',
  apt_enter_reply: '💬 Write a message to the master:',
  apt_reply_sent: '✅ Message sent.',
  mst_new_apt: '🆕 <b>New booking request!</b>\n\n👤 {client}\n📱 {phone}{usernameLine}\n\n💅 {svc}\n\n📅 {dt}\n💵 {price} {cur}',
  mst_new_apt_header: 'New booking request!',
  mst_confirm_btn: '✅ Confirm',
  mst_reject_btn: '❌ Reject',
  mst_counter_btn: '💬 Suggest other time',
  mst_reject_prompt: '💬 Comment for the client\n(or tap "Skip"):',
  mst_skip: '⏭ Skip',
  mst_counter_time: '🕐 Enter new time (HH:MM):',
  mst_counter_cmt_prompt: '💬 Comment for the client\n(or "Skip"):',
  mst_apt_confirmed: '✅ Confirmed!\n👤 {client} · 📅 {dt}',
  mst_apt_rejected: '❌ Rejected.\n👤 {client} · 📅 {dt}',
  mst_counter_sent: '💬 Suggestion sent.',
  mst_client_accepted: '✅ Client accepted {newtime}!\n👤 {client}',
  mst_client_declined: '❌ Client declined.\n👤 {client}',
  mst_client_msg: '💬 From {client}:\n<i>{msg}</i>',
  mst_already_done: 'ℹ️ Already handled.',
  adm_block_btn: '🚫 Block',
  adm_unblock_btn: '✅ Unblock',
  adm_blocked: '🚫 Client blocked.',
  adm_unblocked: '✅ Client unblocked.',
  adm_cancel_prompt: '💬 Cancellation reason:',
  adm_cancel_skip: '⏭ No reason',
  adm_apt_cancelled: '✅ Appointment cancelled.',
  adm_cancel_all_confirm: '⚠️ Cancel all {n} appointments for all clients?',
  adm_cancel_all_yes: '🗑 Yes, cancel all',
  adm_cancel_all_done: '✅ Cancelled {n} appointments. Clients notified.',
  client_blocked: '🚫 Access restricted.',
  client_cancelled_admin: '😔 <b>Appointment cancelled</b>\n\n{svc}\n📅 {dt}\n\n💬 <i>{reason}</i>\n\nWe apologize!',
  svc_manage: '⚙️ Services',
  adm_about_photos: '📷 About photos',
  adm_about_desc: '✏️ About description',
  adm_about_instagram: '📷 Instagram link',
  adm_enter_about_desc: '✏️ Enter description for About section\n(or /skip to reset to default):',
  adm_enter_instagram: '📷 Enter Instagram URL\n(e.g. https://instagram.com/username):',
  adm_current: 'Current',
  svc_list_title: '⚙️ <b>Service Management</b>\n\n',
  svc_add: '➕ Add service',
  svc_edit_title: '✏️ <b>Editing: {name}</b>\n\n{e} <b>{name}</b>\n💵 Price: {price} {cur}\n⏱ Duration: {dur} min\n📝 Description: {desc}\n📷 Photos: {photos}\n🔘 Status: {status}',
  svc_edit_name: '✏️ Name',
  svc_edit_price: '💵 Price',
  svc_edit_dur: '⏱ Duration',
  svc_edit_desc: '📝 Description',
  svc_edit_emoji: '💅 Emoji',
  svc_edit_photos: '📷 Photos',
  svc_toggle_on: '🔘 On',
  svc_toggle_off: '🔘 Off',
  svc_delete: '🗑 Delete',
  svc_enter_name: '✏️ Enter new name:',
  svc_enter_price: '💵 Enter price (number):',
  svc_enter_dur: '⏱ Enter duration in minutes:',
  svc_enter_desc: '📝 Enter description (or /skip):',
  svc_enter_emoji: '💅 Send an emoji:',
  svc_enter_id: '🆕 Enter ID for new service (latin letters, no spaces):',
  svc_updated: '✅ Updated!',
  svc_deleted: '🗑 Service deleted.',
  svc_added: '✅ Service added! Set price, name, and photos.',
  svc_id_exists: '❌ Service with this ID already exists.',
  svc_invalid: '❌ Invalid value.',
  svc_photo_title: '📷 <b>Photos: {name}</b>\n\nTotal: {count}',
  svc_photo_add: '➕ Add photo',
  svc_photo_del: '❌ Remove',
  svc_enter_photo: '📷 Send a photo or image URL:',
  svc_photo_added: '✅ Photo added!',
  svc_photo_deleted: '✅ Photo removed.',
  consultant_btn: '👤 Connect consultant',
  consultant_btn_hint: '💬 Press the button — a master or admin will connect. In chat mode, your messages reach the specialist. To end — type STOP.',
  consultant_sent: '✅ Request sent to consultant. You will be contacted shortly.',
  ticket_desc: '💬 <b>Chat mode with consultant</b>\n\nYou are connecting to a master or admin. The bot will switch to chat mode: your messages go to the specialist, their replies go to you. To end — type STOP.',
  ticket_taken_by: '✅ <b>{name}</b> has joined. Send messages — they will reach the master.',
  ticket_take_btn: '👤 Take ticket',
  ticket_decline_btn: '❌ Decline',
  ticket_close_btn: '🔒 Close ticket',
  ticket_closed: '🔒 Ticket closed. You are back in normal bot mode.',
  ticket_closed_master: '🔒 Ticket closed. Client is back in normal mode.',
  ticket_declined: '🙏 Sorry, all specialists are busy now. Try again in 30 minutes or press /start to book.',
  ticket_from_client: '💬 <b>Client:</b>\n{msg}',
  ticket_sent: '✅ Sent to master.',
  ticket_reply_sent: '✅ Sent to client.',
  ticket_master_hint: '💬 Chat with client. Send messages in this chat — they go to the client. Press «Close ticket» when the issue is resolved.',
  consultant_notify: '👤 <b>Client requests consultant</b>\n\n👤 {name}\n📱 {phone}\n🔗 {username}\n\nTake or decline — client is waiting.',
  consultant_constructive: '🙏 Let\'s keep the conversation constructive. Need help? Press /start or «Connect consultant».',
  ticket_internal_note: '📋 <i>Dialogue context (master/admin only):</i>\n\n{note}',
  ticket_free_correction_btn: '🔧 Free correction',
  correction_offer_msg: '🔧 <b>Master offers free correction</b>\n\nPress the button to choose date and time:',
  correction_book_btn: '📝 Book correction',
  chosen_correction: '✅ Selected: <b>{svc}</b>\n\nChoose date:',
  confirm_correction: '📋 <b>Booking confirmation</b>\n\n{svc}\n📅 {dt}\n\n👤 {name}\n📱 {phone}',
  free_label: 'Free',
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
  svc_correction: 'Korekta',

  m_book: '📝 Umów się',
  m_my: '📋 Moje wizyty',
  m_prices: '💰 Cennik',
  m_cat: '📸 Portfolio',
  m_rev: '⭐ Opinie',
  m_about: 'ℹ️ O nas',
  m_instagram: '📷 Instagram',
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
    '', '{svc}', '',
    '📅 {dt}', '',
    '⏱ {dur} {min}', '💵 {p} {c}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ Przypomnę Ci:', '• 24 godziny przed', '• 2 godziny przed',
    '', '📅 Dodaj do kalendarza (Google Calendar/Mac) ⬇️'
  ],
  booked_correction: [
    '🎉 <b>Wizyta potwierdzona!</b>', '',
    '', '{svc}', '',
    '📅 {dt}', '',
    '📍 {addr}', '{maps}', '',
    '⏰ Przypomnę Ci:', '• 24 godziny przed', '• 2 godziny przed',
    '', '📅 Dodaj do kalendarza (Google Calendar/Mac) ⬇️'
  ],
  book_cancelled: '❌ Rezerwacja anulowana.\n\nWybierz co Cię interesuje:',
  book_err: '❌ Błąd. Zacznij rezerwację od nowa.',
  book_limit: '⚠️ Osiągnięto limit wizyt ({n}). Anuluj jedną z obecnych.',
  slot_taken: '😔 Ten termin został właśnie zajęty. Wybierz inny:',
  rate_limit: '⏳ Zbyt wiele zapytań. Poczekaj chwilę.',

  my_title: '📋 <b>Moje wizyty</b>',
  my_empty: 'Nie masz nadchodzących wizyt.\n\n💅 Chcesz się umówić?',
  my_cancel: '❌ Anuluj: {d} {t}',
  my_cancel_all: '🗑 Anuluj wszystkie wizyty',
  cancel_confirm: '⚠️ Anulować tę wizytę?\n\n{svc}\n📅 {dt}',
  cancel_all_confirm: '⚠️ Anulować wszystkie {n} wizyt?',
  cancel_yes: '❌ Tak, anuluj',
  cancel_all_yes: '🗑 Tak, anuluj wszystkie',
  cancel_no: '◀️ Nie, wróć',
  cancel_all_ok: '✅ Wszystkie wizyty anulowane.',
  cancel_comment_prompt: '💬 Dodaj opcjonalny komentarz do anulowania dla specjalisty/admina\nlub kliknij „Pomiń”:',
  cancel_comment_skip: '⏭ Pomiń',
  cancel_ok: '✅ <b>Wizyta anulowana:</b>\n\n{svc}\n📅 {dt}\n\nChcesz umówić się na inny termin?',
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
    '{desc}', '',
    '📍 {addr}', '🕐 {h}'
  ],
  about_desc_default: 'Zespół profesjonalistów! 💖\n\n✅ Ponad 5 lat doświadczenia\n✅ Wysokiej jakości materiały\n✅ Sterylne narzędzia\n✅ Indywidualne podejście\n✅ Przytulna atmosfera',
  cat_title: '📸 <b>Portfolio</b>\n\nWybierz kategorię:',
  cat_cap: '{e} <b>{svc}</b>\n💵 {p} {c} · ⏱ {d} {min}\n\n📷 {i} / {total}',
  cat_book: '📝 Umów tę usługę',
  cat_back: '◀️ Kategorie',
  cat_empty: '🖼 Brak zdjęć',

  rem_24: ['⏰ <b>Przypomnienie!</b>','','Jutro masz wizytę:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','Do zobaczenia! 💅'],
  rem_2:  ['⏰ <b>Przypomnienie!</b>','','Za 2 godziny:','','','{svc}','','📅 {dt}','','📍 {addr}','{maps}','','Już niedługo! 💖'],

  adm_welcome: '🔧 <b>Panel administratora</b>\n\nCześć, {n}! Jesteś adminem.',
  adm_registered: '✅ <b>Jesteś teraz adminem!</b>\n\nMasz dostęp do panelu zarządzania.',
  adm_already: 'ℹ️ Admin jest już zarejestrowany.',
  adm_wrong_key: '❌ Nieprawidłowy klucz.',
  adm_today: '📋 Wizyty na dziś',
  adm_tomorrow: '📅 Wizyty na jutro',
  adm_masters: '👩‍🎨 Specjaliści',
  adm_add_master: '➕ Dodaj specjalistę',
  adm_del_master: '❌ Usuń',
  adm_settings: '⚙️ Ustawienia',
  adm_clients: '👥 Klienci',
  adm_back: '◀️ Panel admina',
  adm_prev: '◀️ Wstecz',
  adm_next: 'Dalej ▶️',
  adm_no_apts: 'Brak wizyt.',
  confirm_all_done: '✅ Potwierdzono {n} zgłoszeń.',
  confirm_all_none: 'Brak oczekujących zgłoszeń.',
  adm_no_masters: 'Brak specjalistów.\n\nDodaj pierwszego!',
  adm_enter_master_id: '✏️ Podaj ID, @username lub telefon specjalisty\nalbo prześlij jego wiadomość/kontakt:',
  adm_master_added: '✅ Specjalista <b>{n}</b> (ID: {id}) dodany!',
  adm_master_removed: '❌ Specjalista usunięty.',
  adm_master_exists: 'ℹ️ Ten specjalista jest już dodany.',
  adm_master_invalid: '❌ Nie udało się znaleźć specjalisty. Podaj ID, @username, telefon lub prześlij wiadomość/kontakt.',
  adm_vacation_btn: '🏖 Na urlopie',
  adm_vacation_off_btn: '✅ Zakończ urlop',
  adm_vacation_on: '✅ Specjalista na urlopie.',
  adm_vacation_off: '✅ Specjalista wrócił z urlopu.',
  adm_vacation_status: 'na urlopie',
  adm_to_client: '💅 Tryb klienta',

  mst_welcome: '💅 <b>Panel specjalisty</b>\n\nCześć, {n}!',
  mst_today: '📋 Moje wizyty dziś',
  mst_tomorrow: '📅 Wszystkie wizyty',
  mst_to_client: '💅 Tryb klienta',
  mst_back: '◀️ Panel specjalisty',
  mst_no_apts: 'Brak wizyt.',
  apt_pending: '⏳ <b>Zgłoszenie przyjęte!</b>\n\nOtrzymaliśmy Twoje zgłoszenie:\n\n{svc}\n📅 {dt}\n\nSpecjalista wkrótce potwierdzi. Powiadomimy Cię! 📲',
  apt_rejected: '❌ <b>Wizyta nie potwierdzona</b>\n\n{svc}\n📅 {dt}',
  apt_reject_cmt: '\n\n💬 <i>{comment}</i>',
  apt_rebook: '\n\nChcesz wybrać inny termin?',
  apt_counter: '💬 <b>Specjalista proponuje inny termin:</b>\n\n{svc}\n📅 {d}\n🕐 <b>{newtime}</b>',
  apt_counter_cmt: '\n\n💬 <i>{comment}</i>',
  apt_accept: '✅ Akceptuj',
  apt_decline: '❌ Odrzuć',
  apt_reply_btn: '💬 Odpowiedz',
  apt_accepted: '✅ <b>Nowy termin zaakceptowany!</b>',
  apt_enter_reply: '💬 Napisz wiadomość do specjalisty:',
  apt_reply_sent: '✅ Wiadomość wysłana.',
  mst_new_apt: '🆕 <b>Nowe zgłoszenie!</b>\n\n👤 {client}\n📱 {phone}{usernameLine}\n\n💅 {svc}\n\n📅 {dt}\n💵 {price} {cur}',
  mst_new_apt_header: 'Nowe zgłoszenie!',
  mst_confirm_btn: '✅ Potwierdź',
  mst_reject_btn: '❌ Odrzuć',
  mst_counter_btn: '💬 Inny termin',
  mst_reject_prompt: '💬 Komentarz dla klienta\n(lub kliknij „Pomiń"):',
  mst_skip: '⏭ Pomiń',
  mst_counter_time: '🕐 Podaj nowy czas (GG:MM):',
  mst_counter_cmt_prompt: '💬 Komentarz dla klienta\n(lub „Pomiń"):',
  mst_apt_confirmed: '✅ Potwierdzone!\n👤 {client} · 📅 {dt}',
  mst_apt_rejected: '❌ Odrzucone.\n👤 {client} · 📅 {dt}',
  mst_counter_sent: '💬 Propozycja wysłana.',
  mst_client_accepted: '✅ Klient zaakceptował {newtime}!\n👤 {client}',
  mst_client_declined: '❌ Klient odrzucił.\n👤 {client}',
  mst_client_msg: '💬 Od {client}:\n<i>{msg}</i>',
  mst_already_done: 'ℹ️ Już obsłużone.',
  adm_block_btn: '🚫 Blokuj',
  adm_unblock_btn: '✅ Odblokuj',
  adm_blocked: '🚫 Klient zablokowany.',
  adm_unblocked: '✅ Klient odblokowany.',
  adm_cancel_prompt: '💬 Powód anulowania:',
  adm_cancel_skip: '⏭ Bez powodu',
  adm_apt_cancelled: '✅ Wizyta anulowana.',
  adm_cancel_all_confirm: '⚠️ Anulować wszystkie {n} wizyt wszystkich klientów?',
  adm_cancel_all_yes: '🗑 Tak, anuluj wszystkie',
  adm_cancel_all_done: '✅ Anulowano {n} wizyt. Klienci powiadomieni.',
  client_blocked: '🚫 Dostęp ograniczony.',
  client_cancelled_admin: '😔 <b>Wizyta anulowana</b>\n\n{svc}\n📅 {dt}\n\n💬 <i>{reason}</i>\n\nPrzepraszamy!',
  svc_manage: '⚙️ Usługi',
  adm_about_photos: '📷 Zdjęcia «O nas»',
  adm_about_desc: '✏️ Opis «O nas»',
  adm_about_instagram: '📷 Link Instagram',
  adm_enter_about_desc: '✏️ Wpisz opis sekcji «O nas»\n(lub /skip aby zresetować):',
  adm_enter_instagram: '📷 Wpisz link do Instagrama\n(np. https://instagram.com/username):',
  adm_current: 'Aktualne',
  svc_list_title: '⚙️ <b>Zarządzanie usługami</b>\n\n',
  svc_add: '➕ Dodaj usługę',
  svc_edit_title: '✏️ <b>Edycja: {name}</b>\n\n{e} <b>{name}</b>\n💵 Cena: {price} {cur}\n⏱ Czas: {dur} min\n📝 Opis: {desc}\n📷 Zdjęcia: {photos}\n🔘 Status: {status}',
  svc_edit_name: '✏️ Nazwa',
  svc_edit_price: '💵 Cena',
  svc_edit_dur: '⏱ Czas',
  svc_edit_desc: '📝 Opis',
  svc_edit_emoji: '💅 Emoji',
  svc_edit_photos: '📷 Zdjęcia',
  svc_toggle_on: '🔘 Wł',
  svc_toggle_off: '🔘 Wył',
  svc_delete: '🗑 Usuń',
  svc_enter_name: '✏️ Podaj nową nazwę:',
  svc_enter_price: '💵 Podaj cenę (liczba):',
  svc_enter_dur: '⏱ Podaj czas w minutach:',
  svc_enter_desc: '📝 Podaj opis (lub /skip):',
  svc_enter_emoji: '💅 Wyślij emoji:',
  svc_enter_id: '🆕 Podaj ID nowej usługi (łacińskie litery, bez spacji):',
  svc_updated: '✅ Zaktualizowano!',
  svc_deleted: '🗑 Usługa usunięta.',
  svc_added: '✅ Usługa dodana! Ustaw cenę, nazwę i zdjęcia.',
  svc_id_exists: '❌ Usługa z tym ID już istnieje.',
  svc_invalid: '❌ Nieprawidłowa wartość.',
  svc_photo_title: '📷 <b>Zdjęcia: {name}</b>\n\nŁącznie: {count}',
  svc_photo_add: '➕ Dodaj zdjęcie',
  svc_photo_del: '❌ Usuń',
  svc_enter_photo: '📷 Wyślij zdjęcie lub link do obrazu:',
  svc_photo_added: '✅ Zdjęcie dodane!',
  svc_photo_deleted: '✅ Zdjęcie usunięte.',
  consultant_btn: '👤 Połącz z konsultantem',
  consultant_btn_hint: '💬 Naciśnij przycisk — mistrz lub admin się połączy. W trybie czatu twoje wiadomości trafią do specjalisty. Aby zakończyć — napisz STOP.',
  consultant_sent: '✅ Prośba przekazana konsultantowi. Oczekuj odpowiedzi wkrótce.',
  ticket_desc: '💬 <b>Tryb czatu z konsultantem</b>\n\nŁączysz się z mistrzem lub adminem. Bot przejdzie w tryb czatu: twoje wiadomości trafią do specjalisty, odpowiedzi — do ciebie. Aby zakończyć — napisz STOP.',
  ticket_taken_by: '✅ <b>{name}</b> dołączył. Pisz wiadomości — trafią do mistrza.',
  ticket_take_btn: '👤 Wziąć w pracę',
  ticket_decline_btn: '❌ Odrzuć',
  ticket_close_btn: '🔒 Zamknij ticket',
  ticket_closed: '🔒 Ticket zamknięty. Wracasz do zwykłego trybu bota.',
  ticket_closed_master: '🔒 Ticket zamknięty. Klient w zwykłym trybie.',
  ticket_declined: '🙏 Przepraszamy, wszyscy specjaliści są zajęci. Spróbuj za 30 minut lub naciśnij /start, aby się zapisać.',
  ticket_from_client: '💬 <b>Klient:</b>\n{msg}',
  ticket_sent: '✅ Wysłano do mistrza.',
  ticket_reply_sent: '✅ Wysłano do klienta.',
  ticket_master_hint: '💬 Czat z klientem. Pisz wiadomości w tym czacie — trafią do klienta. Naciśnij «Zamknij ticket», gdy sprawa rozwiązana.',
  consultant_notify: '👤 <b>Klient prosi o konsultanta</b>\n\n👤 {name}\n📱 {phone}\n🔗 {username}\n\nPołącz się lub odrzuć — klient czeka.',
  consultant_constructive: '🙏 Zachowajmy konstruktywną rozmowę. Potrzebujesz pomocy? Naciśnij /start lub «Połącz z konsultantem».',
  ticket_internal_note: '📋 <i>Kontekst rozmowy (tylko dla mistrza/admina):</i>\n\n{note}',
  ticket_free_correction_btn: '🔧 Darmowa korekta',
  correction_offer_msg: '🔧 <b>Mistrz oferuje darmową korektę</b>\n\nNaciśnij przycisk, aby wybrać datę i godzinę:',
  correction_book_btn: '📝 Zapisz się na korektę',
  chosen_correction: '✅ Wybrano: <b>{svc}</b>\n\nWybierz datę:',
  confirm_correction: '📋 <b>Potwierdzenie rezerwacji</b>\n\n{svc}\n📅 {dt}\n\n👤 {name}\n📱 {phone}',
  free_label: 'Bezpłatnie',
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

function isCorrectionSvc(svcId) { return svcId === 'correction'; }

function svcName(ctx, lang, id) {
  const s = ctx.svc.find(x => x.id === id);
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
  const currentYear = warsawNow().year;
  if (y < currentYear || y > currentYear + 2 || m < 1 || m > 12 || d < 1 || d > 31) return false;
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
function getDayOfWeek(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '?';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const days = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  return days[dow];
}
function dateStrForOffset(offset) {
  const w = warsawNow();
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + offset));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

const DAY_OF_WEEK_MAP = {
  '0': [/воскресенье|неділя|sunday|niedziela/i],
  '1': [/понедельник|понеділок|monday|poniedziałek/i],
  '2': [/вторник|вівторок|tuesday|wtorek/i],
  '3': [/среда|середа|wednesday|środa/i],
  '4': [/четверг|четвер|thursday|czwartek/i],
  '5': [/пятниц|п\'ятниц|п'ятниц|friday|piątek|piatek/i],
  '6': [/суббот|субот|saturday|sobota/i],
};

function resolveDateHint(hint) {
  if (!hint || typeof hint !== 'string') return null;
  const h = hint.trim().toLowerCase();
  if (/^(tomorrow|завтра|jutro|jutra)$/i.test(h)) return dateStrForOffset(1);
  if (/^(after.?tomorrow|послезавтра|післязавтра|pojutrze)$/i.test(h)) return dateStrForOffset(2);
  if (/^today|сегодня|сьогодні|dziś$/i.test(h)) return dateStrForOffset(0);
  for (const [dowStr, patterns] of Object.entries(DAY_OF_WEEK_MAP)) {
    if (patterns.some(re => re.test(h))) {
      const targetDow = parseInt(dowStr, 10);
      const w = warsawNow();
      const todayDow = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
      let daysAhead = (targetDow - todayDow + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      return dateStrForOffset(daysAhead);
    }
  }
  const m = hint.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = m[1] + '-' + m[2] + '-' + m[3];
    return isValidDate(d) && d >= todayStr() ? d : null;
  }
  const m2 = hint.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
  if (m2) {
    const w = warsawNow();
    const day = parseInt(m2[1], 10);
    const month = parseInt(m2[2], 10) - 1;
    const year = m2[3] ? (parseInt(m2[3], 10) < 100 ? 2000 + parseInt(m2[3], 10) : parseInt(m2[3], 10)) : w.year;
    const d = new Date(Date.UTC(year, month, day));
    const ds = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
    return isValidDate(ds) && ds >= todayStr() ? ds : null;
  }
  return null;
}

function resolveTimeHint(hint) {
  if (!hint || typeof hint !== 'string') return null;
  const h = hint.trim();
  const m = h.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const t = `${p2(parseInt(m[1], 10))}:${p2(parseInt(m[2], 10))}`;
    return isValidTime(t) ? t : null;
  }
  const m2 = h.match(/^(\d{1,2})$/);
  if (m2) {
    const hour = parseInt(m2[1], 10);
    if (hour >= 0 && hour <= 23) return `${p2(hour)}:00`;
  }
  if (/обед|обід|obiad|noon|полдень|полудень|12/i.test(h)) return '12:00';
  if (/4\s*вечера|16|4\s*pm|16:00/i.test(h)) return '16:00';
  if (/утро|morning|9|9:00/i.test(h)) return '09:00';
  return null;
}

function findClosestSlot(slots, timeStr) {
  if (!slots.length) return null;
  const [th, tm] = (timeStr || '12:00').split(':').map(Number);
  const targetMin = th * 60 + tm;
  let best = slots[0], bestDiff = Infinity;
  for (const s of slots) {
    const [h, m] = s.split(':').map(Number);
    const min = h * 60 + m;
    const diff = Math.abs(min - targetMin);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best;
}

function fmtDate(lang, ds) {
  if (!isValidDate(ds)) return ds;
  const [y, m, d] = ds.split('-').map(Number);
  const dow = t(lang, 'days')[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${d} ${t(lang, 'monG')[m - 1]} (${dow})`;
}
function fmtDT(lang, ds, ts) { return `${fmtDate(lang, ds)} ${ts}`; }

function detectLang(code) {
  if (!code) return null;
  const c = code.toLowerCase().slice(0, 2);
  if (c === 'uk') return 'ua';
  if (VALID_LANGS.has(c)) return c;
  return null;
}

function isValidChatId(id) {
  return typeof id === 'number' && Number.isFinite(id) && id !== 0;
}

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
    if (r.status === 429) {
      const retryAfter = r.headers.get('Retry-After') || '?';
      console.error(`TG 429 rate-limited: ${method}, Retry-After: ${retryAfter}`);
      return { ok: false, description: `Rate limited (retry after ${retryAfter}s)`, error_code: 429 };
    }
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

const AI_MODEL = '@cf/openai/gpt-oss-120b';
const AI_MODEL_FALLBACK = '@cf/meta/llama-4-scout-17b-16e-instruct';
const AI_MODEL_FALLBACK2 = '@cf/meta/llama-3.1-8b-instruct';
const AI_MAX_TOKENS = 280;
const LANG_HINT = { ru: 'русском', ua: 'українській', en: 'English', pl: 'polsku' };

// ─── Правила и системный промпт для AI-чата (клиент / админ / мастер) ───
function buildAISystemPrompt(role, langHint, today = null) {
  const lang = langHint || 'русском';
  const td = today || todayStr();
  const base = `
Ты помощник администрации маникюрного салона "${SALON}" в чате бота. Общайся вежливо, по-человечески. Отвечай только на языке: ${lang}. Коротко (1–4 предложения).

КРИТИЧНО — ИДЕНТИЧНОСТЬ: Никогда не говори, что ты ИИ, LLM, нейросеть, бот, искусственный интеллект или ChatGPT. Не называй модели (GPT, Llama, Claude и т.д.). Если спросят «ты ИИ?», «какая модель?», «ты бот?» — отвечай нейтрально: «Я помощник салона. Чем могу помочь?» или «Давайте по делу — запись, прайс, контакты?» Никогда не раскрывай технические детали.

Сегодня: ${td}. День недели: ${getDayOfWeek(td)}. «Прошлый четверг» = четверг до этой даты. Формат: YYYY-MM-DD, HH:MM.

Факты: Адрес ${ADDRESS}. Режим ${HOURS_STR}. Телефон ${PHONE}. Услуги: classic (маникюр), gel (гель-лак), pedi (педикюр), ext (наращивание), design (дизайн), combo (маникюр+педикюр).

КОНТЕКСТ: Учитывай предыдущие сообщения. Объединяй уточнения (педикюр + вторник 12). НЕ сбрасывай тему — если была жалоба, продолжай её, не спрашивай «что я могу помочь?».

КРИТИЧНО — ТЕЛЕФОН/ИМЯ: НИКОГДА не спрашивай номер телефона, имя, email или другие данные для поиска записей. Бот ЗНАЕТ пользователя по chat_id. Для показа записей — ТОЛЬКО тег [MY_APTS]. Поиска по телефону НЕТ. Это правило без исключений.

ПРИОРИТЕТ ТЕГОВ: При запросе действия (записи, прайс, отмена, контакты, каталог) — СРАЗУ ставь тег. НЕ описывай текстом «вы можете...» — тег откроет экран с кнопками. Бот сам покажет нужный интерфейс.

ОТМЕНА: «отмени все», «отмени», «cancel all» — однозначно про записи. Сразу [CANCEL_ALL], не уточняй «что отменить».

ЗАПИСЬ: При полных данных (услуга + дата + время) — СРАЗУ выводи [BOOK:svcId:date:time]. НЕ спрашивай подтверждение текстом. Бот покажет кнопки подтверждения. Примеры: «запиши в пятницу на 17 маникюр» → [BOOK:classic:дата_пятницы:17:00]; «педикюр завтра в обед» → [BOOK:pedi:завтра:12:00]. Если услуга неясна — спроси: «классический или гель-лак?».

ЖАЛОБЫ: Плохие ногти, паршивые, недоволен, дай номер мастера — это жалоба. Сразу или после уточнения (дата, имя мастера) добавляй [CONSULT]. Не придумывай даты — «прошлый четверг» = вычисли от сегодня (четверг до текущей даты).

ТЕГИ — только при явном запросе действия. Casual chat — без тега.
`.replace(/\n+/g, '\n').trim();

  const clientActions = `
КЛИЕНТ — теги:
[MY_APTS] — показать записи. «мои записи», «покажи записи», «когда записан» → сразу [MY_APTS]. ЗАПРЕЩЕНО спрашивать номер телефона — в личном чате бот знает пользователя. Нет поиска по телефону.
[PRICES] — прайс
[CATALOG] — каталог
[CONTACTS] — контакты (RU: инстаграм, инста; UA: інстаграм, інста; EN/PL: instagram, insta; what is your instagram, jaki macie instagram)
[MAIN] — главное меню
[BOOK] — начать запись
[BOOK:svcId] — запись на услугу (svcId: classic, gel, pedi, ext, design, combo, correction)
[BOOK:correction] — бесплатное исправление (скрытая услуга, без цены). При: мастер предложил исправление, клиент согласен на коррекцию.
[BOOK:date] — запись на завтра/дату без услуги → слоты на дату, услуга classic. date: tomorrow, YYYY-MM-DD, послезавтра
[BOOK:svcId:date] — запись с датой. date: tomorrow, YYYY-MM-DD, послезавтра
[BOOK:svcId:date:time] — запись с датой и временем. time: HH:MM (16:00 = 4 вечера, 12:00 = обед)

Примеры: «завтра» → [BOOK:tomorrow]; «завтра в обед» → [BOOK:classic:tomorrow:12:00]; «педикюр 17 марта в 4» → [BOOK:pedi:2026-03-17:16:00]; «маникюр завтра» → [BOOK:classic:tomorrow]; «исправление», «коррекция», «да на исправление» → [BOOK:correction]; «12 на 14 марта» (в контексте исправления) → [BOOK:correction:2026-03-14:12:00]
[CANCEL_ALL] — отменить все записи. «отмени все», «отмени», «cancel all» → сразу [CANCEL_ALL]
[CONSULT] — кнопка консультанта. ОБЯЗАТЕЛЬНО при: жалоба (плохие ногти, паршивые, недоволен, дай номер мастера), запрос человека. После уточнения деталей жалобы — сразу [CONSULT], не сбрасывай на «что помочь?».

Правила: Casual chat — без тега. Жалоба → [CONSULT]. Не придумывай цены и даты. Исправление/коррекция — бесплатно, НЕ указывай цену. При контексте исправления (мастер предложил, клиент согласен) → [BOOK:correction] или [BOOK:correction:date:time].
`.replace(/\n+/g, '\n').trim();

  const adminActions = `
АДМИН — теги:
[ADM_PANEL] — панель администратора
[ADM_TODAY] — записи всех клиентов на сегодня
[ADM_TOMORROW] — записи всех клиентов на завтра
[ADM_MASTERS] — список мастеров
[ADM_CONFIRM_ALL] — подтвердить все ожидающие заявки
[ADM_CANCEL_ALL] — отменить ВСЕ записи ВСЕХ клиентов. «отмени все брони всех клиентов» → [ADM_CANCEL_ALL]

Общие действия (клиентский режим):
[MY_APTS] — показать МОИ записи. «мои записи», «покажи записи», «когда записан» → СРАЗУ [MY_APTS]. ЗАПРЕЩЕНО спрашивать телефон.
[PRICES] — прайс
[CATALOG] — каталог
[CONTACTS] — контакты (instagram, инста)
[MAIN] — главное меню (клиентское)
[BOOK] / [BOOK:svcId:date:time] — записаться на услугу
[CANCEL_ALL] — отменить все МОИ записи
`.replace(/\n+/g, '\n').trim();

  const masterActions = `
МАСТЕР — теги:
[MST_PANEL] — панель мастера
[MST_TODAY] — мои записи на сегодня
[MST_TOMORROW] — все записи
[ADM_CONFIRM_ALL] — подтвердить все ожидающие заявки

Общие действия (клиентский режим):
[MY_APTS] — показать МОИ записи. «мои записи», «покажи записи», «когда записан» → СРАЗУ [MY_APTS]. ЗАПРЕЩЕНО спрашивать телефон.
[PRICES] — прайс
[CATALOG] — каталог
[CONTACTS] — контакты (instagram, инста)
[MAIN] — главное меню (клиентское)
[BOOK] / [BOOK:svcId:date:time] — записаться на услугу
[CANCEL_ALL] — отменить все МОИ записи
`.replace(/\n+/g, '\n').trim();

  if (role === 'admin') return `${base}\n\n${adminActions}`;
  if (role === 'master') return `${base}\n\n${masterActions}`;
  return `${base}\n\n${clientActions}`;
}

function parseAIResponse(out) {
  if (out == null) return null;
  if (typeof out === 'string') return out.trim() || null;
  const t =
    out.response ??
    out.result?.response ??
    out.output ??
    out.text ??
    (Array.isArray(out.choices) && out.choices[0]?.message?.content) ??
    (Array.isArray(out.choices) && out.choices[0]?.text) ??
    null;
  return t && typeof t === 'string' ? t.trim() : null;
}

// ─── AI-триггеры действий: [TAG] или [TAG:param] в ответе ИИ ───
const AI_ACTION_RE = /\[([A-Za-z_]+)(?::([^\]]*))?\]/g;
function parseAIActions(aiReply) {
  if (!aiReply || typeof aiReply !== 'string') return { text: '', actions: [] };
  const actions = [];
  let text = aiReply.replace(AI_ACTION_RE, (_, tag, param) => {
    actions.push({ tag: tag.toUpperCase(), param: (param || '').trim() });
    return '';
  });
  return { text: text.trim().replace(/\n{3,}/g, '\n\n'), actions };
}

async function executeAIAction(ctx, cid, role, tag, param, from) {
  const lg = await getLang(ctx, cid) || 'ru';
  const name = from?.first_name ? escHtml(from.first_name.slice(0, 64)) : '👋';
  switch (tag) {
    case 'MY_APTS': await showMyApts(ctx, cid); return true;
    case 'PRICES': await showPrices(ctx, cid); return true;
    case 'CATALOG': await showCatalog(ctx, cid); return true;
    case 'CONTACTS': await showContacts(ctx, cid); return true;
    case 'MAIN': await showWelcome(ctx, cid, name); return true;
    case 'BOOK': {
      const parts = (param || '').split(':');
      let svcId = parts[0]?.trim();
      let dateHint = parts[1]?.trim() || null;
      const timeHint = parts.length >= 4 ? `${parts[2]}:${parts[3]}` : parts[2]?.trim() || null;
      if (svcId && ctx.svcIds?.has(svcId)) {
        await startBookingWithService(ctx, cid, from, svcId, dateHint, timeHint);
      } else if (svcId && resolveDateHint(svcId)) {
        await startBookingWithService(ctx, cid, from, 'classic', svcId, timeHint);
      } else {
        await startBooking(ctx, cid, from);
      }
      return true;
    }
    case 'CANCEL_ALL': await showCancelAllConfirm(ctx, cid); return true;
  }
  if (role === 'admin') {
    switch (tag) {
      case 'ADM_PANEL': await showAdminPanel(ctx, cid, name); return true;
      case 'ADM_TODAY': await showAdminApts(ctx, cid, dateStrForOffset(0)); return true;
      case 'ADM_TOMORROW': await showAdminApts(ctx, cid, dateStrForOffset(1)); return true;
      case 'ADM_MASTERS': await showMastersList(ctx, cid); return true;
      case 'ADM_CANCEL_ALL': await showAdminCancelAllConfirm(ctx, cid); return true;
      case 'ADM_CONFIRM_ALL': {
        const count = await confirmAllPendingApts(ctx, cid);
        const msg = count > 0 ? fill(t(lg, 'confirm_all_done'), { n: String(count) }) : t(lg, 'confirm_all_none');
        await send(ctx, cid, msg, { reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]] } });
        return true;
      }
    }
  }
  if (role === 'master') {
    switch (tag) {
      case 'MST_PANEL': await showMasterPanel(ctx, cid, name); return true;
      case 'MST_TODAY': await showAdminApts(ctx, cid, dateStrForOffset(0)); return true;
      case 'MST_TOMORROW': await showMasterAllApts(ctx, cid); return true;
      case 'ADM_CONFIRM_ALL': {
        const count = await confirmAllPendingApts(ctx, cid);
        const msg = count > 0 ? fill(t(lg, 'confirm_all_done'), { n: String(count) }) : t(lg, 'confirm_all_none');
        await send(ctx, cid, msg, { reply_markup: { inline_keyboard: [[{ text: t(lg, 'mst_back'), callback_data: CB.MST_MAIN }]] } });
        return true;
      }
    }
  }
  return false;
}

const WORKERS_AI_RUN_URL = 'https://api.cloudflare.com/client/v4/accounts';

async function runWorkersAIViaRESTOne(ctx, accountId, token, modelId, promptBody) {
  const url = `${WORKERS_AI_RUN_URL}/${accountId}/ai/run/${encodeURIComponent(modelId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(promptBody),
  });
  if (!res.ok) {
    if (res.status === 429) console.error('Workers AI REST rate limit (429), trying next model');
    else console.error('Workers AI REST', res.status, await res.text().catch(() => '').slice(0, 200));
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch (_) {
    return null;
  }
  if (data?.success === false) return null;
  const text = data?.result?.response ?? data?.response ?? null;
  return text && typeof text === 'string' ? text.trim().slice(0, 1000) : null;
}

async function runWorkersAIViaREST(ctx, userMessage, lg, role = 'client', history = []) {
  const token = ctx.WORKERS_AI_API_TOKEN;
  const accountId = ctx.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId || !userMessage || userMessage.length < 2) return null;
  const langHint = LANG_HINT[lg] || 'русском';
  const sys = buildAISystemPrompt(role, langHint, todayStr());
  const userText = userMessage.slice(0, 500);
  let prompt = sys + '\n\n';
  for (const m of history) {
    const roleLabel = m.role === 'user' ? 'User' : 'Assistant';
    prompt += `${roleLabel}: ${m.content}\n\n`;
  }
  prompt += `User: ${userText}`;
  const promptBody = { prompt: prompt.slice(0, 6000), max_tokens: AI_MAX_TOKENS };
  const models = [AI_MODEL, AI_MODEL_FALLBACK, AI_MODEL_FALLBACK2];
  for (const modelId of models) {
    try {
      const text = await runWorkersAIViaRESTOne(ctx, accountId, token, modelId, promptBody);
      if (text) return text;
    } catch (e) {
      console.error('Workers AI REST model', modelId, e.message);
    }
  }
  return null;
}

async function runWorkersAI(ctx, userMessage, lg, role = 'client', history = []) {
  if (!userMessage || userMessage.length < 2) return null;

  if (ctx.WORKERS_AI_API_TOKEN && ctx.CLOUDFLARE_ACCOUNT_ID) {
    const rest = await runWorkersAIViaREST(ctx, userMessage, lg, role, history);
    if (rest) return rest;
  }

  if (ctx.AI) {
    const langHint = LANG_HINT[lg] || 'русском';
    const sys = buildAISystemPrompt(role, langHint, todayStr());
    const userText = userMessage.slice(0, 500);
    const messages = [{ role: 'system', content: sys }];
    for (const m of history) {
      messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
    }
    messages.push({ role: 'user', content: userText });
    const messagesPayload = { messages, max_tokens: AI_MAX_TOKENS };

    const bindingModels = [
      { id: AI_MODEL, useInput: true },
      { id: AI_MODEL_FALLBACK, useInput: false },
      { id: AI_MODEL_FALLBACK2, useInput: false },
    ];
    for (const { id: modelId, useInput } of bindingModels) {
      try {
        let out;
        try {
          out = await ctx.AI.run(modelId, messagesPayload);
        } catch (e1) {
          if (useInput && modelId === AI_MODEL) {
            try {
              out = await ctx.AI.run(modelId, { instructions: sys, input: userText, max_tokens: AI_MAX_TOKENS });
            } catch (e2) {
              continue;
            }
          } else {
            continue;
          }
        }
        const text = parseAIResponse(out);
        if (text) return text.slice(0, 1000);
      } catch (e) {
        console.error('Workers AI binding', modelId, e.message);
      }
    }
  }
  return null;
}

// ─── Запрос живого консультанта (счётчик + детекция) ───
// ВАЖНО: \b не работает с кириллицей в JS — используем (?:^|\s) и (?:\s|$)
// Поддержка 4 языков: RU, UA, EN, PL
const WANT_HUMAN_PATTERNS = [
  // RU
  /(?:^|\s)(живого?|настоящего?)\s*(человека|консультанта|оператора|менеджера|специалиста)(?:\s|$)/i,
  /(?:^|\s)(не\s*хочу|не\s*буду)\s*(говорить|общаться)\s*(с\s*)?(роботом|ботом|искусственным)(?:\s|$)/i,
  /(?:^|\s)(хочу|нужен|нужна|дайте|дай)\s*(живого?|настоящего?|человека|консультанта|оператора|менеджера)(?:\s|$)/i,
  /(?:^|\s)подключи(те)?\s*(живого?|консультанта|человека|оператора|меня|к\s*человеку)(?:\s|$)/i,
  /(?:^|\s)подкл[оаеё]?ючи(те)?\s*(живого?|консультанта|человека|оператора|меня)?(?:\s|$)/i,
  /(?:^|\s)(подключиться|подключи меня)/i,
  /(?:^|\s)(человека|консультанта)\s*подкл[оаеё]?ючи(?:\s|$)/i,
  /(?:^|\s)позови(те)?\s*(человека|менеджера|админа|консультанта)(?:\s|$)/i,
  /(?:^|\s)(с\s*)?(живым|настоящим)\s*(человеком|консультантом)(?:\s|$)/i,
  /(?:^|\s)с\s*человеком(?:\s|$)/i,
  /(?:^|\s)(хочу|нужно)\s+(с\s+)?человеком\s*(поговорить|поболтать|общаться)?/i,
  /(?:^|\s)(поговорить|поболтать|общаться|говорить)\s*(с\s*)(живым\s*)?человеком(?:\s|$)/i,
  /(?:^|\s)(я\s*)?не\s*хочу\s*(с\s*)?роботом(?:\s|$)/i,
  /(?:^|\s)(это|вы)\s*(робот|бот|искусственный\s*интеллект)(?:\s|$)/i,
  /(?:^|\s)хочу\s*человека(?:\s|$)/i,
  /(?:^|\s)переведи(те)?\s*на\s*(человека|оператора)(?:\s|$)/i,
  /(?:^|\s)соедини(те)?\s*с\s*(оператором|менеджером)(?:\s|$)/i,
  // UA
  /(?:^|\s)(живого?|справжнього?)\s*(людину|консультанта|оператора|менеджера|фахівця)(?:\s|$)/i,
  /(?:^|\s)(не\s*хочу|не\s*буду)\s*(говорити|спілкуватися)\s*(з\s*)?(роботом|ботом)(?:\s|$)/i,
  /(?:^|\s)(хочу|потрібен|потрібна|дайте|дай)\s*(живого?|справжнього?|людину|консультанта|оператора)(?:\s|$)/i,
  /(?:^|\s)підключи(те)?\s*(живого?|консультанта|людину|оператора|мене|до\s*людини)(?:\s|$)/i,
  /(?:^|\s)(підключитися|підключи мене)/i,
  /(?:^|\s)(людину|консультанта)\s*підключи(?:\s|$)/i,
  /(?:^|\s)поклич(те)?\s*(людину|менеджера|адміна|консультанта)(?:\s|$)/i,
  /(?:^|\s)(з\s*)?(живою|справжньою)\s*(людиною|консультантом)(?:\s|$)/i,
  /(?:^|\s)з\s*людиною(?:\s|$)/i,
  /(?:^|\s)(хочу|потрібно)\s+(з\s+)?людиною\s*(поговорити|поспілкувати)?/i,
  /(?:^|\s)хочу\s*людину(?:\s|$)/i,
  // EN
  /(?:^|\s)(real|live|actual)\s*(person|human|consultant|operator|manager)(?:\s|$)/i,
  /(?:^|\s)(don'?t\s*want|won'?t)\s*(to\s*talk|to\s*chat)\s*(with\s*)?(robot|bot|ai)(?:\s|$)/i,
  /(?:^|\s)(want|need|give\s*me)\s*(a\s*)?(real|live|human|consultant|operator)(?:\s|$)/i,
  /(?:^|\s)connect\s*(me\s*)?(to\s*)?(a\s*)?(human|consultant|operator|person)(?:\s|$)/i,
  /(?:^|\s)(talk|speak|chat)\s*(to|with)\s*(a\s*)?(real\s*)?(human|person)(?:\s|$)/i,
  /(?:^|\s)want\s*(a\s*)?(human|person)(?:\s|$)/i,
  /(?:^|\s)transfer\s*(me\s*)?(to\s*)?(human|operator)(?:\s|$)/i,
  /(?:^|\s)human\s*please(?:\s|$)/i,
  // PL
  /(?:^|\s)(prawdziw\w*|żyw\w*)\s*(człowiek|konsultant|operator|menadżer)(?:\s|$)/i,
  /(?:^|\s)(nie\s*chcę|nie\s*będę)\s*(rozmawiać|gadać)\s*(z\s*)?(robotem|botem)(?:\s|$)/i,
  /(?:^|\s)(chcę|potrzebuję|daj)\s*(prawdziwego?|żyw\w*|człowieka|konsultanta|operatora)(?:\s|$)/i,
  /(?:^|\s)połącz\s*(mnie\s*)?(z\s*)?(człowiekiem|konsultantem|operatorem)(?:\s|$)/i,
  /(?:^|\s)(rozmawiać|gadać)\s*(z\s*)(prawdziwym\s*)?(człowiekiem)(?:\s|$)/i,
  /(?:^|\s)chcę\s*człowieka(?:\s|$)/i,
  /(?:^|\s)przełącz\s*(na\s*)?(człowieka|operatora)(?:\s|$)/i,
];

function isWantHumanMessage(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const s = txt.trim().toLowerCase();
  if (s.length < 5) return false;
  return WANT_HUMAN_PATTERNS.some(re => re.test(s));
}

// Запрос «мои записи» — показываем страницу с кнопками сразу, БЕЗ AI. Бот знает пользователя по chat_id.
const MY_APPOINTMENTS_PATTERNS = [
  /мои\s*записи/i,
  /мої\s*записи/i,
  /ваши\s*записи/i,
  /(покажи|покажі|покажите)\s+.*запис/i,
  /(на\s*)?когда\s*(у\s*меня|мои)\s*записи/i,
  /(на\s*)?коли\s*(у\s*мене|мої)\s*записи/i,
  /у\s*меня\s*записи/i,
  /у\s*мене\s*записи/i,
  /записи\s*(на\s*когда|на\s*какой|на\s*який)/i,
  /(какие?|які)\s*у\s*мен[яе]\s*записи/i,
  /(найди|знайди)\s+мои\s*записи/i,
  /когда\s*я\s*записан/i,
  /my\s*appointments/i,
  /moje\s*wizyty/i,
  /my\s*bookings/i,
];

function isMyAppointmentsMessage(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const s = txt.trim();
  if (s.length < 4) return false;
  return MY_APPOINTMENTS_PATTERNS.some(re => re.test(s));
}

const CONTEXT_PHRASES = {
  prices: [/^(прайс|ціни|prices?|cennik)/i, /\bпрайс\b/i, /\bціни\b/i],
  catalog: [/^(каталог|портфоліо|portfolio)/i, /\bкаталог\b/i],
  contacts: [/^(контакт|contacts?|kontakt|инстаграм|instagram)/i, /\bконтакт/i, /\bинстаграм\b/i],
};

function getContextAction(txt) {
  if (!txt || typeof txt !== 'string') return null;
  const s = txt.trim();
  if (s.length < 3) return null;
  if (CONTEXT_PHRASES.prices.some(re => re.test(s))) return 'prices';
  if (CONTEXT_PHRASES.catalog.some(re => re.test(s))) return 'catalog';
  if (CONTEXT_PHRASES.contacts.some(re => re.test(s))) return 'contacts';
  return null;
}

// «Подтверди все заявки» — для админа/мастера
const CONFIRM_ALL_PATTERNS = [
  /\bподтверди(те)?\s*(все|всі)\s*заявки?\b/i,
  /\b(все|всі)\s*заявки?\s*подтверди(те)?\b/i,
  /\bconfirm\s*all\s*(requests?|bookings?|appointments?)\b/i,
  /\bpotwierd[źz]\s*wszystkie\s*(zgłoszenia?|rezerwacje?)\b/i,
  /\bzaakceptuj\s*wszystkie\b/i,
];

// «Отмени все брони/записи» — для админа
const ADMIN_CANCEL_ALL_PATTERNS = [
  /\bотмени(те)?\s*(все|всі)\s*(брони?|записи?|бронь|запис)\b/i,
  /\bотмени(те)?\s*(все|всі)\s*(брони?|записи?)\s*(всех?|усіх?)?\s*(клиентов?|клієнтів?)?\b/i,
  /\b(все|всі)\s*(брони?|записи?)\s*отмени(те)?\b/i,
  /\bcancel\s*all\s*(bookings?|appointments?|reservations?)\b/i,
  /\banuluj\s*wszystkie\s*(rezerwacje?|wizyty?)\b/i,
];

function isAdminCancelAllMessage(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const s = txt.trim();
  if (s.length < 8) return false;
  return ADMIN_CANCEL_ALL_PATTERNS.some(re => re.test(s));
}

function parseQuickBookingPhrase(txt) {
  if (!txt || typeof txt !== 'string' || txt.length < 8) return null;
  const s = txt.trim();
  if (!/\b(запиши|забронируй|записать|book|umów)\b/i.test(s)) return null;
  const svcMap = [
    { re: /\b(гель|гель-лак|gel)\b/i, id: 'gel' },
    { re: /\b(педикюр|педик|pedicure|pedicur)\b/i, id: 'pedi' },
    { re: /\b(наращивание|нарощ|extensions?|ext)\b/i, id: 'ext' },
    { re: /\b(дизайн|design)\b/i, id: 'design' },
    { re: /\b(комбо|combo)\b/i, id: 'combo' },
    { re: /\b(маникюр|маник|manicure|manicur|обычный)\b/i, id: 'classic' },
  ];
  let svcId = 'classic';
  for (const { re, id } of svcMap) {
    if (re.test(s)) { svcId = id; break; }
  }
  const dateHints = ['завтра', 'послезавтра', 'сегодня', 'today', 'tomorrow', 'пятниц', 'суббот', 'воскресень', 'понедельник', 'вторник', 'сред', 'четверг', 'jutro', 'friday', 'saturday', 'sunday', 'monday'];
  let dateHint = null;
  for (const dh of dateHints) {
    if (new RegExp(dh, 'i').test(s)) {
      dateHint = resolveDateHint(dh);
      if (dateHint) break;
    }
  }
  if (!dateHint && s.match(/(\d{1,2})[.\/](\d{1,2})/)) {
    const m = s.match(/(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?/);
    if (m) dateHint = resolveDateHint(m[0]);
  }
  const timeM = s.match(/\b(?:на|в|о)\s*(\d{1,2})(?::(\d{2}))?\s*(?:часа|час|ч)?/i) || s.match(/\b(\d{1,2})\s*(?:часа|час|ч|:)/i) || s.match(/\b(\d{1,2}):(\d{2})\b/i);
  let timeHint = null;
  if (timeM) {
    const h = parseInt(timeM[1], 10);
    const m = timeM[2] ? parseInt(timeM[2], 10) : 0;
    if (h >= 0 && h <= 23) timeHint = `${p2(h)}:${m === 30 ? '30' : '00'}`;
  }
  if (dateHint && timeHint) return { svcId, dateHint, timeHint };
  if (dateHint) return { svcId, dateHint, timeHint: null };
  return null;
}

function isConfirmAllRequestsMessage(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const s = txt.trim();
  if (s.length < 5) return false;
  return CONFIRM_ALL_PATTERNS.some(re => re.test(s));
}

// Грубая лексика: при 2+ совпадениях показываем предупреждение о конструктивном диалоге
const PROFANITY_PATTERN = /\b(бля|сука|хуй|пизд|ебат|нахер|похер|дерьмо|гавно|мудак|придурок|идиот)\w*/gi;
function hasHeavyProfanity(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const m = txt.match(PROFANITY_PATTERN);
  return m && m.length >= 2;
}

const HUMAN_REQ_THRESHOLD = 1;

async function getHumanRequestCount(ctx, cid) {
  const v = await kvGet(ctx, `hr:${cid}`);
  return typeof v === 'number' && v >= 0 ? v : 0;
}

async function incHumanRequestCount(ctx, cid) {
  const n = await getHumanRequestCount(ctx, cid);
  const next = n + 1;
  await kvPut(ctx, `hr:${cid}`, next);
  return next;
}

async function resetHumanRequestCount(ctx, cid) {
  try { await ctx.kv.delete(ctx.prefix + `hr:${cid}`); } catch (_) {}
}

async function getTicket(ctx, clientCid) {
  const v = await kvGet(ctx, `ticket:${clientCid}`);
  return v && v.open ? v : null;
}

async function setTicket(ctx, clientCid, data) {
  await kvPut(ctx, `ticket:${clientCid}`, data);
}

async function getTicketMaster(ctx, masterCid) {
  const v = await kvGet(ctx, `ticket_master:${masterCid}`);
  return typeof v === 'number' ? v : null;
}

async function setTicketMaster(ctx, masterCid, clientCid) {
  await kvPut(ctx, `ticket_master:${masterCid}`, clientCid);
}

async function clearTicket(ctx, clientCid) {
  const ticket = await getTicket(ctx, clientCid);
  if (ticket?.masterCid) {
    try { await ctx.kv.delete(ctx.prefix + `ticket_master:${ticket.masterCid}`); } catch (_) {}
  }
  try { await ctx.kv.delete(ctx.prefix + `ticket:${clientCid}`); } catch (_) {}
}

function isTicketCloseWord(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const u = txt.trim().toUpperCase();
  return u === 'STOP' || u === 'СТОП';
}

// Собирает контекст диалога для внутренней заметки тикета (видна только мастеру/админу)
async function buildTicketInternalNote(ctx, clientCid) {
  const hist = await getChatHistory(ctx, clientCid);
  if (!hist || hist.length === 0) return null;
  const lines = [];
  for (const m of hist) {
    const role = m.role === 'user' ? '👤' : '🤖';
    const content = (m.content || '').trim().slice(0, 200);
    if (content) lines.push(`${role} ${content}`);
  }
  if (lines.length === 0) return null;
  return lines.join('\n').slice(0, 1500);
}

async function notifyStaffConsultantRequest(ctx, clientCid, replyMarkup = null, internalNote = null) {
  const masters = await listMasters(ctx);
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
  if (adminId) recipients.add(adminId);
  if (ctx.adminChatId) recipients.add(ctx.adminChatId);
  const user = await getUser(ctx, clientCid);
  const name = user?.name ? escHtml(user.name) : '—';
  const phone = user?.phone ? escHtml(user.phone) : '—';
  const username = user?.tgUsername ? `@${escHtml(user.tgUsername)}` : '—';
  for (const rcid of recipients) {
    const rlg = await getLang(ctx, rcid) || 'ru';
    let msg = fill(t(rlg, 'consultant_notify'), { name, phone, username });
    if (internalNote && internalNote.trim()) {
      msg += '\n\n' + fill(t(rlg, 'ticket_internal_note'), { note: escHtml(internalNote.trim()) });
    }
    await send(ctx, rcid, msg, replyMarkup || {});
  }
}

async function sendPhoto(ctx, chatId, url, caption, extra = {}) {
  const res = await api(ctx, 'sendPhoto', { chat_id: chatId, photo: url, caption, parse_mode: 'HTML', ...extra });
  if (res.ok) return res;
  return send(ctx, chatId, `🖼 ${caption}`, extra);
}

async function editPhoto(ctx, chatId, msgId, url, caption, extra = {}) {
  try {
    const body = {
      chat_id: chatId,
      message_id: msgId,
      media: { type: 'photo', media: url, caption: (caption || '').slice(0, 1024), parse_mode: 'HTML' },
    };
    if (extra.reply_markup) body.reply_markup = extra.reply_markup;
    const res = await api(ctx, 'editMessageMedia', body);
    if (res && res.ok) return res;
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
  try { return await ctx.kv.get(ctx.prefix + k, 'json'); }
  catch (e) { console.error('KV GET fail:', k, e.message); return null; }
}

async function kvPut(ctx, k, v, o) {
  try { await ctx.kv.put(ctx.prefix + k, JSON.stringify(v), o); return true; }
  catch (e) { console.error('KV PUT fail:', k, e.message); return false; }
}

async function kvDel(ctx, k) {
  try { await ctx.kv.delete(ctx.prefix + k); }
  catch (e) { console.error('KV DEL fail:', k, e.message); }
}

const CHAT_HISTORY_MAX = 8;
const CHAT_HISTORY_TTL = 3600;

async function getChatHistory(ctx, cid) {
  if (!ctx.kv) return [];
  const raw = await kvGet(ctx, `chat:${cid}`);
  if (!Array.isArray(raw)) return [];
  return raw.slice(-CHAT_HISTORY_MAX);
}

async function appendChatTurn(ctx, cid, userMsg, assistantMsg) {
  if (!ctx.kv || !userMsg) return;
  const hist = await getChatHistory(ctx, cid);
  hist.push({ role: 'user', content: String(userMsg).slice(0, 300) });
  if (assistantMsg) hist.push({ role: 'assistant', content: String(assistantMsg).slice(0, 500) });
  const trimmed = hist.slice(-CHAT_HISTORY_MAX);
  await kvPut(ctx, `chat:${cid}`, trimmed, { expirationTtl: CHAT_HISTORY_TTL });
}

async function clearChatHistory(ctx, cid) {
  if (!ctx.kv) return;
  await kvDel(ctx, `chat:${cid}`);
}

async function getLang(ctx, cid) {
  try { return (await ctx.kv.get(`${ctx.prefix}lang:${cid}`)) || null; }
  catch { return null; }
}
async function setLang(ctx, cid, lang) {
  if (!VALID_LANGS.has(lang)) return;
  try { await ctx.kv.put(`${ctx.prefix}lang:${cid}`, lang); } catch {}
}

// ─── Dynamic Services ────────────────────────────────────────

function buildDefaultSvc() {
  return DEFAULT_SVC.map((s, i) => ({
    id: s.id, e: s.e, dur: s.dur, price: s.price, active: true, order: i,
    names: {
      ru: L.ru['svc_' + s.id] || s.id,
      ua: L.ua['svc_' + s.id] || s.id,
      en: L.en['svc_' + s.id] || s.id,
      pl: L.pl['svc_' + s.id] || s.id,
    },
    desc: { ru: null, ua: null, en: null, pl: null },
    photos: DEFAULT_PHOTOS[s.id] || [],
  }));
}

const CORRECTION_SVC = {
  id: 'correction', e: '🔧', dur: 30, price: 0, active: true, hidden: true, order: 999,
  names: { ru: 'Исправление', ua: 'Виправлення', en: 'Correction', pl: 'Korekta' },
  desc: { ru: null, ua: null, en: null, pl: null },
  photos: [],
};

async function loadServices(ctx) {
  let services = await kvGet(ctx, 'cfg:svc_list');
  if (!services || !Array.isArray(services) || services.length === 0) {
    services = buildDefaultSvc();
    await kvPut(ctx, 'cfg:svc_list', services);
  }
  if (!services.some(s => s.id === 'correction')) {
    services = [...services, CORRECTION_SVC];
    await kvPut(ctx, 'cfg:svc_list', services);
  }
  return services;
}

async function saveServices(ctx, services) {
  if (!services.some(s => s.id === 'correction')) {
    services = [...services, CORRECTION_SVC];
  }
  ctx.svc = services;
  ctx.svcIds = new Set(services.filter(s => s.active !== false).map(s => s.id));
  if (!ctx.svcIds.has('correction')) ctx.svcIds.add('correction');
  await kvPut(ctx, 'cfg:svc_list', services);
  syncSvcNames(ctx);
}

const BROKEN_ABOUT_PHOTO_ID = '33412989';
const FALLBACK_ABOUT_PHOTO = 'https://images.pexels.com/photos/3997354/pexels-photo-3997354.jpeg?w=600';

async function loadAboutPhotos(ctx) {
  let stored = await kvGet(ctx, 'cfg:about_photos');
  if (stored && Array.isArray(stored) && stored.length > 0) {
    const fixed = stored.map(u => (u && u.includes(BROKEN_ABOUT_PHOTO_ID)) ? FALLBACK_ABOUT_PHOTO : u);
    if (fixed.some((u, i) => u !== stored[i])) {
      await kvPut(ctx, 'cfg:about_photos', fixed);
      return fixed;
    }
    return stored;
  }
  await kvPut(ctx, 'cfg:about_photos', DEFAULT_ABOUT_PHOTOS);
  return DEFAULT_ABOUT_PHOTOS;
}

async function saveAboutPhotos(ctx, photos) {
  await kvPut(ctx, 'cfg:about_photos', photos);
}

async function loadAboutDesc(ctx) {
  const stored = await kvGet(ctx, 'cfg:about_desc');
  return stored != null && String(stored).trim() ? stored : null;
}

async function saveAboutDesc(ctx, desc) {
  const v = String(desc || '').trim();
  await kvPut(ctx, 'cfg:about_desc', v || null);
}

async function loadInstagramUrl(ctx) {
  const stored = await kvGet(ctx, 'cfg:instagram_url');
  return stored != null && String(stored).trim() ? stored : INSTAGRAM_URL;
}

async function saveInstagramUrl(ctx, url) {
  const v = String(url || '').trim();
  await kvPut(ctx, 'cfg:instagram_url', v || null);
}

function syncSvcNames(ctx) {
  for (const s of ctx.svc) {
    for (const lang of ['ru', 'ua', 'en', 'pl']) {
      if (s.names?.[lang]) L[lang]['svc_' + s.id] = s.names[lang];
    }
  }
}

async function initServices(ctx) {
  ctx.svc = await loadServices(ctx);
  ctx.svcIds = new Set(ctx.svc.filter(s => s.active !== false).map(s => s.id));
  if (!ctx.svcIds.has('correction')) ctx.svcIds.add('correction');
  syncSvcNames(ctx);
}

// ─── Roles ───────────────────────────────────────────────────

async function getAdminId(ctx) { return kvGet(ctx, 'cfg:admin'); }
async function setAdminId(ctx, cid) { return kvPut(ctx, 'cfg:admin', cid); }
async function isAdmin(ctx, cid) { return (await getAdminId(ctx)) === cid; }

async function getMaster(ctx, cid) { return kvGet(ctx, `master:${cid}`); }
async function saveMaster(ctx, cid, data) {
  data.services = data.services || null;    // future: per-master service list
  data.workHours = data.workHours || null;  // future: per-master { from, to }
  data.workDays = data.workDays || null;    // future: per-master [1,2,3,4,5]
  data.onVacation = data.onVacation === true;
  return kvPut(ctx, `master:${cid}`, data);
}
async function deleteMaster(ctx, cid) { await kvDel(ctx, `master:${cid}`); }
async function isMaster(ctx, cid) { return !!(await getMaster(ctx, cid)); }

async function listMasters(ctx) {
  const keys = await kvListAll(ctx, { prefix: 'master:' });
  const masters = [];
  for (const k of keys) {
    const m = await kvGet(ctx, k.name);
    if (m) masters.push(m);
  }
  return masters;
}

function normalizeUsername(raw) {
  const uname = String(raw || '').trim().replace(/^@+/, '');
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(uname)) return null;
  return uname.toLowerCase();
}

function normalizePhone(raw) {
  const cleaned = String(raw || '').replace(/[^\d+]/g, '').slice(0, 20);
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return { cleaned, digits };
}

async function findUserByUsername(ctx, username) {
  const uname = normalizeUsername(username);
  if (!uname) return null;
  const keys = await kvListAll(ctx, { prefix: 'u:' });
  for (const k of keys) {
    const u = await kvGet(ctx, k.name);
    if (!u?.tgUsername) continue;
    if (normalizeUsername(u.tgUsername) === uname) return u;
  }
  return null;
}

async function findUserByPhone(ctx, phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  const keys = await kvListAll(ctx, { prefix: 'u:' });
  for (const k of keys) {
    const u = await kvGet(ctx, k.name);
    if (!u?.phone) continue;
    const userPhone = normalizePhone(u.phone);
    if (userPhone && userPhone.digits === phone.digits) return u;
  }
  return null;
}

async function resolveMasterInput(ctx, msg, txt) {
  let masterId = null;
  let masterName = '?';
  let masterUsername = null;
  let masterPhone = null;

  if (msg.forward_from) {
    masterId = msg.forward_from.id;
    masterName = [msg.forward_from.first_name, msg.forward_from.last_name].filter(Boolean).join(' ') || '?';
    masterUsername = msg.forward_from.username || null;
    return { masterId, masterName, masterUsername, masterPhone };
  }

  if (msg.contact) {
    if (msg.contact.user_id && isValidChatId(msg.contact.user_id)) {
      masterId = msg.contact.user_id;
      masterName = [msg.contact.first_name, msg.contact.last_name].filter(Boolean).join(' ') || '?';
      masterPhone = normalizePhone(msg.contact.phone_number || '')?.cleaned || null;
      return { masterId, masterName, masterUsername, masterPhone };
    }
    const byContactPhone = await findUserByPhone(ctx, msg.contact.phone_number || '');
    if (byContactPhone?.chatId) {
      return {
        masterId: byContactPhone.chatId,
        masterName: byContactPhone.name || '?',
        masterUsername: byContactPhone.tgUsername || null,
        masterPhone: normalizePhone(byContactPhone.phone || '')?.cleaned || null,
      };
    }
  }

  const parsed = parseInt(txt, 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    masterId = parsed;
    masterName = `User ${parsed}`;
    return { masterId, masterName, masterUsername, masterPhone };
  }

  const username = normalizeUsername(txt);
  if (username) {
    // Fast path: resolve through Telegram API if this user is visible to the bot.
    const chatByUsername = await api(ctx, 'getChat', { chat_id: '@' + username });
    if (chatByUsername?.ok && isValidChatId(chatByUsername.result?.id)) {
      const r = chatByUsername.result;
      return {
        masterId: r.id,
        masterName: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.username ? '@' + r.username : '?'),
        masterUsername: r.username || username,
        masterPhone: null,
      };
    }
    const byUsername = await findUserByUsername(ctx, username);
    if (byUsername?.chatId) {
      return {
        masterId: byUsername.chatId,
        masterName: byUsername.name || (byUsername.tgUsername ? '@' + byUsername.tgUsername : '?'),
        masterUsername: byUsername.tgUsername || username,
        masterPhone: normalizePhone(byUsername.phone || '')?.cleaned || null,
      };
    }
  }

  const phone = normalizePhone(txt);
  if (phone) {
    const byPhone = await findUserByPhone(ctx, phone.cleaned);
    if (byPhone?.chatId) {
      return {
        masterId: byPhone.chatId,
        masterName: byPhone.name || '?',
        masterUsername: byPhone.tgUsername || null,
        masterPhone: normalizePhone(byPhone.phone || '')?.cleaned || phone.cleaned,
      };
    }
  }

  return { masterId: null, masterName: '?', masterUsername: null, masterPhone: null };
}

async function getRole(ctx, cid) {
  if (await isAdmin(ctx, cid)) return 'admin';
  if (await isMaster(ctx, cid)) return 'master';
  return 'client';
}

async function isBlocked(ctx, cid) { return !!(await kvGet(ctx, `blocked:${cid}`)); }
async function blockUser(ctx, cid) { await kvPut(ctx, `blocked:${cid}`, true); }
async function unblockUser(ctx, cid) { await kvDel(ctx, `blocked:${cid}`); }
async function canManageApt(ctx, cid) { return (await isAdmin(ctx, cid)) || (await isMaster(ctx, cid)); }

async function checkRateLimit(ctx, cid) {
  const key = `rl:${cid}`;
  const count = await kvGet(ctx, key);
  if (count !== null && count >= RATE_LIMIT_MAX) return false;
  await kvPut(ctx, key, (count || 0) + 1, { expirationTtl: RATE_LIMIT_WINDOW_SEC });
  return true;
}

async function getState(ctx, cid) { return (await kvGet(ctx, `st:${cid}`)) || { step: 'idle' }; }
async function setState(ctx, cid, s) { await kvPut(ctx, `st:${cid}`, s, { expirationTtl: STATE_TTL_SEC }); }
async function clearState(ctx, cid) { await kvDel(ctx, `st:${cid}`); }

async function getUser(ctx, cid) { return kvGet(ctx, `u:${cid}`); }
async function saveUser(ctx, cid, d) { await kvPut(ctx, `u:${cid}`, d); }

// ─── Appointment index helpers (future: per-master scope) ────

function allKey(dateStr) {
  return `all:${dateStr.slice(0, 7)}`;
}

// future: per-master day index → d:${date}:m:${masterId}
function dayIndexKey(date, masterId = null) {
  return `d:${date}`;
}

function getAptMasterId(apt) { return apt?.masterId || null; }
function isSharedApt(apt) { return !apt?.masterId; }

async function loadDayAppointments(ctx, date, masterId = null) {
  const ids = (await kvGet(ctx, dayIndexKey(date, masterId))) || [];
  const fetched = await Promise.all(ids.map(id => kvGet(ctx, `ap:${id}`)));
  // future: filter by masterId if provided
  return fetched.filter(a => a && !a.cx);
}

async function addToIndexes(ctx, apt) {
  const monthKey = allKey(apt.date);
  const dKey = dayIndexKey(apt.date, getAptMasterId(apt));
  const [dl, al] = await Promise.all([kvGet(ctx, dKey), kvGet(ctx, monthKey)]);
  const newDl = dl || []; newDl.push(apt.id);
  const newAl = al || []; newAl.push(apt.id);
  await Promise.all([
    kvPut(ctx, dKey, newDl),
    kvPut(ctx, monthKey, newAl),
  ]);
}

async function removeFromIndexes(ctx, apt) {
  const monthKey = allKey(apt.date);
  const dKey = dayIndexKey(apt.date, getAptMasterId(apt));
  const [dl, al] = await Promise.all([kvGet(ctx, dKey), kvGet(ctx, monthKey)]);
  const newDl = (dl || []).filter(x => x !== apt.id);
  const newAl = (al || []).filter(x => x !== apt.id);
  await Promise.all([
    newDl.length === 0 ? kvDel(ctx, dKey) : kvPut(ctx, dKey, newDl),
    newAl.length === 0 ? kvDel(ctx, monthKey) : kvPut(ctx, monthKey, newAl),
  ]);
}

// ─── Appointment CRUD ────────────────────────────────────────

async function saveApt(ctx, apt) {
  const ul = (await kvGet(ctx, `ua:${apt.chatId}`)) || [];
  const existing = await Promise.all(ul.map(id => kvGet(ctx, `ap:${id}`)));
  const active = existing.filter(a => a && !a.cx && a.ts > Date.now()).length;
  if (active >= MAX_APTS) return null;

  const id = `a${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  apt.id = id;
  apt.masterId = apt.masterId || null;
  apt.status = 'pending';
  apt.createdAt = Date.now();
  apt.rem = { h24: false, h2: false };
  apt.confirmedBy = null;
  apt.counterTime = null;
  apt.counterComment = null;
  apt.rejectComment = null;
  apt.cancelReason = null;

  ul.push(id);
  await Promise.all([
    kvPut(ctx, `ap:${id}`, apt),
    kvPut(ctx, `ua:${apt.chatId}`, ul),
    addToIndexes(ctx, apt),
  ]);
  return apt;
}

async function getApts(ctx, cid) {
  const ids = (await kvGet(ctx, `ua:${cid}`)) || [];
  const all = await Promise.all(ids.map(id => kvGet(ctx, `ap:${id}`)));
  return all
    .filter(a => a && !a.cx && a.status !== 'rejected' && a.ts > Date.now() - 3600000)
    .sort((a, b) => a.ts - b.ts);
}

async function getAdminAllApts(ctx) {
  const w = warsawNow();
  const monthKeys = [-2, -1, 0, 1].map(off => {
    const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
    return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
  });
  const buckets = await Promise.all(monthKeys.map(k => kvGet(ctx, k)));
  const allIds = [...new Set(buckets.flatMap(b => b || []))];
  const apts = await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`)));
  return apts.filter(a => a && !a.cx && a.ts > Date.now() - CLEANUP_AFTER_MS).sort((a, b) => a.ts - b.ts);
}

async function cancelApt(ctx, id, ownerChatId, adminOverride = false) {
  if (!/^a\d+_\w+$/.test(id)) return null;
  const a = await kvGet(ctx, `ap:${id}`);
  if (!a) return null;
  if (!adminOverride && a.chatId !== ownerChatId) return null;
  a.cx = true;
  a.status = 'cancelled';
  await kvPut(ctx, `ap:${id}`, a);

  const ul = (await kvGet(ctx, `ua:${a.chatId}`)) || [];
  const newUl = ul.filter(x => x !== id);
  await Promise.all([
    kvPut(ctx, `ua:${a.chatId}`, newUl),
    removeFromIndexes(ctx, a),
  ]);
  return a;
}

// ─── Available Slots (future: per-master scope) ──────────────

async function getSlots(ctx, date, svcId, masterId = null) {
  const svc = ctx.svc.find(s => s.id === svcId);
  if (!svc) return [];
  // currently shared salon calendar; future: filter by masterId
  const booked = await loadDayAppointments(ctx, date, masterId);
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
        const bs = ctx.svc.find(s => s.id === a.svcId);
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

function makeICS(ctx, apt, lang) {
  const svc = ctx.svc.find(s => s.id === apt.svcId);
  if (!svc) return '';
  const name = svcName(ctx, lang, apt.svcId);
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
    `DESCRIPTION:${escIcs(safeName)}`,
    `LOCATION:${escIcs(ADDRESS)}`, 'STATUS:CONFIRMED',
    'BEGIN:VALARM', 'TRIGGER:-PT24H', 'ACTION:DISPLAY', 'DESCRIPTION:24h', 'END:VALARM',
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:2h', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

// ─── Keyboards ───────────────────────────────────────────────

function mainKb(lg) {
  return { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
    [{ text: t(lg, 'm_cat'), callback_data: CB.CATALOG },
     { text: t(lg, 'm_prices'), callback_data: CB.PRICES }],
    [{ text: t(lg, 'm_my'), callback_data: CB.MY }],
    [{ text: t(lg, 'm_rev'), callback_data: CB.REVIEWS },
     { text: t(lg, 'm_about'), callback_data: CB.ABOUT }],
    [{ text: t(lg, 'm_cont'), callback_data: CB.CONTACTS },
     { text: t(lg, 'm_lang'), callback_data: CB.LANG }],
  ] } };
}

function langKb() {
  return { reply_markup: { inline_keyboard: [
    [{ text: '🇷🇺 Русский', callback_data: CB.LANG_SET + 'ru' },
     { text: '🇺🇦 Українська', callback_data: CB.LANG_SET + 'ua' }],
    [{ text: '🇬🇧 English', callback_data: CB.LANG_SET + 'en' },
     { text: '🇵🇱 Polski', callback_data: CB.LANG_SET + 'pl' }],
  ] } };
}

function svcKb(ctx, lg) {
  const rows = ctx.svc.filter(s => s.active !== false && s.hidden !== true).map(s => [{
    text: `${s.e} ${t(lg, 'svc_' + s.id)} — ${s.price} ${t(lg, 'cur')}`,
    callback_data: CB.SERVICE + s.id,
  }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
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
  nav.push(mo > 0 ? { text: '◀️', callback_data: CB.CAL_MONTH + (mo - 1) } : { text: ' ', callback_data: CB.NOOP });
  nav.push({ text: `${t(lg, 'mon')[vm]} ${vy}`, callback_data: CB.NOOP });
  nav.push(mo < 2 ? { text: '▶️', callback_data: CB.CAL_MONTH + (mo + 1) } : { text: ' ', callback_data: CB.NOOP });
  rows.push(nav);

  rows.push(t(lg, 'daysH').map(d => ({ text: d, callback_data: CB.NOOP })));

  const td = todayStr();
  let wk = Array.from({ length: f }, () => ({ text: ' ', callback_data: CB.NOOP }));
  for (let day = 1; day <= dim; day++) {
    const ds = `${vy}-${p2(vm + 1)}-${p2(day)}`;
    if (ds < td) wk.push({ text: '·', callback_data: CB.NOOP });
    else wk.push({ text: ds === td ? `[${day}]` : `${day}`, callback_data: CB.DATE + ds });
    if (wk.length === 7) { rows.push(wk); wk = []; }
  }
  if (wk.length) { while (wk.length < 7) wk.push({ text: ' ', callback_data: CB.NOOP }); rows.push(wk); }

  rows.push([{ text: t(lg, 'other_svc'), callback_data: CB.BOOK }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function timeKb(slots, lg) {
  const rows = [];
  for (let i = 0; i < slots.length; i += 3)
    rows.push(slots.slice(i, i + 3).map(x => ({ text: `🕐 ${x}`, callback_data: CB.TIME + x })));
  rows.push([{ text: t(lg, 'other_date'), callback_data: CB.CAL_BACK }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function catListKb(ctx, lg) {
  const rows = ctx.svc.filter(s => s.active !== false && s.hidden !== true).map(s => [{
    text: `${s.e} ${t(lg, 'svc_' + s.id)}`,
    callback_data: CB.CAT_PHOTO + s.id + ':0',
  }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function catPhotoKb(lg, svcId, idx, total) {
  const nav = [];
  if (idx > 0) nav.push({ text: '◀️', callback_data: CB.CAT_PHOTO + svcId + ':' + (idx - 1) });
  nav.push({ text: `${idx + 1} / ${total}`, callback_data: CB.NOOP });
  if (idx < total - 1) nav.push({ text: '▶️', callback_data: CB.CAT_PHOTO + svcId + ':' + (idx + 1) });
  return { reply_markup: { inline_keyboard: [
    nav,
    [{ text: t(lg, 'cat_book'), callback_data: CB.SERVICE + svcId }],
    [{ text: t(lg, 'cat_back'), callback_data: CB.CATALOG }],
  ] } };
}

function aboutPhotoKb(lg, idx, total, instagramUrl) {
  const nav = [];
  if (idx > 0) nav.push({ text: '◀️', callback_data: CB.ABOUT_PHOTO + (idx - 1) });
  nav.push({ text: `${idx + 1} / ${total}`, callback_data: CB.NOOP });
  if (idx < total - 1) nav.push({ text: '▶️', callback_data: CB.ABOUT_PHOTO + (idx + 1) });
  const rows = [nav];
  if (instagramUrl) rows.push([{ text: t(lg, 'm_instagram'), url: instagramUrl }]);
  rows.push([{ text: t(lg, 'm_book'), callback_data: CB.BOOK }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// ─── Appointment Notification Helpers ────────────────────────

async function notifyAptStaff(ctx, apt, user) {
  const masters = await listMasters(ctx);
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
  if (adminId) recipients.add(adminId);
  const promises = [];
  for (const rcid of recipients) {
    promises.push((async () => {
      const lg = await getLang(ctx, rcid) || 'ru';
      const s = ctx.svc.find(x => x.id === apt.svcId);
      const usernameRaw = user?.tgUsername || apt.userTg || '';
      const username = String(usernameRaw).replace(/^@+/, '');
      const client = escHtml(user?.name || apt.userName);
      const phone = escHtml(user?.phone || apt.userPhone);
      const svc = svcName(ctx, lg, apt.svcId);
      const dt = fmtDT(lg, apt.date, apt.time);
      const priceLine = isCorrectionSvc(apt.svcId) ? t(lg, 'free_label') : '💵 ' + String(s?.price || '?') + ' ' + t(lg, 'cur');
      const contactLines = ['👤 ' + client, '📱 ' + phone];
      if (username) contactLines.push('🔗 @' + escHtml(username));
      const reqTxt = [
        '🆕 <b>' + t(lg, 'mst_new_apt_header') + '</b>',
        '',
        ...contactLines,
        '',
        '💅 ' + svc,
        '',
        '📅 ' + dt,
        priceLine,
      ].join('\n');
      await send(ctx, rcid, reqTxt, { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'mst_confirm_btn'), callback_data: CB.APT_CONFIRM + apt.id }],
        [{ text: t(lg, 'mst_reject_btn'), callback_data: CB.APT_REJECT + apt.id }],
        [{ text: t(lg, 'mst_counter_btn'), callback_data: CB.APT_COUNTER + apt.id }],
      ]}});
    })());
  }
  await Promise.all(promises);
}

async function sendAptConfirmedToClient(ctx, apt) {
  const lg = await getLang(ctx, apt.chatId) || 'ru';
  const s = ctx.svc.find(x => x.id === apt.svcId);
  const tpl = isCorrectionSvc(apt.svcId) ? 'booked_correction' : 'booked';
  const vars = { svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time), addr: ADDRESS, maps: MAPS_URL };
  if (!isCorrectionSvc(apt.svcId)) {
    vars.dur = String(s?.dur || '?'); vars.min = t(lg, 'min');
    vars.p = String(s?.price || '?'); vars.c = t(lg, 'cur');
  }
  await send(ctx, apt.chatId, fill(t(lg, tpl), vars));
  const ics = makeICS(ctx, apt, lg);
  if (ics) await sendIcs(ctx, apt.chatId, ics, 'manicure.ics', '');
}

async function getAllPendingApts(ctx) {
  const w = warsawNow();
  const monthKeys = [-1, 0, 1, 2].map(off => {
    const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
    return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
  });
  const buckets = await Promise.all(monthKeys.map(k => kvGet(ctx, k)));
  const allIds = [...new Set(buckets.flatMap(b => b || []))];
  const apts = (await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`))))
    .filter(a => a && !a.cx && (a.status === 'pending' || a.status === 'counter_offer') && a.ts > Date.now() - 6 * 3600000)
    .sort((a, b) => a.ts - b.ts);
  return apts;
}

async function confirmAllPendingApts(ctx, cid) {
  if (!await canManageApt(ctx, cid)) return 0;
  const pending = await getAllPendingApts(ctx);
  let count = 0;
  for (const apt of pending) {
    apt.status = 'confirmed';
    apt.confirmedBy = cid;
    await kvPut(ctx, `ap:${apt.id}`, apt);
    await sendAptConfirmedToClient(ctx, apt);
    count++;
  }
  return count;
}

async function notifyStaffAptCancelled(ctx, apt, comment = null) {
  const masters = await listMasters(ctx);
  const adminId = await getAdminId(ctx);
  const recipients = new Set();
  for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
  if (adminId) recipients.add(adminId);
  const user = await getUser(ctx, apt.chatId);
  const usernameRaw = apt.userTg || user?.tgUsername || '';
  const username = String(usernameRaw).replace(/^@+/, '');
  const promises = [];
  for (const rcid of recipients) {
    promises.push((async () => {
      const lg = await getLang(ctx, rcid) || 'ru';
      const usernamePart = username ? ` | 🔗 @${escHtml(username)}` : '';
      const lines = [
        '❌ <b>Запись отменена клиентом</b>',
        '',
        `👤 ${escHtml(apt.userName)} | 📱 ${escHtml(apt.userPhone)}${usernamePart}`,
        '',
        `💅 ${svcName(ctx, lg, apt.svcId)}`,
        `📅 ${fmtDT(lg, apt.date, apt.time)}`,
      ];
      if (comment && String(comment).trim()) {
        lines.push('', `💬 ${escHtml(String(comment).trim())}`);
      }
      await send(ctx, rcid, lines.join('\n'));
    })());
  }
  await Promise.all(promises);
}

// ─── Service Management Screens ──────────────────────────────

async function showServicesList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  let txt = t(lg, 'svc_list_title');
  const btns = [];
  for (const s of ctx.svc.filter(x => x.hidden !== true)) {
    const status = s.active !== false ? '✅' : '❌';
    const name = s.names?.[lg] || s.names?.ru || s.id;
    txt += `${status} ${s.e} <b>${escHtml(name)}</b> — ${s.price} ${t(lg, 'cur')} · ${s.dur} ${t(lg, 'min')}\n`;
    btns.push([{ text: `✏️ ${s.e} ${name}`, callback_data: CB.SVC_EDIT + s.id }]);
  }
  btns.push([{ text: t(lg, 'svc_add'), callback_data: CB.SVC_ADD }]);
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

async function showServiceEdit(ctx, cid, svcId) {
  const lg = await getLang(ctx, cid) || 'ru';
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s || s.hidden) return showServicesList(ctx, cid);
  const name = s.names?.[lg] || s.names?.ru || s.id;
  const desc = s.desc?.[lg] || s.desc?.ru || '—';
  const photoCount = s.photos?.length || 0;
  const statusText = s.active !== false ? '✅' : '❌';
  const txt = fill(t(lg, 'svc_edit_title'), {
    name: escHtml(name), e: s.e, price: String(s.price),
    cur: t(lg, 'cur'), dur: String(s.dur),
    desc: escHtml(desc), photos: String(photoCount), status: statusText,
  });
  const toggleText = s.active !== false ? t(lg, 'svc_toggle_off') : t(lg, 'svc_toggle_on');
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'svc_edit_name'), callback_data: CB.SVC_NAME + svcId },
     { text: t(lg, 'svc_edit_price'), callback_data: CB.SVC_PRICE + svcId }],
    [{ text: t(lg, 'svc_edit_dur'), callback_data: CB.SVC_DUR + svcId },
     { text: t(lg, 'svc_edit_emoji'), callback_data: CB.SVC_EMOJI + svcId }],
    [{ text: t(lg, 'svc_edit_desc'), callback_data: CB.SVC_DESC + svcId }],
    [{ text: t(lg, 'svc_edit_photos') + ` (${photoCount})`, callback_data: CB.SVC_PHOTOS + svcId }],
    [{ text: toggleText, callback_data: CB.SVC_TOGGLE + svcId },
     { text: t(lg, 'svc_delete'), callback_data: CB.SVC_DEL + svcId }],
    [{ text: t(lg, 'adm_back'), callback_data: CB.SVC_LIST }],
  ] } });
}

async function showServicePhotos(ctx, cid, svcId) {
  const lg = await getLang(ctx, cid) || 'ru';
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s) return showServicesList(ctx, cid);
  const name = s.names?.[lg] || s.names?.ru || s.id;
  const photos = s.photos || [];
  const txt = fill(t(lg, 'svc_photo_title'), { name: escHtml(name), count: String(photos.length) });
  const btns = [];
  for (let i = 0; i < photos.length; i++) {
    const label = `${t(lg, 'svc_photo_del')} #${i + 1}`;
    btns.push([{ text: label, callback_data: CB.SVC_PHOTO_DEL + svcId + ':' + i }]);
  }
  btns.push([{ text: t(lg, 'svc_photo_add'), callback_data: CB.SVC_PHOTO_ADD + svcId }]);
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.SVC_EDIT + svcId }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
  for (let i = 0; i < Math.min(photos.length, 5); i++) {
    await sendPhoto(ctx, cid, photos[i], `#${i + 1}`, {});
  }
}

async function showAboutSettings(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, `🌸 <b>${t(lg, 'm_about')}</b>\n\n${t(lg, 'adm_about_photos')}, ${t(lg, 'adm_about_desc')}, ${t(lg, 'adm_about_instagram')}`, {
    reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_about_photos'), callback_data: CB.ADM_ABOUT_PHOTOS }],
      [{ text: t(lg, 'adm_about_desc'), callback_data: CB.ADM_ABOUT_DESC }],
      [{ text: t(lg, 'adm_about_instagram'), callback_data: CB.ADM_ABOUT_INSTAGRAM }],
      [{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }],
    ] },
  });
}

async function showAboutPhotos(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const photos = await loadAboutPhotos(ctx);
  const txt = fill(t(lg, 'svc_photo_title'), { name: t(lg, 'm_about'), count: String(photos.length) });
  const btns = [];
  for (let i = 0; i < photos.length; i++) {
    btns.push([{ text: `${t(lg, 'svc_photo_del')} #${i + 1}`, callback_data: CB.ADM_ABOUT_PHOTO_DEL + i }]);
  }
  btns.push([{ text: t(lg, 'svc_photo_add'), callback_data: CB.ADM_ABOUT_PHOTO_ADD }]);
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_ABOUT }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
  for (let i = 0; i < Math.min(photos.length, 5); i++) {
    await sendPhoto(ctx, cid, photos[i], `#${i + 1}`, {});
  }
}

async function showAboutDescEdit(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const current = await loadAboutDesc(ctx);
  const preview = current ? current.slice(0, 200) + (current.length > 200 ? '...' : '') : t(lg, 'about_desc_default').slice(0, 100) + '...';
  await setState(ctx, cid, { step: 'edit_about_desc' });
  return send(ctx, cid, `${t(lg, 'adm_enter_about_desc')}\n\n<i>${t(lg, 'adm_current')}:</i>\n${escHtml(preview)}`, {
    reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_ABOUT }]] },
  });
}

async function showAboutInstagramEdit(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const current = await loadInstagramUrl(ctx);
  await setState(ctx, cid, { step: 'edit_about_instagram' });
  return send(ctx, cid, `${t(lg, 'adm_enter_instagram')}\n\n<i>${t(lg, 'adm_current')}:</i> ${escHtml(current)}`, {
    reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_ABOUT }]] },
  });
}

// ─── Screens ─────────────────────────────────────────────────

// ─── Admin & Master Screens ──────────────────────────────────

function adminKb(lg) {
  return { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'adm_today'), callback_data: CB.ADM_TODAY },
     { text: t(lg, 'adm_tomorrow'), callback_data: CB.ADM_TOMORROW }],
    [{ text: t(lg, 'adm_masters'), callback_data: CB.ADM_MASTERS }],
    [{ text: t(lg, 'adm_clients'), callback_data: CB.ADM_CLIENTS }],
    [{ text: t(lg, 'svc_manage'), callback_data: CB.SVC_LIST }],
    [{ text: t(lg, 'm_about'), callback_data: CB.ADM_ABOUT }],
    [{ text: t(lg, 'adm_to_client'), callback_data: CB.MAIN }],
  ] } };
}

function masterKb(lg) {
  return { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'mst_today'), callback_data: CB.MST_TODAY },
     { text: t(lg, 'mst_tomorrow'), callback_data: CB.MST_TOMORROW }],
    [{ text: t(lg, 'svc_manage'), callback_data: CB.SVC_LIST }],
    [{ text: t(lg, 'mst_to_client'), callback_data: CB.MAIN }],
  ] } };
}

async function showAdminPanel(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  await clearState(ctx, cid);
  await send(ctx, cid, fill(t(lg, 'adm_welcome'), { n: escHtml(name) }), adminKb(lg));
}

async function showMasterPanel(ctx, cid, name) {
  const lg = await getLang(ctx, cid) || 'ru';
  await clearState(ctx, cid);
  await send(ctx, cid, fill(t(lg, 'mst_welcome'), { n: escHtml(name) }), masterKb(lg));
}

async function showAdminApts(ctx, cid, dateStr) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = (await loadDayAppointments(ctx, dateStr)).sort((a, b) => a.ts - b.ts);
  if (!apts.length) {
    return send(ctx, cid, `📅 <b>${fmtDate(lg, dateStr)}</b>\n\n${t(lg, 'adm_no_apts')}`, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }],
    ] } });
  }
  let txt = `📅 <b>${fmtDate(lg, dateStr)}</b>\n\n`;
  const btns = [];
  for (const a of apts) {
    const sv = ctx.svc.find(x => x.id === a.svcId);
    if (!sv) continue;
    const st = a.status === 'pending' ? '⏳' : a.status === 'confirmed' ? '✅' : a.status === 'counter_offer' ? '💬' : '🕐';
    const username = a.userTg ? ` · 🔗 @${escHtml(String(a.userTg).replace(/^@+/, ''))}` : '';
    txt += `${st} <b>${a.time}</b> — ${sv.e} ${t(lg, 'svc_' + a.svcId)}\n`;
    txt += `👤 ${escHtml(a.userName)} · 📱 ${escHtml(a.userPhone)}${username}\n\n`;
    if (a.status !== 'cancelled' && a.status !== 'rejected') {
      btns.push([{ text: `❌ ${a.time} ${escHtml(a.userName)}`, callback_data: CB.ADM_CANCEL_APT + a.id }]);
    }
  }
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

async function showMasterAllApts(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const w = warsawNow();
  const monthKeys = [-1, 0, 1, 2].map(off => {
    const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
    return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
  });
  const buckets = await Promise.all(monthKeys.map(k => kvGet(ctx, k)));
  const allIds = [...new Set(buckets.flatMap(b => b || []))];
  const apts = (await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`))))
    .filter(a => a && !a.cx && a.status !== 'rejected' && a.ts > Date.now() - 6 * 3600000)
    .sort((a, b) => a.ts - b.ts);

  if (!apts.length) {
    return send(ctx, cid, t(lg, 'adm_no_apts'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'mst_back'), callback_data: CB.MST_MAIN }],
    ] } });
  }

  let txt = `📅 <b>${t(lg, 'mst_tomorrow')}</b>\n\n`;
  const btns = [];
  let currentDate = null;
  for (const a of apts) {
    if (a.date !== currentDate) {
      currentDate = a.date;
      txt += `📅 <b>${fmtDate(lg, a.date)}</b>\n`;
    }
    const sv = ctx.svc.find(x => x.id === a.svcId);
    if (!sv) continue;
    const st = a.status === 'pending' ? '⏳' : a.status === 'confirmed' ? '✅' : a.status === 'counter_offer' ? '💬' : '🕐';
    const username = a.userTg ? ` · 🔗 @${escHtml(String(a.userTg).replace(/^@+/, ''))}` : '';
    txt += `${st} <b>${a.time}</b> — ${sv.e} ${t(lg, 'svc_' + a.svcId)}\n`;
    txt += `👤 ${escHtml(a.userName)} · 📱 ${escHtml(a.userPhone)}${username}\n\n`;
    if (a.status !== 'cancelled' && a.status !== 'rejected') {
      btns.push([{ text: `❌ ${a.time} ${escHtml(a.userName)}`, callback_data: CB.ADM_CANCEL_APT + a.id }]);
    }
  }
  btns.push([{ text: t(lg, 'mst_back'), callback_data: CB.MST_MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

async function showMastersList(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const masters = await listMasters(ctx);
  if (!masters.length) {
    return send(ctx, cid, t(lg, 'adm_no_masters'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_add_master'), callback_data: CB.ADM_ADD_M }],
      [{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }],
    ] } });
  }
  let txt = `👩‍🎨 <b>${t(lg, 'adm_masters')}</b>\n\n`;
  const btns = [];
  for (const m of masters) {
    const vac = m.onVacation ? ` 🏖 <i>${t(lg, 'adm_vacation_status')}</i>` : '';
    txt += `👤 <b>${escHtml(m.name)}</b> (ID: ${m.chatId})${vac}\n`;
    if (m.tgUsername) txt += `🔗 @${escHtml(m.tgUsername)}\n`;
    if (m.phone) txt += `📱 ${escHtml(m.phone)}\n`;
    txt += '\n';
    const vacBtn = m.onVacation ? t(lg, 'adm_vacation_off_btn') : t(lg, 'adm_vacation_btn');
    btns.push([
      { text: `${t(lg, 'adm_del_master')}: ${m.name}`, callback_data: CB.ADM_DEL_M + m.chatId },
      { text: vacBtn, callback_data: CB.ADM_VACATION + m.chatId },
    ]);
  }
  btns.push([{ text: t(lg, 'adm_add_master'), callback_data: CB.ADM_ADD_M }]);
  btns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: btns } });
}

const CLIENTS_PER_PAGE = 8;

async function showClientsList(ctx, cid, page = 0, msgId = null) {
  const lg = await getLang(ctx, cid) || 'ru';
  const userKeys = await kvListAll(ctx, { prefix: 'u:' });
  const clients = [];
  for (const k of userKeys) {
    const u = await kvGet(ctx, k.name);
    if (u) clients.push(u);
  }
  clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const total = clients.length;
  const totalPages = Math.max(1, Math.ceil(total / CLIENTS_PER_PAGE));
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const slice = clients.slice(p * CLIENTS_PER_PAGE, (p + 1) * CLIENTS_PER_PAGE);
  let txt = `👥 <b>${t(lg, 'adm_clients')}</b> (${total})`;
  if (totalPages > 1) txt += ` · ${p + 1}/${totalPages}`;
  txt += '\n\n';
  const cBtns = [];
  for (const c of slice) {
    const blocked = await isBlocked(ctx, c.chatId);
    txt += `👤 <b>${escHtml(c.name)}</b>${blocked ? ' 🚫' : ''}\n📱 ${escHtml(c.phone)} · ${c.tgUsername ? '@' + escHtml(c.tgUsername) : ''}\n\n`;
    cBtns.push([
      { text: `${t(lg, 'adm_block_btn')} ${c.name}`, callback_data: CB.ADM_BLOCK + c.chatId },
      { text: `${t(lg, 'adm_unblock_btn')} ${c.name}`, callback_data: CB.ADM_UNBLOCK + c.chatId },
    ]);
  }
  if (!clients.length) txt += t(lg, 'adm_no_apts');
  if (totalPages > 1) {
    const nav = [];
    if (p > 0) nav.push({ text: t(lg, 'adm_prev'), callback_data: CB.ADM_CLIENTS_PAGE + (p - 1) });
    if (p < totalPages - 1) nav.push({ text: t(lg, 'adm_next'), callback_data: CB.ADM_CLIENTS_PAGE + (p + 1) });
    if (nav.length) cBtns.push(nav);
  }
  cBtns.push([{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]);
  const opts = { reply_markup: { inline_keyboard: cBtns } };
  if (msgId) await edit(ctx, cid, msgId, txt, opts);
  else await send(ctx, cid, txt, opts);
}

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
  for (const s of ctx.svc.filter(sv => sv.active !== false && sv.hidden !== true))
    txt += `${s.e} <b>${t(lg, 'svc_' + s.id)}</b>\n   💵 ${s.price} ${t(lg, 'cur')} · ⏱ ${s.dur} ${t(lg, 'min')}\n\n`;
  await send(ctx, cid, txt, { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
    [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
  ] } });
}

async function showContacts(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const instagramUrl = await loadInstagramUrl(ctx);
  const rows = [];
  if (instagramUrl) rows.push([{ text: t(lg, 'm_instagram'), url: instagramUrl }]);
  rows.push([{ text: t(lg, 'm_book'), callback_data: CB.BOOK }]);
  rows.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
  await send(ctx, cid, fill(t(lg, 'cont_t'), { addr: ADDRESS, ph: PHONE, h: HOURS_STR }), { reply_markup: { inline_keyboard: rows } });
}

async function showReviews(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, fill(t(lg, 'rev_t'), {}), { reply_markup: { inline_keyboard: [
    [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
    [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
  ] } });
}

async function showAbout(ctx, cid, idx = 0, msgId = null) {
  const lg = await getLang(ctx, cid) || 'ru';
  const customDesc = await loadAboutDesc(ctx);
  const desc = customDesc || t(lg, 'about_desc_default');
  const instagramUrl = await loadInstagramUrl(ctx);
  const aboutTxt = fill(t(lg, 'about_t'), { s: SALON, addr: ADDRESS, h: HOURS_STR, desc: escHtml(desc) });
  const photos = await loadAboutPhotos(ctx);

  if (!photos.length) {
    return send(ctx, cid, aboutTxt, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'm_instagram'), url: instagramUrl }],
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] } });
  }

  const safeIdx = Math.max(0, Math.min(idx, photos.length - 1));
  const kb = aboutPhotoKb(lg, safeIdx, photos.length, instagramUrl);

  if (msgId) {
    const res = await editPhoto(ctx, cid, msgId, photos[safeIdx], aboutTxt, kb);
    if (res && res.ok) return;
    await api(ctx, 'deleteMessage', { chat_id: cid, message_id: msgId });
  }
  await sendPhoto(ctx, cid, photos[safeIdx], aboutTxt, kb);
}

async function showCatalog(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  await send(ctx, cid, t(lg, 'cat_title'), catListKb(ctx, lg));
}

async function showCatPhoto(ctx, cid, svcId, idx, msgId) {
  const lg = await getLang(ctx, cid) || 'ru';
  const photos = ctx.svc.find(x => x.id === svcId)?.photos || [];
  if (!photos.length) {
    return send(ctx, cid, `${svcName(ctx, lg, svcId)}\n\n${t(lg, 'cat_empty')}`, { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cat_back'), callback_data: CB.CATALOG }],
    ] } });
  }
  const safeIdx = Math.max(0, Math.min(idx, photos.length - 1));
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s) return;
  const baseCap = fill(t(lg, 'cat_cap'), {
    e: s.e, svc: t(lg, 'svc_' + svcId),
    p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min'),
    i: String(safeIdx + 1), total: String(photos.length),
  });
  const rawDesc = (s.desc?.[lg] || s.desc?.ru || '').trim();
  const cap = rawDesc ? `${baseCap}\n\n📝 ${escHtml(rawDesc)}` : baseCap;
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
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] } });
  }
  let txt = `${t(lg, 'my_title')}\n\n`;
  const btns = [];
  for (const a of apts) {
    const sv = ctx.svc.find(x => x.id === a.svcId);
    if (!sv) continue;
    const stIcon = a.status === 'pending' ? '⏳' : a.status === 'counter_offer' ? '💬' : '✅';
    const priceLine = isCorrectionSvc(a.svcId) ? t(lg, 'free_label') : `💵 ${sv.price} ${t(lg, 'cur')}`;
    txt += `${stIcon} ${svcName(ctx, lg, a.svcId)}\n📅 ${fmtDT(lg, a.date, a.time)}\n${priceLine}\n\n`;
    btns.push([{
      text: fill(t(lg, 'my_cancel'), { d: fmtDate(lg, a.date), t: a.time }),
      callback_data: CB.CANCEL_APT + a.id,
    }]);
  }
  if (apts.length > 1) {
    btns.push([{ text: t(lg, 'my_cancel_all'), callback_data: CB.CANCEL_ALL }]);
  }
  btns.push([{ text: t(lg, 'back_m'), callback_data: CB.MAIN }]);
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
        [{ text: t(lg, 'reg_yes'), callback_data: CB.REG_YES }],
        [{ text: t(lg, 'reg_change'), callback_data: CB.REG_CHANGE }],
      ] },
    });
  }
  await send(ctx, cid, t(lg, 'choose_svc'), svcKb(ctx, lg));
}

async function startBookingWithService(ctx, cid, from, svcId, dateHint = null, timeHint = null) {
  const lg = await getLang(ctx, cid) || 'ru';
  if (!ctx.svcIds?.has(svcId)) return startBooking(ctx, cid, from);
  const user = await getUser(ctx, cid);
  if (!user) return startBooking(ctx, cid, from);
  const s = ctx.svc.find(x => x.id === svcId);
  if (!s) return startBooking(ctx, cid, from);

  const dateStr = dateHint ? resolveDateHint(dateHint) : null;
  const timeStr = timeHint ? resolveTimeHint(timeHint) : null;

  if (dateStr) {
    const slots = await getSlots(ctx, dateStr, svcId);
    if (!slots.length) {
      await setState(ctx, cid, { step: 'date', svcId });
      return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, dateStr) }) + '\n\n' + t(lg, 'choose_date'), calKb(lg, 0));
    }
    if (timeStr) {
      const slot = slots.includes(timeStr) ? timeStr : findClosestSlot(slots, timeStr);
      if (slot) {
        await setState(ctx, cid, { step: 'conf', svcId, date: dateStr, time: slot });
        const confLines = isCorrectionSvc(svcId)
          ? [fill(t(lg, 'confirm_correction'), { svc: svcName(ctx, lg, svcId), dt: fmtDT(lg, dateStr, slot), name: escHtml(user?.name || '—'), phone: escHtml(user?.phone || '—') })]
          : [t(lg, 'confirm_title'), '', svcName(ctx, lg, svcId), `📅 ${fmtDT(lg, dateStr, slot)}`, `⏱ ${s.dur} ${t(lg, 'min')}`, `💵 ${s.price} ${t(lg, 'cur')}`, '', `👤 ${escHtml(user?.name || '—')}`, `📱 ${escHtml(user?.phone || '—')}`];
        return send(ctx, cid, confLines.join('\n'), { reply_markup: { inline_keyboard: [
          [{ text: t(lg, 'confirm_yes'), callback_data: CB.CONFIRM }],
          [{ text: t(lg, 'confirm_no'), callback_data: CB.CANCEL_BOOK }],
        ] } });
      }
    }
    await setState(ctx, cid, { step: 'time', svcId, date: dateStr });
    return send(ctx, cid, `📅 <b>${fmtDate(lg, dateStr)}</b>\n${svcName(ctx, lg, svcId)}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
  }

  await setState(ctx, cid, { step: 'date', svcId });
  const chosenText = isCorrectionSvc(svcId)
    ? fill(t(lg, 'chosen_correction'), { svc: svcName(ctx, lg, svcId) }) + '\n\n' + t(lg, 'choose_date')
    : fill(t(lg, 'chosen'), { svc: svcName(ctx, lg, svcId), p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min') }) + '\n\n' + t(lg, 'choose_date');
  await send(ctx, cid, chosenText, calKb(lg, 0));
}

async function showCancelAllConfirm(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = await getApts(ctx, cid);
  if (!apts.length) return showMyApts(ctx, cid);
  return send(ctx, cid, fill(t(lg, 'cancel_all_confirm'), { n: String(apts.length) }), {
    reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cancel_all_yes'), callback_data: CB.CANCEL_ALL_YES }],
      [{ text: t(lg, 'cancel_no'), callback_data: CB.MY }],
    ] },
  });
}

async function showAdminCancelAllConfirm(ctx, cid) {
  const lg = await getLang(ctx, cid) || 'ru';
  const apts = await getAdminAllApts(ctx);
  if (!apts.length) {
    return send(ctx, cid, t(lg, 'adm_no_apts'), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]] } });
  }
  return send(ctx, cid, fill(t(lg, 'adm_cancel_all_confirm'), { n: String(apts.length) }), {
    reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_cancel_all_yes'), callback_data: CB.ADM_CANCEL_ALL_YES }],
      [{ text: t(lg, 'cancel_no'), callback_data: CB.ADM_MAIN }],
    ] },
  });
}

// ─── Message handler (with validation) ───────────────────────

async function onMsg(ctx, msg) {
  if (!msg?.chat?.id || !msg?.from) return;
  if (msg.chat.type !== 'private') return;

  const cid = msg.chat.id;
  if (!isValidChatId(cid)) return;
  if (!await checkRateLimit(ctx, cid)) {
    const lg = (await getLang(ctx, cid)) || 'ru';
    await send(ctx, cid, t(lg, 'rate_limit'));
    return;
  }

  const rawName = msg.from.first_name || '';
  const name = escHtml(rawName.slice(0, 64)) || '👋';
  const st = await getState(ctx, cid);
  const lg = (await getLang(ctx, cid)) || 'ru';

  if (await isBlocked(ctx, cid)) return send(ctx, cid, t(lg, 'client_blocked'));

  if (msg.contact && st.step === 'rp') {
    const phone = String(msg.contact.phone_number || '').slice(0, 20);
    return finishPhone(ctx, cid, phone, st);
  }

  const txt = (msg.text || '').trim().slice(0, 200);

  if (txt.startsWith('/admin ')) {
    const key = txt.slice(7).trim();
    if (!timingSafeEqual(key, ctx.ADMIN_KEY)) return send(ctx, cid, t(lg, 'adm_wrong_key'));
    await setAdminId(ctx, cid);
    if (!await getLang(ctx, cid)) {
      const detected = detectLang(msg.from.language_code);
      if (detected) await setLang(ctx, cid, detected);
    }
    await send(ctx, cid, t(lg, 'adm_registered'));
    return showAdminPanel(ctx, cid, name);
  }

  const realRole = await getRole(ctx, cid);

  if (ctx.kv && txt) {
    if (realRole === 'client') {
      const ticket = await getTicket(ctx, cid);
      if (ticket?.open) {
        if (isTicketCloseWord(txt)) {
          await clearTicket(ctx, cid);
          await send(ctx, cid, t(lg, 'ticket_closed'));
          if (ticket.masterCid) await send(ctx, ticket.masterCid, t(await getLang(ctx, ticket.masterCid) || 'ru', 'ticket_closed_master'));
          return;
        }
        const toSend = fill(t(lg, 'ticket_from_client'), { msg: escHtml(txt) });
        if (ticket.masterCid) {
          await send(ctx, ticket.masterCid, toSend);
        } else {
          const masters = await listMasters(ctx);
          const adminId = await getAdminId(ctx);
          for (const m of masters) if (m.chatId && !m.onVacation) await send(ctx, m.chatId, toSend);
          if (adminId) await send(ctx, adminId, toSend);
          if (ctx.adminChatId) await send(ctx, ctx.adminChatId, toSend);
        }
        return;
      }
    } else if (realRole === 'master' || realRole === 'admin') {
      const clientCid = await getTicketMaster(ctx, cid);
      if (clientCid) {
        if (isTicketCloseWord(txt)) {
          await clearTicket(ctx, clientCid);
          const clg = await getLang(ctx, clientCid) || 'ru';
          await send(ctx, clientCid, t(clg, 'ticket_closed'));
          await send(ctx, cid, t(lg, 'ticket_closed_master'));
          return;
        }
        await send(ctx, clientCid, escHtml(txt));
        return;
      }
    }
  }

  if (txt === '/client' && realRole !== 'client') {
    return showWelcome(ctx, cid, name);
  }
  if (txt === '/master' && (realRole === 'admin' || realRole === 'master')) {
    return showMasterPanel(ctx, cid, name);
  }
  if (txt === '/panel' && realRole !== 'client') {
    if (realRole === 'admin') return showAdminPanel(ctx, cid, name);
    if (realRole === 'master') return showMasterPanel(ctx, cid, name);
  }

  if (txt === '/start') {
    await clearChatHistory(ctx, cid);
    let hasLang = await getLang(ctx, cid);
    if (!hasLang) {
      const detected = detectLang(msg.from.language_code);
      if (detected) {
        await setLang(ctx, cid, detected);
        hasLang = detected;
      }
    }
    if (!hasLang) return showLangPick(ctx, cid);
    if (realRole === 'admin') return showAdminPanel(ctx, cid, name);
    if (realRole === 'master') return showMasterPanel(ctx, cid, name);
    return showWelcome(ctx, cid, name);
  }
  if (txt === '/book')     return startBooking(ctx, cid, msg.from);
  if (txt === '/my')       return showMyApts(ctx, cid);
  if (txt === '/prices')   return showPrices(ctx, cid);
  if (txt === '/catalog')  return showCatalog(ctx, cid);
  if (txt === '/contacts' || txt === '/instagram') return showContacts(ctx, cid);
  if (txt === '/lang')     return showLangPick(ctx, cid);
  if (txt === '/help')     return send(ctx, cid, fill(t(lg, 'help'), {}), { reply_markup: { remove_keyboard: true } });

  if (txt) {
    if (isMyAppointmentsMessage(txt)) return showMyApts(ctx, cid);
    const ctxAction = getContextAction(txt);
    if (ctxAction === 'prices') return showPrices(ctx, cid);
    if (ctxAction === 'catalog') return showCatalog(ctx, cid);
    if (ctxAction === 'contacts') return showContacts(ctx, cid);
  }

  if (st.step === 'client_cancel_comment') {
    const comment = txt ? txt.slice(0, 500) : '';
    const apt = await cancelApt(ctx, st.aptId, cid);
    await clearState(ctx, cid);
    if (apt) {
      await send(ctx, cid, fill(t(lg, 'cancel_ok'), {
        svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'rebook'), callback_data: CB.BOOK }],
        [{ text: t(lg, 'm_my'), callback_data: CB.MY }],
        [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
      ] } });
      await notifyStaffAptCancelled(ctx, apt, comment);
    } else {
      await send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    return;
  }

  if (st.step === 'add_master') {
    const { masterId, masterName, masterUsername, masterPhone } = await resolveMasterInput(ctx, msg, txt);
    if (!masterId) return send(ctx, cid, t(lg, 'adm_master_invalid'));
    const existing = await getMaster(ctx, masterId);
    if (existing) return send(ctx, cid, t(lg, 'adm_master_exists'));
    await saveMaster(ctx, masterId, {
      chatId: masterId,
      name: masterName,
      tgUsername: masterUsername || null,
      phone: masterPhone || null,
      addedAt: Date.now(),
      active: true,
    });
    await clearState(ctx, cid);
    await send(ctx, cid, fill(t(lg, 'adm_master_added'), { n: escHtml(masterName), id: String(masterId) }));
    return showMastersList(ctx, cid);
  }

  // ── Appointment management state handlers ──
  if (st.step === 'reject_comment') {
    if (!txt) return send(ctx, cid, t(lg, 'mst_reject_prompt'));
    const apt = await kvGet(ctx, `ap:${st.aptId}`);
    if (!apt || apt.status !== 'pending') return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'rejected';
    apt.rejectComment = txt.slice(0, 500);
    await kvPut(ctx, `ap:${st.aptId}`, apt);
    await clearState(ctx, cid);
    const clg = await getLang(ctx, apt.chatId) || 'ru';
    let clientMsg = fill(t(clg, 'apt_rejected'), { svc: svcName(ctx, clg, apt.svcId), dt: fmtDT(clg, apt.date, apt.time) });
    clientMsg += fill(t(clg, 'apt_reject_cmt'), { comment: escHtml(txt) });
    clientMsg += t(clg, 'apt_rebook');
    await send(ctx, apt.chatId, clientMsg, { reply_markup: { inline_keyboard: [
      [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
      [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
    ]}});
    return send(ctx, cid, fill(t(lg, 'mst_apt_rejected'), { client: escHtml(apt.userName), dt: fmtDT(lg, apt.date, apt.time) }));
  }

  if (st.step === 'counter_time') {
    if (!txt || !isValidTime(txt)) return send(ctx, cid, t(lg, 'mst_counter_time'));
    st.step = 'counter_comment';
    st.newTime = txt;
    await setState(ctx, cid, st);
    return send(ctx, cid, t(lg, 'mst_counter_cmt_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'mst_skip'), callback_data: CB.APT_COUNTER_SKIP + st.aptId }],
    ]}});
  }

  if (st.step === 'counter_comment') {
    const comment = txt ? txt.slice(0, 500) : '';
    const apt = await kvGet(ctx, `ap:${st.aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'counter_offer';
    apt.counterTime = st.newTime;
    apt.counterComment = comment || null;
    apt.confirmedBy = cid;
    await kvPut(ctx, `ap:${st.aptId}`, apt);
    await clearState(ctx, cid);
    const clg = await getLang(ctx, apt.chatId) || 'ru';
    let clientMsg = fill(t(clg, 'apt_counter'), { svc: svcName(ctx, clg, apt.svcId), d: fmtDate(clg, apt.date), newtime: st.newTime });
    if (comment) clientMsg += fill(t(clg, 'apt_counter_cmt'), { comment: escHtml(comment) });
    await send(ctx, apt.chatId, clientMsg, { reply_markup: { inline_keyboard: [
      [{ text: t(clg, 'apt_accept'), callback_data: CB.APT_ACCEPT + apt.id }],
      [{ text: t(clg, 'apt_decline'), callback_data: CB.APT_DECLINE + apt.id }],
      [{ text: t(clg, 'apt_reply_btn'), callback_data: CB.APT_REPLY + apt.id }],
    ]}});
    return send(ctx, cid, t(lg, 'mst_counter_sent'));
  }

  if (st.step === 'admin_cancel_reason') {
    const reason = txt ? txt.slice(0, 500) : '';
    const apt = await kvGet(ctx, `ap:${st.aptId}`);
    if (!apt || apt.cx) { await clearState(ctx, cid); return; }
    apt.cancelReason = reason || null;
    const cancelled = await cancelApt(ctx, apt.id, cid, true);
    await clearState(ctx, cid);
    if (cancelled) {
      const clg = await getLang(ctx, cancelled.chatId) || 'ru';
      await send(ctx, cancelled.chatId, fill(t(clg, 'client_cancelled_admin'), {
        svc: svcName(ctx, clg, cancelled.svcId), dt: fmtDT(clg, cancelled.date, cancelled.time),
        reason: escHtml(reason || '—'),
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
        [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
      ]}});
    }
    return send(ctx, cid, t(lg, 'adm_apt_cancelled'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_prev'), callback_data: CB.ADM_MAIN }],
    ]}});
  }

  if (st.step === 'client_reply') {
    if (!txt) return send(ctx, cid, t(lg, 'apt_enter_reply'));
    const apt = await kvGet(ctx, `ap:${st.aptId}`);
    if (!apt) { await clearState(ctx, cid); return; }
    await clearState(ctx, cid);
    const recipients = new Set();
    if (apt.confirmedBy) recipients.add(apt.confirmedBy);
    const adminId = await getAdminId(ctx);
    if (adminId) recipients.add(adminId);
    const masters = await listMasters(ctx);
    for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
    for (const rcid of recipients) {
      const rlg = await getLang(ctx, rcid) || 'ru';
      await send(ctx, rcid, fill(t(rlg, 'mst_client_msg'), { client: escHtml(apt.userName), msg: escHtml(txt) }), { reply_markup: { inline_keyboard: [
        [{ text: t(rlg, 'mst_confirm_btn'), callback_data: CB.APT_CONFIRM + apt.id }],
        [{ text: t(rlg, 'mst_reject_btn'), callback_data: CB.APT_REJECT + apt.id }],
        [{ text: t(rlg, 'mst_counter_btn'), callback_data: CB.APT_COUNTER + apt.id }],
      ]}});
    }
    return send(ctx, cid, t(lg, 'apt_reply_sent'));
  }

  // ── Service management state handlers ──
  if (st.step === 'edit_svc_name') {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) {
      const cleanName = txt.replace(/<[^>]*>/g, '').trim().slice(0, 100);
      if (!cleanName) return send(ctx, cid, t(lg, 'svc_invalid'));
      if (!s.names) s.names = {};
      for (const lang of ['ru', 'ua', 'en', 'pl']) s.names[lang] = cleanName;
      await saveServices(ctx, ctx.svc);
    }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === 'edit_svc_price') {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const price = parseFloat(txt);
    if (isNaN(price) || price < 0 || price > 99999) return send(ctx, cid, t(lg, 'svc_invalid'));
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) { s.price = Math.round(price * 100) / 100; await saveServices(ctx, ctx.svc); }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === 'edit_svc_dur') {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const dur = parseInt(txt);
    if (isNaN(dur) || dur < 5 || dur > 600) return send(ctx, cid, t(lg, 'svc_invalid'));
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) { s.dur = dur; await saveServices(ctx, ctx.svc); }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === 'edit_svc_desc') {
    if (!await canManageApt(ctx, cid)) return;
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) {
      if (!s.desc) s.desc = {};
      const desc = (txt === '/skip' || !txt) ? null : txt.slice(0, 500);
      for (const lang of ['ru', 'ua', 'en', 'pl']) s.desc[lang] = desc;
      await saveServices(ctx, ctx.svc);
    }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === 'edit_svc_emoji') {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const emoji = txt.trim().slice(0, 4);
    if (!emoji) return send(ctx, cid, t(lg, 'svc_invalid'));
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) { s.e = emoji; await saveServices(ctx, ctx.svc); }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showServiceEdit(ctx, cid, st.svcId);
  }

  if (st.step === 'add_svc_id') {
    if (!txt || !await canManageApt(ctx, cid)) return;
    const newId = txt.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
    if (!newId || newId.length < 2) return send(ctx, cid, t(lg, 'svc_invalid'));
    if (ctx.svc.find(x => x.id === newId)) return send(ctx, cid, t(lg, 'svc_id_exists'));
    ctx.svc.push({
      id: newId, e: '💅', dur: 60, price: 100, active: true,
      order: ctx.svc.length,
      names: { ru: newId, ua: newId, en: newId, pl: newId },
      desc: { ru: null, ua: null, en: null, pl: null },
      photos: [],
    });
    await saveServices(ctx, ctx.svc);
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_added'));
    return showServiceEdit(ctx, cid, newId);
  }

  if (st.step === 'add_svc_photo') {
    if (!await canManageApt(ctx, cid)) return;
    let photoRef = null;
    if (msg.photo && msg.photo.length > 0) {
      photoRef = msg.photo[msg.photo.length - 1].file_id;
    } else if (txt && /^https?:\/\/.+/i.test(txt)) {
      photoRef = txt.trim().slice(0, 500);
    }
    if (!photoRef) return send(ctx, cid, t(lg, 'svc_enter_photo'));
    const s = ctx.svc.find(x => x.id === st.svcId);
    if (s) {
      if (!s.photos) s.photos = [];
      s.photos.push(photoRef);
      await saveServices(ctx, ctx.svc);
    }
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_photo_added'));
    return showServicePhotos(ctx, cid, st.svcId);
  }

  if (st.step === 'add_about_photo') {
    if (!await isAdmin(ctx, cid)) return;
    let photoRef = null;
    if (msg.photo && msg.photo.length > 0) {
      photoRef = msg.photo[msg.photo.length - 1].file_id;
    } else if (txt && /^https?:\/\/.+/i.test(txt)) {
      photoRef = txt.trim().slice(0, 500);
    }
    if (!photoRef) return send(ctx, cid, t(lg, 'svc_enter_photo'));
    const photos = await loadAboutPhotos(ctx);
    photos.push(photoRef);
    await saveAboutPhotos(ctx, photos);
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_photo_added'));
    return showAboutPhotos(ctx, cid);
  }

  if (st.step === 'edit_about_desc') {
    if (!await isAdmin(ctx, cid)) return;
    const desc = txt === '/skip' || !txt ? null : txt.slice(0, 2000);
    await saveAboutDesc(ctx, desc);
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showAboutSettings(ctx, cid);
  }

  if (st.step === 'edit_about_instagram') {
    if (!await isAdmin(ctx, cid)) return;
    const url = txt === '/skip' ? '' : txt.trim().slice(0, 500);
    if (url && !/^https?:\/\//i.test(url)) {
      return send(ctx, cid, t(lg, 'adm_enter_instagram'));
    }
    await saveInstagramUrl(ctx, url || null);
    await clearState(ctx, cid);
    await send(ctx, cid, t(lg, 'svc_updated'));
    return showAboutSettings(ctx, cid);
  }

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
    if (txt) {
      if (isMyAppointmentsMessage(txt)) return showMyApts(ctx, cid);
      const ctxAction = getContextAction(txt);
      if (ctxAction === 'prices') return showPrices(ctx, cid);
      if (ctxAction === 'catalog') return showCatalog(ctx, cid);
      if (ctxAction === 'contacts') return showContacts(ctx, cid);
      const quick = parseQuickBookingPhrase(txt);
      if (quick) {
        await startBookingWithService(ctx, cid, msg.from, quick.svcId, quick.dateHint, quick.timeHint);
        return;
      }
    }
    const showConsultBtn = isWantHumanMessage(txt);
    if (ctx.kv && showConsultBtn) await incHumanRequestCount(ctx, cid);
    let extraConsult = showConsultBtn
      ? { reply_markup: { inline_keyboard: [[{ text: t(lg, 'consultant_btn'), callback_data: CB.CONSULT_REQ }]] } }
      : {};
    const consultHint = extraConsult.reply_markup ? '\n\n' + t(lg, 'consultant_btn_hint') : '';
    if (hasHeavyProfanity(txt)) {
      await send(ctx, cid, t(lg, 'consultant_constructive') + consultHint, extraConsult);
      return;
    }
    const history = await getChatHistory(ctx, cid);
    const aiReply = await runWorkersAI(ctx, txt, lg, realRole, history);
    const { text: aiText, actions } = parseAIActions(aiReply);
    const pageActions = ['MY_APTS', 'PRICES', 'CATALOG', 'CONTACTS', 'MAIN', 'BOOK', 'CANCEL_ALL', 'ADM_PANEL', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_MASTERS', 'ADM_CONFIRM_ALL', 'ADM_CANCEL_ALL', 'MST_PANEL', 'MST_TODAY', 'MST_TOMORROW'];
    let didAction = false;
    for (const { tag, param } of actions) {
      if (pageActions.includes(tag) || (tag === 'BOOK' && param)) {
        const ran = await executeAIAction(ctx, cid, realRole, tag, param, msg.from);
        if (ran) { didAction = true; break; }
      }
      if (tag === 'CONSULT') {
        extraConsult = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'consultant_btn'), callback_data: CB.CONSULT_REQ }]] } };
        if (ctx.kv) await incHumanRequestCount(ctx, cid);
      }
    }
    await appendChatTurn(ctx, cid, txt, aiText || (didAction ? '' : null));
    if (didAction) return;
    const finalHint = extraConsult.reply_markup ? '\n\n' + t(lg, 'consultant_btn_hint') : '';
    const toSend = (aiText ? escHtml(aiText) : t(lg, 'unknown')) + finalHint;
    await send(ctx, cid, toSend, extraConsult);
    return;
  }

  if (st.step === 'rp') return finishPhone(ctx, cid, txt, st);

  if (isMyAppointmentsMessage(txt)) return showMyApts(ctx, cid);

  if (txt) {
    const quick = parseQuickBookingPhrase(txt);
    if (quick) {
      return startBookingWithService(ctx, cid, msg.from, quick.svcId, quick.dateHint, quick.timeHint);
    }
  }

  if ((realRole === 'admin' || realRole === 'master') && isConfirmAllRequestsMessage(txt)) {
    const count = await confirmAllPendingApts(ctx, cid);
    const confirmLg = await getLang(ctx, cid) || 'ru';
    const confirmMsg = count > 0 ? fill(t(confirmLg, 'confirm_all_done'), { n: String(count) }) : t(confirmLg, 'confirm_all_none');
    return send(ctx, cid, confirmMsg, { reply_markup: { inline_keyboard: [[{ text: t(confirmLg, 'adm_back'), callback_data: realRole === 'admin' ? CB.ADM_MAIN : CB.MST_MAIN }]] } });
  }

  if (realRole === 'admin' && isAdminCancelAllMessage(txt)) {
    return showAdminCancelAllConfirm(ctx, cid);
  }

  if (txt && /\b(отмени|отменить|скасуй|скасувати|cancel|anuluj)\b/i.test(txt) && /\b(все|всі|всё|all|wszystk)/i.test(txt)) {
    return showCancelAllConfirm(ctx, cid);
  }

  const showConsultBtn = isWantHumanMessage(txt);
  if (ctx.kv && showConsultBtn) await incHumanRequestCount(ctx, cid);
  let extraConsult = showConsultBtn
    ? { reply_markup: { inline_keyboard: [[{ text: t(lg, 'consultant_btn'), callback_data: CB.CONSULT_REQ }]] } }
    : {};
  const consultHint = extraConsult.reply_markup ? '\n\n' + t(lg, 'consultant_btn_hint') : '';
  if (hasHeavyProfanity(txt)) {
    await send(ctx, cid, t(lg, 'consultant_constructive') + consultHint, extraConsult);
    return;
  }
  const history = await getChatHistory(ctx, cid);
  const aiReply = await runWorkersAI(ctx, txt, lg, realRole, history);
  const { text: aiText, actions } = parseAIActions(aiReply);
  const pageActions = ['MY_APTS', 'PRICES', 'CATALOG', 'CONTACTS', 'MAIN', 'BOOK', 'CANCEL_ALL', 'ADM_PANEL', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_MASTERS', 'ADM_CONFIRM_ALL', 'ADM_CANCEL_ALL', 'MST_PANEL', 'MST_TODAY', 'MST_TOMORROW'];
  let didAction = false;
  for (const { tag, param } of actions) {
    if (pageActions.includes(tag) || (tag === 'BOOK' && param)) {
      const ran = await executeAIAction(ctx, cid, realRole, tag, param, msg.from);
      if (ran) { didAction = true; break; }
    }
    if (tag === 'CONSULT') {
      extraConsult = { reply_markup: { inline_keyboard: [[{ text: t(lg, 'consultant_btn'), callback_data: CB.CONSULT_REQ }]] } };
      if (ctx.kv) await incHumanRequestCount(ctx, cid);
    }
  }
  await appendChatTurn(ctx, cid, txt, aiText || (didAction ? '' : null));
  if (didAction) return;
  const finalHint = extraConsult.reply_markup ? '\n\n' + t(lg, 'consultant_btn_hint') : '';
  const toSend = (aiText ? escHtml(aiText) : t(lg, 'unknown')) + finalHint;
  await send(ctx, cid, toSend, extraConsult);
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
  await send(ctx, cid, t(lg, 'now_choose'), svcKb(ctx, lg));
}

// ─── Callback handler (with validation) ──────────────────────

async function onCb(ctx, cb) {
  if (!cb?.message?.chat?.id || !cb?.from || !cb?.data) return;
  if (cb.message.chat.type !== 'private') return;

  const cid = cb.message.chat.id;
  if (!isValidChatId(cid)) return;
  await answerCb(ctx, cb.id);

  const d = cb.data;
  if (d === CB.NOOP) return;

  if (!await checkRateLimit(ctx, cid)) return;

  const mid = cb.message.message_id;
  const rawName = cb.from.first_name || '';
  const name = escHtml(rawName.slice(0, 64)) || '👋';

  if (d.startsWith(CB.LANG_SET)) {
    const lang = d.slice(CB.LANG_SET.length);
    if (!VALID_LANGS.has(lang)) return;
    await setLang(ctx, cid, lang);
    await send(ctx, cid, t(lang, 'lang_set'));
    return showWelcome(ctx, cid, name);
  }

  const lg = (await getLang(ctx, cid)) || 'ru';

  if (await isBlocked(ctx, cid)) return send(ctx, cid, t(lg, 'client_blocked'));

  if (d === CB.MAIN)     return showWelcome(ctx, cid, name);
  if (d === CB.LANG)     return showLangPick(ctx, cid);
  if (d === CB.BOOK)     return startBooking(ctx, cid, cb.from);

  if (d === CB.CONSULT_REQ) {
    if (ctx.kv) {
      const internalNote = await buildTicketInternalNote(ctx, cid);
      await setTicket(ctx, cid, { open: true, masterCid: null, since: Date.now(), internalNote: internalNote || null });
      await notifyStaffConsultantRequest(ctx, cid, {
        reply_markup: { inline_keyboard: [
          [{ text: t(lg, 'ticket_take_btn'), callback_data: CB.TICKET_TAKE + cid },
           { text: t(lg, 'ticket_decline_btn'), callback_data: CB.TICKET_DECLINE + cid }],
        ] },
      }, internalNote);
      await resetHumanRequestCount(ctx, cid);
    }
    await send(ctx, cid, t(lg, 'ticket_desc'));
    await send(ctx, cid, t(lg, 'consultant_sent'));
    return;
  }

  if (d.startsWith(CB.TICKET_DECLINE)) {
    const clientCid = parseInt(d.slice(CB.TICKET_DECLINE.length), 10);
    if (!clientCid) return;
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid))) return;
    const ticket = await getTicket(ctx, clientCid);
    if (!ticket?.open) return;
    await clearTicket(ctx, clientCid);
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, t(clg, 'ticket_declined'));
    return;
  }

  if (d.startsWith(CB.TICKET_TAKE)) {
    const clientCid = parseInt(d.slice(CB.TICKET_TAKE.length), 10);
    if (!clientCid) return;
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid))) return;
    const ticket = await getTicket(ctx, clientCid);
    if (!ticket?.open) return;
    await setTicket(ctx, clientCid, { ...ticket, masterCid: cid });
    await setTicketMaster(ctx, cid, clientCid);
    const masterName = escHtml((cb.from?.first_name || '').trim() || 'Мастер');
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, fill(t(clg, 'ticket_taken_by'), { name: masterName }));
    let masterMsg = t(lg, 'ticket_master_hint');
    if (ticket.internalNote && ticket.internalNote.trim()) {
      masterMsg += '\n\n' + fill(t(lg, 'ticket_internal_note'), { note: escHtml(ticket.internalNote.trim()) });
    }
    await send(ctx, cid, masterMsg, {
      reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'ticket_close_btn'), callback_data: CB.TICKET_CLOSE + clientCid },
         { text: t(lg, 'ticket_free_correction_btn'), callback_data: CB.TICKET_FREE_CORRECTION + clientCid }],
      ] },
    });
    return;
  }

  if (d.startsWith(CB.TICKET_FREE_CORRECTION)) {
    const clientCid = parseInt(d.slice(CB.TICKET_FREE_CORRECTION.length), 10);
    if (!clientCid) return;
    if (!(await isAdmin(ctx, cid)) && !(await isMaster(ctx, cid))) return;
    const ticket = await getTicket(ctx, clientCid);
    if (!ticket?.open || (ticket.masterCid !== cid && !(await isAdmin(ctx, cid)))) return;
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, t(clg, 'correction_offer_msg'), {
      reply_markup: { inline_keyboard: [[{ text: t(clg, 'correction_book_btn'), callback_data: CB.SERVICE + 'correction' }]] },
    });
    await send(ctx, cid, t(lg, 'ticket_reply_sent'));
    return;
  }

  if (d.startsWith(CB.TICKET_CLOSE)) {
    const clientCid = parseInt(d.slice(CB.TICKET_CLOSE.length), 10);
    if (!clientCid) return;
    const ticket = await getTicket(ctx, clientCid);
    if (!ticket || (ticket.masterCid !== cid && !(await isAdmin(ctx, cid)))) return;
    await clearTicket(ctx, clientCid);
    const clg = await getLang(ctx, clientCid) || 'ru';
    await send(ctx, clientCid, t(clg, 'ticket_closed'));
    await send(ctx, cid, t(lg, 'ticket_closed_master'));
    return;
  }

  // ── Admin callbacks ──
  if (d === CB.ADM_MAIN) {
    if (await isAdmin(ctx, cid)) return showAdminPanel(ctx, cid, name);
    if (await isMaster(ctx, cid)) return showMasterPanel(ctx, cid, name);
    return;
  }

  if (d === CB.ADM_TODAY || d === CB.ADM_TOMORROW) {
    if (!await isAdmin(ctx, cid)) return;
    const offset = d === CB.ADM_TOMORROW ? 1 : 0;
    const w = warsawNow();
    const dt = new Date(Date.UTC(w.year, w.month - 1, w.day + offset));
    const ds = `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;
    return showAdminApts(ctx, cid, ds);
  }

  if (d === CB.ADM_MASTERS) {
    if (!await isAdmin(ctx, cid)) return;
    return showMastersList(ctx, cid);
  }

  if (d === CB.ADM_ADD_M) {
    if (!await isAdmin(ctx, cid)) return;
    await setState(ctx, cid, { step: 'add_master' });
    return send(ctx, cid, t(lg, 'adm_enter_master_id'));
  }

  if (d.startsWith(CB.ADM_DEL_M)) {
    if (!await isAdmin(ctx, cid)) return;
    const mId = parseInt(d.slice(CB.ADM_DEL_M.length));
    if (mId) await deleteMaster(ctx, mId);
    await send(ctx, cid, t(lg, 'adm_master_removed'));
    return showMastersList(ctx, cid);
  }

  if (d.startsWith(CB.ADM_VACATION)) {
    if (!await isAdmin(ctx, cid)) return;
    const mId = parseInt(d.slice(CB.ADM_VACATION.length));
    const m = mId ? await getMaster(ctx, mId) : null;
    if (!m) return showMastersList(ctx, cid);
    m.onVacation = !m.onVacation;
    await saveMaster(ctx, mId, m);
    await send(ctx, cid, m.onVacation ? t(lg, 'adm_vacation_on') : t(lg, 'adm_vacation_off'));
    return showMastersList(ctx, cid);
  }

  if (d === CB.ADM_CLIENTS) {
    if (!await isAdmin(ctx, cid)) return;
    return showClientsList(ctx, cid, 0);
  }

  if (d.startsWith(CB.ADM_CLIENTS_PAGE)) {
    if (!await isAdmin(ctx, cid)) return;
    const page = parseInt(d.slice(CB.ADM_CLIENTS_PAGE.length)) || 0;
    return showClientsList(ctx, cid, page, mid);
  }

  if (d === CB.ADM_ABOUT) {
    if (!await isAdmin(ctx, cid)) return;
    return showAboutSettings(ctx, cid);
  }

  if (d === CB.ADM_ABOUT_PHOTOS) {
    if (!await isAdmin(ctx, cid)) return;
    return showAboutPhotos(ctx, cid);
  }

  if (d === CB.ADM_ABOUT_DESC) {
    if (!await isAdmin(ctx, cid)) return;
    return showAboutDescEdit(ctx, cid);
  }

  if (d === CB.ADM_ABOUT_INSTAGRAM) {
    if (!await isAdmin(ctx, cid)) return;
    return showAboutInstagramEdit(ctx, cid);
  }

  if (d === CB.ADM_ABOUT_PHOTO_ADD) {
    if (!await isAdmin(ctx, cid)) return;
    await setState(ctx, cid, { step: 'add_about_photo' });
    return send(ctx, cid, t(lg, 'svc_enter_photo'));
  }

  if (d.startsWith(CB.ADM_ABOUT_PHOTO_DEL)) {
    if (!await isAdmin(ctx, cid)) return;
    const idx = parseInt(d.slice(CB.ADM_ABOUT_PHOTO_DEL.length));
    const photos = await loadAboutPhotos(ctx);
    if (idx >= 0 && idx < photos.length) {
      photos.splice(idx, 1);
      await saveAboutPhotos(ctx, photos);
    }
    await send(ctx, cid, t(lg, 'svc_photo_deleted'));
    return showAboutPhotos(ctx, cid);
  }

  // ── Block/Unblock ──
  if (d.startsWith(CB.ADM_BLOCK)) {
    if (!await isAdmin(ctx, cid)) return;
    const targetId = parseInt(d.slice(CB.ADM_BLOCK.length));
    if (targetId) await blockUser(ctx, targetId);
    await send(ctx, cid, t(lg, 'adm_blocked'));
    return showClientsList(ctx, cid);
  }

  if (d.startsWith(CB.ADM_UNBLOCK)) {
    if (!await isAdmin(ctx, cid)) return;
    const targetId = parseInt(d.slice(CB.ADM_UNBLOCK.length));
    if (targetId) await unblockUser(ctx, targetId);
    await send(ctx, cid, t(lg, 'adm_unblocked'));
    return showClientsList(ctx, cid);
  }

  // ── Admin cancel appointment ──
  if (d.startsWith(CB.ADM_CANCEL_APT)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.ADM_CANCEL_APT.length);
    await setState(ctx, cid, { step: 'admin_cancel_reason', aptId });
    return send(ctx, cid, t(lg, 'adm_cancel_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_cancel_skip'), callback_data: CB.ADM_CANCEL_SKIP + aptId }],
      [{ text: t(lg, 'adm_prev'), callback_data: CB.ADM_MAIN }],
    ]}});
  }

  if (d.startsWith(CB.ADM_CANCEL_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.ADM_CANCEL_SKIP.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.cx) { await clearState(ctx, cid); return; }
    const cancelled = await cancelApt(ctx, apt.id, cid, true);
    await clearState(ctx, cid);
    if (cancelled) {
      const clg = await getLang(ctx, cancelled.chatId) || 'ru';
      await send(ctx, cancelled.chatId, fill(t(clg, 'client_cancelled_admin'), {
        svc: svcName(ctx, clg, cancelled.svcId), dt: fmtDT(clg, cancelled.date, cancelled.time),
        reason: '—',
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
        [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
      ]}});
    }
    return send(ctx, cid, t(lg, 'adm_apt_cancelled'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'adm_prev'), callback_data: CB.ADM_MAIN }],
    ]}});
  }

  if (d === CB.ADM_CANCEL_ALL_YES) {
    if (!await isAdmin(ctx, cid)) return;
    const apts = await getAdminAllApts(ctx);
    let count = 0;
    for (const apt of apts) {
      const cancelled = await cancelApt(ctx, apt.id, cid, true);
      if (cancelled) {
        count++;
        const clg = await getLang(ctx, cancelled.chatId) || 'ru';
        await send(ctx, cancelled.chatId, fill(t(clg, 'client_cancelled_admin'), {
          svc: svcName(ctx, clg, cancelled.svcId), dt: fmtDT(clg, cancelled.date, cancelled.time),
          reason: '—',
        }), { reply_markup: { inline_keyboard: [
          [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
          [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
        ]}});
      }
    }
    return send(ctx, cid, fill(t(lg, 'adm_cancel_all_done'), { n: String(count) }), { reply_markup: { inline_keyboard: [[{ text: t(lg, 'adm_back'), callback_data: CB.ADM_MAIN }]] } });
  }

  // ── Appointment confirm/reject/counter (master & admin) ──
  if (d.startsWith(CB.APT_CONFIRM)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_CONFIRM.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'confirmed';
    apt.confirmedBy = cid;
    await kvPut(ctx, `ap:${aptId}`, apt);
    await sendAptConfirmedToClient(ctx, apt);
    return send(ctx, cid, fill(t(lg, 'mst_apt_confirmed'), { client: escHtml(apt.userName), dt: fmtDT(lg, apt.date, apt.time) }));
  }

  if (d.startsWith(CB.APT_REJECT) && !d.startsWith(CB.APT_REJECT_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_REJECT.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    await setState(ctx, cid, { step: 'reject_comment', aptId });
    return send(ctx, cid, t(lg, 'mst_reject_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'mst_skip'), callback_data: CB.APT_REJECT_SKIP + aptId }],
    ]}});
  }

  if (d.startsWith(CB.APT_REJECT_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_REJECT_SKIP.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'rejected';
    await kvPut(ctx, `ap:${aptId}`, apt);
    await clearState(ctx, cid);
    const clg = await getLang(ctx, apt.chatId) || 'ru';
    let clientMsg = fill(t(clg, 'apt_rejected'), { svc: svcName(ctx, clg, apt.svcId), dt: fmtDT(clg, apt.date, apt.time) });
    clientMsg += t(clg, 'apt_rebook');
    await send(ctx, apt.chatId, clientMsg, { reply_markup: { inline_keyboard: [
      [{ text: t(clg, 'rebook'), callback_data: CB.BOOK }],
      [{ text: t(clg, 'back_m'), callback_data: CB.MAIN }],
    ]}});
    return send(ctx, cid, fill(t(lg, 'mst_apt_rejected'), { client: escHtml(apt.userName), dt: fmtDT(lg, apt.date, apt.time) }));
  }

  if (d.startsWith(CB.APT_COUNTER) && !d.startsWith(CB.APT_COUNTER_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_COUNTER.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    await setState(ctx, cid, { step: 'counter_time', aptId });
    return send(ctx, cid, t(lg, 'mst_counter_time'));
  }

  if (d.startsWith(CB.APT_COUNTER_SKIP)) {
    if (!await canManageApt(ctx, cid)) return;
    const aptId = d.slice(CB.APT_COUNTER_SKIP.length);
    const st = await getState(ctx, cid);
    if (st.step !== 'counter_comment' || st.aptId !== aptId) return;
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || (apt.status !== 'pending' && apt.status !== 'counter_offer')) return send(ctx, cid, t(lg, 'mst_already_done'));
    apt.status = 'counter_offer';
    apt.counterTime = st.newTime;
    apt.counterComment = null;
    apt.confirmedBy = cid;
    await kvPut(ctx, `ap:${aptId}`, apt);
    await clearState(ctx, cid);
    const clg = await getLang(ctx, apt.chatId) || 'ru';
    await send(ctx, apt.chatId, fill(t(clg, 'apt_counter'), { svc: svcName(ctx, clg, apt.svcId), d: fmtDate(clg, apt.date), newtime: st.newTime }), { reply_markup: { inline_keyboard: [
      [{ text: t(clg, 'apt_accept'), callback_data: CB.APT_ACCEPT + apt.id }],
      [{ text: t(clg, 'apt_decline'), callback_data: CB.APT_DECLINE + apt.id }],
      [{ text: t(clg, 'apt_reply_btn'), callback_data: CB.APT_REPLY + apt.id }],
    ]}});
    return send(ctx, cid, t(lg, 'mst_counter_sent'));
  }

  // ── Client response to counter-offer ──
  if (d.startsWith(CB.APT_ACCEPT)) {
    const aptId = d.slice(CB.APT_ACCEPT.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.status !== 'counter_offer' || apt.chatId !== cid) return;
    const newTime = apt.counterTime;
    apt.time = newTime;
    const [y, mo, dd] = apt.date.split('-').map(Number);
    const [h, mi] = newTime.split(':').map(Number);
    apt.ts = warsawToUTC(y, mo, dd, h, mi).getTime();
    apt.status = 'confirmed';
    await kvPut(ctx, `ap:${aptId}`, apt);
    await sendAptConfirmedToClient(ctx, apt);
    if (apt.confirmedBy) {
      const mlg = await getLang(ctx, apt.confirmedBy) || 'ru';
      await send(ctx, apt.confirmedBy, fill(t(mlg, 'mst_client_accepted'), { client: escHtml(apt.userName), newtime: newTime }));
    }
    return;
  }

  if (d.startsWith(CB.APT_DECLINE)) {
    const aptId = d.slice(CB.APT_DECLINE.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.chatId !== cid) return;
    await setState(ctx, cid, { step: 'client_reply', aptId });
    await send(ctx, cid, t(lg, 'apt_enter_reply'));
    if (apt.confirmedBy) {
      const mlg = await getLang(ctx, apt.confirmedBy) || 'ru';
      await send(ctx, apt.confirmedBy, fill(t(mlg, 'mst_client_declined'), { client: escHtml(apt.userName) }));
    }
    return;
  }

  if (d.startsWith(CB.APT_REPLY)) {
    const aptId = d.slice(CB.APT_REPLY.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.chatId !== cid) return;
    await setState(ctx, cid, { step: 'client_reply', aptId });
    return send(ctx, cid, t(lg, 'apt_enter_reply'));
  }

  // ── Service management callbacks ──
  if (d === CB.SVC_LIST) {
    if (!await canManageApt(ctx, cid)) return;
    return showServicesList(ctx, cid);
  }

  if (d.startsWith(CB.SVC_EDIT)) {
    if (!await canManageApt(ctx, cid)) return;
    return showServiceEdit(ctx, cid, d.slice(CB.SVC_EDIT.length));
  }

  if (d.startsWith(CB.SVC_NAME)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: 'edit_svc_name', svcId: d.slice(CB.SVC_NAME.length) });
    return send(ctx, cid, t(lg, 'svc_enter_name'));
  }

  if (d.startsWith(CB.SVC_PRICE)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: 'edit_svc_price', svcId: d.slice(CB.SVC_PRICE.length) });
    return send(ctx, cid, t(lg, 'svc_enter_price'));
  }

  if (d.startsWith(CB.SVC_DUR)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: 'edit_svc_dur', svcId: d.slice(CB.SVC_DUR.length) });
    return send(ctx, cid, t(lg, 'svc_enter_dur'));
  }

  if (d.startsWith(CB.SVC_DESC)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: 'edit_svc_desc', svcId: d.slice(CB.SVC_DESC.length) });
    return send(ctx, cid, t(lg, 'svc_enter_desc'));
  }

  if (d.startsWith(CB.SVC_EMOJI)) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: 'edit_svc_emoji', svcId: d.slice(CB.SVC_EMOJI.length) });
    return send(ctx, cid, t(lg, 'svc_enter_emoji'));
  }

  if (d.startsWith(CB.SVC_TOGGLE)) {
    if (!await canManageApt(ctx, cid)) return;
    const svcId = d.slice(CB.SVC_TOGGLE.length);
    const s = ctx.svc.find(x => x.id === svcId);
    if (s) {
      s.active = !(s.active !== false);
      await saveServices(ctx, ctx.svc);
    }
    return showServiceEdit(ctx, cid, svcId);
  }

  if (d.startsWith(CB.SVC_DEL)) {
    if (!await canManageApt(ctx, cid)) return;
    const svcId = d.slice(CB.SVC_DEL.length);
    ctx.svc = ctx.svc.filter(x => x.id !== svcId);
    await saveServices(ctx, ctx.svc);
    await send(ctx, cid, t(lg, 'svc_deleted'));
    return showServicesList(ctx, cid);
  }

  if (d === CB.SVC_ADD) {
    if (!await canManageApt(ctx, cid)) return;
    await setState(ctx, cid, { step: 'add_svc_id' });
    return send(ctx, cid, t(lg, 'svc_enter_id'));
  }

  if (d.startsWith(CB.SVC_PHOTOS)) {
    if (!await canManageApt(ctx, cid)) return;
    return showServicePhotos(ctx, cid, d.slice(CB.SVC_PHOTOS.length));
  }

  if (d.startsWith(CB.SVC_PHOTO_ADD)) {
    if (!await canManageApt(ctx, cid)) return;
    const svcId = d.slice(CB.SVC_PHOTO_ADD.length);
    await setState(ctx, cid, { step: 'add_svc_photo', svcId });
    return send(ctx, cid, t(lg, 'svc_enter_photo'));
  }

  if (d.startsWith(CB.SVC_PHOTO_DEL)) {
    if (!await canManageApt(ctx, cid)) return;
    const parts = d.slice(CB.SVC_PHOTO_DEL.length).split(':');
    const svcId = parts[0];
    const idx = parseInt(parts[1]);
    const s = ctx.svc.find(x => x.id === svcId);
    if (s?.photos && idx >= 0 && idx < s.photos.length) {
      s.photos.splice(idx, 1);
      await saveServices(ctx, ctx.svc);
    }
    await send(ctx, cid, t(lg, 'svc_photo_deleted'));
    return showServicePhotos(ctx, cid, svcId);
  }

  // ── Master callbacks ──
  if (d === CB.MST_MAIN) return showMasterPanel(ctx, cid, name);

  if (d === CB.MST_TODAY || d === CB.MST_TOMORROW) {
    if (!await isMaster(ctx, cid)) return;
    if (d === CB.MST_TOMORROW) return showMasterAllApts(ctx, cid);
    return showAdminApts(ctx, cid, dateStrForOffset(0));
  }

  if (d === CB.REG_YES) {
    const st = await getState(ctx, cid);
    if (st.step !== 'rc') return;
    st.step = 'rp';
    st.name = st.tgName;
    await setState(ctx, cid, st);
    return send(ctx, cid, fill(t(lg, 'reg_phone'), { n: escHtml(st.tgName) }), {
      reply_markup: { keyboard: [[{ text: t(lg, 'reg_phone_btn'), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }

  if (d === CB.REG_CHANGE) {
    const st = await getState(ctx, cid);
    if (st.step !== 'rc') return;
    st.step = 'rn';
    await setState(ctx, cid, st);
    return send(ctx, cid, t(lg, 'reg_enter_name'));
  }
  if (d === CB.MY)       return showMyApts(ctx, cid);
  if (d === CB.PRICES)   return showPrices(ctx, cid);
  if (d === CB.CONTACTS) return showContacts(ctx, cid);
  if (d === CB.REVIEWS)  return showReviews(ctx, cid);
  if (d === CB.ABOUT)    return showAbout(ctx, cid);
  if (d === CB.CATALOG)  return showCatalog(ctx, cid);

  if (d.startsWith(CB.CAT_PHOTO)) {
    const parts = d.slice(CB.CAT_PHOTO.length).split(':');
    const svcId = parts[0];
    if (!ctx.svcIds.has(svcId)) return;
    const idx = Math.max(0, parseInt(parts[1]) || 0);
    return showCatPhoto(ctx, cid, svcId, idx, mid);
  }

  if (d.startsWith(CB.ABOUT_PHOTO)) {
    const idx = Math.max(0, parseInt(d.slice(CB.ABOUT_PHOTO.length)) || 0);
    return showAbout(ctx, cid, idx, mid);
  }

  if (d.startsWith(CB.SERVICE)) {
    const sid = d.slice(CB.SERVICE.length);
    if (!ctx.svcIds.has(sid)) return;
    const s = ctx.svc.find(x => x.id === sid);
    const user = await getUser(ctx, cid);
    if (!user) {
      return startBooking(ctx, cid, cb.from);
    }
    await setState(ctx, cid, { step: 'date', svcId: sid });
    const chosenText = isCorrectionSvc(sid)
      ? fill(t(lg, 'chosen_correction'), { svc: svcName(ctx, lg, sid) }) + '\n\n' + t(lg, 'choose_date')
      : fill(t(lg, 'chosen'), { svc: svcName(ctx, lg, sid), p: String(s.price), c: t(lg, 'cur'), d: String(s.dur), min: t(lg, 'min') }) + '\n\n' + t(lg, 'choose_date');
    await send(ctx, cid, chosenText, calKb(lg, 0));
    return;
  }

  if (d.startsWith(CB.CAL_MONTH)) {
    const off = Math.max(0, Math.min(2, parseInt(d.slice(CB.CAL_MONTH.length)) || 0));
    return edit(ctx, cid, mid, t(lg, 'choose_date'), calKb(lg, off));
  }

  if (d.startsWith(CB.DATE)) {
    const date = d.slice(CB.DATE.length);
    if (!isValidDate(date)) return;
    if (date < todayStr()) return;
    const st = await getState(ctx, cid);
    if (!st.svcId || !ctx.svcIds.has(st.svcId)) return send(ctx, cid, t(lg, 'book_err'), svcKb(ctx, lg));
    const slots = await getSlots(ctx, date, st.svcId);
    if (!slots.length) return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, date) }), calKb(lg, 0));
    st.step = 'time';
    st.date = date;
    await setState(ctx, cid, st);
    await send(ctx, cid, `📅 <b>${fmtDate(lg, date)}</b>\n${svcName(ctx, lg, st.svcId)}\n\n${t(lg, 'choose_time')}`, timeKb(slots, lg));
    return;
  }

  if (d === CB.CAL_BACK) return send(ctx, cid, t(lg, 'choose_date'), calKb(lg, 0));

  if (d.startsWith(CB.TIME)) {
    const time = d.slice(CB.TIME.length);
    if (!isValidTime(time)) return;
    const st = await getState(ctx, cid);
    if (!st.svcId || !st.date || !ctx.svcIds.has(st.svcId) || !isValidDate(st.date)) {
      return send(ctx, cid, t(lg, 'book_err'), svcKb(ctx, lg));
    }
    st.step = 'conf';
    st.time = time;
    await setState(ctx, cid, st);
    const s = ctx.svc.find(x => x.id === st.svcId);
    const user = await getUser(ctx, cid);
    const confLines = isCorrectionSvc(st.svcId)
      ? [fill(t(lg, 'confirm_correction'), { svc: svcName(ctx, lg, st.svcId), dt: fmtDT(lg, st.date, time), name: escHtml(user?.name || '—'), phone: escHtml(user?.phone || '—') })]
      : [t(lg, 'confirm_title'), '', svcName(ctx, lg, st.svcId), `📅 ${fmtDT(lg, st.date, time)}`, `⏱ ${s.dur} ${t(lg, 'min')}`, `💵 ${s.price} ${t(lg, 'cur')}`, '', `👤 ${escHtml(user?.name || '—')}`, `📱 ${escHtml(user?.phone || '—')}`];
    await send(ctx, cid, confLines.join('\n'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'confirm_yes'), callback_data: CB.CONFIRM }],
      [{ text: t(lg, 'confirm_no'), callback_data: CB.CANCEL_BOOK }],
    ] } });
    return;
  }

  if (d === CB.CONFIRM) {
    const st = await getState(ctx, cid);
    if (st.step !== 'conf' || !st.svcId || !st.date || !st.time) {
      return send(ctx, cid, t(lg, 'book_err'), mainKb(lg));
    }
    if (!ctx.svcIds.has(st.svcId) || !isValidDate(st.date) || !isValidTime(st.time)) {
      return send(ctx, cid, t(lg, 'book_err'), mainKb(lg));
    }

    const lockKey = `lock:slot:${st.date}:${st.time}`;
    const lockTaken = await kvGet(ctx, lockKey);
    if (lockTaken) {
      const fallbackSlots = await getSlots(ctx, st.date, st.svcId);
      if (fallbackSlots.length) {
        return send(ctx, cid, t(lg, 'slot_taken'), timeKb(fallbackSlots, lg));
      }
      return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, st.date) }), calKb(lg, 0));
    }
    await kvPut(ctx, lockKey, 1, { expirationTtl: LOCK_TTL_SEC });

    const slots = await getSlots(ctx, st.date, st.svcId);
    if (!slots.includes(st.time)) {
      if (slots.length) {
        return send(ctx, cid, t(lg, 'slot_taken'), timeKb(slots, lg));
      }
      return send(ctx, cid, fill(t(lg, 'no_slots'), { d: fmtDate(lg, st.date) }), calKb(lg, 0));
    }

    await clearState(ctx, cid);

    const s = ctx.svc.find(x => x.id === st.svcId);
    const user = await getUser(ctx, cid);
    const [y, mo, dd] = st.date.split('-').map(Number);
    const [h, mi] = st.time.split(':').map(Number);
    const ts = warsawToUTC(y, mo, dd, h, mi).getTime();

    const apt = await saveApt(ctx, {
      chatId: cid, svcId: st.svcId, date: st.date, time: st.time, ts,
      userName: user?.name || '?', userPhone: user?.phone || '?',
      userTg: user?.tgUsername ? String(user.tgUsername).replace(/^@+/, '') : null,
    });

    if (!apt) {
      return send(ctx, cid, fill(t(lg, 'book_limit'), { n: String(MAX_APTS) }), mainKb(lg));
    }

    await send(ctx, cid, fill(t(lg, 'apt_pending'), {
      svc: svcName(ctx, lg, st.svcId), dt: fmtDT(lg, st.date, st.time),
    }), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] } });

    await notifyAptStaff(ctx, apt, user);
    return;
  }

  if (d === CB.CANCEL_BOOK) {
    await clearState(ctx, cid);
    return send(ctx, cid, t(lg, 'book_cancelled'), mainKb(lg));
  }

  if (d.startsWith(CB.CANCEL_APT_YES)) {
    const aptId = d.slice(CB.CANCEL_APT_YES.length);
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.chatId !== cid || apt.cx) {
      return send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    await setState(ctx, cid, { step: 'client_cancel_comment', aptId });
    return send(ctx, cid, t(lg, 'cancel_comment_prompt'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cancel_comment_skip'), callback_data: CB.CANCEL_APT_SKIP + aptId }],
      [{ text: t(lg, 'cancel_no'), callback_data: CB.MY }],
    ] } });
  }

  if (d.startsWith(CB.CANCEL_APT_SKIP)) {
    const aptId = d.slice(CB.CANCEL_APT_SKIP.length);
    const apt = await cancelApt(ctx, aptId, cid);
    await clearState(ctx, cid);
    if (apt) {
      await send(ctx, cid, fill(t(lg, 'cancel_ok'), {
        svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
      }), { reply_markup: { inline_keyboard: [
        [{ text: t(lg, 'rebook'), callback_data: CB.BOOK }],
        [{ text: t(lg, 'm_my'), callback_data: CB.MY }],
        [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
      ] } });
      await notifyStaffAptCancelled(ctx, apt);
    } else {
      await send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    return;
  }

  if (d === CB.CANCEL_ALL) {
    return showCancelAllConfirm(ctx, cid);
  }

  if (d === CB.CANCEL_ALL_YES) {
    const apts = await getApts(ctx, cid);
    for (const apt of apts) {
      const cancelled = await cancelApt(ctx, apt.id, cid);
      if (cancelled) await notifyStaffAptCancelled(ctx, cancelled);
    }
    return send(ctx, cid, t(lg, 'cancel_all_ok'), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'm_book'), callback_data: CB.BOOK }],
      [{ text: t(lg, 'back_m'), callback_data: CB.MAIN }],
    ] } });
  }

  if (d.startsWith(CB.CANCEL_APT)) {
    const aptId = d.slice(CB.CANCEL_APT.length);
    if (!/^a\d+_\w+$/.test(aptId)) return;
    const apt = await kvGet(ctx, `ap:${aptId}`);
    if (!apt || apt.chatId !== cid || apt.cx) {
      return send(ctx, cid, t(lg, 'cancel_err'), mainKb(lg));
    }
    return send(ctx, cid, fill(t(lg, 'cancel_confirm'), {
      svc: svcName(ctx, lg, apt.svcId), dt: fmtDT(lg, apt.date, apt.time),
    }), { reply_markup: { inline_keyboard: [
      [{ text: t(lg, 'cancel_yes'), callback_data: CB.CANCEL_APT_YES + aptId }],
      [{ text: t(lg, 'cancel_no'), callback_data: CB.MY }],
    ] } });
  }
}

// ─── Cron: Reminders + Cleanup ───────────────────────────────

async function handleCron(ctx) {
  await initServices(ctx);
  const now = Date.now();
  const w = warsawNow();

  // Phase 1: reminders — only scan today + tomorrow (not all appointments)
  const reminderDates = [];
  for (const off of [0, 1]) {
    const d = new Date(Date.UTC(w.year, w.month - 1, w.day + off));
    reminderDates.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`);
  }
  for (const date of reminderDates) {
    const ids = (await kvGet(ctx, dayIndexKey(date))) || [];
    for (const id of ids) {
      try {
        const a = await kvGet(ctx, `ap:${id}`);
        if (!a || a.cx) continue;
        if (a.status && a.status !== 'confirmed') continue;
        const diffH = (a.ts - now) / 3600000;
        if (diffH < -1 || diffH > 25) continue;
        const lg = (await getLang(ctx, a.chatId)) || 'ru';
        const vars = { svc: svcName(ctx, lg, a.svcId), dt: fmtDT(lg, a.date, a.time), addr: ADDRESS, maps: MAPS_URL };
        let sent = false;
        if (!a.rem.h24 && diffH <= 25 && diffH > 23) { a.rem.h24 = true; sent = true; await send(ctx, a.chatId, fill(t(lg, 'rem_24'), vars)); }
        if (!a.rem.h2  && diffH <= 2.5 && diffH > 1.5) { a.rem.h2 = true; sent = true; await send(ctx, a.chatId, fill(t(lg, 'rem_2'), vars)); }
        if (sent) await kvPut(ctx, `ap:${id}`, a);
      } catch (e) {
        console.error(`Cron reminder error for apt ${id}:`, e.message);
      }
    }
  }

  // Phase 2: cleanup — scan current + previous month, remove expired/cancelled
  const monthsToClean = [];
  for (const off of [-1, 0]) {
    const d = new Date(Date.UTC(w.year, w.month - 1 + off, 1));
    monthsToClean.push(`all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`);
  }
  const cleanedAptIds = new Set();
  for (const monthKey of monthsToClean) {
    const allIds = (await kvGet(ctx, monthKey)) || [];
    const kept = [];
    for (const id of allIds) {
      try {
        const a = await kvGet(ctx, `ap:${id}`);
        if (!a) continue;
        if ((a.ts < now - CLEANUP_AFTER_MS) || a.cx) {
          cleanedAptIds.add(id);
          await kvDel(ctx, `ap:${id}`);
          const dKey = dayIndexKey(a.date, getAptMasterId(a));
          const dl = (await kvGet(ctx, dKey)) || [];
          const newDl = dl.filter(x => x !== id);
          if (newDl.length !== dl.length) {
            if (newDl.length === 0) await kvDel(ctx, dKey);
            else await kvPut(ctx, dKey, newDl);
          }
          continue;
        }
        kept.push(id);
      } catch (e) {
        console.error(`Cron cleanup error for apt ${id}:`, e.message);
        kept.push(id);
      }
    }
    if (kept.length !== allIds.length) {
      if (kept.length === 0) await kvDel(ctx, monthKey);
      else await kvPut(ctx, monthKey, kept);
    }
  }

  // Phase 3: prune ua:${chatId} lists — remove stale IDs
  if (cleanedAptIds.size > 0) {
    const userKeys = await kvListAll(ctx, { prefix: 'ua:' });
    for (const k of userKeys) {
      try {
        const ids = (await kvGet(ctx, k.name)) || [];
        const pruned = ids.filter(id => !cleanedAptIds.has(id));
        if (pruned.length !== ids.length) {
          if (pruned.length === 0) await kvDel(ctx, k.name);
          else await kvPut(ctx, k.name, pruned);
        }
      } catch (e) {
        console.error(`Cron ua cleanup error for ${k.name}:`, e.message);
      }
    }
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
    ctx.baseUrl = url.origin;
    const ADMIN_401 = new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="ManicBot Admin"' },
    });

    // ── Admin: set webhook (key-protected, curl-friendly)
    if (url.pathname === '/setup') {
      if (!timingSafeEqual(url.searchParams.get('key') || '', ctx.ADMIN_KEY)) {
        return new Response('Forbidden', { status: 403 });
      }
      const wh = `${url.origin}/webhook`;
      const [r, cmds] = await Promise.all([
        api(ctx, 'setWebhook', {
          url: wh,
          secret_token: ctx.WEBHOOK_SECRET,
          allowed_updates: ['message', 'callback_query'],
        }),
        api(ctx, 'setMyCommands', {
          commands: [
            { command: 'start', description: '💅 Главное меню / Main menu' },
            { command: 'book', description: '📝 Записаться / Book now' },
            { command: 'my', description: '📋 Мои записи / My appointments' },
            { command: 'lang', description: '🌐 Язык / Language' },
          ],
        }),
      ]);
      return Response.json({ webhook: wh, result: r, commands: cmds });
    }

    // ── Admin: remove webhook (key-protected, curl-friendly)
    if (url.pathname === '/remove-webhook') {
      if (!timingSafeEqual(url.searchParams.get('key') || '', ctx.ADMIN_KEY)) {
        return new Response('Forbidden', { status: 403 });
      }
      return Response.json({ result: await api(ctx, 'deleteWebhook', {}) });
    }

    // ── Admin panel (Basic Auth)
    if (url.pathname === '/admin') {
      if (!checkAdmin(request, ctx.ADMIN_KEY)) return ADMIN_401;
      if (!ctx.kv) return new Response('KV not bound', { status: 500 });
      await initServices(ctx);

      const adminW = warsawNow();
      const adminMonthKeys = [-2, -1, 0].map(off => {
        const d = new Date(Date.UTC(adminW.year, adminW.month - 1 + off, 1));
        return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
      });
      const monthBuckets = await Promise.all(adminMonthKeys.map(k => kvGet(ctx, k)));
      const allIds = [...new Set(monthBuckets.flatMap(b => b || []))];
      const userKeys = await kvListAll(ctx, { prefix: 'u:' });

      const [aptRecords, userRecords] = await Promise.all([
        Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`))),
        Promise.all(userKeys.map(k => kvGet(ctx, k.name))),
      ]);

      const appointments = aptRecords
        .filter(Boolean)
        .map(a => {
          const svc = ctx.svc.find(x => x.id === a.svcId);
          return {
            id: a.id,
            client: a.userName,
            chatId: a.chatId,
            service: svc ? `${svc.e} ${a.svcId}` : a.svcId,
            date: a.date,
            time: a.time,
            status: a.cx ? '❌ Отменено' : a.status === 'pending' ? '⏳ Ожидает' : a.status === 'rejected' ? '❌ Отклонено' : a.status === 'counter_offer' ? '💬 Предложен другой час' : (a.ts < Date.now() ? '✅ Завершено' : '✅ Подтверждено'),
            created: new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' '),
          };
        });

      const clients = userRecords
        .filter(Boolean)
        .map(u => ({
          chatId: u.chatId,
          name: u.name,
          phone: u.phone,
          username: u.tgUsername ? `@${u.tgUsername}` : '—',
          lang: u.tgLang || '—',
          registered: u.registeredAt ? new Date(u.registeredAt).toISOString().slice(0, 16).replace('T', ' ') : '—',
        }));

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
<div class="stat"><b>${appointments.filter(a => a.status === '✅ Подтверждено').length}</b>Предстоит</div>
</div>

<h2>👥 Клиенты</h2>
<a class="export" href="/admin/export/clients.csv">📥 Скачать CSV</a>
<table>
<tr><th>Chat ID</th><th>Имя</th><th>Телефон</th><th>Username</th><th>Язык</th><th>Дата рег.</th></tr>`;
      for (const c of clients) {
        html += `<tr><td>${escHtml(c.chatId)}</td><td>${escHtml(c.name)}</td><td>${escHtml(c.phone)}</td><td>${escHtml(c.username)}</td><td>${escHtml(c.lang)}</td><td>${escHtml(c.registered)}</td></tr>`;
      }
      html += `</table>

<h2>📋 Записи</h2>
<a class="export" href="/admin/export/appointments.csv">📥 Скачать CSV</a>
<table>
<tr><th>ID</th><th>Клиент</th><th>Chat ID</th><th>Услуга</th><th>Дата</th><th>Время</th><th>Статус</th><th>Создано</th></tr>`;
      for (const a of appointments) {
        html += `<tr><td>${escHtml(a.id)}</td><td>${escHtml(a.client)}</td><td>${escHtml(a.chatId)}</td><td>${escHtml(a.service)}</td><td>${escHtml(a.date)}</td><td>${escHtml(a.time)}</td><td>${escHtml(a.status)}</td><td>${escHtml(a.created)}</td></tr>`;
      }
      html += `</table></body></html>`;

      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    // ── CSV export (Basic Auth)
    if (url.pathname.startsWith('/admin/export/') && ctx.kv) {
      if (!checkAdmin(request, ctx.ADMIN_KEY)) return ADMIN_401;
      await initServices(ctx);
      const file = url.pathname.split('/').pop();

      if (file === 'clients.csv') {
        const userKeys = await kvListAll(ctx, { prefix: 'u:' });
        const users = await Promise.all(userKeys.map(k => kvGet(ctx, k.name)));
        let csv = 'Chat ID,Name,Phone,Username,Language,Registered\n';
        for (const u of users) {
          if (!u) continue;
          csv += `${u.chatId},"${(u.name||'').replace(/"/g,'""')}",${u.phone},${u.tgUsername||''},${u.tgLang||''},${u.registeredAt ? new Date(u.registeredAt).toISOString() : ''}\n`;
        }
        return new Response(csv, { headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="clients.csv"' } });
      }

      if (file === 'appointments.csv') {
        const csvW = warsawNow();
        const csvMonthKeys = [-2, -1, 0].map(off => {
          const d = new Date(Date.UTC(csvW.year, csvW.month - 1 + off, 1));
          return `all:${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
        });
        const csvBuckets = await Promise.all(csvMonthKeys.map(k => kvGet(ctx, k)));
        const allIds = [...new Set(csvBuckets.flatMap(b => b || []))];
        const apts = await Promise.all(allIds.map(id => kvGet(ctx, `ap:${id}`)));
        let csv = 'ID,Client,Chat ID,Service,Date,Time,Status,Created\n';
        for (const a of apts) {
          if (!a) continue;
          const status = a.cx ? 'Cancelled' : a.status === 'pending' ? 'Pending' : a.status === 'rejected' ? 'Rejected' : a.status === 'counter_offer' ? 'Counter-offer' : (a.ts < Date.now() ? 'Completed' : 'Confirmed');
          csv += `${a.id},"${(a.userName||'').replace(/"/g,'""')}",${a.chatId},${a.svcId},${a.date},${a.time},${status},${new Date(a.createdAt).toISOString()}\n`;
        }
        return new Response(csv, { headers: { 'Content-Type': 'text/csv;charset=utf-8', 'Content-Disposition': 'attachment; filename="appointments.csv"' } });
      }
    }

    // ── Calendar ICS
    const calMatch = request.method === 'GET' && url.pathname.match(/^\/calendar\/(.+)$/);
    if (calMatch) {
      const rawId = calMatch[1];
      const aptId = rawId.endsWith('.ics') ? rawId.slice(0, -4) : rawId;
      if (!/^a\d+_\w+$/.test(aptId)) {
        return new Response('Invalid appointment ID', { status: 400 });
      }
      if (!ctx.kv) return new Response('Service unavailable', { status: 503 });
      await initServices(ctx);
      const apt = await ctx.kv.get(ctx.prefix + 'ap:' + aptId, 'json');
      if (!apt || apt.cx) {
        return new Response('Appointment not found', { status: 404 });
      }
      const svc = ctx.svc.find(x => x.id === apt.svcId);
      if (!svc) return new Response('Service not found', { status: 404 });

      const userLang = await getLang(ctx, apt.chatId) || 'ru';
      const ics = makeICS(ctx, apt, userLang);
      if (!ics) return new Response('Error', { status: 500 });
      const openInline = url.searchParams.get('open') === '1';
      return new Response(ics, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': openInline ? 'inline; filename="manicure.ics"' : 'attachment; filename="manicure.ics"',
        },
      });
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
      const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
      if (!timingSafeEqual(secret, ctx.WEBHOOK_SECRET)) {
        return new Response('Unauthorized', { status: 403 });
      }

      if (!ctx.kv) {
        console.error('KV MANICBOT not bound');
        return new Response('OK');
      }

      try {
        const upd = await request.json();

        await initServices(ctx);

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
