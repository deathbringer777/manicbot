import { describe, it, expect } from 'vitest';
import { escIcs, makeICS } from '../src/utils/ics.js';

describe('escIcs', () => {
  it('escapes special ICS characters', () => {
    expect(escIcs('hello;world')).toBe('hello\\;world');
    expect(escIcs('a,b')).toBe('a\\,b');
    expect(escIcs('line\nnew')).toBe('line\\nnew');
    expect(escIcs('back\\slash')).toBe('back\\\\slash');
  });

  it('handles plain strings', () => {
    expect(escIcs('simple')).toBe('simple');
  });
});

describe('makeICS', () => {
  it('generates valid ICS content', () => {
    const ctx = {
      svc: [
        { id: 'classic', e: '💅', dur: 60, price: 80, active: true, names: { ru: 'Маникюр' } },
      ],
      svcIds: new Set(['classic']),
    };
    const apt = {
      id: 'a1234_abc',
      svcId: 'classic',
      date: '2026-03-15',
      time: '14:00',
    };

    const ics = makeICS(ctx, apt, 'ru');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('a1234_abc@manicbot');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT24H');
    expect(ics).toContain('TRIGGER:-PT2H');
  });

  it('returns empty string for unknown service', () => {
    const ctx = { svc: [], svcIds: new Set() };
    const apt = { id: 'a1_x', svcId: 'unknown', date: '2026-03-15', time: '14:00' };
    expect(makeICS(ctx, apt, 'ru')).toBe('');
  });
});
