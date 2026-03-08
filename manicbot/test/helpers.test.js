import { describe, it, expect } from 'vitest';
import { escHtml, fill, t, p2, detectLang, isValidChatId, isCorrectionSvc } from '../src/utils/helpers.js';

describe('escHtml', () => {
  it('escapes HTML entities', () => {
    expect(escHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;');
    expect(escHtml('a & b')).toBe('a &amp; b');
    expect(escHtml('"quoted"')).toBe('&quot;quoted&quot;');
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
  });

  it('rejects invalid IDs', () => {
    expect(isValidChatId(0)).toBe(false);
    expect(isValidChatId(NaN)).toBe(false);
    expect(isValidChatId(Infinity)).toBe(false);
    expect(isValidChatId('123')).toBe(false);
  });
});

describe('isCorrectionSvc', () => {
  it('identifies correction service', () => {
    expect(isCorrectionSvc('correction')).toBe(true);
    expect(isCorrectionSvc('classic')).toBe(false);
    expect(isCorrectionSvc(null)).toBe(false);
  });
});
