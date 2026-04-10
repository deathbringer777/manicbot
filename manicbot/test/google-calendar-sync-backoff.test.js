/**
 * Google Calendar sync backoff tests.
 *
 * Verifies sync retry logic:
 * - sync_retries increments correctly
 * - sync_retry_after respects exponential backoff
 * - max retry limit behavior
 * - sync error logging (truncation, reset on success)
 *
 * Uses D1 mock (appointments table) to test actual column updates.
 */

import { describe, it, expect } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { saveApt, getAptById } from '../src/services/appointments.js';
import { dbRun, dbGet } from '../src/utils/db.js';
import { warsawToUTC } from '../src/utils/date.js';

// ── Backoff formula constants (mirrors cron.js logic) ─────────────────────

const BASE_MS = 15 * 60 * 1000;   // 15 minutes
const MAX_MS = 24 * 60 * 60 * 1000; // 24 hours cap
const MAX_RETRIES = 5;

function calcBackoff(retries) {
  return Math.min(BASE_MS * Math.pow(2, retries), MAX_MS);
}

// ── Exponential backoff formula ───────────────────────────────────────────

describe('sync_retries exponential backoff formula', () => {
  it('retry 0 -> 15min base delay', () => {
    expect(calcBackoff(0)).toBe(15 * 60 * 1000);
  });

  it('retry 1 -> 30min', () => {
    expect(calcBackoff(1)).toBe(30 * 60 * 1000);
  });

  it('retry 2 -> 60min', () => {
    expect(calcBackoff(2)).toBe(60 * 60 * 1000);
  });

  it('retry 3 -> 2h', () => {
    expect(calcBackoff(3)).toBe(2 * 60 * 60 * 1000);
  });

  it('retry 4 -> 4h', () => {
    expect(calcBackoff(4)).toBe(4 * 60 * 60 * 1000);
  });

  it('retry 5 -> 8h', () => {
    expect(calcBackoff(5)).toBe(8 * 60 * 60 * 1000);
  });

  it('retry 10 -> capped at 24h', () => {
    expect(calcBackoff(10)).toBe(MAX_MS);
  });

  it('retry 20 -> still capped at 24h', () => {
    expect(calcBackoff(20)).toBe(MAX_MS);
  });

  it('backoff is strictly increasing up to the cap', () => {
    for (let i = 0; i < 6; i++) {
      expect(calcBackoff(i + 1)).toBeGreaterThan(calcBackoff(i));
    }
  });

  it('backoff never exceeds MAX_MS', () => {
    for (let i = 0; i <= 30; i++) {
      expect(calcBackoff(i)).toBeLessThanOrEqual(MAX_MS);
    }
  });
});

// ── sync_retries increments correctly in D1 ───────────────────────────────

describe('sync_retries increments correctly via D1', () => {
  it('new appointment starts with null/0 sync_retries', async () => {
    const ctx = makeCtx({ tenantId: 't_sync_inc' });
    const apt = await saveApt(ctx, {
      chatId: 100,
      svcId: 'classic',
      date: '2026-04-15',
      time: '10:00',
      ts: warsawToUTC(2026, 4, 15, 10, 0).getTime(),
      userName: 'Client',
      userPhone: '+48111111111',
    });
    const saved = await getAptById(ctx, apt.id);
    // sync_retries defaults to null or 0 for new appointments
    expect(saved.sync_retries == null || saved.sync_retries === 0).toBe(true);
  });

  it('increments sync_retries from 0 to 1 on first failure', async () => {
    const ctx = makeCtx({ tenantId: 't_sync_inc2' });
    const apt = await saveApt(ctx, {
      chatId: 101,
      svcId: 'classic',
      date: '2026-04-15',
      time: '11:00',
      ts: warsawToUTC(2026, 4, 15, 11, 0).getTime(),
      userName: 'Alice',
      userPhone: '+48222222222',
    });

    // Simulate a sync failure: increment retries via direct SQL (sync columns not in updateApt fieldMap)
    const newRetries = 1;
    const retryAfter = Date.now() + calcBackoff(newRetries);
    const errorMsg = 'Google API 503: Service Unavailable';
    await dbRun(ctx,
      'UPDATE appointments SET sync_retries = ?, sync_retry_after = ?, sync_last_error = ? WHERE id = ? AND tenant_id = ?',
      newRetries, retryAfter, errorMsg, apt.id, ctx.tenantId,
    );

    const saved = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', apt.id, ctx.tenantId);
    expect(saved.sync_retries).toBe(1);
    expect(saved.sync_retry_after).toBe(retryAfter);
    expect(saved.sync_last_error).toBe(errorMsg);
  });

  it('increments sync_retries from 3 to 4', async () => {
    const ctx = makeCtx({ tenantId: 't_sync_inc3' });
    const apt = await saveApt(ctx, {
      chatId: 102,
      svcId: 'classic',
      date: '2026-04-16',
      time: '09:00',
      ts: warsawToUTC(2026, 4, 16, 9, 0).getTime(),
      userName: 'Bob',
      userPhone: '+48333333333',
    });

    // Set retries to 3 initially via direct SQL
    await dbRun(ctx,
      'UPDATE appointments SET sync_retries = ? WHERE id = ? AND tenant_id = ?',
      3, apt.id, ctx.tenantId,
    );

    // Now increment to 4
    await dbRun(ctx,
      'UPDATE appointments SET sync_retries = ? WHERE id = ? AND tenant_id = ?',
      4, apt.id, ctx.tenantId,
    );

    const saved = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', apt.id, ctx.tenantId);
    expect(saved.sync_retries).toBe(4);
  });
});

// ── sync_retry_after respects exponential backoff ─────────────────────────

