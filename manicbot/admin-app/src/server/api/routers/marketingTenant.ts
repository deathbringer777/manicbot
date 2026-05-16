/**
 * Marketing module router — tenant-scoped.
 *
 * Sibling to `marketing.ts` (which is God Mode / system_admin only). Every
 * procedure here requires `assertTenantOwner(ctx, input.tenantId)` and filters
 * each query by `tenant_id = ?` so a tenant_owner / personal master / sysadmin
 * previewing a tenant only ever sees their own data.
 *
 * Phase 1: CRUD surface only. Send paths (`campaignSendNow`) still stub —
 * real send execution lands in PR 3 of the marketing roadmap.
 */

import { z } from "zod";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { sanitizeText, sanitizeHtml } from "~/server/security/sanitize";
import {
  marketingContacts,
  marketingSegments,
  marketingTemplates,
  marketingCampaigns,
  marketingSends,
  marketingProviders,
} from "~/server/db/schema";
import { listProviders } from "~/server/marketing/providers";

const CHANNEL = z.enum(["email", "sms", "whatsapp"]);
const CAMPAIGN_STATUS = z.enum(["draft", "scheduled", "sending", "sent", "paused", "failed"]);

function now() {
  return Math.floor(Date.now() / 1000);
}
function rid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export const marketingTenantRouter = createTRPCRouter({
  // ═══════════════════════════════════════════════════════════════
  //  DASHBOARD
  // ═══════════════════════════════════════════════════════════════
  stats: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const [contactsRow, campaignsRow, sendsRow, segmentsRow] = await Promise.all([
        ctx.db
          .select({
            count: sql<number>`count(*)`,
            subscribed: sql<number>`sum(case when unsubscribed=0 then 1 else 0 end)`,
          })
          .from(marketingContacts)
          .where(eq(marketingContacts.tenantId, input.tenantId)),
        ctx.db
          .select({ status: marketingCampaigns.status, count: sql<number>`count(*)` })
          .from(marketingCampaigns)
          .where(eq(marketingCampaigns.tenantId, input.tenantId))
          .groupBy(marketingCampaigns.status),
        ctx.db
          .select({ status: marketingSends.status, count: sql<number>`count(*)` })
          .from(marketingSends)
          .innerJoin(marketingCampaigns, eq(marketingSends.campaignId, marketingCampaigns.id))
          .where(eq(marketingCampaigns.tenantId, input.tenantId))
          .groupBy(marketingSends.status),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(marketingSegments)
          .where(eq(marketingSegments.tenantId, input.tenantId)),
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
  contactsList: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
      subscribedOnly: z.boolean().default(false),
      search: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const conds: any[] = [eq(marketingContacts.tenantId, input.tenantId)];
      if (input.subscribedOnly) conds.push(eq(marketingContacts.unsubscribed, 0));
      if (input.search && input.search.trim()) {
        const s = `%${input.search.trim().toLowerCase()}%`;
        conds.push(sql`(lower(${marketingContacts.email}) like ${s} or lower(coalesce(${marketingContacts.name},'')) like ${s} or coalesce(${marketingContacts.phone},'') like ${s})`);
      }
      const where = conds.length === 1 ? conds[0] : and(...conds);

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

  contactUpdate: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      id: z.number().int(),
      tags: z.string().nullable().optional(),
      lifecycleStage: z.string().nullable().optional(),
      locale: z.string().nullable().optional(),
      consentEmail: z.boolean().optional(),
      consentSms: z.boolean().optional(),
      unsubscribed: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Verify the contact belongs to the caller's tenant before any write.
      const existing = await ctx.db
        .select({ tenantId: marketingContacts.tenantId })
        .from(marketingContacts)
        .where(eq(marketingContacts.id, input.id))
        .limit(1);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Contact belongs to a different tenant" });
      }

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
  segmentsList: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      return ctx.db.select().from(marketingSegments)
        .where(eq(marketingSegments.tenantId, input.tenantId))
        .orderBy(desc(marketingSegments.updatedAt));
    }),

  segmentCreate: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      name: z.string().min(1).max(120),
      description: z.string().optional(),
      filterJson: z.string().default("{}"),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const id = rid("seg");
      const t = now();
      await ctx.db.insert(marketingSegments).values({
        id,
        tenantId: input.tenantId,
        name: sanitizeText(input.name, 120),
        description: input.description ? sanitizeText(input.description, 500) : null,
        filterJson: input.filterJson,
        contactCount: 0,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  segmentDelete: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Only delete if the row's tenantId matches — defense in depth even
      // though the row id is opaque.
      await ctx.db.delete(marketingSegments)
        .where(and(eq(marketingSegments.id, input.id), eq(marketingSegments.tenantId, input.tenantId)));
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  TEMPLATES
  // ═══════════════════════════════════════════════════════════════
  templatesList: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), channel: CHANNEL.optional() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const conds: any[] = [eq(marketingTemplates.tenantId, input.tenantId)];
      if (input.channel) conds.push(eq(marketingTemplates.channel, input.channel));
      const where = conds.length === 1 ? conds[0] : and(...conds);
      return ctx.db.select().from(marketingTemplates)
        .where(where as any)
        .orderBy(desc(marketingTemplates.updatedAt));
    }),

  templateCreate: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      name: z.string().min(1).max(120),
      channel: CHANNEL,
      subject: z.string().optional(),
      body: z.string().min(1),
      locale: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const id = rid("tpl");
      const t = now();
      await ctx.db.insert(marketingTemplates).values({
        id,
        tenantId: input.tenantId,
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

  templateUpdate: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      id: z.string(),
      name: z.string().optional(),
      subject: z.string().nullable().optional(),
      body: z.string().optional(),
      locale: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const existing = await ctx.db
        .select({ tenantId: marketingTemplates.tenantId })
        .from(marketingTemplates)
        .where(eq(marketingTemplates.id, input.id))
        .limit(1);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Template belongs to a different tenant" });
      }

      const patch: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) patch.name = sanitizeText(input.name, 120);
      if (input.subject !== undefined) patch.subject = input.subject ? sanitizeText(input.subject, 500) : input.subject;
      if (input.body !== undefined) patch.body = sanitizeHtml(input.body, "marketingHtml");
      if (input.locale !== undefined) patch.locale = input.locale;
      await ctx.db.update(marketingTemplates).set(patch).where(eq(marketingTemplates.id, input.id));
      return { ok: true };
    }),

  templateDelete: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.delete(marketingTemplates)
        .where(and(eq(marketingTemplates.id, input.id), eq(marketingTemplates.tenantId, input.tenantId)));
      return { ok: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  CAMPAIGNS
  // ═══════════════════════════════════════════════════════════════
  campaignsList: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      status: CAMPAIGN_STATUS.optional(),
      channel: CHANNEL.optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const conds: any[] = [eq(marketingCampaigns.tenantId, input.tenantId)];
      if (input.status) conds.push(eq(marketingCampaigns.status, input.status));
      if (input.channel) conds.push(eq(marketingCampaigns.channel, input.channel));
      const where = conds.length === 1 ? conds[0] : and(...conds);
      return ctx.db.select().from(marketingCampaigns)
        .where(where as any)
        .orderBy(desc(marketingCampaigns.updatedAt));
    }),

  campaignCreate: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      name: z.string().min(1).max(120),
      channel: CHANNEL,
      segmentId: z.string().optional(),
      templateId: z.string().optional(),
      provider: z.string().optional(),
      scheduledAt: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const id = rid("cmp");
      const t = now();
      await ctx.db.insert(marketingCampaigns).values({
        id,
        tenantId: input.tenantId,
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

  campaignDelete: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.delete(marketingCampaigns)
        .where(and(eq(marketingCampaigns.id, input.id), eq(marketingCampaigns.tenantId, input.tenantId)));
      return { ok: true };
    }),

  /** Stub — actual fan-out lands in PR 3 of the marketing roadmap. */
  campaignSendNow: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const row = await ctx.db.select().from(marketingCampaigns)
        .where(and(eq(marketingCampaigns.id, input.id), eq(marketingCampaigns.tenantId, input.tenantId)))
        .limit(1);
      const c = row[0];
      if (!c) return { ok: false, error: "campaign_not_found" as const };
      return {
        ok: false,
        stub: true,
        message: "Send-now is not yet wired for tenant-scoped campaigns. Real send pipeline ships in PR 3.",
        campaignId: c.id,
      };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  PROVIDERS — read-only (provider config stays God Mode)
  // ═══════════════════════════════════════════════════════════════
  providersList: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

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

  // ═══════════════════════════════════════════════════════════════
  //  AUTOMATIONS (phase 2 stub — empty list until PR 5)
  // ═══════════════════════════════════════════════════════════════
  automationsList: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      return [] as Array<{ id: string; name: string; triggerType: string; enabled: boolean }>;
    }),
});

// Suppress unused import warning — `isNull` will be used once we wire the
// God Mode "view tenant-orphaned rows" surface in PR 2.
void isNull;
