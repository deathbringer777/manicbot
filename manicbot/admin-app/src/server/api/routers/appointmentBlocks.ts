import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, lte, or } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { appointmentBlocks, masters } from "~/server/db/schema";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { slotsBusy } from "~/server/api/slotsBusy";

/**
 * Calendar overhaul (PR #?? — 2026-05-16).
 *
 * Backs the «Резерв времени» and «Перерыв / выходной» FAB scenarios
 * that previously rendered as СКОРО placeholders. Two block types:
 *
 *   * `reservation` — one short slot a master holds for themselves
 *     (no client, no service). E.g. «Прогрев лампы», «Доделать дизайн».
 *
 *   * `time_off`    — break / day off / vacation. May be a single time
 *     window (`reason='Обед'`, 60 min) or a multi-day range
 *     (`endDate` set, `time='00:00'`, `durationMin=1440`).
 *
 * Conflict semantics live in `slotsBusy()` so that creating a block
 * AND creating an appointment both honor the same union of busy slots.
 */
export const appointmentBlocksRouter = createTRPCRouter({
  // ── List blocks for a date range — used by the Day/Week/Month views.
  listByRange: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Single-day rows: date inside [from,to].
      // Multi-day time_off rows: window [date,endDate] intersects [from,to].
      const rows = await ctx.db
        .select()
        .from(appointmentBlocks)
        .where(
          and(
            eq(appointmentBlocks.tenantId, input.tenantId),
            eq(appointmentBlocks.cancelled, 0),
            or(
              and(
                gte(appointmentBlocks.date, input.dateFrom),
                lte(appointmentBlocks.date, input.dateTo),
              ),
              and(
                lte(appointmentBlocks.date, input.dateTo),
                gte(appointmentBlocks.endDate, input.dateFrom),
              ),
            ),
          ),
        )
        .orderBy(asc(appointmentBlocks.date), asc(appointmentBlocks.time));
      return { blocks: rows };
    }),

  // ── Create a block. Master role can only block their own calendar.
  create: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        masterId: z.number().int(),
        type: z.enum(["reservation", "time_off"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        durationMin: z.number().int().min(15).max(60 * 24),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        reason: z.string().max(200).optional(),
      })
        .refine(
          (d) => !d.endDate || d.endDate >= d.date,
          { message: "endDate must be on or after date" },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Master role: can only block on their own master row. The web
      // session's web_user.id is the master's chat_id (synthetic for
      // personal-tenant masters, real for Telegram-linked masters).
      if (ctx.webUser?.webRole === "master") {
        const [m] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(eq(masters.tenantId, input.tenantId), eq(masters.active, 1)))
          .limit(1);
        if (!m || m.chatId !== input.masterId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Masters can only block their own calendar",
          });
        }
      }

      // Slot-conflict check. For multi-day time_off we run the check
      // for each spanned day so an in-flight booking on day 2 also
      // surfaces.
      const checkDates: string[] = [];
      if (input.endDate && input.endDate !== input.date) {
        // Walk the range inclusive — small (typically 1–14 days).
        let d = input.date;
        while (d <= input.endDate) {
          checkDates.push(d);
          const next = new Date(d + "T00:00:00Z");
          next.setUTCDate(next.getUTCDate() + 1);
          d = next.toISOString().slice(0, 10);
        }
      } else {
        checkDates.push(input.date);
      }
      for (const d of checkDates) {
        const r = await slotsBusy({
          db: ctx.db,
          tenantId: input.tenantId,
          masterId: input.masterId,
          date: d,
          startTime: input.time,
          durationMin: input.durationMin,
        });
        if (r.busy) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "slot_conflict",
            cause: r.conflict,
          });
        }
      }

      const id = `b${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).slice(2, 8)}`;
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.insert(appointmentBlocks).values({
        id,
        tenantId: input.tenantId,
        masterId: input.masterId,
        type: input.type,
        date: input.date,
        time: input.time,
        durationMin: input.durationMin,
        endDate: input.endDate ?? null,
        reason: input.reason ?? null,
        createdAt: now,
        createdBy: ctx.webUser?.id ?? null,
        cancelled: 0,
      });
      return { ok: true, id };
    }),

  // ── Soft-cancel a block. The block stays in the table for audit; the
  // partial index `WHERE cancelled = 0` keeps it out of busy checks.
  delete: protectedProcedure
    .input(z.object({ tenantId: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const [row] = await ctx.db
        .select({ tenantId: appointmentBlocks.tenantId, masterId: appointmentBlocks.masterId })
        .from(appointmentBlocks)
        .where(eq(appointmentBlocks.id, input.id))
        .limit(1);
      if (!row || row.tenantId !== input.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      // Master role: same as create — can only cancel their own block.
      if (ctx.webUser?.webRole === "master") {
        const [m] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(eq(masters.tenantId, input.tenantId), eq(masters.active, 1)))
          .limit(1);
        if (!m || m.chatId !== row.masterId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }
      await ctx.db
        .update(appointmentBlocks)
        .set({ cancelled: 1 })
        .where(eq(appointmentBlocks.id, input.id));
      return { ok: true };
    }),

  // ── Edit an existing block in place (date / time / master / duration /
  // reason / type). Same guards + slot-conflict semantics as `create`, but
  // passes `excludeBlockId` so "save in place" / "shorten" don't collide
  // with the block's own row. No `cancelled` write — editing must never
  // resurrect a soft-cancelled block.
  update: protectedProcedure
    .input(
      z.object({
        tenantId: z.string().min(1),
        id: z.string().min(1),
        masterId: z.number().int(),
        type: z.enum(["reservation", "time_off"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^\d{2}:\d{2}$/),
        durationMin: z.number().int().min(15).max(60 * 24),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        reason: z.string().max(200).optional(),
      })
        .refine(
          (d) => !d.endDate || d.endDate >= d.date,
          { message: "endDate must be on or after date" },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Row must exist AND belong to this tenant — guards editing another
      // tenant's block by guessing its id.
      const [row] = await ctx.db
        .select({ tenantId: appointmentBlocks.tenantId, masterId: appointmentBlocks.masterId })
        .from(appointmentBlocks)
        .where(eq(appointmentBlocks.id, input.id))
        .limit(1);
      if (!row || row.tenantId !== input.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Master role: can only edit their own calendar — both the existing
      // row and the requested master must be the caller's own chat_id, so a
      // master can neither touch a colleague's block nor reassign one away.
      if (ctx.webUser?.webRole === "master") {
        const [m] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(eq(masters.tenantId, input.tenantId), eq(masters.active, 1)))
          .limit(1);
        if (!m || m.chatId !== row.masterId || m.chatId !== input.masterId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Masters can only edit their own calendar",
          });
        }
      }

      // Slot-conflict check mirrors `create`, but excludes this block's own
      // row (multi-day time_off walks each spanned day the same way).
      const checkDates: string[] = [];
      if (input.endDate && input.endDate !== input.date) {
        let d = input.date;
        while (d <= input.endDate) {
          checkDates.push(d);
          const next = new Date(d + "T00:00:00Z");
          next.setUTCDate(next.getUTCDate() + 1);
          d = next.toISOString().slice(0, 10);
        }
      } else {
        checkDates.push(input.date);
      }
      for (const d of checkDates) {
        const r = await slotsBusy({
          db: ctx.db,
          tenantId: input.tenantId,
          masterId: input.masterId,
          date: d,
          startTime: input.time,
          durationMin: input.durationMin,
          excludeBlockId: input.id,
        });
        if (r.busy) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "slot_conflict",
            cause: r.conflict,
          });
        }
      }

      await ctx.db
        .update(appointmentBlocks)
        .set({
          masterId: input.masterId,
          type: input.type,
          date: input.date,
          time: input.time,
          durationMin: input.durationMin,
          endDate: input.endDate ?? null,
          reason: input.reason ?? null,
        })
        .where(eq(appointmentBlocks.id, input.id));
      return { ok: true };
    }),
});
