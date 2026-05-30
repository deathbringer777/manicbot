/**
 * Single source of truth for "full-page" dashboard routes.
 *
 * `(dashboard)/layout.tsx` is a client component that, for the role-scoped
 * dashboards (tenant_owner / tenant_manager / master / support), renders the
 * matched page (`children`) ONLY for the paths listed here; every other path is
 * swapped for the role dashboard (SalonDashboard / MasterDashboard / …). A
 * notification or email link to a real page that is NOT listed here silently
 * lands the user on the role dashboard instead of the page they clicked.
 *
 * That is exactly the salon-invitation bug: the bell linked to a correct
 * `/invitations/<id>`, but the accept page wasn't whitelisted, so an owner saw
 * the home dashboard and "nothing happened". `/invitations` is now included.
 *
 * Routes reached via `?tab=` on the role dashboard itself (e.g.
 * `/dashboard?tab=channels`) are intentionally NOT here — the dashboard reads
 * the tab and renders correctly.
 */
export const FULL_PAGE_ROUTE_PREFIXES = [
  "/settings",
  "/plugins",
  "/plugin",
  "/marketing",
  "/messages",
  "/notifications",
  "/invitations",
] as const;

/**
 * True when `pathname` is one of the full-page routes (exact match or a
 * sub-path like `/invitations/<id>`). Matching requires either an exact hit or
 * a `<prefix>/…` boundary so `/settings-export` does NOT match `/settings`.
 */
export function isFullPageRoute(pathname: string): boolean {
  return FULL_PAGE_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
