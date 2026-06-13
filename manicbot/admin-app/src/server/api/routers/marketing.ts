/**
 * Marketing module router — God Mode CRM + campaigns.
 *
 * Phase 2 (PR-A): real send via runCampaignSend, audience preview,
 * per-campaign stats. God-mode mirror of `marketingTenant.ts` — same
 * procs but no tenant_id WHERE clause, since adminProcedure already gates
 * to system_admin.
 */

import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { sanitizeText, sanitizeHtml } from "~/server/security/sanitize";
import {
  marketingContacts,
  marketingSegments,
  marketingTemplates,
  marketingCampaigns,
  marketingSends,
  marketingProviders,
  marketingConsentLog,
  marketingAutomations,
} from "~/server/db/schema";
import { listProviders, getProvider } from "~/server/marketing/providers";
import type { ProviderName } from "~/server/marketing/providers";
import { runCampaignSend } from "~/server/marketing/sender";
import { resolveAudience } from "~/server/marketing/audience";

const CHANNEL = z.enum(["email", "sms", "whatsapp"]);
const CAMPAIGN_STATUS = z.enum(["draft", "scheduled", "sending", "sent", "paused", "failed"]);

function now() {
  return Math.floor(Date.now() / 1000);
}
function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
/** PII-safe email preview for the audience sample — `jo***@gmail.com`. */
function redactEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return null;
  const head = (local ?? "").slice(0, 2);
  return `${head}***@${domain}`;
}

