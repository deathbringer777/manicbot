import { z } from "zod";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { leads, marketingContacts } from "~/server/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { csvCell } from "~/server/lib/csvSafe";

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

  /** Marketing contacts: deduped email/phone directory for email & SMS campaigns. */
  marketingList: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
      subscribedOnly: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      const where = input.subscribedOnly ? eq(marketingContacts.unsubscribed, 0) : undefined;
      const [items, totalRow] = await Promise.all([
        ctx.db.select().from(marketingContacts)
          .where(where as any)
          .orderBy(desc(marketingContacts.lastSeenAt))
          .limit(input.limit).offset(input.offset),
        ctx.db.select({ count: sql<number>`count(*)` })
          .from(marketingContacts).where(where as any),
      ]);
      return { items, total: totalRow[0]?.count ?? 0 };
    }),

  marketingExportCsv: adminProcedure
    .input(z.object({ subscribedOnly: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      const where = input.subscribedOnly ? eq(marketingContacts.unsubscribed, 0) : undefined;
      const rows = await ctx.db.select().from(marketingContacts)
        .where(where as any)
        .orderBy(desc(marketingContacts.lastSeenAt));
      // #M-07-1 — csvCell adds the formula-injection guard (=,+,-,@) + RFC-4180 quoting.
      const header = "email,name,phone,source,first_seen_at,last_seen_at,lead_count";
      const body = rows.map(r => [r.email, r.name, r.phone, r.source, r.firstSeenAt, r.lastSeenAt, r.leadCount].map(csvCell).join(",")).join("\n");
      return { csv: `${header}\n${body}\n`, count: rows.length };
    }),

  marketingUnsubscribe: adminProcedure
    .input(z.object({ id: z.number().int(), unsubscribed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.update(marketingContacts)
        .set({ unsubscribed: input.unsubscribed ? 1 : 0 })
        .where(eq(marketingContacts.id, input.id));
      return { ok: true };
    }),
});
