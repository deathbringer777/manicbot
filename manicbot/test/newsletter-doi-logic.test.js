import { describe, it, expect } from 'vitest';
import {
  parseTokenFromUrl,
  renderConfirmSuccessPage,
  renderConfirmExpiredPage,
  renderUnsubscribeSuccessPage,
  renderNewsletterErrorPage,
  resolvePageLang,
} from '../src/http/newsletterDoiLogic.js';

describe('parseTokenFromUrl', () => {
  it('extracts a valid 32-hex token', () => {
    const url = 'https://manicbot.com/confirm-subscription?token=' + 'a'.repeat(32);
    expect(parseTokenFromUrl(url)).toEqual({ ok: true, token: 'a'.repeat(32) });
  });

  it('extracts token from /newsletter/unsubscribe path too', () => {
    const url = 'https://manicbot.com/newsletter/unsubscribe?token=0123456789abcdef0123456789abcdef';
    expect(parseTokenFromUrl(url)).toEqual({ ok: true, token: '0123456789abcdef0123456789abcdef' });
  });

  it('rejects missing token param', () => {
    expect(parseTokenFromUrl('https://manicbot.com/confirm-subscription')).toEqual({
      ok: false,
      error: 'missing_token',
    });
  });

  it('rejects malformed token shape (uppercase / dashes / too short)', () => {
    expect(parseTokenFromUrl('https://manicbot.com/confirm-subscription?token=ABC123')).toEqual({
      ok: false,
      error: 'invalid_token',
    });
    expect(parseTokenFromUrl('https://manicbot.com/confirm-subscription?token=abc-123')).toEqual({
      ok: false,
      error: 'invalid_token',
    });
    expect(parseTokenFromUrl('https://manicbot.com/confirm-subscription?token=' + 'a'.repeat(31))).toEqual({
      ok: false,
      error: 'invalid_token',
    });
  });

  it('handles empty query value', () => {
    expect(parseTokenFromUrl('https://manicbot.com/confirm-subscription?token=')).toEqual({
      ok: false,
      error: 'missing_token',
    });
  });
});

describe('resolvePageLang', () => {
  it('returns the row lang when it is in the whitelist', () => {
    expect(resolvePageLang('ru')).toBe('ru');
    expect(resolvePageLang('uk')).toBe('uk');
    expect(resolvePageLang('en')).toBe('en');
    expect(resolvePageLang('pl')).toBe('pl');
  });

  it('maps ua → uk', () => {
    expect(resolvePageLang('ua')).toBe('uk');
  });

  it('falls back to ru for null/undefined/unknown', () => {
    expect(resolvePageLang(null)).toBe('ru');
    expect(resolvePageLang(undefined)).toBe('ru');
    expect(resolvePageLang('xx')).toBe('ru');
    expect(resolvePageLang('')).toBe('ru');
  });
});

describe('renderConfirmSuccessPage', () => {
  it('renders a complete HTML page with Russian copy when lang=ru', () => {
    const html = renderConfirmSuccessPage('ru');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="ru">');
    expect(html).toContain('Подписка подтверждена');
    expect(html).toContain('https://manicbot.com');
  });

  it('renders English page when lang=en', () => {
    const html = renderConfirmSuccessPage('en');
    expect(html).toContain('Subscription confirmed');
    expect(html).toContain('<html lang="en">');
  });

  it('renders Polish page when lang=pl', () => {
    const html = renderConfirmSuccessPage('pl');
    expect(html).toMatch(/subskrypcj/i);
    expect(html).toContain('<html lang="pl">');
  });

  it('renders Ukrainian page when lang=uk', () => {
    const html = renderConfirmSuccessPage('uk');
    expect(html).toContain('<html lang="uk">');
    expect(html).toMatch(/підписк/i);
  });
});

describe('renderConfirmExpiredPage', () => {
  it('renders a localized "link expired" page with a re-subscribe CTA', () => {
    const html = renderConfirmExpiredPage('en');
    expect(html).toContain('expired');
    expect(html).toContain('https://manicbot.com');
  });

  it('localized in ru / uk / pl', () => {
    expect(renderConfirmExpiredPage('ru')).toMatch(/срок|истек|просрочен/i);
    expect(renderConfirmExpiredPage('uk')).toMatch(/термін|стрічена|закінч/i);
    expect(renderConfirmExpiredPage('pl')).toMatch(/wygasł/i);
  });
});

describe('renderUnsubscribeSuccessPage', () => {
  it('renders a "you have been unsubscribed" page in 4 langs', () => {
    expect(renderUnsubscribeSuccessPage('ru')).toMatch(/отписаны|отписали/i);
    expect(renderUnsubscribeSuccessPage('uk')).toMatch(/відписан/i);
    expect(renderUnsubscribeSuccessPage('en')).toMatch(/unsubscribed/i);
    expect(renderUnsubscribeSuccessPage('pl')).toMatch(/wypisan/i);
  });

  it('contains an HTML doctype', () => {
    expect(renderUnsubscribeSuccessPage('ru')).toMatch(/^<!DOCTYPE html>/);
  });
});

describe('renderNewsletterErrorPage', () => {
  it('renders a localized generic error page (bad token / not found)', () => {
    expect(renderNewsletterErrorPage('ru')).toMatch(/ошибк|недействителен/i);
    expect(renderNewsletterErrorPage('en')).toMatch(/error|invalid/i);
  });

  it('starts with doctype', () => {
    expect(renderNewsletterErrorPage('en')).toMatch(/^<!DOCTYPE html>/);
  });
});
