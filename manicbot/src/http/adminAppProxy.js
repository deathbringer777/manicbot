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
  if (pathname === '/search' || pathname.startsWith('/search/')) return true;
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
