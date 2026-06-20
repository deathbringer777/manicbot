/**
 * Single source of truth for the "popular cities" pinned list shown on the
 * landing search dropdown and on /search.
 *
 * Keep this list in sync with `manicbot/src/lib/popularCities.js` (the
 * Worker version exposed via `GET /api/search/cities`).
 */
export const POPULAR_CITIES = [
  "Warszawa", "Kraków", "Łódź", "Wrocław", "Poznań",
  "Gdańsk", "Szczecin", "Bydgoszcz", "Lublin", "Katowice",
] as const;

/**
 * City-center coordinates used to auto-select the nearest pinned city on
 * /search when the URL carries ?lat=&lng= (e.g. arriving from the landing's
 * geolocation button). Keys must match POPULAR_CITIES exactly.
 */
export const POPULAR_CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Warszawa: { lat: 52.2297, lng: 21.0122 },
  "Kraków": { lat: 50.0647, lng: 19.945 },
  "Łódź": { lat: 51.7592, lng: 19.456 },
  "Wrocław": { lat: 51.1079, lng: 17.0385 },
  "Poznań": { lat: 52.4064, lng: 16.9252 },
  "Gdańsk": { lat: 54.352, lng: 18.6466 },
  Szczecin: { lat: 53.4285, lng: 14.5528 },
  Bydgoszcz: { lat: 53.1235, lng: 18.0084 },
  Lublin: { lat: 51.2465, lng: 22.5684 },
  Katowice: { lat: 50.2649, lng: 19.0238 },
};

/**
 * ASCII-fold + URL-slugify a city name for use in `/salons/{slug}` routes.
 * Mirrors `manicbot/src/utils/seo.js#citySlug` so the sitemap and the
 * Next.js route segment agree on the canonical slug shape.
 *
 * SEO audit 2026-05-20 P1-1.
 */
export function citySlug(input: string | null | undefined): string {
  if (input == null || input === "") return "";
  return String(input)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[ąĄ]/g, "a")
    .replace(/[ęĘ]/g, "e")
    .replace(/[óÓ]/g, "o")
    .replace(/[śŚ]/g, "s")
    .replace(/[źżŹŻ]/g, "z")
    .replace(/[ćĆ]/g, "c")
    .replace(/[ńŃ]/g, "n")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Reverse lookup — given a slug, return the canonical city name (with
 * Polish diacritics preserved). Returns `null` if no popular city
 * matches the slug. Used by the `/salons/[city]` route to gate on the
 * supported-city allowlist.
 */
export function cityNameFromSlug(slug: string): string | null {
  if (!slug) return null;
  const norm = slug.toLowerCase();
  for (const city of POPULAR_CITIES) {
    if (citySlug(city) === norm) return city;
  }
  return null;
}
