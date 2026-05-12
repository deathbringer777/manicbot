/**
 * Channel resolver: Meta webhook IDs vs D1 channel_configs (string normalization, alt IG ids).
 */
import { describe, it, expect } from 'vitest';
import {
  getChannelConfig,
  instagramWebhookEntryIdMatchesConfig,
  resolveTenantFromInstagram,
  resolveTenantFromWhatsApp,
} from '../src/channels/resolver.js';

function mockDbAllRows(rows) {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: rows }),
      }),
    }),
  };
}

function mockDbFirstRow(row) {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: row ? [row] : [] }),
      }),
    }),
  };
}

describe('instagramWebhookEntryIdMatchesConfig', () => {
  it('matches page_id when webhook entry is number and config is string', () => {
    expect(instagramWebhookEntryIdMatchesConfig(1784360123456, { page_id: '1784360123456' })).toBe(true);
  });

  it('matches page_id when both are strings', () => {
    expect(instagramWebhookEntryIdMatchesConfig('99', { page_id: '99' })).toBe(true);
  });

  it('does not match different ids', () => {
    expect(instagramWebhookEntryIdMatchesConfig(1, { page_id: '2' })).toBe(false);
  });

  it('matches instagram_business_id when page_id differs', () => {
    const cfg = { page_id: '111', instagram_business_id: '222' };
    expect(instagramWebhookEntryIdMatchesConfig(222, cfg)).toBe(true);
    expect(instagramWebhookEntryIdMatchesConfig('222', cfg)).toBe(true);
  });

  it('matches ig_account_id', () => {
    expect(instagramWebhookEntryIdMatchesConfig('777', { page_id: '1', ig_account_id: '777' })).toBe(true);
  });

  it('returns false for empty entry id', () => {
    expect(instagramWebhookEntryIdMatchesConfig('', { page_id: '1' })).toBe(false);
  });
});

describe('resolveTenantFromInstagram', () => {
  it('resolves when entry.id (number) equals string page_id in config', async () => {
    const row = {
      tenant_id: 't_ig',
      channel_type: 'instagram',
      active: 1,
      config: JSON.stringify({ page_id: '1784360123456' }),
    };
    const ctx = { db: mockDbAllRows([row]) };
    const r = await resolveTenantFromInstagram(ctx, 1784360123456);
    expect(r?.tenantId).toBe('t_ig');
    expect(r?.channelConfig).toEqual(row);
  });

  it('resolves via instagram_business_id when page_id does not match entry.id', async () => {
    const row = {
      tenant_id: 't_alt',
      channel_type: 'instagram',
      active: 1,
      config: JSON.stringify({ page_id: 'fb_page_only', instagram_business_id: '999888' }),
    };
    const ctx = { db: mockDbAllRows([row]) };
    const r = await resolveTenantFromInstagram(ctx, '999888');
    expect(r?.tenantId).toBe('t_alt');
  });
});

describe('getChannelConfig', () => {
  it('P1-8 — returns token=null when BOT_ENCRYPTION_KEY is unset (fail-closed)', async () => {
    // Pre-P1-8 contract: pass through plaintext-looking tokens (EAA / IGAA)
    // when no key is configured. New contract: refuse and log.
    const plain = `IGAA${'a'.repeat(100)}`;
    const row = {
      id: 'cc1',
      tenant_id: 't_x',
      channel_type: 'instagram',
      active: 1,
      token_encrypted: plain,
      config: '{"page_id":"1"}',
      webhook_verify_token: null,
      token_expires_at: null,
      created_at: 1,
      updated_at: 1,
    };
    const ctx = { db: mockDbFirstRow(row) };
    const r = await getChannelConfig(ctx, 't_x', 'instagram', null);
    expect(r?.token).toBeNull();
    expect(r?.config?.page_id).toBe('1');
  });

  it('returns null token for short garbage when encKey unset', async () => {
    const row = {
      id: 'cc2',
      tenant_id: 't_x',
      channel_type: 'instagram',
      active: 1,
      token_encrypted: 'nope',
      config: '{}',
      webhook_verify_token: null,
      token_expires_at: null,
      created_at: 1,
      updated_at: 1,
    };
    const ctx = { db: mockDbFirstRow(row) };
    const r = await getChannelConfig(ctx, 't_x', 'instagram', null);
    expect(r?.token).toBeNull();
  });
});

describe('resolveTenantFromWhatsApp', () => {
  it('resolves when phone_number_id is number in webhook and string in config', async () => {
    const row = {
      tenant_id: 't_wa',
      channel_type: 'whatsapp',
      active: 1,
      config: JSON.stringify({ phone_number_id: '48123456789012' }),
    };
    const ctx = { db: mockDbAllRows([row]) };
    const r = await resolveTenantFromWhatsApp(ctx, 48123456789012);
    expect(r?.tenantId).toBe('t_wa');
  });
});
