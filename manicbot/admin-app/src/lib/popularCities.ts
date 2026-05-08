/**
 * Single source of truth for the "popular cities" pinned list shown on the
 * landing search dropdown and on /search.
 *
 * Keep this list in sync with `manicbot/src/lib/popularCities.js` (the
 * Worker version exposed via `GET /api/search/cities`).
 */
export const POPULAR_CITIES = ["Warszawa", "Gdańsk", "Wrocław"] as const;
