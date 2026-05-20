/**
 * Which request paths are forwarded to Cloudflare Pages (admin-app).
 * Keep in sync with manicbot/admin-app/src/app routes.
 *
 * @param {string} pathname URL pathname (e.g. /settings)
 * @returns {boolean}
 */
export function isAdminAppPath(pathname) {
  // NOTE: '/' is intentionally NOT proxied to admin-app — root serves the landing page.
  // Worker-handled Stripe routes must NOT be proxied to Pages.
  if (pathname === '/stripe/webhook' || pathname === '/stripe/success') return false;
  // Admin-app static assets at root that would otherwise be claimed by
  // isLandingPath's `*.png` regex. Without this the WebShell sidebar img +
  // metadata.icons return the landing SPA fallback (HTML) instead of the PNG,
  // and Chrome renders the broken-image placeholder with the alt text.
  if (pathname === '/manicbot-mark-ui.png') return true;
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return true;
  if (pathname === '/login' || pathname === '/register' || pathname === '/tg') return true;
  if (pathname === '/forgot-password' || pathname === '/reset-password') return true;
  if (pathname === '/verify-email' || pathname === '/confirm-email-change') return true;
  if (pathname === '/rules') return true;
  if (pathname === '/help' || pathname.startsWith('/help/')) return true;
  if (pathname === '/blog' || pathname.startsWith('/blog/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/api/trpc/')) return true;
  if (pathname.startsWith('/api/auth/')) return true;
  if (pathname.startsWith('/salon/')) return true;
  // SEO audit 2026-05-20 P1-1 — programmatic city directory pages live
  // under /salons/{city-slug} on the Next.js admin-app. Worker must route
  // them to admin-app, NOT the landing SPA (which would 200-soft-404 them).
  if (pathname === '/salons' || pathname.startsWith('/salons/')) return true;
  if (pathname === '/search' || pathname.startsWith('/search/')) return true;
  // SEO audit 2026-05-20 — new public pages (/pricing, /about, /comparisons/*)
  // live in the admin-app under (public). Without these the Worker would
  // fall through to the landing soft-404 guard (P0-7) and return 404.
  if (pathname === '/pricing' || pathname.startsWith('/pricing/')) return true;
  if (pathname === '/about' || pathname.startsWith('/about/')) return true;
  if (pathname === '/comparisons' || pathname.startsWith('/comparisons/')) return true;
  const dash = [
    '/tenants',
    '/users',
    '/appointments',
    '/conversations',
    '/agents',
    '/billing',
    '/events',
    '/system',
    '/settings',
    '/stripe',
    '/platform-support',
    '/plugins',
    '/plugin',
    '/marketing',
    '/marketing-autopilot',
    '/leads',
    '/inbox',
    '/messages',
    '/role-requests',
    '/notifications',
    '/channels',
    '/errors',
    '/invitations',
  ];
  for (const p of dash) {
    if (pathname === p || pathname.startsWith(p + '/')) return true;
  }
  return false;
}
