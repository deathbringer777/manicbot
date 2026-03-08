import { describe, it, expect } from 'vitest';
import { isValidDate, isValidTime, warsawNow, todayStr, getDayOfWeek, fmtDate, fmtDT, resolveDateHint, resolveTimeHint, findClosestSlot, p2 } from '../src/utils/date.js';

describe('isValidDate', () => {
  it('accepts valid dates', () => {
    expect(isValidDate('2026-03-15')).toBe(true);
    expect(isValidDate('2026-12-31')).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(isValidDate('15-03-2026')).toBe(false);
    expect(isValidDate('2026/03/15')).toBe(false);
    expect(isValidDate('abc')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });

  it('rejects invalid day/month', () => {
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-00-01')).toBe(false);
  });
});

describe('isValidTime', () => {
  it('accepts valid times (only :00 and :30)', () => {
    expect(isValidTime('09:00')).toBe(true);
    expect(isValidTime('14:30')).toBe(true);
    expect(isValidTime('23:00')).toBe(true);
  });

  it('rejects invalid times', () => {
    expect(isValidTime('09:15')).toBe(false);
    expect(isValidTime('09:45')).toBe(false);
    expect(isValidTime('25:00')).toBe(false);
    expect(isValidTime('abc')).toBe(false);
    expect(isValidTime('')).toBe(false);
  });
});

describe('warsawNow', () => {
  it('returns valid time components', () => {
    const now = warsawNow();
    expect(now.year).toBeGreaterThanOrEqual(2024);
    expect(now.month).toBeGreaterThanOrEqual(1);
    expect(now.month).toBeLessThanOrEqual(12);
    expect(now.day).toBeGreaterThanOrEqual(1);
    expect(now.day).toBeLessThanOrEqual(31);
    expect(now.hour).toBeGreaterThanOrEqual(0);
    expect(now.hour).toBeLessThanOrEqual(23);
    expect(now.minute).toBeGreaterThanOrEqual(0);
    expect(now.minute).toBeLessThanOrEqual(59);
  });
});

describe('todayStr', () => {
  it('returns YYYY-MM-DD format', () => {
    const today = todayStr();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getDayOfWeek', () => {
  it('returns correct day for known date (ru)', () => {
    const day = getDayOfWeek('2026-03-08', 'ru');
    expect(day).toBe('Вс');
  });

  it('returns correct day for known date (en)', () => {
    const day = getDayOfWeek('2026-03-08', 'en');
    expect(day).toBe('Sun');
  });

  it('returns correct day for known date (pl)', () => {
    const day = getDayOfWeek('2026-03-08', 'pl');
    expect(day).toBe('Nd');
  });

  it('defaults to ru if no lang provided', () => {
    const day = getDayOfWeek('2026-03-08');
    expect(day).toBe('Вс');
  });

  it('returns ? for invalid input', () => {
    expect(getDayOfWeek(null)).toBe('?');
    expect(getDayOfWeek('invalid')).toBe('?');
    expect(getDayOfWeek('')).toBe('?');
  });
});

describe('fmtDate', () => {
  it('formats date with localized day and month (ru)', () => {
    const result = fmtDate('ru', '2026-03-15');
    expect(result).toContain('15');
    expect(result).toContain('марта');
  });

  it('formats date with localized day and month (en)', () => {
    const result = fmtDate('en', '2026-03-15');
    expect(result).toContain('15');
    expect(result).toContain('March');
  });

  it('returns raw string for invalid date', () => {
    expect(fmtDate('ru', 'invalid')).toBe('invalid');
  });
});

describe('fmtDT', () => {
  it('combines date and time', () => {
    const result = fmtDT('ru', '2026-03-15', '14:30');
    expect(result).toContain('14:30');
    expect(result).toContain('марта');
  });
});

describe('resolveTimeHint', () => {
  it('parses HH:MM format', () => {
    expect(resolveTimeHint('14:00')).toBe('14:00');
    expect(resolveTimeHint('9:30')).toBe('09:30');
  });

  it('parses bare hour', () => {
    expect(resolveTimeHint('14')).toBe('14:00');
    expect(resolveTimeHint('9')).toBe('09:00');
  });

  it('returns null for invalid input', () => {
    expect(resolveTimeHint(null)).toBeNull();
    expect(resolveTimeHint('')).toBeNull();
    expect(resolveTimeHint('abc')).toBeNull();
  });
});

describe('findClosestSlot', () => {
  it('returns exact match', () => {
    expect(findClosestSlot(['09:00', '10:00', '11:00'], '10:00')).toBe('10:00');
  });

  it('returns closest slot', () => {
    expect(findClosestSlot(['09:00', '11:00', '14:00'], '10:00')).toBe('09:00');
    expect(findClosestSlot(['09:00', '11:00', '14:00'], '12:00')).toBe('11:00');
  });

  it('returns null for empty slots', () => {
    expect(findClosestSlot([], '10:00')).toBeNull();
  });
});
