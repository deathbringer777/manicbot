/**
 * handleGoogleWebhook — channel-ID spoofing guard.
 *
 * Google Calendar push notifications always carry X-Goog-Channel-ID matching
 * the channel we registered via /watch. A request whose channel ID does not
 * match the stored watch_channel_id — INCLUDING a request that omits the
 * header entirely — must be rejected with 403 before any sync work runs.
 *
 * Regression pin for the security fix where a missing X-Goog-Channel-ID
 * header used to bypass the mismatch check (`channelId &&` short-circuit),
 * letting anyone who learned an integration id trigger sync via the
 * unauthenticated /google/webhook endpoint.
 */

import { describe, expect, it } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { handleGoogleWebhook, saveGoogleIntegration } from '../src/services/google-calendar-oauth.js';

function makeRequest(headers) {
  return { headers: new Headers(headers) };
}

async function seedIntegration(ctx, extra = {}) {
  return saveGoogleIntegration(ctx, {
    scope: 'tenant',
    calendarId: 'salon@example.com',
    calendarSummary: 'Salon calendar',
    providerAccountEmail: 'owner@example.com',
    refreshTokenEnc: 'encrypted-refresh-token',
    syncEnabled: true,
    syncDirection: 'two_way',
    ...extra,
  });
}

describe('handleGoogleWebhook — channel ID guard', () => {
  it('returns 400 when channel token (integration id) is missing', async () => {
    const ctx = makeCtx({ tenantId: 't_gwh_1' });
    const res = await handleGoogleWebhook(ctx, makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown integration id', async () => {
    const ctx = makeCtx({ tenantId: 't_gwh_2' });
    const res = await handleGoogleWebhook(ctx, makeRequest({
      'X-Goog-Channel-Token': 'gi_does_not_exist',
      'X-Goog-Channel-ID': 'ch_anything',
    }));
    expect(res.status).toBe(404);
  });

  it('returns 403 on a mismatched channel ID', async () => {
    const ctx = makeCtx({ tenantId: 't_gwh_3' });
    const integration = await seedIntegration(ctx, { watchChannelId: 'ch_registered' });
    const res = await handleGoogleWebhook(ctx, makeRequest({
      'X-Goog-Channel-Token': integration.id,
      'X-Goog-Channel-ID': 'ch_spoofed',
      'X-Goog-Resource-State': 'exists',
    }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when the channel ID header is MISSING (no bypass)', async () => {
    const ctx = makeCtx({ tenantId: 't_gwh_4' });
    const integration = await seedIntegration(ctx, { watchChannelId: 'ch_registered' });
    const res = await handleGoogleWebhook(ctx, makeRequest({
      'X-Goog-Channel-Token': integration.id,
      'X-Goog-Resource-State': 'exists',
    }));
    expect(res.status).toBe(403);
  });

  it('returns 200 OK when the channel ID matches (sync state — no fetch needed)', async () => {
    const ctx = makeCtx({ tenantId: 't_gwh_5' });
    const integration = await seedIntegration(ctx, { watchChannelId: 'ch_registered' });
    const res = await handleGoogleWebhook(ctx, makeRequest({
      'X-Goog-Channel-Token': integration.id,
      'X-Goog-Channel-ID': 'ch_registered',
      'X-Goog-Resource-State': 'sync',
    }));
    expect(res.status).toBe(200);
  });
});
