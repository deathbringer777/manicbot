/**
 * Single source of truth for the "popular cities" pinned list shown on the
 * landing search dropdown and on /search.
 *
 * The platform currently operates in Poland only. The dynamic
 * `SELECT DISTINCT city FROM tenants` query previously surfaced legacy /
 * test data such as "Київ", which broke the UX promise of a Polish-only
 * directory. Hardcoding the list keeps the pinned chips aligned with our
 * marketing surface and lets us extend coverage explicitly when we open
 * new markets.
 */
// Top-10 Polish metros by population. Drives both the pinned search chips and
// the /salons/{city} programmatic-SEO directory (unknown slugs 404). Extend
// explicitly as coverage grows. Keep in sync with the admin-app twin
// (admin-app/src/lib/popularCities.ts), which also carries city-center coords.
export const POPULAR_CITIES = [
  'Warszawa', 'Kraków', 'Łódź', 'Wrocław', 'Poznań',
  'Gdańsk', 'Szczecin', 'Bydgoszcz', 'Lublin', 'Katowice',
];
