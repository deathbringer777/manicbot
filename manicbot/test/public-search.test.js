import { describe, it, expect } from 'vitest';

// ─── Haversine distance (copied from publicSalon.ts) ──────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── buildSearchText logic (pure version for testing) ─────────────
function buildSearchTextPure(opts, services) {
  const parts = [opts.name, opts.city, opts.description].filter(Boolean);
  for (const svc of services) {
    if (!svc.active || svc.hidden) continue;
    try {
      const names = typeof svc.names === 'string' ? JSON.parse(svc.names) : (svc.names || {});
      parts.push(...Object.values(names).filter(Boolean));
    } catch { /* ignore */ }
  }
  return [...new Set(parts)].join(' ');
}

// ─── BLOG_ARTICLES simple match ───────────────────────────────────
const BLOG_ARTICLES = [
  {
    slug: 'manicbot-telegram-booking',
    titles: {
      ru: 'Онлайн-запись через Telegram: как это работает',
      en: 'Online booking via Telegram: how it works',
    },
  },
  {
    slug: 'gel-polish-care-guide',
    titles: {
      ru: 'Уход за гель-лаком: советы от мастеров',
      en: 'Gel polish care guide from nail masters',
    },
  },
];

function matchArticles(q) {
  const qLow = q.toLowerCase();
  return BLOG_ARTICLES.filter((a) =>
    Object.values(a.titles).some((title) => title.toLowerCase().includes(qLow)),
  );
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Haversine distance', () => {
  it('returns ~0 for same coordinates', () => {
    const d = haversineKm(52.2297, 21.0122, 52.2297, 21.0122);
    expect(d).toBeCloseTo(0, 2);
  });

  it('Moscow ↔ Warsaw is roughly 1250 km', () => {
    const d = haversineKm(55.7558, 37.6173, 52.2297, 21.0122);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1400);
  });

  it('nearby points < 1 km', () => {
    // ~0.1 km offset
    const d = haversineKm(52.2297, 21.0122, 52.2306, 21.0132);
    expect(d).toBeLessThan(1);
  });
});

describe('buildSearchText', () => {
  it('includes name, city, description', () => {
    const text = buildSearchTextPure(
      { name: 'Nails Studio', city: 'Варшава', description: 'Маникюр' },
      [],
    );
    expect(text).toContain('Nails Studio');
    expect(text).toContain('Варшава');
    expect(text).toContain('Маникюр');
  });

  it('includes service names in all languages', () => {
    const text = buildSearchTextPure({ name: 'Salon', city: null, description: null }, [
      {
        active: 1,
        hidden: 0,
        names: JSON.stringify({ ru: 'Гель-лак', en: 'Gel polish', pl: 'Żelowy lakier' }),
      },
    ]);
    expect(text).toContain('Гель-лак');
    expect(text).toContain('Gel polish');
    expect(text).toContain('Żelowy lakier');
  });

  it('skips inactive/hidden services', () => {
    const text = buildSearchTextPure({ name: 'Salon', city: null, description: null }, [
      { active: 0, hidden: 0, names: JSON.stringify({ ru: 'Скрытая услуга' }) },
      { active: 1, hidden: 1, names: JSON.stringify({ ru: 'Скрытая услуга 2' }) },
    ]);
    expect(text).not.toContain('Скрытая услуга');
    expect(text).not.toContain('Скрытая услуга 2');
  });

  it('deduplicates repeated words', () => {
    const text = buildSearchTextPure({ name: 'Salon', city: 'Salon', description: null }, []);
    // "Salon" should appear only once due to Set deduplication
    const count = text.split('Salon').length - 1;
    expect(count).toBe(1);
  });
});

describe('Blog article autocomplete matching', () => {
  it('matches Russian article title by keyword', () => {
    const results = matchArticles('telegram');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].slug).toBe('manicbot-telegram-booking');
  });

  it('matches gel polish article', () => {
    const results = matchArticles('гель');
    expect(results.some((a) => a.slug === 'gel-polish-care-guide')).toBe(true);
  });

  it('returns empty for non-matching query', () => {
    const results = matchArticles('xyzxyzxyz123');
    expect(results.length).toBe(0);
  });

  it('is case-insensitive', () => {
    const results = matchArticles('TELEGRAM');
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('Slug validation (regex)', () => {
  const slugRegex = /^[a-z0-9-]+$/;

  it('accepts valid slugs', () => {
    expect(slugRegex.test('moi-salon')).toBe(true);
    expect(slugRegex.test('salon123')).toBe(true);
    expect(slugRegex.test('nails-studio-warsaw')).toBe(true);
  });

  it('rejects uppercase letters', () => {
    expect(slugRegex.test('My-Salon')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(slugRegex.test('my salon')).toBe(false);
  });

  it('rejects Cyrillic', () => {
    expect(slugRegex.test('мой-салон')).toBe(false);
  });
});
