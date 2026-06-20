/**
 * Run a marketing campaign send (admin-app surface).
 *
 * Caller passes a campaign id and the function:
 *   1. Loads campaign + template + (optional) segment.
 *   2. Locks the campaign by flipping status to `sending`.
 *   3. Resolves the audience via {@link resolveAudience}.
 *   4. For each recipient, renders the template, INSERTs a `marketing_sends`
 *      row in `queued` status, then calls `provider.sendEmail` / `sendSms`
 *      and updates the row with the final status + provider_message_id.
 *   5. Updates the campaign with terminal status (`sent` or `failed`) and
 *      stats_json (`{queued, sent, failed, total}`).
 *
 * Hard cap (inline mode): 500 recipients. Larger audiences keep status =
 * `sending`; the worker cron picks up the tail.
 *
 * Returns `{ ok, error?, total, sent, failed, deferred }` — `deferred` is
 * the count that was left as `queued` for cron to flush.
 */

import { eq } from "drizzle-orm";
import {
  marketingCampaigns,
  marketingSends,
  marketingTemplates,
  tenants,
} from "~/server/db/schema";
import { pickProvider } from "~/server/marketing/providers";
import { resolveAudience, type ResolvedContact } from "./audience";
import { renderTemplate } from "./templateRender";
import { getUnsubscribeUrl } from "./unsubscribeUrl";
import { rewriteLinksForTracking } from "./linkRewrite";
import { getRuntimeEnv } from "~/server/runtimeEnv";

const TRACKING_FALLBACK_ORIGIN = "https://manicbot.com";

type DbInstance = ReturnType<typeof import("~/server/db").getDb>;

const INLINE_CAP = 500;

export interface RunCampaignSendArgs {
  db: DbInstance;
  tenantId: string | null;
  campaignId: string;
  /** UNIX seconds. Defaults to now(). */
  nowSec?: number;
  /** Override inline cap for tests. */
  inlineCap?: number;
}

export interface RunCampaignSendResult {
  ok: boolean;
  error?: string;
  total: number;
  sent: number;
  failed: number;
  deferred: number;
  campaignStatus: string;
}

