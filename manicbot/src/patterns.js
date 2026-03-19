import { resolveDateHint, resolveTimeHint } from './utils/date.js';
import { p2 } from './utils/helpers.js';

// ─── Запрос живого консультанта (счётчик + детекция) ───
// ВАЖНО: \b не работает с кириллицей в JS — используем (?:^|\s) и (?:\s|$)
// Поддержка 4 языков: RU, UA, EN, PL
export const WANT_HUMAN_PATTERNS = [
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

export function isWantHumanMessage(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const s = txt.trim().toLowerCase();
  if (s.length < 5) return false;
  return WANT_HUMAN_PATTERNS.some(re => re.test(s));
}

export const MY_APPOINTMENTS_PATTERNS = [
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

export function isMyAppointmentsMessage(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const s = txt.trim();
  if (s.length < 4) return false;
  return MY_APPOINTMENTS_PATTERNS.some(re => re.test(s));
}

export const CONTEXT_PHRASES = {
  prices: [/^(прайс|ціни|prices?|cennik)/i, /\bпрайс\b/i, /\bціни\b/i],
  catalog: [/^(каталог|портфоліо|portfolio)/i, /\bкаталог\b/i],
  contacts: [/^(контакт|contacts?|kontakt|инстаграм|instagram)/i, /\bконтакт/i, /\bинстаграм\b/i],
  main: [/^(главн|меню|main|back|головн|menu|główn)/i, /◀️\s*главн/i, /главное\s*меню/i],
};

export function getContextAction(txt) {
  if (!txt || typeof txt !== 'string') return null;
  const s = txt.trim();
  if (s.length < 2) return null;
  if (CONTEXT_PHRASES.main.some(re => re.test(s))) return 'main';
  if (CONTEXT_PHRASES.prices.some(re => re.test(s))) return 'prices';
  if (CONTEXT_PHRASES.catalog.some(re => re.test(s))) return 'catalog';
  if (CONTEXT_PHRASES.contacts.some(re => re.test(s))) return 'contacts';
  return null;
}

export const CONFIRM_ALL_PATTERNS = [
  /(?:^|\s)подтверди(те)?\s*(все|всі)\s*заявки?(?:\s|$)/i,
  /(?:^|\s)(все|всі)\s*заявки?\s*подтверди(те)?(?:\s|$)/i,
  /(?:^|\s)confirm\s*all\s*(requests?|bookings?|appointments?)(?:\s|$)/i,
  /(?:^|\s)potwierd[źz]\s*wszystkie\s*(zgłoszenia?|rezerwacje?)(?:\s|$)/i,
  /(?:^|\s)zaakceptuj\s*wszystkie(?:\s|$)/i,
];

export const ADMIN_CANCEL_ALL_PATTERNS = [
  /(?:^|\s)отмени(те)?\s*(все|всі)\s*(брони?|записи?|бронь|запис)(?:\s|$)/i,
  /(?:^|\s)отмени(те)?\s*(все|всі)\s*(брони?|записи?)\s*(всех?|усіх?)?\s*(клиентов?|клієнтів?)?(?:\s|$)/i,
  /(?:^|\s)(все|всі)\s*(брони?|записи?)\s*отмени(те)?(?:\s|$)/i,
  /(?:^|\s)cancel\s*all\s*(bookings?|appointments?|reservations?)(?:\s|$)/i,
  /(?:^|\s)anuluj\s*wszystkie\s*(rezerwacje?|wizyty?)(?:\s|$)/i,
];

export function isAdminCancelAllMessage(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const s = txt.trim();
  if (s.length < 8) return false;
  return ADMIN_CANCEL_ALL_PATTERNS.some(re => re.test(s));
}

export function parseQuickBookingPhrase(txt) {
  if (!txt || typeof txt !== 'string' || txt.length < 8) return null;
  const s = txt.trim();
  if (/(^|\s)(не\s+)(запиши|забронируй|записать|book|umów)/i.test(s)) return null;
  if (!/(^|\s)(запиши|забронируй|записать|book|umów)(\s|$)/i.test(s)) return null;
  const svcMap = [
    { re: /(^|\s)(гель|гель-лак|gel)(\s|$)/i, id: 'gel' },
    { re: /(^|\s)(педикюр|педик|pedicure|pedicur)(\s|$)/i, id: 'pedi' },
    { re: /(^|\s)(наращивание|нарощ|extensions?|ext)(\s|$)/i, id: 'ext' },
    { re: /(^|\s)(дизайн|design)(\s|$)/i, id: 'design' },
    { re: /(^|\s)(комбо|combo)(\s|$)/i, id: 'combo' },
    { re: /(^|\s)(маникюр|маник|manicure|manicur|обычный)(\s|$)/i, id: 'classic' },
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
  const timeM = s.match(/(?:^|\s)(?:на|в|о)\s+(\d{1,2})(?::(\d{2}))?\s*(?:часа?|ч(?:\s|$))?/i) || s.match(/\b(\d{1,2})\s*(?:часа|час|ч|:)/i) || s.match(/\b(\d{1,2}):(\d{2})\b/i);
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

export function isConfirmAllRequestsMessage(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const s = txt.trim();
  if (s.length < 5) return false;
  return CONFIRM_ALL_PATTERNS.some(re => re.test(s));
}

export const PROFANITY_PATTERN = /(?:^|\s)(бля|сука|хуй|пизд|ебат|нахер|похер|дерьмо|гавно|мудак|придурок|идиот)\S*/gi;
export function hasHeavyProfanity(txt) {
  if (!txt || typeof txt !== 'string') return false;
  const m = txt.match(PROFANITY_PATTERN);
  return m && m.length >= 2;
}
