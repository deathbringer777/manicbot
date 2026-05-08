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
export const POPULAR_CITIES = ['Warszawa', 'Gdańsk', 'Wrocław'];