function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function runCampaignSend(args: RunCampaignSendArgs): Promise<RunCampaignSendResult> {
  const { db, tenantId, campaignId } = args;
  const now = args.nowSec ?? nowS();
  const inlineCap = Math.max(1, args.inlineCap ?? INLINE_CAP);

  // 1) Load campaign.
  const rows = await db.select().from(marketingCampaigns)
    .where(eq(marketingCampaigns.id, campaignId))
    .limit(1);
  const c = rows[0];
  if (!c) {
    return baseResult("campaign_not_found");
  }
  // Tenant-scoped callers: refuse cross-tenant.
  if (tenantId && c.tenantId && c.tenantId !== tenantId) {
    return baseResult("tenant_mismatch");
  }
  if (c.status !== "draft" && c.status !== "scheduled" && c.status !== "sending") {
    // Already terminal — idempotent no-op.
    return {
      ok: false,
      error: `not_eligible_${c.status}`,
      total: 0, sent: 0, failed: 0, deferred: 0,
      campaignStatus: c.status,
    };
  }

  // 2) Lock — only flip if not already sending (avoids two concurrent runners).
  if (c.status !== "sending") {
    await db.update(marketingCampaigns).set({
      status: "sending",
      startedAt: now,
      updatedAt: now,
    }).where(eq(marketingCampaigns.id, campaignId));
  }

  // 3) Load template (optional but typically required for real sends).
  if (!c.templateId) {
    await failCampaign(db, campaignId, "no_template", now);
    return baseResult("no_template", "failed");
  }
  const tplRows = await db.select().from(marketingTemplates)
    .where(eq(marketingTemplates.id, c.templateId))
    .limit(1);
  const tpl = tplRows[0];
  if (!tpl) {
    await failCampaign(db, campaignId, "template_not_found", now);
    return baseResult("template_not_found", "failed");
  }

  // Channel mismatch check — campaign and template must agree.
  if (tpl.channel !== c.channel) {
    await failCampaign(db, campaignId, "channel_mismatch", now);
    return baseResult("channel_mismatch", "failed");
  }

  // 4) Provider.
  const channel = c.channel as "email" | "sms" | "whatsapp";
  const provider = pickProvider(channel);
  if (!provider) {
    await failCampaign(db, campaignId, "no_provider", now);
    return baseResult("no_provider", "failed");
  }
  const sendFn = channel === "email" ? provider.sendEmail : provider.sendSms;
  if (!sendFn) {
    await failCampaign(db, campaignId, "provider_missing_channel", now);
    return baseResult("provider_missing_channel", "failed");
  }
  if (!provider.isConfigured(channel)) {
    await failCampaign(db, campaignId, "provider_not_configured", now);
    return baseResult("provider_not_configured", "failed");
  }

  // 5) Resolve audience.
  const effectiveTenantId = c.tenantId ?? tenantId;
  if (!effectiveTenantId) {
    await failCampaign(db, campaignId, "no_tenant_scope", now);
    return baseResult("no_tenant_scope", "failed");
  }

  const { contacts, totalCount } = await resolveAudience({
    db,
    tenantId: effectiveTenantId,
    segmentId: c.segmentId ?? null,
    channel,
    limit: inlineCap,
    nowSec: now,
    // Exclude contacts already sent for this campaign so each cron tick
    // advances to the next un-sent batch (no >INLINE_CAP re-send loop).
    excludeSentForCampaignId: c.id,
  });

  // 6) Salon name for {{salon}} merge var (best-effort; non-fatal).
  let salonName: string | null = null;
  try {
    const tRow = await db.select({ name: tenants.name }).from(tenants)
      .where(eq(tenants.id, effectiveTenantId)).limit(1);
    salonName = tRow[0]?.name ?? null;
  } catch {
    /* tenant lookup is non-fatal */
  }

  // 7) Fan out.
  let sent = 0;
  let failed = 0;
  for (const contact of contacts) {
    const recipient = channel === "email" ? (contact.email ?? "") : (contact.phone ?? "");
    if (!recipient) {
      failed += 1;
      continue;
    }

    const sendRowId = rid("snd");
    const queuedAt = nowS();
    // onConflictDoNothing is the row-level race guard: the NOT EXISTS exclusion
    // in resolveAudience already skips already-sent contacts, but two ticks
    // racing the same batch could both pass that read. Once a
    // UNIQUE(campaign_id, contact_id) index exists this makes the loser a
    // no-op; until then it is harmless (random PK never collides).
    await db.insert(marketingSends).values({
      id: sendRowId,
      campaignId: c.id,
      contactId: contact.id,
      recipient,
      provider: provider.name,
      status: "queued",
      queuedAt,
    }).onConflictDoNothing();

    try {
      const unsubUrl = channel === "email"
        ? await getUnsubscribeUrl(db, contact.id, contact.unsubscribeToken)
        : "";
      const rendered = renderTemplate(
        { channel, subject: tpl.subject, body: tpl.body },
        contact as ResolvedContact,
        {
          salonName,
          unsubscribeUrl: unsubUrl,
          locale: (tpl.locale as "ru" | "ua" | "en" | "pl" | null) ?? "ru",
        },
      );

      // First-party click tracking: rewrite the email's links through the
      // signed Worker /r/ redirect. Fail-open — never block a send on this.
      let html = rendered.html;
      if (channel === "email") {
        const trackingSecret = (getRuntimeEnv("CLICK_TOKEN_SECRET") ?? "").trim();
        if (trackingSecret && getRuntimeEnv("CLICK_TRACKING_ENABLED") !== "0") {
          const origin = (getRuntimeEnv("WORKER_PUBLIC_URL") ?? TRACKING_FALLBACK_ORIGIN).replace(/\/+$/, "");
          html = await rewriteLinksForTracking(rendered.html, {
            origin,
            campaignId: c.id,
            sendId: sendRowId,
            tenantId: effectiveTenantId,
            contactId: contact.id,
            secret: trackingSecret,
          });
        }
      }

      const result = channel === "email"
        ? await provider.sendEmail!({
            to: recipient,
            subject: rendered.subject || tpl.name,
            html,
          })
        : await provider.sendSms!({
            to: recipient,
            text: rendered.text,
            tag: `cmp_${c.id}`,
          });

      const completedAt = nowS();
      if (result.ok) {
        sent += 1;
        await db.update(marketingSends).set({
          status: "sent",
          providerMessageId: result.messageId ?? null,
          sentAt: completedAt,
        }).where(eq(marketingSends.id, sendRowId));
      } else {
        failed += 1;
        await db.update(marketingSends).set({
          status: "failed",
          error: (result.error ?? "send_failed").slice(0, 500),
          sentAt: completedAt,
        }).where(eq(marketingSends.id, sendRowId));
      }
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : "send_threw";
      await db.update(marketingSends).set({
        status: "failed",
        error: msg.slice(0, 500),
        sentAt: nowS(),
      }).where(eq(marketingSends.id, sendRowId));
    }
  }

  const deferred = Math.max(0, totalCount - contacts.length);
  const finishedAt = nowS();
  const stats = { total: totalCount, sent, failed, deferred };
  const terminalStatus = deferred > 0 ? "sending" : (failed === contacts.length && contacts.length > 0 ? "failed" : "sent");

  await db.update(marketingCampaigns).set({
    status: terminalStatus,
    finishedAt: terminalStatus === "sending" ? null : finishedAt,
    statsJson: JSON.stringify(stats),
    error: terminalStatus === "failed" ? "all_sends_failed" : null,
    updatedAt: finishedAt,
  }).where(eq(marketingCampaigns.id, campaignId));

  return {
    ok: terminalStatus !== "failed",
    total: totalCount,
    sent,
    failed,
    deferred,
    campaignStatus: terminalStatus,
  };
}

function baseResult(
  error: string,
  campaignStatus: string = "draft",
): RunCampaignSendResult {
  return { ok: false, error, total: 0, sent: 0, failed: 0, deferred: 0, campaignStatus };
}

async function failCampaign(
  db: DbInstance,
  campaignId: string,
  reason: string,
  now: number,
): Promise<void> {
  await db.update(marketingCampaigns).set({
    status: "failed",
    error: reason,
    finishedAt: now,
    updatedAt: now,
  }).where(eq(marketingCampaigns.id, campaignId));
}
