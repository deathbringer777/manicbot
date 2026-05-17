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
