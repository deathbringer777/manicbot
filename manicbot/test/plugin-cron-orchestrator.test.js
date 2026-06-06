/**
 * phasePluginCron — the generic plugin-cron orchestrator.
 *
 * The `reminders` plugin (the first AND only cron-backed plugin) was removed
 * 2026-06-06, so PLUGIN_CRON_DISPATCHERS is currently empty. The orchestrator
 * machinery stays for the next cron plugin; these tests pin its platform
 * invariants by injecting a FAKE dispatcher map (phasePluginCron's optional
 * 3rd arg) instead of depending on any real plugin:
 *   - Only enabled installations for the current tenant are dispatched.
 *   - Cross-tenant installs (other tenant) are skipped.
 *   - Disabled installs are skipped.
 *   - past_due / canceled paid addons are skipped even with enabled=1.
 *   - Slugs not in the dispatcher map are silently ignored.
 *   - A handler throwing does NOT propagate — the orchestrator catches + logs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { phasePluginCron } from '../src/handlers/cron.js';

const cronStub = vi.fn(async () => ({ fired: 0, skipped: 0 }));

// Fake dispatcher map injected into phasePluginCron — decouples this test from
// any real plugin (none have cron right now).
const DISPATCHERS = { 'demo-plugin': (...args) => cronStub(...args) };

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
  cronStub.mockReset();
  cronStub.mockImplementation(async () => ({ fired: 0, skipped: 0 }));
});

describe('phasePluginCron — dispatch invariants', () => {
  it('dispatches a cron-backed plugin to its handler for the current tenant', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_a', tenant_id: 't_a', plugin_slug: 'demo-plugin' });
    await phasePluginCron(ctx, Date.now(), DISPATCHERS);
    expect(cronStub).toHaveBeenCalledTimes(1);
    const [passedCtx, install, now] = cronStub.mock.calls[0];
    expect(passedCtx.tenantId).toBe('t_a');
    expect(install.id).toBe('pi_a');
    expect(install.plugin_slug).toBe('demo-plugin');
    expect(typeof now).toBe('number');
  });

  it('skips installations of other tenants', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_other', tenant_id: 't_b', plugin_slug: 'demo-plugin' });
    await phasePluginCron(ctx, Date.now(), DISPATCHERS);
    expect(cronStub).not.toHaveBeenCalled();
  });

  it('skips disabled installations', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_off', tenant_id: 't_a', plugin_slug: 'demo-plugin', enabled: 0 });
    await phasePluginCron(ctx, Date.now(), DISPATCHERS);
    expect(cronStub).not.toHaveBeenCalled();
  });

  it('skips past_due paid addons even with enabled=1', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, {
      id: 'pi_pastdue', tenant_id: 't_a', plugin_slug: 'demo-plugin',
      enabled: 1, billing_state: 'past_due',
    });
    await phasePluginCron(ctx, Date.now(), DISPATCHERS);
    expect(cronStub).not.toHaveBeenCalled();
  });

  it('skips canceled paid addons', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, {
      id: 'pi_cancelled', tenant_id: 't_a', plugin_slug: 'demo-plugin',
      enabled: 1, billing_state: 'canceled',
    });
    await phasePluginCron(ctx, Date.now(), DISPATCHERS);
    expect(cronStub).not.toHaveBeenCalled();
  });

  it('silently ignores slugs not in the dispatcher map', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_other_plugin', tenant_id: 't_a', plugin_slug: 'loyalty-stamps' });
    await phasePluginCron(ctx, Date.now(), DISPATCHERS);
    expect(cronStub).not.toHaveBeenCalled();
    // No throw, no surprise.
  });

  it('catches handler throws — orchestrator never propagates plugin failures', async () => {
    cronStub.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_boom', tenant_id: 't_a', plugin_slug: 'demo-plugin' });
    await expect(phasePluginCron(ctx, Date.now(), DISPATCHERS)).resolves.toBeUndefined();
    expect(cronStub).toHaveBeenCalledTimes(1);
  });

  it('does nothing when ctx has no db / tenantId', async () => {
    await expect(phasePluginCron({}, Date.now(), DISPATCHERS)).resolves.toBeUndefined();
    await expect(phasePluginCron(null, Date.now(), DISPATCHERS)).resolves.toBeUndefined();
    expect(cronStub).not.toHaveBeenCalled();
  });

  it('passes the same nowMs through to every handler', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedInstall(ctx, { id: 'pi_t', tenant_id: 't_a', plugin_slug: 'demo-plugin' });
    const pinned = 1_700_000_000_000;
    await phasePluginCron(ctx, pinned, DISPATCHERS);
    expect(cronStub.mock.calls[0][2]).toBe(pinned);
  });
});
