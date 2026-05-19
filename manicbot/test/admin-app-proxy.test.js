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
    ['/tg'],
    ['/_next/static/chunks/foo.js'],
    ['/api/trpc/x.y'],
    ['/api/auth/callback/google'],
    ['/salon/my-salon'],
    // SEO audit 2026-05-20 P1-1 — programmatic city directory pages live on
    // admin-app, NOT the landing SPA. Without this entry, /salons/warszawa
    // would proxy to the landing site and return a soft-404 (HTTP 200 with
    // the marketing HTML).
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
  ])('proxies %s', (path) => {
    expect(isAdminAppPath(path)).toBe(true);
  });

  it.each([
    ['/'],           // root → landing page, NOT admin-app
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
