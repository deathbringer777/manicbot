import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { platformTickets, platformTicketMessages, platformRoles } from "~/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { isAdminProcedurePlatformRole } from "~/server/api/platformRoles";

async function assertSupport(ctx: any) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  const row = await ctx.db
    .select()
    .from(platformRoles)
    .where(eq(platformRoles.chatId, ctx.user.id))
    .limit(1);
  if (!row.length) throw new TRPCError({ code: "FORBIDDEN" });
  const role = row[0]!.role;
  if (!isAdminProcedurePlatformRole(role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

export const supportRouter = createTRPCRouter({
  getOpenTickets: publicProcedure.query(async ({ ctx }) => {
    await assertSupport(ctx);
    return ctx.db.select().from(platformTickets)
      .where(eq(platformTickets.status, "open"))
      .orderBy(desc(platformTickets.createdAt))
      .limit(100);
  }),

  getAllTickets: publicProcedure
    .input(z.object({ status: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await assertSupport(ctx);
      const rows = await ctx.db.select().from(platformTickets)
        .orderBy(desc(platformTickets.createdAt))
        .limit(200);
      if (input.status) return rows.filter((t: any) => t.status === input.status);
      return rows;
    }),

  getTicket: publicProcedure
    .input(z.object({ ticketId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertSupport(ctx);
      const [ticket, messages] = await Promise.all([
        ctx.db.select().from(platformTickets).where(eq(platformTickets.id, input.ticketId)).limit(1),
        ctx.db.select().from(platformTicketMessages)
          .where(eq(platformTicketMessages.ticketId, input.ticketId))
          .orderBy(platformTicketMessages.createdAt),
      ]);
      if (!ticket.length) throw new TRPCError({ code: "NOT_FOUND" });
      return { ticket: ticket[0]!, messages };
    }),

  replyToTicket: publicProcedure
    .input(z.object({ ticketId: z.string(), text: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertSupport(ctx);
      await ctx.db.insert(platformTicketMessages).values({
        ticketId: input.ticketId,
        sender: `support:${ctx.user!.id}`,
        text: input.text,
        createdAt: Math.floor(Date.now() / 1000),
      });
      return { ok: true };
    }),

  claimTicket: publicProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertSupport(ctx);
      await ctx.db.update(platformTickets)
        .set({ claimedBy: ctx.user!.id, claimedAt: Math.floor(Date.now() / 1000) })
        .where(eq(platformTickets.id, input.ticketId));
      return { ok: true };
    }),

  closeTicket: publicProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertSupport(ctx);
      await ctx.db.update(platformTickets)
        .set({ status: "closed", updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(platformTickets.id, input.ticketId));
      return { ok: true };
    }),

  escalateTicket: publicProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertSupport(ctx);
      await ctx.db.update(platformTickets)
        .set({ status: "escalated", updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(platformTickets.id, input.ticketId));
      return { ok: true };
    }),
});
