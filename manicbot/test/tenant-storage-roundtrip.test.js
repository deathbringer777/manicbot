/**
 * Tenant storage round-trip — putTenant must NOT wipe admin-written columns.
 *
 * Regression for the "column-landmine": putTenant uses INSERT OR REPLACE, so any
 * tenants column the mapper does NOT list is reset to its DEFAULT on every save.
 * storage.js historically knew 38 of the tenants table's 47 columns, silently
 * resetting 9 of them — branding (display_name, logo_r2_key, cover_r2_key,
 * brand_palette, bg_image, bg_r2_key) plus is_personal / industry / is_test —
 * on every billing-webhook or Telegram settings save.
 *
 * The is_test reset is the dangerous one: a demo/test tenant silently becomes a
 * "real" indexed tenant the next time Stripe fires an event on it.
 *
 * The bug only manifests on a read-modify-write cycle (getTenant -> mutate one
 * field -> putTenant), which is exactly what every billing/settings caller does.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';
import { getTenant, putTenant } from '../src/tenant/storage.js';

describe('tenant storage round-trip (column-landmine regression)', () => {
  let ctx;
  beforeEach(() => {
    ctx = { db: createMockD1() };
  });

  // A fully-branded, flagged tenant as the admin-app / onboarding would persist it.
  const SEED = {
    id: 't_brand',
    name: 'Barber Bros',
    active: 1,
    plan: 'pro',
    billing_status: 'active',
    display_name: 'Barber Bros Praga',
    logo_r2_key: 'tenants/t_brand/logo.png',
    cover_r2_key: 'tenants/t_brand/cover.png',
    brand_palette: '{"primary":"#1a1a1a","accent":"#c9a227"}',
    bg_image: 'https://cdn.example/bg.jpg',
    bg_r2_key: 'tenants/t_brand/bg.jpg',
    is_personal: 1,
    industry: 'barber',
    is_test: 1,
    created_at: 1000,
    updated_at: 1000,
  };

  it('getTenant surfaces branding + flags so read-modify-write can round-trip them', async () => {
    ctx.db._getTable('tenants').push({ ...SEED });

    const t = await getTenant(ctx, 't_brand');

    expect(t.displayName).toBe('Barber Bros Praga');
    expect(t.logoR2Key).toBe('tenants/t_brand/logo.png');
    expect(t.coverR2Key).toBe('tenants/t_brand/cover.png');
    expect(t.brandPalette).toBe('{"primary":"#1a1a1a","accent":"#c9a227"}');
    expect(t.bgImage).toBe('https://cdn.example/bg.jpg');
    expect(t.bgR2Key).toBe('tenants/t_brand/bg.jpg');
    expect(t.isPersonal).toBe(true);
    expect(t.industry).toBe('barber');
    expect(t.isTest).toBe(true);
  });

  it('putTenant after a billing change preserves the 9 previously-wiped columns', async () => {
    ctx.db._getTable('tenants').push({ ...SEED });

    // Simulate a Stripe webhook / Telegram settings save: read, change ONE field, save.
    const t = await getTenant(ctx, 't_brand');
    t.billingStatus = 'grace';
    const ok = await putTenant(ctx, 't_brand', t);
    expect(ok).toBe(true);

    const row = ctx.db._getTable('tenants').find((r) => r.id === 't_brand');
    // the intended change landed:
    expect(row.billing_status).toBe('grace');
    // and the columns this code never touches survived:
    expect(row.is_test).toBe(1);
    expect(row.industry).toBe('barber');
    expect(row.is_personal).toBe(1);
    expect(row.display_name).toBe('Barber Bros Praga');
    expect(row.logo_r2_key).toBe('tenants/t_brand/logo.png');
    expect(row.cover_r2_key).toBe('tenants/t_brand/cover.png');
    expect(row.brand_palette).toBe('{"primary":"#1a1a1a","accent":"#c9a227"}');
    expect(row.bg_image).toBe('https://cdn.example/bg.jpg');
    expect(row.bg_r2_key).toBe('tenants/t_brand/bg.jpg');
  });

  it('new tenant without branding gets safe NOT-NULL defaults (is_test=0, industry=beauty, is_personal=0)', async () => {
    const ok = await putTenant(ctx, 't_new', {
      id: 't_new',
      name: 'Fresh Nails',
      plan: 'start',
      billingStatus: 'trialing',
    });
    expect(ok).toBe(true);

    const row = ctx.db._getTable('tenants').find((r) => r.id === 't_new');
    expect(row.is_test).toBe(0);
    expect(row.industry).toBe('beauty');
    expect(row.is_personal).toBe(0);
    expect(row.display_name == null).toBe(true);
  });
});
