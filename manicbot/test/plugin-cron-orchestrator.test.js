/**
 * phasePluginCron — the platform's first plugin-cron orchestrator.
 *
 * Covers the platform invariants (NOT the reminders handler specifics —
 * those live in reminders-cron.test.js):
 *   - Only enabled installations for the current tenant are dispatched.
 *   - Cross-tenant installs (other tenant) are skipped.
 *   - Disabled installs are skipped.
 *   - past_due / canceled paid addons are skipped even with enabled=1.
 *   - Slugs not in the dispatcher map are silently ignored (e.g. a plugin
 *     that doesn't have cron).
 *   - A handler throwing does NOT propagate — the orchestrator catches +
 *     logs the event, so sibling plugins keep running.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

const remindersCronStub = vi.fn(async () => ({ fired: 0, skipped: 0 }));

// Stub the actual cron handler so the orchestrator test is decoupled from
// the reminders implementation. The orchestrator imports remindersCron at
// module load — we override AFTER the import via vi.doMock + dynamic import.
vi.mock('../plugins/reminders/cron.js', () => ({
  remindersCron: (...args) => remindersCronStub(...args),
}));

const { phasePluginCron } = await import('../src/handlers/cron.js');

async function seedInstall(ctx, install) {
  await ctx.db.prepare(`
    INSERT INTO plugin_installations
      (id, tenant_id, plugin_slug, enabled, version, installed_by, installed_at, updated_at, settings_json, billing_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    install.id,
    install.tenant_id ?? null,
    install.plugin_slug,
    install.enabled ?? 1,
    install.version ?? '0.1.0',
    install.installed_by ?? 'wu_test',
    install.installed_at ?? Math.floor(Date.now() / 1000),
    install.updated_at ?? Math.floor(Date.now() / 1000),
    install.settings_json ?? null,
    install.billing_state ?? 'not_applicable',
  ).run();
}

beforeEach(() => {
  remindersCronStub.mockReset();
  remindersCronStub.mockImplementation(async () => ({ fired: 0, skipped: 0 }));
});

describe('phasePluginCron — dispatch invariants', () => {
  it('dispatches reminders to the registered handler for current tenant', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_a', tenant_id: 't_a', plugin_slug: 'reminders' });
    await phasePluginCron(ctx, Date.now());
    expect(remindersCronStub).toHaveBeenCalledTimes(1);
    const [passedCtx, install, now] = remindersCronStub.mock.calls[0];
    expect(passedCtx.tenantId).toBe('t_a');
    expect(install.id).toBe('pi_a');
    expect(install.plugin_slug).toBe('reminders');
    expect(typeof now).toBe('number');
  });

  it('skips installations of other tenants', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_other', tenant_id: 't_b', plugin_slug: 'reminders' });
    await phasePluginCron(ctx, Date.now());
    expect(remindersCronStub).not.toHaveBeenCalled();
  });

  it('skips disabled installations', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_off', tenant_id: 't_a', plugin_slug: 'reminders', enabled: 0 });
    await phasePluginCron(ctx, Date.now());
    expect(remindersCronStub).not.toHaveBeenCalled();
  });

  it('skips past_due paid addons even with enabled=1', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, {
      id: 'pi_pastdue', tenant_id: 't_a', plugin_slug: 'reminders',
      enabled: 1, billing_state: 'past_due',
    });
    await phasePluginCron(ctx, Date.now());
    expect(remindersCronStub).not.toHaveBeenCalled();
  });

  it('skips canceled paid addons', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, {
      id: 'pi_cancelled', tenant_id: 't_a', plugin_slug: 'reminders',
      enabled: 1, billing_state: 'canceled',
    });
    await phasePluginCron(ctx, Date.now());
    expect(remindersCronStub).not.toHaveBeenCalled();
  });

  it('silently ignores slugs not in the dispatcher map', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_other_plugin', tenant_id: 't_a', plugin_slug: 'loyalty-stamps' });
    await phasePluginCron(ctx, Date.now());
    expect(remindersCronStub).not.toHaveBeenCalled();
    // No throw, no surprise.
  });

  it('catches handler throws — orchestrator never propagates plugin failures', async () => {
    remindersCronStub.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_boom', tenant_id: 't_a', plugin_slug: 'reminders' });
    await expect(phasePluginCron(ctx, Date.now())).resolves.toBeUndefined();
    expect(remindersCronStub).toHaveBeenCalledTimes(1);
  });

  it('does nothing when ctx has no db / tenantId', async () => {
    await expect(phasePluginCron({}, Date.now())).resolves.toBeUndefined();
    await expect(phasePluginCron(null, Date.now())).resolves.toBeUndefined();
    expect(remindersCronStub).not.toHaveBeenCalled();
  });

  it('passes the same nowMs through to every handler', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_t', tenant_id: 't_a', plugin_slug: 'reminders' });
    const pinned = 1_700_000_000_000;
    await phasePluginCron(ctx, pinned);
    expect(remindersCronStub.mock.calls[0][2]).toBe(pinned);
  });
});
