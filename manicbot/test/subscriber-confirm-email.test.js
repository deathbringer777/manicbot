import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendSubscriberConfirmEmail, _test } from '../src/email/subscriberConfirmEmail.js';

const { COPY, normalizeLang, buildHtml } = _test;

describe('subscriberConfirmEmail — localization', () => {
  it('supports ru / uk / en / pl', () => {
    for (const lang of ['ru', 'uk', 'en', 'pl']) {
      expect(COPY[lang]).toBeTruthy();
      expect(COPY[lang].subject).toBeTruthy();
      expect(COPY[lang].heading).toBeTruthy();
      expect(COPY[lang].bullets.length).toBeGreaterThanOrEqual(3);
      expect(COPY[lang].unsubLink).toBeTruthy();
      expect(COPY[lang].zeroSpam).toBeTruthy();
    }
  });

  it('normalizes ua -> uk and falls back to ru for unknown', () => {
    expect(normalizeLang('ua')).toBe('uk');
    expect(normalizeLang('UK')).toBe('uk');
    expect(normalizeLang('xx')).toBe('ru');
    expect(normalizeLang(undefined)).toBe('ru');
  });

  it('buildHtml renders a well-formed HTML doc with unsub URL and bullets', () => {
    const html = buildHtml(COPY.en, 'en', 'https://manicbot.com/newsletter/unsubscribe?token=abc123');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('https://manicbot.com/newsletter/unsubscribe?token=abc123');
    // Preheader for inbox preview
    expect(html).toContain(COPY.en.preheader);
    // Each bullet's bold + rest concatenation appears
    for (const b of COPY.en.bullets) {
      expect(html).toContain(b.bold);
      expect(html).toContain(b.rest);
    }
    expect(html).toContain('ManicBot');
  });

  it('does NOT carry a placeholder unsubscribe token in the rendered HTML', () => {
    // Regression guard against the previous `?token=placeholder` stub. The
    // builder always interpolates whatever the caller passes; the test
    // confirms it does pass the real value through and that a default fallback
    // is a clean URL — not a placeholder string.
    const explicit = buildHtml(COPY.ru, 'ru', 'https://manicbot.com/newsletter/unsubscribe?token=real');
    expect(explicit).not.toContain('?token=placeholder');
    expect(explicit).toContain('token=real');
  });

  it('renders color-scheme meta tags so clients know we support dark+light', () => {
    const html = buildHtml(COPY.ru, 'ru', 'https://manicbot.com/u/x');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
  });

  it('includes prefers-color-scheme media query for adaptive dark polish', () => {
    const html = buildHtml(COPY.en, 'en', 'https://manicbot.com/u/x');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toMatch(/\.mb-body\s*\{\s*background:#0b1020/);
    expect(html).toMatch(/\.mb-card\s*\{\s*background:#0f172a/);
  });

  it('embeds the brand logo from a stable absolute URL', () => {
    const html = buildHtml(COPY.ru, 'ru', 'https://manicbot.com/u/x');
    expect(html).toContain('https://manicbot.com/manicbot-mark-ui.png');
    expect(html).toContain('alt="ManicBot"');
  });
});

describe('subscriberConfirmEmail — sendSubscriberConfirmEmail()', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns false when required args are missing', async () => {
    expect(await sendSubscriberConfirmEmail({ resendKey: '', fromAddr: 'x', email: 'a@b.com' })).toBe(false);
    expect(await sendSubscriberConfirmEmail({ resendKey: 'k', fromAddr: '', email: 'a@b.com' })).toBe(false);
    expect(await sendSubscriberConfirmEmail({ resendKey: 'k', fromAddr: 'x', email: '' })).toBe(false);
  });

  it('POSTs to Resend with correct auth, body, and subject for the locale', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":"e_1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const ok = await sendSubscriberConfirmEmail({
      resendKey: 'rk_live_xyz',
      fromAddr: 'ManicBot <news@manicbot.com>',
      email: 'user@test.com',
      locale: 'pl',
      unsubUrl: 'https://manicbot.com/newsletter/unsubscribe?token=abc',
    });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer rk_live_xyz');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.from).toBe('ManicBot <news@manicbot.com>');
    expect(body.to).toEqual(['user@test.com']);
    expect(body.subject).toBe(COPY.pl.subject);
    expect(body.html).toContain('Jesteś na liście');
    expect(body.html).toContain('https://manicbot.com/newsletter/unsubscribe?token=abc');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns false and logs when Resend responds non-2xx', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ name: 'validation_error', message: 'domain not verified' }),
      { status: 403 },
    )));

    const ok = await sendSubscriberConfirmEmail({
      resendKey: 'rk', fromAddr: 'ManicBot <x@y.com>', email: 'a@b.com', locale: 'en',
    });

    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringMatching(/"scope":"email\.subscriberConfirm".*"status":403/s),
    );
    errSpy.mockRestore();
  });

  it('returns false on network/timeout errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('TimeoutError'); }));
    const ok = await sendSubscriberConfirmEmail({
      resendKey: 'rk', fromAddr: 'ManicBot <x@y.com>', email: 'a@b.com', locale: 'ru',
    });
    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('defaults unsubUrl to https://manicbot.com/unsubscribe when omitted', async () => {
    let capturedHtml = '';
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      capturedHtml = JSON.parse(init.body).html;
      return new Response('{}', { status: 200 });
    }));
    await sendSubscriberConfirmEmail({
      resendKey: 'rk', fromAddr: 'ManicBot <x@y.com>', email: 'a@b.com', locale: 'en',
    });
    expect(capturedHtml).toContain('https://manicbot.com/unsubscribe');
    expect(capturedHtml).not.toContain('?token=placeholder');
  });

  it('uses correct locale → subject mapping including ua → uk fallback', async () => {
    const subjects = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      subjects.push(JSON.parse(init.body).subject);
      return new Response('{}', { status: 200 });
    }));
    for (const loc of ['ru', 'uk', 'ua', 'en', 'pl', 'zz']) {
      await sendSubscriberConfirmEmail({
        resendKey: 'rk', fromAddr: 'from@x.com', email: 'a@b.com', locale: loc,
      });
    }
    expect(subjects[0]).toBe(COPY.ru.subject);
    expect(subjects[1]).toBe(COPY.uk.subject);
    expect(subjects[2]).toBe(COPY.uk.subject); // ua → uk
    expect(subjects[3]).toBe(COPY.en.subject);
    expect(subjects[4]).toBe(COPY.pl.subject);
    expect(subjects[5]).toBe(COPY.ru.subject); // fallback
  });
});
