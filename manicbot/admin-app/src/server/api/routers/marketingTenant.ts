/**
 * Marketing module router — tenant-scoped.
 *
 * Sibling to `marketing.ts` (which is God Mode / system_admin only). Every
 * procedure here requires `assertTenantOwner(ctx, input.tenantId)` and filters
 * each query by `tenant_id = ?` so a tenant_owner / personal master / sysadmin
 * previewing a tenant only ever sees their own data.
 *
 * Phase 2 (PR-A): real send via runCampaignSend (Resend), audience preview,
 * per-campaign stats + sends detail, 7-day activity widget. Automations CRUD
 * still stub — lands in PR-B alongside SMS.
 */

import { z } from "zod";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner, assertTenantBillingActive, assertEmailVerified } from "~/server/api/tenantAccess";
import { sanitizeText, sanitizeHtml } from "~/server/security/sanitize";
import {
  marketingContacts,
  marketingSegments,
  marketingSegmentMembers,
  marketingTemplates,
  marketingCampaigns,
  marketingSends,
  marketingProviders,
  marketingConsentLog,
  marketingAutomations,
} from "~/server/db/schema";
import { listProviders } from "~/server/marketing/providers";
import { runCampaignSend } from "~/server/marketing/sender";
import { resolveAudience } from "~/server/marketing/audience";
import { addContactsToSegment, removeContactsFromSegment } from "~/server/marketing/segments";

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
      await ctx.db
        .update(marketingContacts)
        .set(patch)
        .where(and(eq(marketingContacts.id, input.id), eq(marketingContacts.tenantId, input.tenantId)));

      // GDPR (MKT-01/MKT-06): the boolean is the send gate; this log is the
      // demonstrable audit trail of who/when granted or revoked consent. Record
      // a 'subscribed'/'unsubscribed' event per channel whenever the owner
      // toggles a consent flag, mirroring the unsubscribe-link event shape.
      const consentTs = now();
      const consentLogs: Array<typeof marketingConsentLog.$inferInsert> = [];
      if (input.consentEmail !== undefined) {
        consentLogs.push({ contactId: input.id, event: input.consentEmail ? "subscribed" : "unsubscribed", source: "owner", note: "email", createdAt: consentTs });
      }
      if (input.consentSms !== undefined) {
        consentLogs.push({ contactId: input.id, event: input.consentSms ? "subscribed" : "unsubscribed", source: "owner", note: "sms", createdAt: consentTs });
      }
      if (consentLogs.length) await ctx.db.insert(marketingConsentLog).values(consentLogs);
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
      kind: z.enum(["filter", "manual"]).default("manual"),
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
        kind: input.kind,
        filterJson: input.filterJson,
        contactCount: 0,
        createdAt: t,
        updatedAt: t,
      });
      return { id };
    }),

  segmentUpdate: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      id: z.string(),
      name: z.string().min(1).max(120).optional(),
      description: z.string().nullable().optional(),
      filterJson: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const existing = await ctx.db
        .select({ tenantId: marketingSegments.tenantId })
        .from(marketingSegments)
        .where(eq(marketingSegments.id, input.id))
        .limit(1);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Segment belongs to a different tenant" });
      }

      const patch: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) patch.name = sanitizeText(input.name, 120);
      if (input.description !== undefined) patch.description = input.description ? sanitizeText(input.description, 500) : null;
      if (input.filterJson !== undefined) patch.filterJson = input.filterJson;
      await ctx.db.update(marketingSegments).set(patch).where(eq(marketingSegments.id, input.id));
      return { ok: true };
    }),

  segmentDelete: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Only delete if the row's tenantId matches — defense in depth even
      // though the row id is opaque. Member rows cascade implicitly because
      // SQLite has no orphan rows to scan (segment_id is opaque + indexed).
      await ctx.db.delete(marketingSegmentMembers)
        .where(eq(marketingSegmentMembers.segmentId, input.id));
      await ctx.db.delete(marketingSegments)
        .where(and(eq(marketingSegments.id, input.id), eq(marketingSegments.tenantId, input.tenantId)));
      return { ok: true };
    }),

  /**
   * Manual list membership operations.
   *
   * Every op verifies the segment belongs to the caller's tenant before any
   * write. Contact ids are checked to ensure they belong to the same tenant
   * (cross-tenant adds would otherwise leak audience composition).
   */
  segmentMembersList: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      segmentId: z.string(),
      limit: z.number().int().min(1).max(500).default(200),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const seg = await ctx.db
        .select({ tenantId: marketingSegments.tenantId, kind: marketingSegments.kind })
        .from(marketingSegments)
        .where(eq(marketingSegments.id, input.segmentId))
        .limit(1);
      if (!seg[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (seg[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const rows = await ctx.db
        .select({
          id: marketingContacts.id,
          email: marketingContacts.email,
          phone: marketingContacts.phone,
          name: marketingContacts.name,
          unsubscribed: marketingContacts.unsubscribed,
          addedAt: marketingSegmentMembers.addedAt,
        })
        .from(marketingSegmentMembers)
        .innerJoin(marketingContacts, eq(marketingContacts.id, marketingSegmentMembers.contactId))
        .where(and(
          eq(marketingSegmentMembers.segmentId, input.segmentId),
          eq(marketingContacts.tenantId, input.tenantId),
        ))
        .orderBy(desc(marketingSegmentMembers.addedAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalRow = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(marketingSegmentMembers)
        .innerJoin(marketingContacts, eq(marketingContacts.id, marketingSegmentMembers.contactId))
        .where(and(
          eq(marketingSegmentMembers.segmentId, input.segmentId),
          eq(marketingContacts.tenantId, input.tenantId),
        ));

      return { items: rows, total: Number(totalRow[0]?.count ?? 0), kind: seg[0].kind };
    }),

  segmentAddContacts: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      segmentId: z.string(),
      contactIds: z.array(z.number().int()).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const seg = await ctx.db
        .select({ tenantId: marketingSegments.tenantId })
        .from(marketingSegments)
        .where(eq(marketingSegments.id, input.segmentId))
        .limit(1);
      if (!seg[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (seg[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Membership insert + dedup + denormalized recount live in the shared
      // helper (also used by the Salon Clients tab). Contact-tenant guard is
      // enforced there; the segment-tenant guard above already ran.
      return addContactsToSegment(ctx.db, input.tenantId, input.segmentId, input.contactIds);
    }),

  segmentRemoveContacts: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      segmentId: z.string(),
      contactIds: z.array(z.number().int()).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const seg = await ctx.db
        .select({ tenantId: marketingSegments.tenantId })
        .from(marketingSegments)
        .where(eq(marketingSegments.id, input.segmentId))
        .limit(1);
      if (!seg[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (seg[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return removeContactsFromSegment(ctx.db, input.tenantId, input.segmentId, input.contactIds);
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
      // V-1 (post-fix verification 2026-06-12): scheduling a campaign is the
      // ungated back door into the marketing-send gate — the cron dispatcher
      // would later send it for a locked/unverified tenant. Gate the moment a
      // campaign is created in a SENDABLE (scheduled) state; plain drafts stay
      // open (they can't send until campaignSendNow, which is gated). The
      // worker `runCampaignSend` carries the same check as the backstop.
      if (input.scheduledAt) {
        await assertTenantBillingActive(ctx, input.tenantId);
        await assertEmailVerified(ctx);
      }

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

  /**
   * Send the campaign now. Inline-runs `runCampaignSend()` for audiences up to
   * 500; larger audiences leave the campaign in `sending` for the worker cron
   * to drain. Caller MUST verify the tenant owns the campaign via
   * `assertTenantOwner`; the sender double-checks `tenant_id` defense in depth.
   */
  campaignSendNow: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // CS-1 (audit 2026-06-12): marketing sends are a high-value product
      // action — locked server-side for an expired-trial / churned tenant.
      await assertTenantBillingActive(ctx, input.tenantId);
      // CS-2: marketing sends also require a verified email.
      await assertEmailVerified(ctx);

      // Defense-in-depth: confirm the campaign row belongs to the caller's
      // tenant BEFORE delegating to the sender (which also checks).
      const row = await ctx.db.select().from(marketingCampaigns)
        .where(and(eq(marketingCampaigns.id, input.id), eq(marketingCampaigns.tenantId, input.tenantId)))
        .limit(1);
      const c = row[0];
      if (!c) return { ok: false as const, error: "campaign_not_found" as const };

      const r = await runCampaignSend({
        db: ctx.db,
        tenantId: input.tenantId,
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

  /**
   * Per-campaign aggregate stats from `marketing_sends`, scoped to the
   * caller's tenant via a campaign-tenant precheck.
   */
  campaignStats: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Verify the campaign belongs to the caller's tenant.
      const cmp = await ctx.db.select({
        id: marketingCampaigns.id,
        tenantId: marketingCampaigns.tenantId,
        status: marketingCampaigns.status,
        statsJson: marketingCampaigns.statsJson,
      }).from(marketingCampaigns)
        .where(and(eq(marketingCampaigns.id, input.id), eq(marketingCampaigns.tenantId, input.tenantId)))
        .limit(1);
      if (!cmp[0]) throw new TRPCError({ code: "NOT_FOUND" });

      const rows = await ctx.db.select({
        status: marketingSends.status,
        count: sql<number>`count(*)`,
      })
        .from(marketingSends)
        .innerJoin(marketingCampaigns, eq(marketingSends.campaignId, marketingCampaigns.id))
        .where(and(eq(marketingSends.campaignId, input.id), eq(marketingCampaigns.tenantId, input.tenantId)))
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

  /** Per-recipient sends detail — paginated. */
  campaignSendsList: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      id: z.string(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const cmp = await ctx.db.select({ tenantId: marketingCampaigns.tenantId })
        .from(marketingCampaigns)
        .where(and(eq(marketingCampaigns.id, input.id), eq(marketingCampaigns.tenantId, input.tenantId)))
        .limit(1);
      if (!cmp[0]) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.select().from(marketingSends)
        .innerJoin(marketingCampaigns, eq(marketingSends.campaignId, marketingCampaigns.id))
        .where(and(eq(marketingSends.campaignId, input.id), eq(marketingCampaigns.tenantId, input.tenantId)))
        .orderBy(desc(marketingSends.queuedAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  /**
   * Preview the audience for a candidate (segmentId, channel) tuple. Used by
   * the "Создать кампанию" form to show "Будет отправлено N писем" before the
   * user confirms.
   */
  campaignAudiencePreview: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      segmentId: z.string().nullable().optional(),
      channel: CHANNEL,
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

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

  /**
   * 7-day activity summary for the Overview tab. Counts campaigns sent, new
   * contacts added, sends that failed, and unsubscribes in the window.
   */
  activity: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      days: z.number().int().min(1).max(90).default(7),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const since = now() - input.days * 86400;

      const [campaignsRow, contactsRow, sendsFailedRow, unsubsRow] = await Promise.all([
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingCampaigns)
          .where(and(
            eq(marketingCampaigns.tenantId, input.tenantId),
            eq(marketingCampaigns.status, "sent"),
            sql`coalesce(${marketingCampaigns.finishedAt}, ${marketingCampaigns.updatedAt}) >= ${since}`,
          )),
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingContacts)
          .where(and(
            eq(marketingContacts.tenantId, input.tenantId),
            sql`${marketingContacts.firstSeenAt} >= ${since}`,
          )),
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingSends)
          .innerJoin(marketingCampaigns, eq(marketingSends.campaignId, marketingCampaigns.id))
          .where(and(
            eq(marketingCampaigns.tenantId, input.tenantId),
            eq(marketingSends.status, "failed"),
            sql`${marketingSends.queuedAt} >= ${since}`,
          )),
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingConsentLog)
          .innerJoin(marketingContacts, eq(marketingConsentLog.contactId, marketingContacts.id))
          .where(and(
            eq(marketingContacts.tenantId, input.tenantId),
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
  //  PROVIDERS — aggregate-only capability flags.
  //
  //  By design the tenant surface MUST NOT leak which email/SMS vendor
  //  is wired under the hood (Brevo, Resend, Twilio …). Salon owners
  //  don't operate that plumbing and the names are platform-internal —
  //  if we swap a vendor tomorrow the tenant should not see the churn.
  //  Provider names, per-channel toggles and health detail stay on the
  //  admin-only `marketing.providersList` / `providerToggle` /
  //  `providerHealthCheck` procedures.
  //
  //  This procedure returns a sanitized capability object — enough for
  //  the SMS tab "can we send?" gate, nothing more.
  // ═══════════════════════════════════════════════════════════════
  providersList: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const rows = await ctx.db.select().from(marketingProviders);
      const fromCode = listProviders();

      // A channel is "available" iff at least one enabled provider both
      // declares the channel and reports its env config as present. We
      // deliberately do NOT expose which provider satisfies it.
      const enabledNames = new Set(
        rows.filter((r) => r.enabled === 1).map((r) => r.name),
      );
      let canSendEmail = false;
      let canSendSms = false;
      for (const p of fromCode) {
        const enabled = enabledNames.has(p.name);
        if (!enabled) continue;
        if (p.channels.includes("email") && p.isConfigured("email")) canSendEmail = true;
        if (p.channels.includes("sms") && p.isConfigured("sms")) canSendSms = true;
      }
      return { canSendEmail, canSendSms };
    }),

  // ═══════════════════════════════════════════════════════════════
  //  AUTOMATIONS (PR-B: real CRUD + manual Run Now)
  //  Trigger-based engine (cron sweep of birthday / inactive_30d / etc.)
  //  is a follow-up — only manual Run Now is wired here.
  // ═══════════════════════════════════════════════════════════════
  automationsList: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      return ctx.db.select().from(marketingAutomations)
        .where(eq(marketingAutomations.tenantId, input.tenantId))
        .orderBy(desc(marketingAutomations.updatedAt));
    }),

  automationCreate: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      name: z.string().min(1).max(120),
      triggerType: z.string().min(1).max(64),
      triggerConfigJson: z.string().optional(),
      stepsJson: z.string().min(1),
      enabled: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const id = rid("auto");
      const t = now();
      await ctx.db.insert(marketingAutomations).values({
        id,
        tenantId: input.tenantId,
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

  automationUpdate: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      id: z.string(),
      name: z.string().optional(),
      triggerType: z.string().optional(),
      triggerConfigJson: z.string().nullable().optional(),
      stepsJson: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const existing = await ctx.db
        .select({ tenantId: marketingAutomations.tenantId })
        .from(marketingAutomations)
        .where(eq(marketingAutomations.id, input.id))
        .limit(1);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Automation belongs to a different tenant" });
      }

      const patch: Record<string, unknown> = { updatedAt: now() };
      if (input.name !== undefined) patch.name = sanitizeText(input.name, 120);
      if (input.triggerType !== undefined) patch.triggerType = sanitizeText(input.triggerType, 64);
      if (input.triggerConfigJson !== undefined) patch.triggerConfigJson = input.triggerConfigJson;
      if (input.stepsJson !== undefined) patch.stepsJson = input.stepsJson;
      await ctx.db
        .update(marketingAutomations)
        .set(patch)
        .where(and(eq(marketingAutomations.id, input.id), eq(marketingAutomations.tenantId, input.tenantId)));
      return { ok: true };
    }),

  automationToggle: protectedProcedure
    .input(z.object({
      tenantId: z.string().min(1),
      id: z.string(),
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const existing = await ctx.db
        .select({ tenantId: marketingAutomations.tenantId })
        .from(marketingAutomations)
        .where(eq(marketingAutomations.id, input.id))
        .limit(1);
      if (!existing[0]) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing[0].tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db.update(marketingAutomations)
        .set({ enabled: input.enabled ? 1 : 0, updatedAt: now() })
        .where(and(eq(marketingAutomations.id, input.id), eq(marketingAutomations.tenantId, input.tenantId)));
      return { ok: true };
    }),

  automationDelete: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.delete(marketingAutomations)
        .where(and(eq(marketingAutomations.id, input.id), eq(marketingAutomations.tenantId, input.tenantId)));
      return { ok: true };
    }),

  /**
   * Manual fire: takes a saved automation, materialises a one-shot synthetic
   * campaign from its first `send_email` step, and runs `runCampaignSend`.
   * Trigger-based scheduling (cron) is out of scope for PR-B.
   *
   * `stepsJson` v1 shape: `[{type:'send_email', templateId, segmentId?}]`.
   * Only the first step is consumed; multi-step sequences ship later.
   */
  automationRunNow: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // CS-1: server-side billing gate (see campaignSendNow).
      await assertTenantBillingActive(ctx, input.tenantId);
      // CS-2: marketing sends also require a verified email.
      await assertEmailVerified(ctx);

      const rows = await ctx.db.select().from(marketingAutomations)
        .where(and(eq(marketingAutomations.id, input.id), eq(marketingAutomations.tenantId, input.tenantId)))
        .limit(1);
      const auto = rows[0];
      if (!auto) throw new TRPCError({ code: "NOT_FOUND" });

      let steps: Array<{ type: string; templateId?: string; segmentId?: string | null; channel?: string }> = [];
      try {
        const v = JSON.parse(auto.stepsJson);
        if (Array.isArray(v)) steps = v;
      } catch {
        return { ok: false as const, error: "invalid_steps_json" };
      }
      const step = steps[0];
      if (!step || !step.templateId) {
        return { ok: false as const, error: "no_send_step" };
      }

      // Materialise a one-shot campaign and run it inline. The campaign
      // carries the automation id in its name so the activity feed can
      // attribute the send.
      const tNow = now();
      const cmpId = `cmp_auto_${auto.id}_${tNow}`;
      const channel = (step.channel as "email" | "sms" | "whatsapp" | undefined) ?? "email";
      await ctx.db.insert(marketingCampaigns).values({
        id: cmpId,
        tenantId: input.tenantId,
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
        tenantId: input.tenantId,
        campaignId: cmpId,
      });

      // Bump updatedAt — the UI sorts by it so a recently-run automation
      // rises to the top of the list. A proper `last_run_at` column waits
      // for the cron engine migration in a follow-up PR. The WHERE clause
      // re-applies the tenant guard for the source-scan invariant.
      await ctx.db.update(marketingAutomations)
        .set({ updatedAt: tNow })
        .where(and(
          eq(marketingAutomations.id, auto.id),
          eq(marketingAutomations.tenantId, input.tenantId),
        ));

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

// Suppress unused import warning — `isNull` will be used once we wire the
// God Mode "view tenant-orphaned rows" surface in PR 2.
void isNull;
