import { describe, it, expect } from 'vitest';
import {
  escHtml, fill, t, p2, detectLang, isValidChatId, isCorrectionSvc,
  parseInstagramAiTriggers, instagramAiTriggerAllows,
} from '../src/utils/helpers.js';

describe('escHtml', () => {
  it('escapes HTML entities', () => {
    expect(escHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;');
    expect(escHtml('a & b')).toBe('a &amp; b');
    expect(escHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escHtml("'apos'")).toBe('&#39;apos&#39;');
  });

  it('handles non-string input', () => {
    expect(escHtml(123)).toBe('123');
    expect(escHtml(null)).toBe('null');
  });
});

describe('fill', () => {
  it('replaces template variables', () => {
    expect(fill('Hello {n}!', { n: 'World' })).toBe('Hello World!');
    expect(fill('{a} and {b}', { a: '1', b: '2' })).toBe('1 and 2');
  });

  it('handles array input', () => {
    expect(fill(['Hello', '{n}'], { n: 'World' })).toBe('Hello\nWorld');
  });

  it('replaces all occurrences of same variable', () => {
    expect(fill('{x} + {x}', { x: '5' })).toBe('5 + 5');
  });
});

describe('t', () => {
  it('returns translation for valid key', () => {
    expect(t('ru', 'back')).toBe('◀️ Назад');
    expect(t('en', 'back')).toBe('◀️ Back');
  });

  it('falls back to Russian for unknown lang', () => {
    expect(t('xx', 'back')).toBe('◀️ Назад');
  });

  it('returns key for unknown key', () => {
    expect(t('ru', 'nonexistent_key_xyz')).toBe('nonexistent_key_xyz');
  });
});

describe('p2', () => {
  it('pads single digit', () => {
    expect(p2(5)).toBe('05');
    expect(p2(0)).toBe('00');
  });

  it('keeps double digit', () => {
    expect(p2(12)).toBe('12');
    expect(p2(99)).toBe('99');
  });
});

describe('detectLang', () => {
  it('detects known languages', () => {
    expect(detectLang('ru')).toBe('ru');
    expect(detectLang('en')).toBe('en');
    expect(detectLang('pl')).toBe('pl');
  });

  it('maps uk to ua', () => {
    expect(detectLang('uk')).toBe('ua');
    expect(detectLang('uk-UA')).toBe('ua');
  });

  it('returns null for unknown', () => {
    expect(detectLang('zh')).toBeNull();
    expect(detectLang(null)).toBeNull();
    expect(detectLang('')).toBeNull();
  });
});

describe('isValidChatId', () => {
  it('accepts valid IDs', () => {
    expect(isValidChatId(123456)).toBe(true);
    expect(isValidChatId(-100123)).toBe(true);
    expect(isValidChatId('48123456789')).toBe(true);
    expect(isValidChatId('+48123456789')).toBe(true);
    expect(isValidChatId('17841405357341234')).toBe(true);
    expect(isValidChatId('1' + '2'.repeat(40))).toBe(true);
  });

  it('rejects invalid IDs', () => {
    expect(isValidChatId(0)).toBe(false);
    expect(isValidChatId(NaN)).toBe(false);
    expect(isValidChatId(Infinity)).toBe(false);
    expect(isValidChatId('')).toBe(false);
    expect(isValidChatId('12a')).toBe(false);
    expect(isValidChatId('not-digits')).toBe(false);
    expect(isValidChatId('1' + '2'.repeat(65))).toBe(false);
  });
});

describe('isCorrectionSvc', () => {
  it('identifies correction service', () => {
    expect(isCorrectionSvc('correction')).toBe(true);
    expect(isCorrectionSvc('classic')).toBe(false);
    expect(isCorrectionSvc(null)).toBe(false);
  });
});

describe('parseInstagramAiTriggers', () => {
  it('returns empty for null/empty', () => {
    expect(parseInstagramAiTriggers(null)).toEqual([]);
    expect(parseInstagramAiTriggers('')).toEqual([]);
    expect(parseInstagramAiTriggers('  \t  ')).toEqual([]);
  });

  it('splits on comma and lowercases', () => {
    expect(parseInstagramAiTriggers('Запись, ВОПРОС ,manic')).toEqual(['запись', 'вопрос', 'manic']);
  });

  it('drops empty segments between commas', () => {
    expect(parseInstagramAiTriggers(',,запись,, ,')).toEqual(['запись']);
  });
});

describe('instagramAiTriggerAllows', () => {
  const igCtx = triggers => ({
    channel: { type: 'instagram' },
    INSTAGRAM_AI_TRIGGER: triggers,
  });

  it('allows when not instagram', () => {
    expect(instagramAiTriggerAllows({ channel: { type: 'telegram' } }, 'hello')).toBe(true);
    expect(instagramAiTriggerAllows({}, 'x')).toBe(true);
  });

  it('allows when triggers empty', () => {
    expect(instagramAiTriggerAllows(igCtx(''), 'привет')).toBe(true);
    expect(instagramAiTriggerAllows(igCtx(undefined), 'привет')).toBe(true);
  });

  it('allows when text contains any trigger substring', () => {
    expect(instagramAiTriggerAllows(igCtx('запись,вопрос'), 'Хочу ЗАПИСЬ на завтра')).toBe(true);
    expect(instagramAiTriggerAllows(igCtx('manic'), 'MANIC bot')).toBe(true);
  });

  it('blocks when no trigger matches', () => {
    expect(instagramAiTriggerAllows(igCtx('запись'), 'только привет')).toBe(false);
  });

  it('allows when all comma segments empty after trim (no effective triggers)', () => {
    expect(instagramAiTriggerAllows(igCtx(' , , '), 'привет')).toBe(true);
  });
});
