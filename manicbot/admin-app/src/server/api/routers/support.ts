import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";
import { platformTickets, platformTicketMessages } from "~/server/db/schema";
import { eq, desc, or, like, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

async function assertSupport(ctx: any) {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  const r = ctx.webUser.webRole;
  if (r === "system_admin" || r === "support" || r === "technical_support") return;
  throw new TRPCError({ code: "FORBIDDEN" });
}

function supportSenderId(ctx: any): string {
  if (ctx.webUser) return `support:web:${ctx.webUser.id}`;
  return "support:unknown";
}

function userSenderId(ctx: any): string {
  if (ctx.webUser) return `user:web:${ctx.webUser.id}`;
  return "user:unknown";
}

/** Build WHERE condition matching tickets created by the current user */
function myTicketsFilter(ctx: any) {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  return and(
    eq(platformTickets.clientChatId, 0),
    eq(platformTickets.clientName, ctx.webUser.email),
  );
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
    .input(z.object({ status: z.string().optional(), q: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await assertSupport(ctx);
      const q = input.q?.trim();
      let rows;
      if (q) {
        const pat = `%${q.replace(/%/g, "\\%")}%`;
        rows = await ctx.db
          .select()
          .from(platformTickets)
          .where(
            or(
              like(platformTickets.clientName, pat),
              like(platformTickets.id, pat),
              like(platformTickets.tenantId, pat),
            ),
          )
          .orderBy(desc(platformTickets.createdAt))
          .limit(200);
      } else {
        rows = await ctx.db.select().from(platformTickets)
          .orderBy(desc(platformTickets.createdAt))
          .limit(200);
      }
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
    .input(z.object({
      ticketId: z.string(),
      text: z.string().min(1),
      attachmentUrl: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertSupport(ctx);
      await ctx.db.insert(platformTicketMessages).values({
        ticketId: input.ticketId,
        sender: supportSenderId(ctx),
        text: input.text,
        attachmentUrl: input.attachmentUrl ?? null,
        createdAt: Math.floor(Date.now() / 1000),
      });
      await ctx.db.update(platformTickets)
        .set({ updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(platformTickets.id, input.ticketId));
      return { ok: true };
    }),

  claimTicket: publicProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertSupport(ctx);
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.update(platformTickets)
        .set({
          claimedBy: null,
          claimedByWebUserId: ctx.webUser!.id,
          claimedAt: now,
          updatedAt: now,
          status: "claimed",
        })
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

  // ── Creator-facing procedures ──────────────────────────────────────

  /** List tickets created by the current user */
  getMyTickets: protectedProcedure.query(async ({ ctx }) => {
    const filter = myTicketsFilter(ctx);
    return ctx.db
      .select()
      .from(platformTickets)
      .where(filter)
      .orderBy(desc(platformTickets.updatedAt))
      .limit(50);
  }),

  /** Get a single ticket + messages (only if the current user created it) */
  getMyTicket: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .query(async ({ ctx, input }) => {
      const filter = myTicketsFilter(ctx);
      const rows = await ctx.db
        .select()
        .from(platformTickets)
        .where(and(eq(platformTickets.id, input.ticketId), filter))
        .limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND" });
      const messages = await ctx.db
        .select()
        .from(platformTicketMessages)
        .where(eq(platformTicketMessages.ticketId, input.ticketId))
        .orderBy(platformTicketMessages.createdAt);
      return { ticket: rows[0]!, messages };
    }),

  /** Reply to own ticket (reopens if closed) */
  replyToMyTicket: protectedProcedure
    .input(z.object({ ticketId: z.string(), text: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const filter = myTicketsFilter(ctx);
      const rows = await ctx.db
        .select()
        .from(platformTickets)
        .where(and(eq(platformTickets.id, input.ticketId), filter))
        .limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND" });
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.insert(platformTicketMessages).values({
        ticketId: input.ticketId,
        sender: userSenderId(ctx),
        text: input.text,
        createdAt: now,
      });
      const updates: Record<string, any> = { updatedAt: now };
      if (rows[0]!.status === "closed") updates.status = "open";
      await ctx.db
        .update(platformTickets)
        .set(updates)
        .where(eq(platformTickets.id, input.ticketId));
      return { ok: true };
    }),

  /** Create a support ticket — available to any authenticated user (tenant_owner, master, etc.) */
  createTicket: protectedProcedure
    .input(z.object({
      subject: z.string().min(1).max(200),
      message: z.string().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const ticketId = `pt_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

      // Resolve caller identity
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      const clientChatId = 0;
      const clientName: string | null = ctx.webUser.email;
      const tenantId: string | null = ctx.webUser.tenantId ?? null;
      const sender = `user:web:${ctx.webUser.id}`;

      await ctx.db.insert(platformTickets).values({
        id: ticketId,
        tenantId,
        clientChatId,
        clientName,
        status: "open",
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert(platformTicketMessages).values({
        ticketId,
        sender,
        text: `[${input.subject}]\n\n${input.message}`,
        createdAt: now,
      });

      return { ticketId };
    }),
});
