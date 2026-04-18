import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendSubscriberWelcomeEmail, _test } from '../src/email/subscriberWelcomeEmail.js';

const { COPY, normalizeLang, buildHtml } = _test;

describe('subscriberWelcomeEmail — localization', () => {
  it('supports ru / uk / en / pl', () => {
    for (const lang of ['ru', 'uk', 'en', 'pl']) {
      expect(COPY[lang]).toBeTruthy();
      expect(COPY[lang].subject).toBeTruthy();
      expect(COPY[lang].heading).toBeTruthy();
      expect(COPY[lang].benefits.length).toBeGreaterThan(3);
      expect(COPY[lang].ctaButton).toBeTruthy();
    }
  });

  it('normalizes ua -> uk and falls back to ru for unknown', () => {
    expect(normalizeLang('ua')).toBe('uk');
    expect(normalizeLang('UK')).toBe('uk');
    expect(normalizeLang('xx')).toBe('ru');
    expect(normalizeLang(undefined)).toBe('ru');
  });

  it('buildHtml renders a well-formed HTML doc with CTA URL, benefits, preheader', () => {
    const html = buildHtml(COPY.en, 'en', 'https://manicbot.com?src=welcome');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('https://manicbot.com?src=welcome');
    // Preheader for inbox preview
    expect(html).toContain(COPY.en.preheader);
    // All benefits rendered
    for (const b of COPY.en.benefits) expect(html).toContain(b);
    // Signature
    expect(html).toContain('ManicBot');
  });

  it('XSS: Cyrillic/emoji content is preserved verbatim (no escaping of intentional HTML in COPY)', () => {
    const html = buildHtml(COPY.ru, 'ru', 'https://manicbot.com');
    expect(html).toContain('Спасибо');
    expect(html).toContain('🤖');
  });
});

describe('subscriberWelcomeEmail — sendSubscriberWelcomeEmail()', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('returns false when required args are missing', async () => {
    expect(await sendSubscriberWelcomeEmail({ resendKey: '', fromAddr: 'x', email: 'a@b.com' })).toBe(false);
    expect(await sendSubscriberWelcomeEmail({ resendKey: 'k', fromAddr: '', email: 'a@b.com' })).toBe(false);
    expect(await sendSubscriberWelcomeEmail({ resendKey: 'k', fromAddr: 'x', email: '' })).toBe(false);
  });

  it('POSTs to Resend with correct auth header, from, to, subject, and HTML body', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"e_1"}', { status: 200 }));
    global.fetch = fetchMock;

    const ok = await sendSubscriberWelcomeEmail({
      resendKey: 'rk_live_123',
      fromAddr: 'ManicBot <noreply@manicbot.com>',
      email: 'user@test.com',
      locale: 'pl',
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer rk_live_123');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('ManicBot <noreply@manicbot.com>');
    expect(body.to).toEqual(['user@test.com']);
    expect(body.subject).toBe(COPY.pl.subject);
    expect(body.html).toContain('Dziękujemy');
    // Abort signal present (timeout)
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns false and logs when Resend responds non-2xx (e.g. domain not verified)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async () => new Response(
      JSON.stringify({ name: 'validation_error', message: 'The manicbot.com domain is not verified.' }),
      { status: 403 },
    ));

    const ok = await sendSubscriberWelcomeEmail({
      resendKey: 'rk',
      fromAddr: 'ManicBot <noreply@manicbot.com>',
      email: 'user@test.com',
      locale: 'ru',
    });

    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      '[subscriberWelcome] Resend error:',
      403,
      expect.stringContaining('not verified'),
    );
    errSpy.mockRestore();
  });

  it('returns false on network/timeout errors (fetch throws)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async () => { throw new Error('TimeoutError'); });
    const ok = await sendSubscriberWelcomeEmail({
      resendKey: 'rk', fromAddr: 'ManicBot <x@y.com>', email: 'a@b.com', locale: 'en',
    });
    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('uses the correct locale → subject mapping', async () => {
    const subjects = [];
    global.fetch = vi.fn(async (_url, init) => {
      subjects.push(JSON.parse(init.body).subject);
      return new Response('{}', { status: 200 });
    });
    for (const loc of ['ru', 'uk', 'ua', 'en', 'pl', 'zz']) {
      await sendSubscriberWelcomeEmail({
        resendKey: 'rk', fromAddr: 'from@x.com', email: 'a@b.com', locale: loc,
      });
    }
    expect(subjects[0]).toBe(COPY.ru.subject);
    expect(subjects[1]).toBe(COPY.uk.subject);
    expect(subjects[2]).toBe(COPY.uk.subject); // ua -> uk
    expect(subjects[3]).toBe(COPY.en.subject);
    expect(subjects[4]).toBe(COPY.pl.subject);
    expect(subjects[5]).toBe(COPY.ru.subject); // fallback
  });
});
