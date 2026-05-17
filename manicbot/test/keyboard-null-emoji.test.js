import { describe, it, expect } from 'vitest';
import { fmtEmoji, svcName } from '../src/utils/helpers.js';
import { svcKb } from '../src/ui/keyboards.js';

describe('fmtEmoji', () => {
  it('returns empty string for null', () => {
    expect(fmtEmoji(null)).toBe('');
  });
  it('returns empty string for undefined', () => {
    expect(fmtEmoji(undefined)).toBe('');
  });
  it('returns empty string for empty string', () => {
    expect(fmtEmoji('')).toBe('');
  });
  it('returns empty string for whitespace-only string', () => {
    expect(fmtEmoji('   ')).toBe('');
  });
  it('returns empty string for non-string types', () => {
    expect(fmtEmoji(0)).toBe('');
    expect(fmtEmoji(false)).toBe('');
    expect(fmtEmoji({})).toBe('');
  });
  it('returns "💅 " (with trailing space) for a real emoji', () => {
    expect(fmtEmoji('💅')).toBe('💅 ');
  });
  it('returns "X " for an arbitrary one-char string', () => {
    expect(fmtEmoji('X')).toBe('X ');
  });
});

describe('svcName', () => {
  const baseCtx = (svcEmoji) => ({
    svc: [{ id: 'classic', e: svcEmoji, dur: 60, price: 80 }],
  });

  it('does NOT include the literal "null" when service emoji is null', () => {
    const out = svcName(baseCtx(null), 'pl', 'classic');
    expect(out).not.toMatch(/^null\b/);
    expect(out).not.toContain('null ');
  });

  it('does NOT include "undefined" when service emoji is undefined', () => {
    const out = svcName(baseCtx(undefined), 'pl', 'classic');
    expect(out).not.toContain('undefined');
  });

  it('does NOT show empty leading space when emoji is empty', () => {
    const out = svcName(baseCtx(''), 'pl', 'classic');
    expect(out.startsWith(' ')).toBe(false);
  });

  it('prefixes "💅 " when emoji is present', () => {
    const out = svcName(baseCtx('💅'), 'pl', 'classic');
    expect(out.startsWith('💅 ')).toBe(true);
  });
});

describe('svcKb', () => {
  const ctxWith = (services) => ({
    svc: services,
    svcIds: new Set(services.map(s => s.id)),
    channel: null,
  });

  it('does NOT render the literal "null" before service names when emoji is null', () => {
    const ctx = ctxWith([
      { id: 'french', e: null, dur: 60, price: 150, active: true },
    ]);
    const kb = svcKb(ctx, 'pl');
    const buttons = kb.reply_markup.inline_keyboard.flat();
    const svcBtn = buttons.find(b => b.callback_data?.includes('french'));
    expect(svcBtn).toBeDefined();
    expect(svcBtn.text).not.toMatch(/^null\b/);
    expect(svcBtn.text.startsWith(' ')).toBe(false);
  });

  it('renders "💅 ..." when emoji is set', () => {
    const ctx = ctxWith([
      { id: 'classic', e: '💅', dur: 60, price: 80, active: true },
    ]);
    const kb = svcKb(ctx, 'pl');
    const buttons = kb.reply_markup.inline_keyboard.flat();
    const svcBtn = buttons.find(b => b.callback_data?.includes('classic'));
    expect(svcBtn).toBeDefined();
    expect(svcBtn.text.startsWith('💅 ')).toBe(true);
  });

  it('handles mixed-emoji catalog (some null, some set)', () => {
    const ctx = ctxWith([
      { id: 'classic', e: '💅', dur: 60, price: 80, active: true },
      { id: 'french', e: null, dur: 60, price: 150, active: true },
      { id: 'pedi', e: '', dur: 90, price: 120, active: true },
    ]);
    const kb = svcKb(ctx, 'pl');
    const buttons = kb.reply_markup.inline_keyboard.flat();
    for (const b of buttons) {
      if (b.callback_data?.startsWith('back')) continue;
      expect(b.text).not.toMatch(/^null\b/);
      expect(b.text).not.toContain('undefined');
    }
  });
});
