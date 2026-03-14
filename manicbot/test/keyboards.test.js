import { describe, it, expect } from 'vitest';
import * as kb from '../src/ui/keyboards.js';

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
});
