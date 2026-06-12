/**
 * reactiveMessaging — event-driven (webhook + behavioral-cron) system/billing
 * messages, delivered through the SAME platform_campaign_deliveries ledger and
 * the SAME per-channel delivery as the scheduled platformCampaigns dispatch.
 *
 * One ecosystem: a reactive message is just a delivery whose trigger is an event
 * (Stripe webhook, a behavioral threshold) instead of a cron due-scan. Content
 * comes from the keyed, per-locale platform_message_templates library
 * (template_key = the reactive `kind`, e.g. 'sys_payment_failed'); the tenant's
 * locale is resolved with an EN fallback. Idempotency is the ledger's
 * UNIQUE(campaign_id, occurrence_key, recipient, channel) — campaign_id is the
 * reactive kind, occurrence_key the natural event anchor (Stripe invoice id, a
 * subscription period, a behavioral week).
 *
 * The global MESSAGING_SEND_ENABLED gate (default '0') means every reactive
 * delivery is STAGED until the operator flips it: the ledger row is claimed and
 * marked 'skipped_flag', and NO external egress happens (no message row, no bell,
 * no Telegram, no email). Flipping the flag to '1' makes the same code deliver.
 *
 * Scope: platform_message_templates is platform-scoped; platform_campaign_deliveries
 * and platform_thread_messages are written under ctx.tenantId. Cross-tenant reach
 * is impossible — the caller passes this tenant's own owner recipients.
 */

import { dbAll, dbGet } from '../utils/db.js';
import { log } from '../utils/logger.js';
import { buildCampaignVars, renderTemplateVars } from './platformCampaignVars.js';
import { tryClaimDelivery, markDelivery, deliverChannel } from './platformCampaigns.js';

const DEFAULT_CHANNELS = ['center', 'bell'];
const FALLBACK_LOCALE = 'en';

/**
 * Is the real-send flag on? Default OFF — everything stages until flipped.
 * Reads the envCtx mirror (ctx.messagingSendEnabled) or a raw env object
 * (ctx.env.MESSAGING_SEND_ENABLED) so both production ctx and tests work.
 */
export function sendEnabled(ctx) {
  if (ctx?.messagingSendEnabled === true) return true;
  return (ctx?.env?.MESSAGING_SEND_ENABLED ?? '0') === '1';
}

function parseJson(s, fallback) {
  if (s == null) return fallback;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return fallback; }
}

/**
 * Resolve the best-matching approved template for a key, preferring the tenant
 * locale, then EN, then any available row. Returns { locale, bodies, variables }
 * or null when no approved template exists for the key.
 *
 * @param {object} ctx          tenant-scoped ctx (db)
 * @param {string} templateKey  reactive kind / template key
 * @param {string} locale       tenant/recipient locale (ru|ua|en|pl)
 */
export async function resolveTemplateBodies(ctx, templateKey, locale) {
  // tenant-scan-ignore: platform_message_templates is PLATFORM-scoped (no tenant_id by design, migration 0100) — the keyed template library is operator content, not tenant data.
  const rows = await dbAll(
    ctx,
    "SELECT locale, bodies_json, variables_json FROM platform_message_templates WHERE template_key = ? AND status = 'approved'",
    templateKey,
  ).catch(() => []);
  if (!rows || rows.length === 0) return null;

  const byLocale = new Map();
  for (const r of rows) byLocale.set(r.locale, r);
  const pick = byLocale.get(locale) || byLocale.get(FALLBACK_LOCALE) || rows[0];

  return {
    locale: pick.locale,
    bodies: parseJson(pick.bodies_json, {}),
    variables: parseJson(pick.variables_json, []),
  };
}

/**
 * Validate that every declared `{token}` is present in vars, then interpolate
 * each channel body. A declared-but-absent variable is a HARD FAIL (throws) so
 * tests catch a template/vars mismatch instead of shipping a '{token}' literal.
 */
function renderBodies(rawBodies, variables, vars) {
  const list = Array.isArray(variables) ? variables : [];
  for (const name of list) {
    if (!Object.prototype.hasOwnProperty.call(vars || {}, name)) {
      throw new Error(`reactiveMessaging: missing variable '${name}'`);
    }
  }
  const out = {};
  for (const [channel, body] of Object.entries(rawBodies || {})) {
    out[channel] = typeof body === 'string' ? renderTemplateVars(body, vars) : body;
  }
  return out;
}

/**
 * Build the bodies shape deliverChannel expects ({center,title,bellBody,
 * telegram,emailSubject,emailHtml}) from a rendered template body map.
 */
function toDeliveryBodies(rendered, title) {
  const center = rendered.center || rendered.bell || '';
  return {
    title,
    center,
    bellBody: rendered.bell || center,
    telegram: rendered.telegram || center,
    emailSubject: rendered.emailSubject || title,
    emailHtml: rendered.emailHtml || rendered.email || center,
  };
}

