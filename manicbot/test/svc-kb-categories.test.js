/**
 * svcKb (Telegram booking-flow service catalog) should group services by
 * category when ctx.svcCategories is populated, and fall back to the legacy
 * flat list when it isn't. Pins the shape so a regression of either path
 * shows up here, not in a salon owner's bug report.
 */
import { describe, it, expect } from 'vitest';
import { svcKb } from '../src/ui/keyboards.js';
import { CB } from '../src/config.js';

function buildCtx({ services, categories = [], channel = null }) {
  return {
    svc: services,
    svcCategories: categories,
    channel,
  };
}

function buttonTexts(kb) {
  return kb.reply_markup.inline_keyboard.flat().map(b => b.text);
}

function rowCount(kb) {
  return kb.reply_markup.inline_keyboard.length;
}

describe('svcKb category grouping', () => {
  it('falls back to flat list when there are no categories', () => {
    const ctx = buildCtx({
      services: [
        { id: 'manicure', e: '💅', price: 130, active: true, category: null },
        { id: 'french', e: '✨', price: 150, active: true, category: null },
      ],
    });
    const kb = svcKb(ctx, 'ru');
    // 2 service rows + 1 back row, NO category separator rows.
    expect(rowCount(kb)).toBe(3);
    expect(buttonTexts(kb).some(t => t.includes('—') && !t.includes('💅') && !t.includes('✨'))).toBe(false);
  });

  it('falls back to flat list when categories exist but no service is assigned', () => {
    const ctx = buildCtx({
      services: [
        { id: 'manicure', e: '💅', price: 130, active: true, category: null },
      ],
      categories: [{ id: 'sc_1', name: 'Маникюр', sort_order: 0 }],
    });
    const kb = svcKb(ctx, 'ru');
    expect(rowCount(kb)).toBe(2); // service + back
    expect(buttonTexts(kb).some(t => t.includes('— Маникюр —'))).toBe(false);
  });

  it('groups services under category headers in sort_order', () => {
    const ctx = buildCtx({
      services: [
        { id: 'french', e: '✨', price: 150, active: true, category: 'Маникюр' },
        { id: 'spa_pedi', e: '🦶', price: 220, active: true, category: 'Педикюр' },
        { id: 'manicure', e: '💅', price: 130, active: true, category: 'Маникюр' },
      ],
      categories: [
        { id: 'sc_1', name: 'Маникюр', sort_order: 0 },
        { id: 'sc_2', name: 'Педикюр', sort_order: 1 },
      ],
    });
    const kb = svcKb(ctx, 'ru');
    const texts = buttonTexts(kb);
    const idxManiHeader = texts.findIndex(x => x === '— Маникюр —');
    const idxPediHeader = texts.findIndex(x => x === '— Педикюр —');
    expect(idxManiHeader).toBeGreaterThanOrEqual(0);
    expect(idxPediHeader).toBeGreaterThan(idxManiHeader);
    // Маникюр services land between the two headers.
    const between = texts.slice(idxManiHeader + 1, idxPediHeader);
    expect(between.some(t => t.includes('💅'))).toBe(true);
    expect(between.some(t => t.includes('✨'))).toBe(true);
  });

  it('category separator rows are not clickable (callback_data = CB.NOOP)', () => {
    const ctx = buildCtx({
      services: [
        { id: 'manicure', e: '💅', price: 130, active: true, category: 'Маникюр' },
      ],
      categories: [{ id: 'sc_1', name: 'Маникюр', sort_order: 0 }],
    });
    const kb = svcKb(ctx, 'ru');
    const header = kb.reply_markup.inline_keyboard
      .flat()
      .find(b => b.text === '— Маникюр —');
    expect(header).toBeDefined();
    expect(header.callback_data).toBe(CB.NOOP);
  });

  it('puts services with unknown / null category into a trailing orphan group', () => {
    const ctx = buildCtx({
      services: [
        { id: 'manicure', e: '💅', price: 130, active: true, category: 'Маникюр' },
        { id: 'correction', e: '🔧', price: 50, active: true, category: null },
        { id: 'ghost', e: '👻', price: 80, active: true, category: 'DeletedCategory' },
      ],
      categories: [{ id: 'sc_1', name: 'Маникюр', sort_order: 0 }],
    });
    const kb = svcKb(ctx, 'ru');
    const texts = buttonTexts(kb);
    // Both orphans show up, after the Маникюр group, with no extra header.
    const idxManiHeader = texts.findIndex(t => t === '— Маникюр —');
    const idxCorrection = texts.findIndex(t => t.includes('🔧'));
    const idxGhost = texts.findIndex(t => t.includes('👻'));
    expect(idxCorrection).toBeGreaterThan(idxManiHeader);
    expect(idxGhost).toBeGreaterThan(idxManiHeader);
  });

  it('skips category headers for empty categories', () => {
    const ctx = buildCtx({
      services: [
        { id: 'manicure', e: '💅', price: 130, active: true, category: 'Маникюр' },
      ],
      categories: [
        { id: 'sc_1', name: 'Маникюр', sort_order: 0 },
        { id: 'sc_2', name: 'Педикюр', sort_order: 1 }, // empty
      ],
    });
    const kb = svcKb(ctx, 'ru');
    const texts = buttonTexts(kb);
    expect(texts.some(t => t === '— Педикюр —')).toBe(false);
    expect(texts.some(t => t === '— Маникюр —')).toBe(true);
  });

  it('Instagram >12 services keeps the flat paged keyboard (no headers)', () => {
    const services = [];
    for (let i = 0; i < 14; i++) {
      services.push({ id: `svc_${i}`, e: '💅', price: 100 + i, active: true, category: 'Маникюр' });
    }
    const ctx = buildCtx({
      services,
      categories: [{ id: 'sc_1', name: 'Маникюр', sort_order: 0 }],
      channel: { type: 'instagram' },
    });
    const kb = svcKb(ctx, 'ru');
    const texts = buttonTexts(kb);
    expect(texts.some(t => t === '— Маникюр —')).toBe(false);
  });
});
