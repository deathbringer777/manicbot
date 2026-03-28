/**
 * Tests for src/channels/ui-renderer.js
 *  - extractButtonRows
 *  - truncateButtonText
 *  - splitIntoPages
 *  - adaptCalendarForMeta
 */
import { describe, it, expect } from 'vitest';
import {
  extractButtonRows,
  truncateButtonText,
  splitIntoPages,
  adaptCalendarForMeta,
  BUTTON_TITLE_MAX,
} from '../src/channels/ui-renderer.js';

// ─── extractButtonRows ────────────────────────────────────────────────────────

describe('extractButtonRows', () => {
  it('returns null when tgExtra is null', () => {
    expect(extractButtonRows(null)).toBeNull();
  });

  it('returns null when tgExtra is undefined', () => {
    expect(extractButtonRows(undefined)).toBeNull();
  });

  it('returns null when reply_markup is absent', () => {
    expect(extractButtonRows({})).toBeNull();
  });

  it('returns null when inline_keyboard is absent', () => {
    expect(extractButtonRows({ reply_markup: {} })).toBeNull();
  });

  it('converts Telegram inline_keyboard to normalized rows', () => {
    const extra = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Book', callback_data: 'book' }],
          [{ text: 'Prices', callback_data: 'prices' }, { text: 'Back', callback_data: 'main' }],
        ],
      },
    };
    const rows = extractButtonRows(extra);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([{ text: 'Book', callbackData: 'book' }]);
    expect(rows[1]).toHaveLength(2);
    expect(rows[1][1]).toEqual({ text: 'Back', callbackData: 'main' });
  });

  it('handles missing callback_data gracefully', () => {
    const extra = { reply_markup: { inline_keyboard: [[{ text: 'Btn' }]] } };
    const rows = extractButtonRows(extra);
    expect(rows[0][0].callbackData).toBe('');
  });

  it('handles missing text gracefully', () => {
    const extra = { reply_markup: { inline_keyboard: [[{ callback_data: 'x' }]] } };
    const rows = extractButtonRows(extra);
    expect(rows[0][0].text).toBe('');
  });

  it('returns empty array for empty keyboard', () => {
    const extra = { reply_markup: { inline_keyboard: [] } };
    expect(extractButtonRows(extra)).toEqual([]);
  });
});

// ─── truncateButtonText ───────────────────────────────────────────────────────

describe('truncateButtonText', () => {
  it('BUTTON_TITLE_MAX is 20', () => {
    expect(BUTTON_TITLE_MAX).toBe(20);
  });

  it('returns text unchanged if shorter than max', () => {
    expect(truncateButtonText('Book', 20)).toBe('Book');
  });

  it('returns text unchanged if exactly max length', () => {
    expect(truncateButtonText('12345678901234567890', 20)).toBe('12345678901234567890');
  });

  it('truncates text longer than max with ellipsis', () => {
    const result = truncateButtonText('123456789012345678901', 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith('…')).toBe(true);
  });

  it('truncates at 19 chars + ellipsis when 21 chars', () => {
    const result = truncateButtonText('abcdefghijklmnopqrstu', 20);
    expect(result).toBe('abcdefghijklmnopqrs…');
  });

  it('uses default max of 20 when not specified', () => {
    const long = 'a'.repeat(25);
    const result = truncateButtonText(long);
    expect(result.length).toBe(20);
  });

  it('handles empty string', () => {
    expect(truncateButtonText('', 20)).toBe('');
  });

  it('handles null', () => {
    expect(truncateButtonText(null, 20)).toBe(null);
  });

  it('handles custom max length', () => {
    const result = truncateButtonText('Hello World', 5);
    expect(result).toBe('Hell…');
    expect(result.length).toBe(5);
  });
});

// ─── splitIntoPages ───────────────────────────────────────────────────────────

describe('splitIntoPages', () => {
  const btns = (n) => Array.from({ length: n }, (_, i) => ({ text: `B${i}`, callbackData: `b${i}` }));

  it('returns one page when buttons fit in pageSize', () => {
    const pages = splitIntoPages(btns(5), 10);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(5);
  });

  it('splits evenly into pages', () => {
    const pages = splitIntoPages(btns(20), 10);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(10);
    expect(pages[1]).toHaveLength(10);
  });

  it('last page may be smaller', () => {
    const pages = splitIntoPages(btns(15), 10);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toHaveLength(5);
  });

  it('handles empty array', () => {
    expect(splitIntoPages([], 10)).toEqual([]);
  });

  it('pageSize of 1 creates one row per button', () => {
    const pages = splitIntoPages(btns(3), 1);
    expect(pages).toHaveLength(3);
  });

  it('uses default pageSize of 10', () => {
    const pages = splitIntoPages(btns(25));
    expect(pages).toHaveLength(3);
  });
});

// ─── adaptCalendarForMeta ─────────────────────────────────────────────────────

