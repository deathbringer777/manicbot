/**
 * Single source of truth for the "popular cities" pinned list shown on the
 * landing search dropdown and on /search.
 *
 * Keep this list in sync with `manicbot/src/lib/popularCities.js` (the
 * Worker version exposed via `GET /api/search/cities`).
 */
export const POPULAR_CITIES = ["Warszawa", "Gdańsk", "Wrocław"] as const;

/**
 * City-center coordinates used to auto-select the nearest pinned city on
 * /search when the URL carries ?lat=&lng= (e.g. arriving from the landing's
 * geolocation button). Keys must match POPULAR_CITIES exactly.
 */
export const POPULAR_CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Warszawa: { lat: 52.2297, lng: 21.0122 },
  "Gdańsk": { lat: 54.352, lng: 18.6466 },
  "Wrocław": { lat: 51.1079, lng: 17.0385 },
};