export const marketingRouter = createTRPCRouter({
  // ═══════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ═══════════════════════════════════════════════════════════════
  stats: adminProcedure.query(async ({ ctx }) => {
    const [contactsRow, campaignsRow, sendsRow, segmentsRow] = await Promise.all([
      ctx.db
        .select({ count: sql<number>`count(*)`, subscribed: sql<number>`sum(case when unsubscribed=0 then 1 else 0 end)` })
        .from(marketingContacts),
      ctx.db
        .select({ status: marketingCampaigns.status, count: sql<number>`count(*)` })
        .from(marketingCampaigns)
        .groupBy(marketingCampaigns.status),
      ctx.db
        .select({ status: marketingSends.status, count: sql<number>`count(*)` })
        .from(marketingSends)
        .groupBy(marketingSends.status),
      ctx.db.select({ count: sql<number>`count(*)` }).from(marketingSegments),
    ]);

    const campaignsByStatus: Record<string, number> = {};
    for (const r of campaignsRow) campaignsByStatus[r.status] = r.count;

    const sendsByStatus: Record<string, number> = {};
    for (const r of sendsRow) sendsByStatus[r.status] = r.count;

    return {
      contacts: {
        total: contactsRow[0]?.count ?? 0,
        subscribed: contactsRow[0]?.subscribed ?? 0,
      },
      campaigns: campaignsByStatus,
      sends: sendsByStatus,
      segments: segmentsRow[0]?.count ?? 0,
    };
  }),

  // ═══════════════════════════════════════════════════════════════
  //  CONTACTS
  // ═══════════════════════════════════════════════════════════════
  contactsList: adminProcedure
    .input(z.object({
      // Cap raised 500 → 1000 to match marketingTenant.contactsList and back
      // the "Показать все" page-size option on the shared Contacts UI.
      limit: z.number().int().min(1).max(1000).default(100),
      offset: z.number().int().min(0).default(0),
      subscribedOnly: z.boolean().default(false),
      search: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conds = [] as any[];
      if (input.subscribedOnly) conds.push(eq(marketingContacts.unsubscribed, 0));
      if (input.search && input.search.trim()) {
        const s = `%${input.search.trim().toLowerCase()}%`;
        conds.push(sql`(lower(${marketingContacts.email}) like ${s} or lower(coalesce(${marketingContacts.name},'')) like ${s} or coalesce(${marketingContacts.phone},'') like ${s})`);
      }
      const where = conds.length ? (conds.length === 1 ? conds[0] : and(...conds)) : undefined;

      const [items, totalRow] = await Promise.all([
        ctx.db.select().from(marketingContacts)
          .where(where as any)
          .orderBy(desc(marketingContacts.lastSeenAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ count: sql<number>`count(*)` }).from(marketingContacts).where(where as any),
      ]);
      return { items, total: totalRow[0]?.count ?? 0 };
    }),

  contactUpdate: adminProcedure
    .input(z.object({
      id: z.number().int(),
      tags: z.string().nullable().optional(),
      lifecycleStage: z.string().nullable().optional(),
      locale: z.string().nullable().optional(),
      consentEmail: z.boolean().optional(),
      consentSms: z.boolean().optional(),
      unsubscribed: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = {};
      if (input.tags !== undefined) patch.tags = input.tags;
      if (input.lifecycleStage !== undefined) patch.lifecycleStage = input.lifecycleStage;
      if (input.locale !== undefined) patch.locale = input.locale;
      if (input.consentEmail !== undefined) patch.consentEmail = input.consentEmail ? 1 : 0;
      if (input.consentSms !== undefined) patch.consentSms = input.consentSms ? 1 : 0;
      if (input.unsubscribed !== undefined) patch.unsubscribed = input.unsubscribed ? 1 : 0;
      if (!Object.keys(patch).length) return { ok: true };
      await ctx.db.update(marketingContacts).set(patch).where(eq(marketingContacts.id, input.id));

      // GDPR (MKT-01/MKT-06): demonstrable consent audit trail for God-Mode
      // edits of consent flags, mirroring marketingTenant.contactUpdate.
      const consentTs = now();
      const consentLogs: Array<typeof marketingConsentLog.$inferInsert> = [];
      if (input.consentEmail !== undefined) {
        consentLogs.push({ contactId: input.id, event: input.consentEmail ? "subscribed" : "unsubscribed", source: "system_admin", note: "email", createdAt: consentTs });
      }
      if (input.consentSms !== undefined) {
        consentLogs.push({ contactId: input.id, event: input.consentSms ? "subscribed" : "unsubscribed", source: "system_admin", note: "sms", createdAt: consentTs });
      }
      if (consentLogs.length) await ctx.db.insert(marketingConsentLog).values(consentLogs);
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  SEGMENTS
  // ═══════════════════════════════════════════════════════════════
  segmentsList: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(marketingSegments).orderBy(desc(marketingSegments.updatedAt));
  }),

  segmentCreate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(120),
      description: z.string().optional(),
      filterJson: z.string().default("{}"),
      tenantId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = rid("seg");
      const t = now();
      await ctx.db.insert(marketingSegments).values({
        id,
        tenantId: input.tenantId ?? null,
        name: sanitizeText(input.name, 120),
        description: input.description ? sanitizeText(input.description, 500) : null,
        filterJson: input.filterJson,
        contactCount: 0,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  segmentDelete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(marketingSegments).where(eq(marketingSegments.id, input.id));
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  templatesList: adminProcedure
    .input(z.object({ channel: CHANNEL.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const where = input?.channel ? eq(marketingTemplates.channel, input.channel) : undefined;
      return ctx.db.select().from(marketingTemplates)
        .where(where as any)
        .orderBy(desc(marketingTemplates.updatedAt));
    }),

  templateCreate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(120),
      channel: CHANNEL,
      subject: z.string().optional(),
      body: z.string().min(1),
      locale: z.string().optional(),
      tenantId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = rid("tpl");
      const t = now();
      await ctx.db.insert(marketingTemplates).values({
        id,
        tenantId: input.tenantId ?? null,
        name: sanitizeText(input.name, 120),
        channel: input.channel,
        subject: input.subject ? sanitizeText(input.subject, 500) : null,
        body: sanitizeHtml(input.body, "marketingHtml"),
        locale: input.locale ?? null,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  templateUpdate: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      subject: z.string().nullable().optional(),
      body: z.string().optional(),
      locale: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) patch.name = sanitizeText(input.name, 120);
      if (input.subject !== undefined) patch.subject = input.subject ? sanitizeText(input.subject, 500) : input.subject;
      if (input.body !== undefined) patch.body = sanitizeHtml(input.body, "marketingHtml");
      if (input.locale !== undefined) patch.locale = input.locale;
      await ctx.db.update(marketingTemplates).set(patch).where(eq(marketingTemplates.id, input.id));
      return { ok: true };
    }),

  templateDelete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(marketingTemplates).where(eq(marketingTemplates.id, input.id));
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  CAMPAIGNS
  // ═══════════════════════════════════════════════════════════════
  campaignsList: adminProcedure
    .input(z.object({ status: CAMPAIGN_STATUS.optional(), channel: CHANNEL.optional() }).optional())
    .query(async ({ ctx, input }) => {
      const conds: any[] = [];
      if (input?.status) conds.push(eq(marketingCampaigns.status, input.status));
      if (input?.channel) conds.push(eq(marketingCampaigns.channel, input.channel));
      const where = conds.length ? (conds.length === 1 ? conds[0] : and(...conds)) : undefined;
      return ctx.db.select().from(marketingCampaigns)
        .where(where as any)
        .orderBy(desc(marketingCampaigns.updatedAt));
    }),

  campaignCreate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(120),
      channel: CHANNEL,
      segmentId: z.string().optional(),
      templateId: z.string().optional(),
      provider: z.string().optional(),
      scheduledAt: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = rid("cmp");
      const t = now();
      await ctx.db.insert(marketingCampaigns).values({
        id,
        name: sanitizeText(input.name, 120),
        channel: input.channel,
        segmentId: input.segmentId ?? null,
        templateId: input.templateId ?? null,
        provider: input.provider ?? null,
        status: input.scheduledAt ? "scheduled" : "draft",
        scheduledAt: input.scheduledAt ?? null,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  campaignDelete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, input.id));
      return { ok: true };
    }),

  /**
   * Send the campaign now (God Mode). Delegates to `runCampaignSend()`.
   * Inline cap 500; tail deferred to worker cron.
   */
  campaignSendNow: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.select().from(marketingCampaigns)
        .where(eq(marketingCampaigns.id, input.id)).limit(1);
      const c = row[0];
      if (!c) return { ok: false as const, error: "campaign_not_found" as const };

      const r = await runCampaignSend({
        db: ctx.db,
        tenantId: c.tenantId,
        campaignId: input.id,
      });
      return {
        ok: r.ok,
        campaignId: input.id,
        total: r.total,
        sent: r.sent,
        failed: r.failed,
        deferred: r.deferred,
        status: r.campaignStatus,
        error: r.error,
      };
    }),

  /** Per-campaign aggregate stats from `marketing_sends` — God Mode. */
  campaignStats: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const cmp = await ctx.db.select({
        id: marketingCampaigns.id,
        status: marketingCampaigns.status,
      }).from(marketingCampaigns).where(eq(marketingCampaigns.id, input.id)).limit(1);
      if (!cmp[0]) throw new TRPCError({ code: "NOT_FOUND" });

      const rows = await ctx.db.select({
        status: marketingSends.status,
        count: sql<number>`count(*)`,
      })
        .from(marketingSends)
        .where(eq(marketingSends.campaignId, input.id))
        .groupBy(marketingSends.status);

      const byStatus: Record<string, number> = {};
      let total = 0;
      for (const r of rows) {
        byStatus[r.status] = Number(r.count);
        total += Number(r.count);
      }
      return {
        campaignStatus: cmp[0].status,
        queued: byStatus.queued ?? 0,
        sent: byStatus.sent ?? 0,
        failed: byStatus.failed ?? 0,
        delivered: byStatus.delivered ?? 0,
        opened: byStatus.opened ?? 0,
        clicked: byStatus.clicked ?? 0,
        bounced: byStatus.bounced ?? 0,
        total,
      };
    }),

  /** Per-recipient sends detail — God Mode, paginated. */
  campaignSendsList: adminProcedure
    .input(z.object({
      id: z.string(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      return ctx.db.select().from(marketingSends)
        .where(eq(marketingSends.campaignId, input.id))
        .orderBy(desc(marketingSends.queuedAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  /**
   * Cross-campaign recent sends — God Mode deliverability dashboard.
   * Powers `/system/marketing/sends`. Optional filters: status (single),
   * recipient substring. Joins to `marketing_campaigns` so the row can
   * surface campaign name + tenant_id without an extra round-trip.
   */
  sendsRecent: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
      status: z.string().optional(),
      recipient: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conds: any[] = [];
      if (input.status) conds.push(eq(marketingSends.status, input.status));
      if (input.recipient && input.recipient.trim()) {
        const s = `%${input.recipient.trim().toLowerCase()}%`;
        conds.push(sql`lower(${marketingSends.recipient}) like ${s}`);
      }
      const where = conds.length ? (conds.length === 1 ? conds[0] : and(...conds)) : undefined;

      const [items, totalRow] = await Promise.all([
        ctx.db
          .select({
            id: marketingSends.id,
            campaignId: marketingSends.campaignId,
            campaignName: marketingCampaigns.name,
            campaignChannel: marketingCampaigns.channel,
            tenantId: marketingCampaigns.tenantId,
            contactId: marketingSends.contactId,
            recipient: marketingSends.recipient,
            provider: marketingSends.provider,
            providerMessageId: marketingSends.providerMessageId,
            status: marketingSends.status,
            error: marketingSends.error,
            queuedAt: marketingSends.queuedAt,
            sentAt: marketingSends.sentAt,
            deliveredAt: marketingSends.deliveredAt,
            openedAt: marketingSends.openedAt,
            clickedAt: marketingSends.clickedAt,
            bouncedAt: marketingSends.bouncedAt,
            complainedAt: marketingSends.complainedAt,
          })
          .from(marketingSends)
          .leftJoin(marketingCampaigns, eq(marketingSends.campaignId, marketingCampaigns.id))
          .where(where as any)
          .orderBy(desc(marketingSends.queuedAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ count: sql<number>`count(*)` }).from(marketingSends).where(where as any),
      ]);
      return { items, total: Number(totalRow[0]?.count ?? 0) };
    }),

  /** Audience preview — God Mode requires a tenantId since segments are tenant-scoped. */
  campaignAudiencePreview: adminProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      segmentId: z.string().nullable().optional(),
      channel: CHANNEL,
    }))
    .query(async ({ ctx, input }) => {
      const { contacts, totalCount } = await resolveAudience({
        db: ctx.db,
        tenantId: input.tenantId,
        segmentId: input.segmentId ?? null,
        channel: input.channel,
        limit: 3,
      });
      return {
        count: totalCount,
        sample: contacts.map((c) => ({
          id: c.id,
          name: c.name,
          email: redactEmail(c.email),
        })),
      };
    }),

  /** Platform-wide 7-day activity summary (God Mode). */
  activity: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }))
    .query(async ({ ctx, input }) => {
      const since = now() - input.days * 86400;
      const [campaignsRow, contactsRow, sendsFailedRow, unsubsRow] = await Promise.all([
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingCampaigns)
          .where(and(
            eq(marketingCampaigns.status, "sent"),
            sql`coalesce(${marketingCampaigns.finishedAt}, ${marketingCampaigns.updatedAt}) >= ${since}`,
          )),
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingContacts)
          .where(sql`${marketingContacts.firstSeenAt} >= ${since}`),
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingSends)
          .where(and(
            eq(marketingSends.status, "failed"),
            sql`${marketingSends.queuedAt} >= ${since}`,
          )),
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingConsentLog)
          .where(and(
            eq(marketingConsentLog.event, "unsubscribed"),
            sql`${marketingConsentLog.createdAt} >= ${since}`,
          )),
      ]);
      return {
        days: input.days,
        campaignsSent: Number(campaignsRow[0]?.count ?? 0),
        contactsAdded: Number(contactsRow[0]?.count ?? 0),
        sendsFailed: Number(sendsFailedRow[0]?.count ?? 0),
        unsubscribes: Number(unsubsRow[0]?.count ?? 0),
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  PROVIDERS — status + health + toggle
  // ═══════════════════════════════════════════════════════════════
  providersList: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(marketingProviders);
    const fromCode = listProviders();

    return fromCode.map((p) => {
      const row = rows.find((r) => r.name === p.name);
      return {
        name: p.name,
        channels: p.channels,
        configured: {
          email: p.channels.includes("email") && p.isConfigured("email"),
          sms: p.channels.includes("sms") && p.isConfigured("sms"),
        },
        db: row ? {
          enabled: row.enabled === 1,
          isDefault: row.isDefault === 1,
          healthStatus: row.healthStatus ?? "unknown",
          healthDetail: row.healthDetail,
          lastCheckAt: row.lastCheckAt,
        } : null,
      };
    });
  }),

  providerHealthCheck: adminProcedure
    .input(z.object({ name: z.enum(["brevo", "resend", "twilio"]) }))
    .mutation(async ({ ctx, input }) => {
      const p = getProvider(input.name as ProviderName);
      if (!p) return { ok: false, error: "unknown_provider" as const };

      const h = await p.checkHealth();
      const t = now();
      await ctx.db.update(marketingProviders)
        .set({
          healthStatus: h.status,
          healthDetail: h.detail ?? null,
          lastCheckAt: t,
          updatedAt: t,
        })
        .where(eq(marketingProviders.name, input.name));

      return { ok: true, ...h };
    }),

  providerToggle: adminProcedure
    .input(z.object({
      name: z.enum(["brevo", "resend", "twilio"]),
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(marketingProviders)
        .set({ enabled: input.enabled ? 1 : 0, updatedAt: now() })
        .where(eq(marketingProviders.name, input.name));
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  AUTOMATIONS (PR-B: real CRUD + manual Run Now — God Mode)
  // ═══════════════════════════════════════════════════════════════
  automationsList: adminProcedure
    .input(z.object({ tenantId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (input?.tenantId) {
        return ctx.db.select().from(marketingAutomations)
          .where(eq(marketingAutomations.tenantId, input.tenantId))
          .orderBy(desc(marketingAutomations.updatedAt));
      }
      return ctx.db.select().from(marketingAutomations)
        .orderBy(desc(marketingAutomations.updatedAt));
    }),

  automationCreate: adminProcedure
    .input(z.object({
      tenantId: z.string().nullable().optional(),
      name: z.string().min(1).max(120),
      triggerType: z.string().min(1).max(64),
      triggerConfigJson: z.string().optional(),
      stepsJson: z.string().min(1),
      enabled: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = rid("auto");
      const t = now();
      await ctx.db.insert(marketingAutomations).values({
        id,
        tenantId: input.tenantId ?? null,
        name: sanitizeText(input.name, 120),
        triggerType: sanitizeText(input.triggerType, 64),
        triggerConfigJson: input.triggerConfigJson ?? null,
        stepsJson: input.stepsJson,
        enabled: input.enabled ? 1 : 0,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  automationUpdate: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      triggerType: z.string().optional(),
      triggerConfigJson: z.string().nullable().optional(),
      stepsJson: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) patch.name = sanitizeText(input.name, 120);
      if (input.triggerType !== undefined) patch.triggerType = sanitizeText(input.triggerType, 64);
      if (input.triggerConfigJson !== undefined) patch.triggerConfigJson = input.triggerConfigJson;
      if (input.stepsJson !== undefined) patch.stepsJson = input.stepsJson;
      await ctx.db.update(marketingAutomations).set(patch).where(eq(marketingAutomations.id, input.id));
      return { ok: true };
    }),

  automationToggle: adminProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(marketingAutomations)
        .set({ enabled: input.enabled ? 1 : 0, updatedAt: now() })
        .where(eq(marketingAutomations.id, input.id));
      return { ok: true };
    }),

  automationDelete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(marketingAutomations).where(eq(marketingAutomations.id, input.id));
      return { ok: true };
    }),

  automationRunNow: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.select().from(marketingAutomations)
        .where(eq(marketingAutomations.id, input.id)).limit(1);
      const auto = rows[0];
      if (!auto) return { ok: false as const, error: "automation_not_found" as const };

      let steps: Array<{ type: string; templateId?: string; segmentId?: string | null; channel?: string }> = [];
      try {
        const v = JSON.parse(auto.stepsJson);
        if (Array.isArray(v)) steps = v;
      } catch {
        return { ok: false as const, error: "invalid_steps_json" as const };
      }
      const step = steps[0];
      if (!step || !step.templateId) return { ok: false as const, error: "no_send_step" as const };

      const tNow = now();
      const cmpId = `cmp_auto_${auto.id}_${tNow}`;
      const channel = (step.channel as "email" | "sms" | "whatsapp" | undefined) ?? "email";
      await ctx.db.insert(marketingCampaigns).values({
        id: cmpId,
        tenantId: auto.tenantId,
        name: `[automation] ${auto.name}`,
        channel,
        segmentId: step.segmentId ?? null,
        templateId: step.templateId,
        status: "draft",
        createdAt: tNow,
        updatedAt: tNow,
      });

      const r = await runCampaignSend({
        db: ctx.db,
        tenantId: auto.tenantId,
        campaignId: cmpId,
      });
      await ctx.db.update(marketingAutomations)
        .set({ updatedAt: tNow })
        .where(eq(marketingAutomations.id, auto.id));

      return {
        ok: r.ok,
        automationId: auto.id,
        campaignId: cmpId,
        total: r.total,
        sent: r.sent,
        failed: r.failed,
        deferred: r.deferred,
        status: r.campaignStatus,
        error: r.error,
      };
    }),
});
