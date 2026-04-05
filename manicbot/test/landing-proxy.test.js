import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LANDING_ORIGIN,
  resolveLandingOrigin,
  isLandingPath,
  buildLandingFetchUrl,
} from '../src/utils/landing-pages-proxy.js';

describe('landing-pages-proxy', () => {
  describe('resolveLandingOrigin', () => {
    it('uses default when LANDING_URL missing', () => {
      expect(resolveLandingOrigin({})).toBe(DEFAULT_LANDING_ORIGIN);
      expect(resolveLandingOrigin({ LANDING_URL: '' })).toBe(DEFAULT_LANDING_ORIGIN);
      expect(resolveLandingOrigin({ LANDING_URL: '   ' })).toBe(DEFAULT_LANDING_ORIGIN);
    });

    it('strips trailing slash from custom URL', () => {
      expect(resolveLandingOrigin({ LANDING_URL: 'https://foo.pages.dev/' })).toBe('https://foo.pages.dev');
    });

    it('ignores manicbot.com to avoid fetch loop', () => {
      expect(resolveLandingOrigin({ LANDING_URL: 'https://manicbot.com' })).toBe(DEFAULT_LANDING_ORIGIN);
      expect(resolveLandingOrigin({ LANDING_URL: 'https://www.manicbot.com/' })).toBe(DEFAULT_LANDING_ORIGIN);
    });
  });

  describe('isLandingPath', () => {
    it('allows SPA shell and assets', () => {
      expect(isLandingPath('/')).toBe(true);
      expect(isLandingPath('/assets/index-abc.js')).toBe(true);
    });

    it('allows blog tree', () => {
      expect(isLandingPath('/blog')).toBe(true);
      expect(isLandingPath('/blog/')).toBe(true);
      expect(isLandingPath('/blog/ru/manicbot-telegram-booking.html')).toBe(true);
    });

    it('allows root static extensions', () => {
      expect(isLandingPath('/og-image.png')).toBe(true);
      expect(isLandingPath('/robots.txt')).toBe(true);
      expect(isLandingPath('/sitemap.xml')).toBe(true);
      expect(isLandingPath('/favicon.svg')).toBe(true);
    });

    it('allows legal / info pages', () => {
      expect(isLandingPath('/privacy')).toBe(true);
      expect(isLandingPath('/terms')).toBe(true);
      expect(isLandingPath('/cookies')).toBe(true);
      expect(isLandingPath('/support')).toBe(true);
      expect(isLandingPath('/rules')).toBe(true);
    });

    it('denies API-ish paths', () => {
      expect(isLandingPath('/webhook/123')).toBe(false);
      expect(isLandingPath('/admin/migrate')).toBe(false);
      expect(isLandingPath('/stripe/webhook')).toBe(false);
    });
  });

  describe('buildLandingFetchUrl', () => {
    it('normalizes root', () => {
      expect(buildLandingFetchUrl('/', 'https://x.pages.dev')).toBe('https://x.pages.dev/');
    });

    it('preserves blog path', () => {
      expect(buildLandingFetchUrl('/blog/ru/a.html', 'https://x.pages.dev')).toBe(
        'https://x.pages.dev/blog/ru/a.html'
      );
    });
  });
});
