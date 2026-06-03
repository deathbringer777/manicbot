/**
 * Tests for resolveMasterDay() — the booking-engine resolver that turns a
 * master's stored schedule into a concrete {open, close, breaks} window for a
 * given UTC weekday. Understands BOTH the new per-day `{days:{…}}` shape and the
 * legacy `{from,to}` + `workDays[]` shape. JS twin of
 * admin-app/src/lib/workHours.ts (kept in lockstep).
 */
import { describe, it, expect } from 'vitest';
import { resolveMasterDay } from '../src/services/masterSchedule.js';

describe('resolveMasterDay — per-day {days} shape', () => {
  const master = {
    workHours: {
      days: {
        mon: { open: '09:00', close: '12:00' },
        tue: { open: '14:00', close: '18:00', break: { start: '15:00', end: '15:30' } },
        wed: null, thu: null, fri: null, sat: null, sun: null,
      },
    },
    workDays: [1, 2], // ignored when the per-day shape is present
  };

  it('returns the per-day window (Monday = dow 1)', () => {
    expect(resolveMasterDay(master, 1)).toEqual({ open: 9, close: 12, breaks: [] });
  });

  it('converts a break to fractional hours (Tuesday = dow 2)', () => {
    expect(resolveMasterDay(master, 2)).toEqual({
      open: 14, close: 18, breaks: [{ start: 15, end: 15.5 }],
    });
  });

  it('returns null for an explicit day off (Wednesday = dow 3)', () => {
    expect(resolveMasterDay(master, 3)).toBeNull();
  });

  it('returns null for Sunday (dow 0) when sun is null', () => {
    expect(resolveMasterDay(master, 0)).toBeNull();
  });

  it('drops an inverted/zero-length break defensively', () => {
    const m = { workHours: { days: { mon: { open: '09:00', close: '18:00', break: { start: '14:00', end: '13:00' } } } } };
    expect(resolveMasterDay(m, 1)).toEqual({ open: 9, close: 18, breaks: [] });
  });
});

describe('resolveMasterDay — legacy {from,to} + workDays shape', () => {
  it('applies the {from,to} window with no breaks on a working day', () => {
    const m = { workHours: { from: 14, to: 16 }, workDays: [1, 3] };
    expect(resolveMasterDay(m, 1)).toEqual({ open: 14, close: 16, breaks: [] });
  });

  it('returns null on a day not in workDays', () => {
    const m = { workHours: { from: 14, to: 16 }, workDays: [1, 3] };
    expect(resolveMasterDay(m, 2)).toBeNull();
  });

  it('treats empty/absent workDays as every day, defaulting to the global window (9..19)', () => {
    const m = { workHours: null, workDays: null };
    expect(resolveMasterDay(m, 2)).toEqual({ open: 9, close: 19, breaks: [] });
  });

  it('applies a custom {from,to} on every day when workDays is empty', () => {
    const m = { workHours: { from: 10, to: 20 }, workDays: [] };
    expect(resolveMasterDay(m, 0)).toEqual({ open: 10, close: 20, breaks: [] });
  });
});
