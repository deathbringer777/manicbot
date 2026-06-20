import { describe, it, expect } from 'vitest';
import { POPULAR_CITIES } from '../src/lib/popularCities.js';
import { trySearchApi } from '../src/http/searchHttp.js';

function makeKv() {
  const store = new Map();
  return {
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  };
}

describe('POPULAR_CITIES', () => {
  it('promotes a stable set of Polish metros, Warszawa first', () => {
    expect(POPULAR_CITIES[0]).toBe('Warszawa');
    expect(POPULAR_CITIES).toContain('Kraków');
    expect(POPULAR_CITIES).toContain('Gdańsk');
    expect(POPULAR_CITIES.length).toBeGreaterThanOrEqual(10);
  });

  it('does not contain any non-Polish placeholders (e.g. legacy test "Київ")', () => {
    for (const c of POPULAR_CITIES) {
      expect(c).not.toMatch(/київ|kyiv|kiev/i);
    }
  });
});

describe('GET /api/search/cities', () => {
  it('returns the hardcoded Polish list and ignores DB rows', async () => {
    // Even if the tenants table contains other cities (e.g. Київ from test
    // accounts), the public list must stay aligned with POPULAR_CITIES.
    const env = {
      MANICBOT: makeKv(),
      MANICBOT_DB: {
        prepare: () => ({
          all: async () => ({ results: [{ city: 'Київ', total: 5 }, { city: 'Warszawa', total: 1 }] }),
        }),
      },
    };
    const url = new URL('https://manicbot.com/api/search/cities');
    const req = new Request(url.toString(), { method: 'GET' });

    const res = await trySearchApi(req, env, url);
    expect(res).not.toBeNull();
    const body = await res.json();
    expect(body.cities).toEqual([...POPULAR_CITIES]);
  });

  it('returns the same Polish list when DB binding is missing', async () => {
    const env = { MANICBOT: makeKv() };
    const url = new URL('https://manicbot.com/api/search/cities');
    const req = new Request(url.toString(), { method: 'GET' });

    const res = await trySearchApi(req, env, url);
    const body = await res.json();
    expect(body.cities).toEqual([...POPULAR_CITIES]);
  });
});
