/**
 * Salon FAQ router — the owner-authored knowledge base for the bot's RAG layer.
 *
 * Rows in `salon_faq` are the primary corpus the bot retrieves from (alongside
 * auto-indexed service descriptions + master bios). The Worker cron
 * (`phaseRagReindex`, flag-gated) re-embeds changed rows into `rag_chunks` —
 * so this router only needs to own the source-of-truth CRUD; it does not embed.
 *
 * Tenant isolation: every procedure calls `assertTenantOwner(ctx, input.tenantId)`
 * and every query is scoped by `tenant_id` (the table's composite PK).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { salonFaq } from "~/server/db/schema";
import { and, eq, asc, desc } from "drizzle-orm";

function nowSec(): number { return Math.floor(Date.now() / 1000); }

const LANGS = ["ru", "uk", "en", "pl"] as const;

// Per-language free text. At least one language must carry BOTH a question and
// an answer (enforced in the handler) — an empty FAQ is not worth indexing.
const langText = z.object({
  ru: z.string().max(2000).optional(),
  uk: z.string().max(2000).optional(),
  en: z.string().max(2000).optional(),
  pl: z.string().max(2000).optional(),
});

export const salonFaqRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      return ctx.db
        .select()
        .from(salonFaq)
        .where(eq(salonFaq.tenantId, input.tenantId))
        .orderBy(asc(salonFaq.sortOrder), desc(salonFaq.createdAt))
        .limit(500);
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        tenantId: z.string(),
        id: z.string().optional(), // omit to create, provide to edit
        question: langText,
        answer: langText,
        active: z.boolean().default(true),
        sortOrder: z.number().int().min(0).default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const hasPair = LANGS.some(
        (l) => input.question[l]?.trim() && input.answer[l]?.trim(),
      );
      if (!hasPair) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "need_question_and_answer" });
      }
      const now = nowSec();
      const qJson = JSON.stringify(input.question);
      const aJson = JSON.stringify(input.answer);
      const activeInt = input.active ? 1 : 0;

      if (input.id) {
        await ctx.db
          .update(salonFaq)
          .set({ questionJson: qJson, answerJson: aJson, active: activeInt, sortOrder: input.sortOrder, updatedAt: now })
          .where(and(eq(salonFaq.tenantId, input.tenantId), eq(salonFaq.id, input.id)));
        return { id: input.id };
      }

      const id = crypto.randomUUID();
      await ctx.db.insert(salonFaq).values({
        tenantId: input.tenantId,
        id,
        questionJson: qJson,
        answerJson: aJson,
        active: activeInt,
        sortOrder: input.sortOrder,
        createdAt: now,
        updatedAt: now,
      });
      return { id };
    }),

  setActive: protectedProcedure
    .input(z.object({ tenantId: z.string(), id: z.string(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .update(salonFaq)
        .set({ active: input.active ? 1 : 0, updatedAt: nowSec() })
        .where(and(eq(salonFaq.tenantId, input.tenantId), eq(salonFaq.id, input.id)));
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ tenantId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .delete(salonFaq)
        .where(and(eq(salonFaq.tenantId, input.tenantId), eq(salonFaq.id, input.id)));
      return { ok: true };
    }),
});
