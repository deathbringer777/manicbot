/** Legal / info pages served by the SPA via pathname matching. */
export const LEGAL_ROUTES: Record<string, string> = {
  "/privacy": "privacy",
  "/terms": "terms",
  "/cookies": "cookies",
  "/support": "support",
  "/rules": "rules",
};

/**
 * Returns the page key for a given pathname, or `null` if it's the main landing.
 * Accepts an optional pathname override for testing (defaults to `window.location.pathname`).
 */
export function getLegalPage(pathname?: string): string | null {
  const path =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  return LEGAL_ROUTES[path] ?? null;
}