/**
 * Fire a reactive system/billing message to one tenant's recipients.
 *
 * @param {object} ctx  tenant-scoped ctx (db, tenantId, env, bot/TG, resend…)
 * @param {object} opts
 * @param {string} opts.kind          reactive kind == template_key
 * @param {string} opts.occurrenceKey natural event anchor (invoice id, period…)
 * @param {Array<{id,lang,name,email,email_verified}>} opts.recipients
 * @param {Record<string,unknown>} opts.vars  personalization tokens
 * @param {string[]} [opts.channels]  defaults to ['center','bell']
 * @param {string}  [opts.title]      bell/email title; defaults to kind
 * @returns {Promise<{delivered:number, skipped?:string}>}
 */
export async function fireReactiveMessage(ctx, opts) {
  if (!ctx?.db || !ctx?.tenantId) return { delivered: 0, skipped: 'no_ctx' };
  const { kind, occurrenceKey, recipients, vars = {}, channels = DEFAULT_CHANNELS, title } = opts || {};
  if (!kind || !occurrenceKey || !Array.isArray(recipients) || recipients.length === 0) {
    return { delivered: 0, skipped: 'no_recipients' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const flagOn = sendEnabled(ctx);
  const pseudoCampaign = { id: kind, kind, title: title || kind, created_by: 'system' };
  let delivered = 0;

  for (const recipient of recipients) {
    const locale = recipient.lang || FALLBACK_LOCALE;
    const tpl = await resolveTemplateBodies(ctx, kind, locale);
    if (!tpl) return { delivered, skipped: 'no_template' };

    // renderBodies throws on a missing declared variable — surfaces a hard fail.
    const rendered = renderBodies(tpl.bodies, tpl.variables, vars);
    const bodies = toDeliveryBodies(rendered, pseudoCampaign.title);

    for (const channel of channels) {
      const claimId = await tryClaimDelivery(ctx, kind, occurrenceKey, recipient.id, channel, ctx.tenantId, nowSec);
      if (!claimId) continue; // already claimed — idempotent skip

      if (!flagOn) {
        // Staged: claim the ledger slot, record the gate, NO external egress.
        await markDelivery(ctx, claimId, 'skipped_flag', 'messaging_send_disabled', nowSec);
        log.info('reactive.messaging', { action: 'staged', kind, channel, tenantId: ctx.tenantId });
        continue;
      }

      let result;
      try {
        result = await deliverChannel(ctx, channel, recipient, pseudoCampaign, bodies, occurrenceKey, nowSec);
      } catch (e) {
        result = { ok: false, error: e?.message };
      }
      const status = result.ok ? 'sent' : (result.skipped ? 'skipped' : 'failed');
      await markDelivery(ctx, claimId, status, result.error, nowSec);
      if (result.ok) delivered += 1;
    }
  }

  return { delivered };
}

/**
 * Load this tenant's owner/manager recipients (the audience for reactive
 * messages). Mirrors platformCampaigns.resolveTenantRecipients — excludes the
 * synthetic *.manicbot.local placeholder addresses.
 */
async function loadReactiveRecipients(ctx, tenantId) {
  const rows = await dbAll(
    ctx,
    "SELECT id, lang, email, email_verified, name FROM web_users WHERE tenant_id = ? AND role IN ('tenant_owner', 'tenant_manager') AND email NOT LIKE '%manicbot.local'",
    tenantId,
  ).catch(() => []);
  return rows || [];
}

/**
 * Webhook-friendly wrapper: resolve a tenant's row + recipients and fire a
 * reactive message to each, with per-recipient personalization
 * ({salon_name}/{owner_name}/{first_name}/{plan}) merged under the caller's
 * event-specific vars (e.g. {amount}, {planName}). Test tenants are skipped (the
 * same guard the cron dispatch uses). Safe to call fire-and-forget from a
 * webhook — never throws on a missing template (returns a skipped reason); a
 * missing DECLARED variable still throws (caught by the caller's .catch).
 *
 * @param {object} ctx      worker ctx (db, env, bot/TG, resend…) — tenantId set here
 * @param {string} tenantId target tenant
 * @param {{kind:string, occurrenceKey:string, vars?:object, channels?:string[], title?:string}} opts
 */
export async function fireReactiveForTenant(ctx, tenantId, opts) {
  if (!ctx?.db || !tenantId) return { delivered: 0, skipped: 'no_ctx' };
  const tctx = { ...ctx, tenantId };
  const tenant = await dbGet(
    tctx, 'SELECT id, name, plan, is_test FROM tenants WHERE id = ?', tenantId,
  ).catch(() => null);
  if (!tenant) return { delivered: 0, skipped: 'no_tenant' };
  if (tenant.is_test === 1) return { delivered: 0, skipped: 'test_tenant' };

  const recipients = await loadReactiveRecipients(tctx, tenantId);
  if (recipients.length === 0) return { delivered: 0, skipped: 'no_recipients' };

  let delivered = 0;
  let lastSkip;
  for (const recipient of recipients) {
    const vars = { ...buildCampaignVars(tenant, recipient), ...(opts.vars || {}) };
    const res = await fireReactiveMessage(tctx, {
      kind: opts.kind,
      occurrenceKey: opts.occurrenceKey,
      recipients: [recipient],
      vars,
      channels: opts.channels,
      title: opts.title,
    });
    delivered += res.delivered;
    if (res.skipped) lastSkip = res.skipped;
  }
  return delivered > 0 ? { delivered } : { delivered: 0, skipped: lastSkip };
}
