/**
 * Notification links are stored verbatim in `user_notifications.link` by many
 * writers (Worker crons + tRPC routers) and navigated via `router.push()` from
 * the bell dropdown and the /notifications page.
 *
 * Root-anchored links ("/", "/?tab=…") send the user to the marketing LANDING
 * page, because the Worker (src/http/adminAppProxy.js) intentionally does NOT
 * proxy "/" to the admin-app — root is the landing. Bare relative links
 * ("?tab=…") resolve against whatever page happens to be current, which is
 * wrong from any full-page route.
 *
 * The canonical in-app home is /dashboard (same DashboardClient as "/", but it
 * IS on the Worker allowlist and SalonDashboard reads ?tab=). Anchor both the
 * root and bare-relative forms there. Already-correct paths pass through
 * untouched, so this is safe to run on every link unconditionally — including
 * rows already persisted with the bad link (no DB backfill needed).
 */
export function resolveNotificationHref(link: string): string {
  if (!link) return link;
  // Bare relative query ("?tab=…") → anchor at the dashboard home.
  if (link.startsWith("?")) return `/dashboard${link}`;
  // Exact root path → dashboard home.
  if (link === "/") return "/dashboard";
  // Root path carrying a query ("/?tab=…") → /dashboard?tab=… (drop the leading
  // slash before re-prefixing). Note the "/?" guard, NOT a plain "/" prefix
  // check, so "/settings" and friends are left alone.
  if (link.startsWith("/?")) return `/dashboard${link.slice(1)}`;
  return link;
}
