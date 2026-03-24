import { describe, it, expect } from 'vitest';
import { buildCtx, CB, STEP, VALID_LANGS, WORK, TIMEZONE } from '../src/config.js';

describe('buildCtx', () => {
  it('builds context from env', () => {
    const env = {
      BOT_TOKEN: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
      ADMIN_KEY: 'test-admin-key',
      WEBHOOK_SECRET: 'test-secret',
      MANICBOT: {},
      ADMIN_CHAT_ID: '999',
    };
    const ctx = buildCtx(env);
    expect(ctx.TG).toContain('api.telegram.org');
    expect(ctx.TG).toContain(env.BOT_TOKEN);
    expect(ctx.ADMIN_KEY).toBe(env.ADMIN_KEY);
    expect(ctx.WEBHOOK_SECRET).toBe(env.WEBHOOK_SECRET);
    expect(ctx.prefix).toBe('b:123456789:');
    expect(ctx.adminChatId).toBe('999');
  });

  it('throws on missing BOT_TOKEN', () => {
    expect(() => buildCtx({ ADMIN_KEY: 'x', WEBHOOK_SECRET: 'y' })).toThrow('Missing secret: BOT_TOKEN');
  });

  it('throws on missing ADMIN_KEY', () => {
    expect(() => buildCtx({ BOT_TOKEN: 'x', WEBHOOK_SECRET: 'y' })).toThrow('Missing secret: ADMIN_KEY');
  });

  it('throws on missing WEBHOOK_SECRET', () => {
    expect(() => buildCtx({ BOT_TOKEN: 'x', ADMIN_KEY: 'y' })).toThrow('Missing secret: WEBHOOK_SECRET');
  });
});

describe('CB constants', () => {
  it('has required callback prefixes', () => {
    expect(CB.MAIN).toBe('main');
    expect(CB.BOOK).toBe('book');
    expect(CB.MY).toBe('my');
    expect(CB.LANG).toBe('lang');
    expect(CB.CONFIRM).toBe('ok');
    expect(CB.NOOP).toBe('_');
  });
});

describe('STEP constants', () => {
  it('has required step constants', () => {
    expect(STEP.REG_CONFIRM).toBe('rc');
    expect(STEP.REG_NAME).toBe('rn');
    expect(STEP.REG_PHONE).toBe('rp');
    expect(STEP.CONFIRM).toBe('conf');
    expect(STEP.BOOK_ADJUST).toBe('badj');
    expect(STEP.DATE).toBe('date');
    expect(STEP.TIME).toBe('time');
  });
});

describe('VALID_LANGS', () => {
  it('includes all supported languages', () => {
    expect(VALID_LANGS.has('ru')).toBe(true);
    expect(VALID_LANGS.has('ua')).toBe(true);
    expect(VALID_LANGS.has('en')).toBe(true);
    expect(VALID_LANGS.has('pl')).toBe(true);
    expect(VALID_LANGS.has('de')).toBe(false);
  });
});

describe('WORK', () => {
  it('has valid work hours', () => {
    expect(WORK.from).toBe(9);
    expect(WORK.to).toBe(19);
    expect(WORK.from).toBeLessThan(WORK.to);
  });
});

describe('TIMEZONE', () => {
  it('is Warsaw timezone', () => {
    expect(TIMEZONE).toBe('Europe/Warsaw');
  });
});
