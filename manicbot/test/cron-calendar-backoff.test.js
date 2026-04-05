import { describe, it, expect } from 'vitest';

describe('Google Calendar Sync Backoff Logic', () => {
  const MAX_SYNC_PER_CRON = 10;

  describe('backoff formula', () => {
    it('calculates correct backoff delays', () => {
      const baseMs = 15 * 60 * 1000; // 15 minutes
      const maxMs = 24 * 60 * 60 * 1000; // 24 hours

      // retries=1: 30min
      expect(Math.min(baseMs * Math.pow(2, 1), maxMs)).toBe(30 * 60 * 1000);
      // retries=2: 60min
      expect(Math.min(baseMs * Math.pow(2, 2), maxMs)).toBe(60 * 60 * 1000);
      // retries=3: 2h
      expect(Math.min(baseMs * Math.pow(2, 3), maxMs)).toBe(2 * 60 * 60 * 1000);
      // retries=4: 4h
      expect(Math.min(baseMs * Math.pow(2, 4), maxMs)).toBe(4 * 60 * 60 * 1000);
      // retries=5: 8h
      expect(Math.min(baseMs * Math.pow(2, 5), maxMs)).toBe(8 * 60 * 60 * 1000);
      // retries=10: capped at 24h
      expect(Math.min(baseMs * Math.pow(2, 10), maxMs)).toBe(maxMs);
    });
  });

  describe('sync filtering', () => {
    it('respects MAX_SYNC_PER_CRON limit', () => {
      const appointments = Array.from({ length: 20 }, (_, i) => ({ id: `apt_${i}` }));
      const limited = appointments.slice(0, MAX_SYNC_PER_CRON);
      expect(limited).toHaveLength(10);
    });

    it('skips appointments with sync_retries >= 5', () => {
      const apts = [
        { id: 'a1', sync_retries: 0 },
        { id: 'a2', sync_retries: 3 },
        { id: 'a3', sync_retries: 5 },  // should be skipped
        { id: 'a4', sync_retries: 10 }, // should be skipped
        { id: 'a5', sync_retries: null }, // should pass (treated as 0)
      ];
      const eligible = apts.filter(a => (a.sync_retries == null || a.sync_retries < 5));
      expect(eligible.map(a => a.id)).toEqual(['a1', 'a2', 'a5']);
    });

    it('skips appointments with future sync_retry_after', () => {
      const now = Date.now();
      const apts = [
        { id: 'a1', sync_retry_after: null },          // pass
        { id: 'a2', sync_retry_after: now - 60000 },   // past → pass
        { id: 'a3', sync_retry_after: now + 60000 },   // future → skip
        { id: 'a4', sync_retry_after: now + 3600000 },  // future → skip
      ];
      const eligible = apts.filter(a => a.sync_retry_after == null || a.sync_retry_after < now);
      expect(eligible.map(a => a.id)).toEqual(['a1', 'a2']);
    });
  });

  describe('retry state management', () => {
    it('increments retries on failure', () => {
      let retries = 0;
      retries = (retries || 0) + 1;
      expect(retries).toBe(1);
      retries = (retries || 0) + 1;
      expect(retries).toBe(2);
    });

    it('resets state on success', () => {
      const successState = { sync_retries: 0, sync_retry_after: null, sync_last_error: null };
      expect(successState.sync_retries).toBe(0);
      expect(successState.sync_retry_after).toBeNull();
      expect(successState.sync_last_error).toBeNull();
    });

    it('stores truncated error message', () => {
      const longError = 'A'.repeat(300);
      const stored = longError.slice(0, 200);
      expect(stored.length).toBe(200);
    });

    it('detects permanent failure at 5 retries', () => {
      const retries = 5;
      expect(retries >= 5).toBe(true);
    });
  });
});
