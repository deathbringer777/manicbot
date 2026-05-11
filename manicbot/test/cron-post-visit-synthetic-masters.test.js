/**
 * 0052: the cron post-visit phase must skip masters whose chat_id is
 * synthetic (web-only personal masters). Sending a Telegram prompt to a
 * synthetic chat would fail silently and pollute analytics with
 * `post_visit.prompt_sent` rows for non-existent recipients.
 *
 * The cron's candidate query LEFT JOINs `masters` and surfaces
 * `master_is_synthetic`. The inner gate is:
 *
 *   if (a.master_id && a.master_id > 0 && !a.master_is_synthetic) {
 *     send(...);
 *   }
 *
 * This test verifies that gate logic in isolation — exactly the boolean
 * the cron handler computes, with no Telegram round-trip.
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirror of the inner gate in `processPostVisitConfirmations` after the
 * LEFT JOIN was added in 0052.
 */
function shouldSendPostVisitPrompt(apt) {
  return Boolean(apt.master_id && apt.master_id > 0 && !apt.master_is_synthetic);
}

describe('cron post-visit phase — synthetic master skip (0052)', () => {
  it('sends the prompt to a real Telegram master (master_is_synthetic=0)', () => {
    const apt = { master_id: 555_111_222, master_is_synthetic: 0 };
    expect(shouldSendPostVisitPrompt(apt)).toBe(true);
  });

  it('skips a synthetic personal-master row (master_is_synthetic=1)', () => {
    // 10_000_000_001 is well inside the synthetic range used by
    // webUsers.register / provisioning.provisionTestAccount /
    // roleChangeRequests / salon.inviteMaster.
    const apt = { master_id: 10_000_000_001, master_is_synthetic: 1 };
    expect(shouldSendPostVisitPrompt(apt)).toBe(false);
  });

  it('skips when master_id is negative (manual-booking placeholder)', () => {
    const apt = { master_id: -1, master_is_synthetic: 0 };
    expect(shouldSendPostVisitPrompt(apt)).toBe(false);
  });

  it('skips when master_id is null', () => {
    const apt = { master_id: null, master_is_synthetic: 0 };
    expect(shouldSendPostVisitPrompt(apt)).toBe(false);
  });

  it('skips when master_id is 0', () => {
    const apt = { master_id: 0, master_is_synthetic: 0 };
    expect(shouldSendPostVisitPrompt(apt)).toBe(false);
  });

  it('skips even a positive master_id that happens to be synthetic', () => {
    // Defense-in-depth: even if some legacy row in the synthetic range
    // ends up with master_is_synthetic=1, we MUST skip it.
    const apt = { master_id: 10_000_000_000, master_is_synthetic: 1 };
    expect(shouldSendPostVisitPrompt(apt)).toBe(false);
  });
});

/**
 * Verify the SQL the cron runs actually carries the LEFT JOIN + the
 * `master_is_synthetic` column. The query text is the contract between
 * the cron and migration 0052 — if either drifts, this guard catches it.
 */
describe('cron post-visit SQL surface — 0052 LEFT JOIN', () => {
  it('includes the masters LEFT JOIN and is_synthetic projection', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const cronSource = readFileSync(join(__dirname, '..', 'src', 'handlers', 'cron.js'), 'utf8');
    expect(cronSource).toMatch(/LEFT JOIN masters m/);
    expect(cronSource).toMatch(/COALESCE\(m\.is_synthetic, 0\) AS master_is_synthetic/);
    expect(cronSource).toMatch(/!a\.master_is_synthetic/);
  });
});
