/**
 * Marketing module router — God Mode CRM + campaigns.
 *
 * Phase 1 skeleton: all procedures compile and pass adminProcedure guard,
 * but send/execute paths are stubs (return `{ ok: true, stub: true }`). The
 * intent is to lock the API surface so UI can be built against it; real
 * execution (Brevo/Resend fan-out, SMS billing gate, webhooks) lands later.
 */

import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import {
  marketingContacts,
  marketingSegments,
  marketingTemplates,
  marketingCampaigns,
  marketingSends,
  marketingProviders,
} from "~/server/db/schema";
import { listProviders, getProvider } from "~/server/marketing/providers";
import type { ProviderName } from "~/server/marketing/providers";

const CHANNEL = z.enum(["email", "sms", "whatsapp"]);
const CAMPAIGN_STATUS = z.enum(["draft", "scheduled", "sending", "sent", "paused", "failed"]);

function now() {
  return Math.floor(Date.now() / 1000);
}
function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
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
      limit: z.number().int().min(1).max(500).default(100),
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
        name: input.name,
        description: input.description ?? null,
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
        name: input.name,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
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
      if (input.name !== undefined) patch.name = input.name;
      if (input.subject !== undefined) patch.subject = input.subject;
      if (input.body !== undefined) patch.body = input.body;
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
        name: input.name,
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

  /** Stub — actual fan-out lands in phase 2. For now returns an audit trail. */
  campaignSendNow: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.select().from(marketingCampaigns)
        .where(eq(marketingCampaigns.id, input.id)).limit(1);
      const c = row[0];
      if (!c) return { ok: false, error: "campaign_not_found" as const };
      return {
        ok: false,
        stub: true,
        message: "Send-now is a stub in phase 1. Campaigns are stored but no emails/SMS are dispatched yet.",
        campaignId: c.id,
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
  //  AUTOMATIONS (phase 2 stubs — CRUD only)
  // ═══════════════════════════════════════════════════════════════
  automationsList: adminProcedure.query(async () => {
    // Intentionally returns an empty list until automations are built out.
    return [] as Array<{ id: string; name: string; triggerType: string; enabled: boolean }>;
  }),
});
