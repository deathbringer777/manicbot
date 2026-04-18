import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { leads } from "~/server/db/schema";
import { eq, desc, sql } from "drizzle-orm";

const STATUSES = ["new", "contacted", "closed"] as const;

export const leadsRouter = createTRPCRouter({
  list: adminProcedure
    .input(z.object({
      status: z.enum([...STATUSES, "all"]).default("all"),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const where = input.status === "all" ? undefined : eq(leads.status, input.status);
      const [items, totalRow] = await Promise.all([
        ctx.db
          .select()
          .from(leads)
          .where(where as any)
          .orderBy(desc(leads.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(leads)
          .where(where as any),
      ]);
      return { items, total: totalRow[0]?.count ?? 0 };
    }),

  counts: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ status: leads.status, count: sql<number>`count(*)` })
      .from(leads)
      .groupBy(leads.status);
    const out: Record<string, number> = { new: 0, contacted: 0, closed: 0, all: 0 };
    for (const r of rows) {
      out[r.status] = r.count;
      out.all = (out.all ?? 0) + r.count;
    }
    return out;
  }),

  updateStatus: adminProcedure
    .input(z.object({ id: z.number().int(), status: z.enum(STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(leads).set({ status: input.status }).where(eq(leads.id, input.id));
      return { ok: true };
    }),

  remove: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(leads).where(eq(leads.id, input.id));
      return { ok: true };
    }),
});
