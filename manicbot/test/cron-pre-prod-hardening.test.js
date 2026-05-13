/**
 * Locks in two cron-side guardrails added during the pre-prod hardening
 * pass:
 *
 *   1. error_log retention bumped 30 → 90 days. 30 days was too tight
 *      for "check the logs once a month" ops workflow — we want at least
 *      one quarter of history.
 *   2. WA template-quota exhaustion now emits a structured
 *      `wa.template.quota_exhausted` analytics event so the dashboard
 *      can surface the case where the plan's monthly template quota is
 *      used up and reminders are silently dropped.
 *
 * Both are guarded by source-level assertions because the cron functions
 * they live in are deep inside per-tenant loops that are hard to set up
 * in isolation. The grep is enough to catch a regression that flips the
 * constants back or removes the event emission.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cronSource = readFileSync(join(__dirname, '..', 'src', 'handlers', 'cron.js'), 'utf8');

describe('cron retention — error_log 90 day window', () => {
  it('error_log is pruned with a -90 days window (not -30 days)', () => {
    // Match the exact RETENTION_PRUNES entry for error_log.
    const errorLogEntry = cronSource.match(/{\s*table:\s*'error_log',[^}]*}/);
    expect(errorLogEntry, 'RETENTION_PRUNES entry for error_log not found').toBeTruthy();
    expect(errorLogEntry[0]).toContain("'-90 days'");
    expect(errorLogEntry[0]).not.toContain("'-30 days'");
  });

  it('still includes error_log in the retention list', () => {
    expect(cronSource).toMatch(/{\s*table:\s*'error_log'/);
  });
});

describe('cron WA reminders — template quota exhaustion event', () => {
  it('emits wa.template.quota_exhausted when both 24h window AND template quota are unavailable', () => {
    // The event is fired in the else branch after `canSendTemplate`
    // returns false. Pre-fix this branch was a silent skip.
    expect(cronSource).toContain("'wa.template.quota_exhausted'");
  });

  it('classifies the event at warn level (ops should see it)', () => {
    // The logEvent payload must mark this as warn so it surfaces in
    // the Errors / Activity feed, not buried in info chatter.
    const evtBlock = cronSource.match(
      /void logEvent\(ctx, 'wa\.template\.quota_exhausted',[\s\S]*?\}\);/,
    );
    expect(evtBlock, 'wa.template.quota_exhausted logEvent block not found').toBeTruthy();
    expect(evtBlock[0]).toContain("level: 'warn'");
    expect(evtBlock[0]).toContain('appointmentId');
    expect(evtBlock[0]).toContain('reminderKind');
    expect(evtBlock[0]).toContain("channel: 'whatsapp'");
  });

  it('emits the event INSIDE the else branch of canSendTemplate (correct call site)', () => {
    // The event must be the action taken when canSendTemplate returns
    // false — not when the template send itself fails. Regression guard
    // against accidentally moving the emission into the success path.
    const block = cronSource.match(
      /else if \(await canSendTemplate\(ctx\)\)\s*{[\s\S]*?}\s*else\s*{[\s\S]*?}/,
    );
    expect(block, 'canSendTemplate if/else block not found').toBeTruthy();
    expect(block[0]).toContain("'wa.template.quota_exhausted'");
  });
});
