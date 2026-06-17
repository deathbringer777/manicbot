/**
 * Worker → Pages proxy allowlist (prevents 404 on admin-app routes).
 */

import { describe, it, expect } from 'vitest';
import { isAdminAppPath } from '../src/http/adminAppProxy.js';

describe('isAdminAppPath', () => {
  it.each([
    ['/dashboard'],
    ['/dashboard/foo'],
    ['/login'],
    ['/register'],
    ['/help'],
    ['/help/'],
    // /terms → admin-app multilingual Regulamin (replaces the legacy Worker
    // static page). /privacy intentionally stays on the Worker (see below).
    ['/terms'],
    ['/tg'],
    ['/_next/static/chunks/foo.js'],
    ['/api/trpc/x.y'],
    ['/api/auth/callback/google'],
    ['/salon/my-salon'],
    // SEO audit 2026-05-20 P1-1 — programmatic city directory pages live on
    // admin-app, NOT the landing SPA. Without this entry, /salons/warszawa
    // would proxy to the landing site and return a soft-404 (HTTP 200 with
    // the marketing HTML).
    // T08 note: bare `/salons` is still classified as an admin-app path here,
    // but the Worker 301-redirects it to /search BEFORE the proxy runs (it
    // has no `salons/page.tsx` index route). See test/salons-redirect.test.js.
    ['/salons'],
    ['/salons/warszawa'],
    ['/salons/gdansk'],
    ['/salons/wroclaw'],
    ['/search'],
    ['/search/'],
    ['/tenants'],
    ['/users'],
    ['/appointments'],
    ['/conversations'],
    ['/agents'],
    ['/billing'],
    ['/events'],
    ['/system'],
    ['/settings'],
    ['/stripe'],
    ['/platform-support'],
    ['/settings/profile'],
    ['/marketing'],
    ['/marketing/contacts'],
    ['/marketing/sms'],
    ['/marketing/templates'],
    ['/marketing/automations'],
    ['/marketing/campaigns'],
    ['/marketing/providers'],
    ['/leads'],
    ['/inbox'],
    ['/messages'],
    ['/messages/abc123'],
    ['/role-requests'],
    // Notification Center pages (PR1 of bell upgrade — were 404-ing on prod
    // because the Worker proxied them to the landing site instead of Pages).
    ['/notifications'],
    ['/notifications/'],
    // Dashboard pages that exist in app/(dashboard) but were never wired
    // into this proxy table — same class of bug as /notifications.
    ['/channels'],
    ['/channels/whatsapp'],
    ['/errors'],
    ['/invitations'],
    ['/invitations/abc'],
    ['/marketing-autopilot'],
    // Admin-app static asset that would otherwise match isLandingPath's *.png
    // catch-all and route to the landing site (which doesn't have this file).
    // Used by WebShell + Shell sidebar logo + admin-app metadata.icons.
    ['/manicbot-mark-ui.png'],
    // PWA manifest + maskable icon (admin-app app/manifest.ts). The landing's
    // *.png catch-all + SPA fallback would otherwise shadow these, returning
    // HTML instead of the manifest JSON / the PNG and breaking PWA install.
    ['/manifest.webmanifest'],
    ['/icon-maskable-512.png'],
  ])('proxies %s', (path) => {
    expect(isAdminAppPath(path)).toBe(true);
  });

  it.each([
    ['/'],           // root → landing page, NOT admin-app
    // /privacy stays on the Worker static page (Google OAuth "Limited Use"
    // disclosure for the active verification) — must NOT proxy to admin-app.
    ['/privacy'],
    ['/webhook'],
    ['/webhook/bot123'],
    ['/admin/migrate'],
    ['/api/search/foo'],
    ['/random-page'],
    ['/tenantsx'],
  ])('does not proxy %s', (path) => {
    expect(isAdminAppPath(path)).toBe(false);
  });
});