// Helpers to build fake calendar rows (like calKb produces)
function makeCalendarRows({ month = 'April 2026', dates = [], navPrev = true, navNext = true, actionLabel = 'Other service' } = {}) {
  const rows = [];
  // Nav row
  const nav = [];
  if (navPrev) nav.push({ text: '◀️', callbackData: 'cm:0' });
  nav.push({ text: month, callbackData: '_' });
  if (navNext) nav.push({ text: '▶️', callbackData: 'cm:2' });
  rows.push(nav);
  // Day headers row (all NOOP)
  rows.push(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => ({ text: d, callbackData: '_' })));
  // Date rows (7 per row)
  const padded = [
    ...Array(3).fill({ text: ' ', callbackData: '_' }), // empty cells at start
    ...dates.map(d => ({ text: String(d), callbackData: `dt:2026-04-${String(d).padStart(2, '0')}` })),
  ];
  for (let i = 0; i < padded.length; i += 7) {
    const row = padded.slice(i, i + 7);
    while (row.length < 7) row.push({ text: ' ', callbackData: '_' });
    rows.push(row);
  }
  // Action button
  rows.push([{ text: actionLabel, callbackData: 'book' }]);
  return rows;
}

describe('adaptCalendarForMeta', () => {
  it('returns rows unchanged if null', () => {
    expect(adaptCalendarForMeta(null, 10)).toBeNull();
  });

  it('returns rows unchanged if total buttons <= maxButtons', () => {
    const rows = [[{ text: 'A', callbackData: 'a' }], [{ text: 'B', callbackData: 'b' }]];
    expect(adaptCalendarForMeta(rows, 10)).toBe(rows); // same reference
  });

  it('detects and adapts a full calendar (30 dates)', () => {
    const dates = Array.from({ length: 30 }, (_, i) => i + 1);
    const rows = makeCalendarRows({ dates });
    const adapted = adaptCalendarForMeta(rows, 10);
    const allBtns = adapted.flat();
    expect(allBtns.length).toBeLessThanOrEqual(10);
  });

  it('preserves navigation buttons (prev/next month)', () => {
    const dates = Array.from({ length: 20 }, (_, i) => i + 1);
    const rows = makeCalendarRows({ dates, navPrev: true, navNext: true });
    const adapted = adaptCalendarForMeta(rows, 10);
    const allBtns = adapted.flat();
    const navBtns = allBtns.filter(b => b.callbackData.startsWith('cm:'));
    expect(navBtns.length).toBeGreaterThan(0);
  });

  it('preserves action buttons (Other service)', () => {
    const dates = Array.from({ length: 20 }, (_, i) => i + 1);
    const rows = makeCalendarRows({ dates, actionLabel: 'Other service' });
    const adapted = adaptCalendarForMeta(rows, 10);
    const allBtns = adapted.flat();
    const actionBtns = allBtns.filter(b => b.callbackData === 'book');
    expect(actionBtns.length).toBe(1);
  });

  it('strips NOOP buttons (empty cells and day headers)', () => {
    const dates = Array.from({ length: 20 }, (_, i) => i + 1);
    const rows = makeCalendarRows({ dates });
    const adapted = adaptCalendarForMeta(rows, 10);
    const allBtns = adapted.flat();
    const noopBtns = allBtns.filter(b => b.callbackData === '_');
    expect(noopBtns.length).toBe(0);
  });

  it('includes only date buttons (dt: prefix) as date entries', () => {
    const dates = Array.from({ length: 20 }, (_, i) => i + 1);
    const rows = makeCalendarRows({ dates });
    const adapted = adaptCalendarForMeta(rows, 10);
    const allBtns = adapted.flat();
    const dateBtns = allBtns.filter(b => b.callbackData.startsWith('dt:'));
    expect(dateBtns.length).toBeGreaterThan(0);
    // Should be within budget: total ≤ 10
    expect(allBtns.length).toBeLessThanOrEqual(10);
  });

  it('does not adapt non-calendar button sets', () => {
    // Service list buttons — not a calendar
    const rows = [
      [{ text: '💅 Classic', callbackData: 'sv:classic' }],
      [{ text: '💅 Gel', callbackData: 'sv:gel' }],
      [{ text: 'Back', callbackData: 'main' }],
    ];
    expect(adaptCalendarForMeta(rows, 10)).toBe(rows); // Not adapted (< maxButtons)
  });

  it('works with maxButtons=13 for Instagram', () => {
    const dates = Array.from({ length: 25 }, (_, i) => i + 1);
    const rows = makeCalendarRows({ dates });
    const adapted = adaptCalendarForMeta(rows, 13);
    const allBtns = adapted.flat();
    expect(allBtns.length).toBeLessThanOrEqual(13);
  });

  it('handles calendar with no available dates', () => {
    // Empty calendar — only headers + nav + action
    const rows = makeCalendarRows({ dates: [] });
    const allBefore = rows.flat();
    // Not detected as calendar because no dt: buttons
    // Falls through to passthrough
    const adapted = adaptCalendarForMeta(rows, 5);
    // Since total buttons > maxButtons and it IS detected as calendar (many NOOP buttons)
    // But no date buttons → result has nav + action only
    const allBtns = adapted.flat();
    expect(allBtns.length).toBeLessThanOrEqual(5);
  });

  it('returns at least 1 date button even if budget is tight', () => {
    const dates = Array.from({ length: 15 }, (_, i) => i + 1);
    const rows = makeCalendarRows({ dates });
    // maxButtons = 4: nav(2) + action(1) + 1 date minimum
    const adapted = adaptCalendarForMeta(rows, 4);
    const dateBtns = adapted.flat().filter(b => b.callbackData.startsWith('dt:'));
    expect(dateBtns.length).toBeGreaterThanOrEqual(1);
  });
});
