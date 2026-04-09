import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";
import { platformTickets, platformTicketMessages, platformRoles, tenantRoles } from "~/server/db/schema";
import { eq, desc, or, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { timingSafeEqualStr } from "~/server/auth/telegram";

async function assertSupport(ctx: any) {
  if (!ctx.user && ctx.webUser) {
    const r = ctx.webUser.webRole;
    if (r === "system_admin") return;
    if (r === "support" || r === "technical_support") return;
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (env.ADMIN_CHAT_ID && timingSafeEqualStr(String(ctx.user.id), env.ADMIN_CHAT_ID)) return;
  const row = await ctx.db
    .select()
    .from(platformRoles)
    .where(eq(platformRoles.chatId, ctx.user.id))
    .limit(1);
  if (!row.length) throw new TRPCError({ code: "FORBIDDEN" });
  const role = row[0]!.role;
  if (role !== "support" && role !== "technical_support") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

function supportSenderId(ctx: any): string {
  if (ctx.user) return `support:${ctx.user.id}`;
  if (ctx.webUser) return `support:web:${ctx.webUser.id}`;
  return "support:unknown";
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
      if (ctx.user) {
        await ctx.db.update(platformTickets)
          .set({
            claimedBy: ctx.user.id,
            claimedByWebUserId: null,
            claimedAt: now,
            updatedAt: now,
            status: "claimed",
          })
          .where(eq(platformTickets.id, input.ticketId));
      } else if (ctx.webUser) {
        await ctx.db.update(platformTickets)
          .set({
            claimedBy: null,
            claimedByWebUserId: ctx.webUser.id,
            claimedAt: now,
            updatedAt: now,
            status: "claimed",
          })
          .where(eq(platformTickets.id, input.ticketId));
      }
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
      let clientChatId = 0;
      let clientName: string | null = null;
      let tenantId: string | null = null;
      let sender = "user:unknown";

      if (ctx.user) {
        clientChatId = ctx.user.id;
        clientName = [ctx.user.first_name, ctx.user.last_name].filter(Boolean).join(" ") || null;
        sender = `user:${ctx.user.id}`;
        // Resolve tenantId from tenant_roles
        const trRow = await ctx.db
          .select({ tenantId: tenantRoles.tenantId })
          .from(tenantRoles)
          .where(eq(tenantRoles.chatId, ctx.user.id))
          .limit(1);
        if (trRow.length) tenantId = trRow[0]!.tenantId;
      } else if (ctx.webUser) {
        clientChatId = 0;
        clientName = ctx.webUser.email;
        sender = `user:web:${ctx.webUser.id}`;
        tenantId = ctx.webUser.tenantId ?? null;
      }

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
