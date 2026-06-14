import { describe, it, expect } from 'vitest';
import * as kb from '../src/ui/keyboards.js';
import { CB } from '../src/config.js';

describe('keyboards', () => {
  it('exports mainKb and it returns inline_keyboard only (no reply keyboard)', () => {
    expect(kb.mainKb).toBeDefined();
    const result = kb.mainKb('ru', 'client');
    expect(result.reply_markup).toBeDefined();
    expect(result.reply_markup.inline_keyboard).toBeDefined();
    expect(Array.isArray(result.reply_markup.inline_keyboard)).toBe(true);
    expect(result.reply_markup.keyboard).toBeUndefined();
  });

  it('mainReplyKb is not exported (reply keyboard removed)', () => {
    expect(kb.mainReplyKb).toBeUndefined();
  });

  it('catPhotoKb puts book + back in one row (equal-width pair, not two stacked rows)', () => {
    // Two single-button rows coalesce into the web date-grid (gappy, looks like
    // a missing 3rd button). One row renders as a .mb-btn-row → flex:1 each.
    const rows = kb.catPhotoKb('pl', 'classic', 0, 2).reply_markup.inline_keyboard;
    const actionRow = rows[rows.length - 1];
    expect(actionRow).toHaveLength(2);
    const cbs = actionRow.map((b) => b.callback_data);
    expect(cbs).toContain(CB.SERVICE + 'classic'); // book this service
    expect(cbs).toContain(CB.CATALOG); // back to categories
  });
});
