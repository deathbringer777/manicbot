/**
 * Post-visit auto-done gate. The T+24h sweep used to auto-mark every
 * un-confirmed appointment as 'done', regardless of whether the Stage-1
 * prompt had actually been delivered. A transient Telegram outage at
 * Stage 1 (the master never saw "did the visit happen?") therefore made
 * the system silently auto-done those visits — masters lost the chance
 * to flag no-shows AND lost the post-visit review prompt.
 *
 * The fix gates auto-done behind `shouldAutoDonePostVisit`. The pure
 * helper drives the boolean; this test locks its truth table in.
 */
import { describe, it, expect } from 'vitest';
import { shouldAutoDonePostVisit, POST_VISIT_HARD_CAP_SEC } from '../src/handlers/cron.js';

const NOW = 1_750_000_000;
const ONE_DAY_AGO = NOW - 24 * 3600;
const HARD_CAP_AGO = NOW - POST_VISIT_HARD_CAP_SEC;

function endBefore(seconds) { return NOW - seconds; }
function endAfter(seconds)  { return NOW + seconds; }

describe('shouldAutoDonePostVisit — Stage 2 gate', () => {
  it('defers when the appointment ended <24h ago (too early)', () => {
    const apt = { master_id: 100, master_is_synthetic: 0, review_requested_at: NOW - 7200 };
    // Ended 23h ago — still inside the wait window.
    expect(shouldAutoDonePostVisit(apt, endBefore(23 * 3600), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(false);
  });

  it('auto-dones a real master when Stage 1 succeeded (review_requested_at set)', () => {
    const apt = { master_id: 100, master_is_synthetic: 0, review_requested_at: NOW - 22 * 3600 };
    expect(shouldAutoDonePostVisit(apt, endBefore(24 * 3600 + 60), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(true);
  });

  it('defers auto-done for a real master when Stage 1 has not delivered yet (review_requested_at IS NULL)', () => {
    // The bug case. Pre-fix this returned true and silently auto-doned
    // the visit even though the master never saw the prompt.
    const apt = { master_id: 100, master_is_synthetic: 0, review_requested_at: null };
    expect(shouldAutoDonePostVisit(apt, endBefore(24 * 3600 + 60), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(false);
  });

  it('auto-dones a synthetic personal-master appointment regardless of Stage 1', () => {
    // Synthetic masters never receive a Stage 1 prompt by design; the
    // appointment must still age out.
    const apt = { master_id: 10_000_000_001, master_is_synthetic: 1, review_requested_at: null };
    expect(shouldAutoDonePostVisit(apt, endBefore(24 * 3600 + 60), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(true);
  });

  it('auto-dones a manual-booking placeholder (negative master_id)', () => {
    const apt = { master_id: -1, master_is_synthetic: 0, review_requested_at: null };
    expect(shouldAutoDonePostVisit(apt, endBefore(24 * 3600 + 60), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(true);
  });

  it('auto-dones when master_id is 0 or null', () => {
    const a1 = { master_id: 0, master_is_synthetic: 0, review_requested_at: null };
    const a2 = { master_id: null, master_is_synthetic: 0, review_requested_at: null };
    expect(shouldAutoDonePostVisit(a1, endBefore(24 * 3600 + 60), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(true);
    expect(shouldAutoDonePostVisit(a2, endBefore(24 * 3600 + 60), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(true);
  });

  it('auto-dones a real master past the 72h hard cap even without Stage 1 delivery', () => {
    // After the hard cap we must give up — otherwise an unreachable
    // master would pin the appointment indefinitely.
    const apt = { master_id: 100, master_is_synthetic: 0, review_requested_at: null };
    // endSec = NOW - 73h → past the cap.
    expect(shouldAutoDonePostVisit(apt, endBefore(73 * 3600), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(true);
  });

  it('returns false for appointments that have not even reached end_at yet', () => {
    const apt = { master_id: 100, master_is_synthetic: 0, review_requested_at: null };
    expect(shouldAutoDonePostVisit(apt, endAfter(3600), ONE_DAY_AGO, HARD_CAP_AGO)).toBe(false);
  });
});

describe('POST_VISIT_HARD_CAP_SEC export', () => {
  it('is 72 hours', () => {
    expect(POST_VISIT_HARD_CAP_SEC).toBe(3 * 24 * 3600);
  });
});
