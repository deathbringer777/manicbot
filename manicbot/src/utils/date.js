import { TIMEZONE, DATE_RE, TIME_RE } from '../config.js';
import { p2, t } from './helpers.js';

export function isValidDate(ds) {
  if (!DATE_RE.test(ds)) return false;
  const [y, m, d] = ds.split('-').map(Number);
  const currentYear = warsawNow().year;
  if (y < currentYear || y > currentYear + 2 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function isValidTime(ts) {
  if (!TIME_RE.test(ts)) return false;
  const [h, m] = ts.split(':').map(Number);
  return h >= 0 && h <= 23 && (m === 0 || m === 30);
}

export function warsawNow() {
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

export function warsawToUTC(year, month, day, hour, minute) {
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

export function todayStr() {
  const w = warsawNow();
  return `${w.year}-${p2(w.month)}-${p2(w.day)}`;
}

export function getDayOfWeek(dateStr, lang) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '?';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const days = t(lang || 'ru', 'days');
  return days[dow];
}

export function dateStrForOffset(offset) {
  const w = warsawNow();
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + offset));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

export const DAY_OF_WEEK_MAP = {
  '0': [/воскресенье|неділя|sunday|niedziela/i],
  '1': [/понедельник|понеділок|monday|poniedziałek/i],
  '2': [/вторник|вівторок|tuesday|wtorek/i],
  '3': [/среда|середа|wednesday|środa/i],
  '4': [/четверг|четвер|thursday|czwartek/i],
  '5': [/пятниц|п'ятниц|п'ятниц|friday|piątek|piatek/i],
  '6': [/суббот|субот|saturday|sobota/i],
};

export function resolveDateHint(hint) {
  if (!hint || typeof hint !== 'string') return null;
  const h = hint.trim().toLowerCase();
  if (/^(tomorrow|завтра|jutro|jutra)$/i.test(h)) return dateStrForOffset(1);
  if (/^(after.?tomorrow|послезавтра|післязавтра|pojutrze)$/i.test(h)) return dateStrForOffset(2);
  if (/^(today|сегодня|сьогодні|dziś)$/i.test(h)) return dateStrForOffset(0);
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

export function resolveTimeHint(hint) {
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

export function findClosestSlot(slots, timeStr) {
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

export function fmtDate(lang, ds) {
  if (!isValidDate(ds)) return ds;
  const [y, m, d] = ds.split('-').map(Number);
  const dow = t(lang, 'days')[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${d} ${t(lang, 'monG')[m - 1]} (${dow})`;
}

export function fmtDT(lang, ds, ts) { return `${fmtDate(lang, ds)} ${ts}`; }
