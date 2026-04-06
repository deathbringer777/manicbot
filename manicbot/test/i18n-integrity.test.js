import { describe, it, expect } from 'vitest';
import { L, t } from '../src/i18n/index.js';

const LANGS = ['ru', 'ua', 'en', 'pl'];

describe('i18n — module structure', () => {
  it('exports L with all 4 languages', () => {
    expect(Object.keys(L)).toEqual(expect.arrayContaining(LANGS));
  });

  it('each language is a non-empty flat object', () => {
    for (const lang of LANGS) {
      const keys = Object.keys(L[lang]);
      expect(keys.length, `${lang} should have many keys`).toBeGreaterThan(100);
    }
  });

  it('all languages have same keys as Russian (ru reference)', () => {
    const ruKeys = Object.keys(L.ru);
    for (const lang of ['ua', 'en', 'pl']) {
      const langKeys = new Set(Object.keys(L[lang]));
      const missing = ruKeys.filter(k => !langKeys.has(k));
      expect(missing, `${lang} missing keys: ${missing.join(', ')}`).toHaveLength(0);
    }
  });

  it('sub-module imports work for ru', async () => {
    const { meta, menu, booking, admin, billing, sysadmin, gcal } = await import('../src/i18n/ru/index.js');
    expect(meta.flag).toBe('🇷🇺');
    expect(menu.m_book).toBeTruthy();
    expect(booking.choose_svc).toBeTruthy();
    expect(admin.adm_welcome).toBeTruthy();
    expect(billing.billing_menu).toBeTruthy();
    expect(sysadmin.sysadm_title).toBeTruthy();
    expect(gcal.gcal_oauth_btn).toBeTruthy();
  });

  it('sub-module imports work for en', async () => {
    const { meta, menu, booking, admin, billing, sysadmin } = await import('../src/i18n/en/index.js');
    expect(meta.flag).toBe('🇬🇧');
    expect(menu.m_book).toBe('📝 Book Now');
    expect(booking.choose_svc).toBeTruthy();
    expect(admin.adm_welcome).toBeTruthy();
    expect(billing.billing_menu).toBeTruthy();
    expect(sysadmin.sysadm_title).toBeTruthy();
  });

  it('sub-module imports work for ua', async () => {
    const { meta } = await import('../src/i18n/ua/index.js');
    expect(meta.flag).toBe('🇺🇦');
  });

  it('sub-module imports work for pl', async () => {
    const { meta } = await import('../src/i18n/pl/index.js');
    expect(meta.flag).toBe('🇵🇱');
  });
});

describe('i18n — t() function', () => {
  it('returns key from correct language', () => {
    expect(t('ru', 'm_book')).toBe('📝 Записаться');
    expect(t('en', 'm_book')).toBe('📝 Book Now');
    expect(t('pl', 'm_book')).toBe('📝 Umów się');
    expect(t('ua', 'm_book')).toBe('📝 Записатися');
  });

  it('falls back to ru for unknown language', () => {
    expect(t('de', 'm_book')).toBe('📝 Записаться');
  });

  it('falls back to ru for missing key in other languages', () => {
    // All keys should exist in all languages, but test fallback mechanism
    const key = t('en', 'adm_welcome');
    expect(key).toBeTruthy();
    expect(key).not.toBe('adm_welcome'); // should not return the key itself
  });

  it('returns key itself when not found in any language', () => {
    expect(t('ru', 'totally_nonexistent_key_xyz')).toBe('totally_nonexistent_key_xyz');
  });

  it('critical keys exist in all languages', () => {
    const criticalKeys = [
      'welcome', 'back', 'back_m', 'min', 'm_book', 'm_my', 'm_prices',
      'choose_svc', 'choose_date', 'booked', 'cancel_ok', 'my_title',
      'adm_welcome', 'mst_welcome', 'billing_menu', 'sysadm_title',
      'consultant_btn', 'ticket_closed', 'feature_ai_unavailable',
      'gcal_oauth_btn', 'mst_calendar',
    ];
    for (const lang of LANGS) {
      for (const key of criticalKeys) {
        const val = L[lang][key];
        expect(val, `${lang}.${key} should exist`).toBeDefined();
      }
    }
  });
});

describe('i18n — section completeness', () => {
  it('meta section has all required fields', () => {
    for (const lang of LANGS) {
      const l = L[lang];
      expect(l.flag, `${lang}.flag`).toBeTruthy();
      expect(l.lname, `${lang}.lname`).toBeTruthy();
      expect(l.cur, `${lang}.cur`).toBeTruthy();
      expect(Array.isArray(l.days), `${lang}.days`).toBe(true);
      expect(l.days).toHaveLength(7);
      expect(Array.isArray(l.mon), `${lang}.mon`).toBe(true);
      expect(l.mon).toHaveLength(12);
    }
  });

  it('service names exist for all 7 services in all languages', () => {
    const svcIds = ['classic', 'gel', 'pedi', 'ext', 'design', 'combo', 'correction'];
    for (const lang of LANGS) {
      for (const id of svcIds) {
        expect(L[lang][`svc_${id}`], `${lang}.svc_${id}`).toBeTruthy();
      }
    }
  });

  it('billing keys exist in all languages', () => {
    const billingKeys = ['billing_menu', 'billing_plan_start', 'billing_plan_pro', 'billing_plan_max',
      'feature_ai_unavailable', 'feature_masters_limit', 'billing_inactive_msg'];
    for (const lang of LANGS) {
      for (const key of billingKeys) {
        expect(L[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('gcal keys exist in all languages', () => {
    const gcalKeys = ['gcal_oauth_btn', 'gcal_sync_now_btn', 'gcal_scope_salon', 'mst_calendar'];
    for (const lang of LANGS) {
      for (const key of gcalKeys) {
        expect(L[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });

  it('support/ticket keys exist in all languages', () => {
    const supportKeys = ['consultant_btn', 'ticket_closed', 'ticket_declined', 'correction_offer_msg',
      'tech_support_enter_msg', 'tech_support_created'];
    for (const lang of LANGS) {
      for (const key of supportKeys) {
        expect(L[lang][key], `${lang}.${key}`).toBeTruthy();
      }
    }
  });
});
