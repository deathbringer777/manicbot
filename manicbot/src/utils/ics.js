import { ADDRESS } from '../config.js';
import { warsawToUTC } from './date.js';
import { svcName } from './helpers.js';

function escIcs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function makeICS(ctx, apt, lang) {
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

export { escIcs };