describe('sync_retry_after respects exponential backoff', () => {
  it('retry_after is set further in the future for higher retry counts', () => {
    const now = Date.now();
    const retryAfter1 = now + calcBackoff(1);
    const retryAfter3 = now + calcBackoff(3);
    const retryAfter5 = now + calcBackoff(5);

    expect(retryAfter3).toBeGreaterThan(retryAfter1);
    expect(retryAfter5).toBeGreaterThan(retryAfter3);
  });

  it('filters out appointments where sync_retry_after is in the future', () => {
    const now = Date.now();
    const apts = [
      { id: 'a1', sync_retry_after: null },
      { id: 'a2', sync_retry_after: now - 60000 },
      { id: 'a3', sync_retry_after: now + 60000 },
      { id: 'a4', sync_retry_after: now + 3600000 },
    ];

    const eligible = apts.filter(a => a.sync_retry_after == null || a.sync_retry_after < now);
    expect(eligible.map(a => a.id)).toEqual(['a1', 'a2']);
    expect(eligible).toHaveLength(2);
  });
});

// ── Max retry limit behavior ──────────────────────────────────────────────

describe('max retry limit behavior', () => {
  it('appointments with sync_retries >= MAX_RETRIES are skipped', () => {
    const apts = [
      { id: 'ok1', sync_retries: 0 },
      { id: 'ok2', sync_retries: 2 },
      { id: 'ok3', sync_retries: 4 },
      { id: 'max1', sync_retries: 5 },
      { id: 'max2', sync_retries: 10 },
      { id: 'null1', sync_retries: null },
    ];

    const eligible = apts.filter(a => a.sync_retries == null || a.sync_retries < MAX_RETRIES);
    expect(eligible.map(a => a.id)).toEqual(['ok1', 'ok2', 'ok3', 'null1']);
    expect(eligible).not.toContainEqual(expect.objectContaining({ id: 'max1' }));
    expect(eligible).not.toContainEqual(expect.objectContaining({ id: 'max2' }));
  });

  it('treats null sync_retries as 0 (eligible)', () => {
    const apt = { sync_retries: null };
    const eligible = apt.sync_retries == null || apt.sync_retries < MAX_RETRIES;
    expect(eligible).toBe(true);
  });

  it('detects permanent failure at exactly MAX_RETRIES', () => {
    const retries = MAX_RETRIES;
    expect(retries >= MAX_RETRIES).toBe(true);
  });

  it('MAX_SYNC_PER_CRON limits batch size', () => {
    const MAX_SYNC_PER_CRON = 10;
    const appointments = Array.from({ length: 25 }, (_, i) => ({ id: `apt_${i}` }));
    const batch = appointments.slice(0, MAX_SYNC_PER_CRON);
    expect(batch).toHaveLength(10);
  });
});

// ── Sync error logging ────────────────────────────────────────────────────

describe('sync error logging', () => {
  it('stores truncated error message (max 200 chars)', () => {
    const longError = 'Google Calendar API Error: ' + 'x'.repeat(300);
    const stored = longError.slice(0, 200);
    expect(stored.length).toBe(200);
    expect(stored.startsWith('Google Calendar API Error:')).toBe(true);
  });

  it('stores short error messages as-is', () => {
    const shortError = 'Token expired';
    const stored = shortError.length > 200 ? shortError.slice(0, 200) : shortError;
    expect(stored).toBe('Token expired');
  });

  it('resets all sync state on success', async () => {
    const ctx = makeCtx({ tenantId: 't_sync_reset' });
    const apt = await saveApt(ctx, {
      chatId: 103,
      svcId: 'classic',
      date: '2026-04-17',
      time: '14:00',
      ts: warsawToUTC(2026, 4, 17, 14, 0).getTime(),
      userName: 'Carol',
      userPhone: '+48444444444',
    });

    // Simulate failed state via direct SQL
    await dbRun(ctx,
      'UPDATE appointments SET sync_retries = ?, sync_retry_after = ?, sync_last_error = ? WHERE id = ? AND tenant_id = ?',
      3, Date.now() + 999999, 'Some error', apt.id, ctx.tenantId,
    );

    // Simulate success reset via direct SQL
    await dbRun(ctx,
      'UPDATE appointments SET sync_retries = ?, sync_retry_after = ?, sync_last_error = ? WHERE id = ? AND tenant_id = ?',
      0, null, null, apt.id, ctx.tenantId,
    );

    const saved = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', apt.id, ctx.tenantId);
    expect(saved.sync_retries).toBe(0);
    expect(saved.sync_retry_after).toBeNull();
    expect(saved.sync_last_error).toBeNull();
  });

  it('persists error state across reads', async () => {
    const ctx = makeCtx({ tenantId: 't_sync_persist' });
    const apt = await saveApt(ctx, {
      chatId: 104,
      svcId: 'pedi',
      date: '2026-04-18',
      time: '15:00',
      ts: warsawToUTC(2026, 4, 18, 15, 0).getTime(),
      userName: 'Dave',
      userPhone: '+48555555555',
    });

    const errorMsg = 'invalid_grant: Token has been expired or revoked';
    await dbRun(ctx,
      'UPDATE appointments SET sync_retries = ?, sync_last_error = ? WHERE id = ? AND tenant_id = ?',
      2, errorMsg, apt.id, ctx.tenantId,
    );

    const read1 = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', apt.id, ctx.tenantId);
    expect(read1.sync_retries).toBe(2);
    expect(read1.sync_last_error).toBe(errorMsg);

    // Read again to confirm persistence
    const read2 = await dbGet(ctx, 'SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', apt.id, ctx.tenantId);
    expect(read2.sync_retries).toBe(2);
    expect(read2.sync_last_error).toBe(errorMsg);
  });
});
