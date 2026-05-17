import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { platformTickets, platformTicketMessages, webUsers } from "~/server/db/schema";
import { eq, desc, or, like, and, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { sendSupportReplyEmail } from "~/server/email/emailService";
import { log } from "~/server/utils/logger";
import { signUploadToken } from "~/server/lib/uploadToken";
import { env } from "~/env";
import type { Lang } from "~/lib/i18n";
import { notifyWebUser, notifyManyWebUsers } from "~/server/services/notifyWebUser";

const SUPPORT_STAFF_ROLES = ["system_admin", "support", "technical_support"] as const;
const TICKET_SUBJECT_PREVIEW_RE = /^\[([^\]]{1,80})\]/;

function extractTicketSubject(rawText: string | null | undefined, fallback = "Ticket"): string {
  if (!rawText) return fallback;
  const m = TICKET_SUBJECT_PREVIEW_RE.exec(rawText);
  if (m && m[1]) return m[1].trim();
  return rawText.slice(0, 80).trim() || fallback;
}

function truncateBody(text: string, max = 200): string {
  const clean = text.replace(/^\[[^\]]+\]\s*/, "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

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
  getOpenTickets: protectedProcedure.query(async ({ ctx }) => {
    await assertSupport(ctx);
    return ctx.db.select().from(platformTickets)
      .where(eq(platformTickets.status, "open"))
      .orderBy(desc(platformTickets.createdAt))
      .limit(100);
  }),

  getAllTickets: protectedProcedure
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

  getTicket: protectedProcedure
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

  replyToTicket: protectedProcedure
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

      // #P1-5 (relax.md §5) + notification-center PR1 — best-effort
      // support_reply fan-out. We resolve the ticket owner via
      // platform_tickets.client_name (which holds the email at create-time —
      // see createTicket below), then fire BOTH an email AND an in-app
      // user_notifications row so the salon-owner's header bell lights up.
      // Email + in-app are independent: a failure in either path must
      // never break the support reply flow.
      try {
        const ticketRows = await ctx.db
          .select({
            clientName: platformTickets.clientName,
            tenantId: platformTickets.tenantId,
          })
          .from(platformTickets)
          .where(eq(platformTickets.id, input.ticketId))
          .limit(1);
        const recipientEmail = ticketRows[0]?.clientName?.trim();
        const tenantId = ticketRows[0]?.tenantId ?? null;
        if (recipientEmail && /@/.test(recipientEmail)) {
          let lang: Lang = "en";
          let recipientWebUserId: string | null = null;
          try {
            const userRows = await ctx.db
              .select({ id: webUsers.id, lang: webUsers.lang })
              .from(webUsers)
              .where(eq(webUsers.email, recipientEmail))
              .limit(1);
            if (userRows[0]?.lang) lang = userRows[0].lang as Lang;
            if (userRows[0]?.id) recipientWebUserId = userRows[0].id;
          } catch { /* best-effort */ }

          void sendSupportReplyEmail(recipientEmail, input.ticketId, input.text, lang).catch((e) =>
            log.error("support.replyToTicket.email", e instanceof Error ? e : new Error(String(e))),
          );

          if (recipientWebUserId) {
            // Idempotency: sourceId includes the message timestamp so each
            // reply produces a fresh bell row (multiple replies to the
            // same ticket don't collapse into one).
            const sourceId = `${input.ticketId}:${Math.floor(Date.now() / 1000)}`;
            void notifyWebUser(ctx.db, {
              webUserId: recipientWebUserId,
              tenantId,
              kind: "support.reply",
              title: lang === "ru" ? "Новый ответ поддержки"
                : lang === "ua" ? "Нова відповідь підтримки"
                : lang === "pl" ? "Nowa odpowiedź wsparcia"
                : "New support reply",
              body: truncateBody(input.text),
              link: `/settings?section=help&ticket=${input.ticketId}`,
              sourceSlug: "support",
              sourceId,
            }).catch((e) =>
              log.error("support.replyToTicket.notify", e instanceof Error ? e : new Error(String(e))),
            );
          }
        }
      } catch (e) {
        log.error("support.replyToTicket.email", e instanceof Error ? e : new Error(String(e)));
      }

      return { ok: true };
    }),

  claimTicket: protectedProcedure
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

  closeTicket: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertSupport(ctx);
      await ctx.db.update(platformTickets)
        .set({ status: "closed", updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(platformTickets.id, input.ticketId));
      return { ok: true };
    }),

  escalateTicket: protectedProcedure
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
    .input(z.object({
      ticketId: z.string(),
      text: z.string().min(1).max(5000),
      attachmentUrl: z.string().max(2000).optional(),
    }))
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
        attachmentUrl: input.attachmentUrl ?? null,
        createdAt: now,
      });
      const updates: Record<string, any> = { updatedAt: now };
      if (rows[0]!.status === "closed") updates.status = "open";
      await ctx.db
        .update(platformTickets)
        .set(updates)
        .where(eq(platformTickets.id, input.ticketId));

      // Fan-out to support staff so they see the follow-up in their bell.
      // Skip the original ticket creator (no self-notify), and use a
      // per-reply sourceId so multiple follow-ups don't collapse.
      void notifyPlatformSupportStaff(ctx.db, {
        excludeWebUserId: ctx.webUser?.id ?? null,
        ticketId: input.ticketId,
        kindSlug: "support.ticket.reply",
        title: "Клиент ответил в тикете",
        body: truncateBody(input.text),
        link: `/?ticket=${input.ticketId}`,
        sourceId: `${input.ticketId}:reply:${now}`,
      }).catch((e) =>
        log.error("support.replyToMyTicket.notifyStaff", e instanceof Error ? e : new Error(String(e))),
      );

      return { ok: true };
    }),

  /**
   * Mint a short-lived HMAC-signed upload token for the Worker's
   * `/upload/asset` endpoint, scoped to `chat_attachment` and the ticket's
   * tenant. The client uses this to upload an image (PNG/JPEG/WEBP, ≤2 MB)
   * directly to R2 via the Worker, then includes the returned CDN URL in
   * the next `replyToTicket` / `replyToMyTicket` call.
   *
   * Authorization rule: the caller must be either
   *   - support staff (system_admin / support / technical_support), OR
   *   - the ticket's owner (created by them per `myTicketsFilter`)
   *
   * Tenant scoping: the upload's R2 key is `t/{tid}/chat_attachment-{sha}.{ext}`
   * where `tid` = `ticket.tenant_id`. If the ticket has no tenant (rare —
   * platform-staff-created tickets only), we use the `_platform` sentinel.
   */
  mintTicketUploadToken: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });

      // Resolve the ticket so we can decide tenant scope + authorization.
      const ticketRows = await ctx.db
        .select({
          id: platformTickets.id,
          tenantId: platformTickets.tenantId,
          clientName: platformTickets.clientName,
        })
        .from(platformTickets)
        .where(eq(platformTickets.id, input.ticketId))
        .limit(1);
      if (!ticketRows.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      const ticket = ticketRows[0]!;

      const role = ctx.webUser.webRole;
      const isSupportStaff = role === "system_admin" || role === "support" || role === "technical_support";
      // Tickets are keyed to the creator by `clientName` (= their email).
      // `replyToMyTicket` uses this exact check via `myTicketsFilter`.
      const isOwner = !!ctx.webUser.email && ticket.clientName === ctx.webUser.email;

      if (!isSupportStaff && !isOwner) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this ticket" });
      }

      if (!env.UPLOAD_TOKEN_SECRET) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "UPLOAD_TOKEN_SECRET not configured on admin-app",
        });
      }
      if (!env.WORKER_PUBLIC_URL) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "WORKER_PUBLIC_URL not configured on admin-app",
        });
      }

      const tid = ticket.tenantId ?? "_platform";
      const token = await signUploadToken({
        tid,
        kind: "chat_attachment",
        secret: env.UPLOAD_TOKEN_SECRET,
      });
      const base = env.WORKER_PUBLIC_URL.replace(/\/$/, "");
      return {
        token,
        uploadUrl: `${base}/upload/asset?t=${encodeURIComponent(token)}&kind=chat_attachment`,
      };
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

      // Fan-out: notify every support staff member that a new ticket is
      // waiting. Fire-and-forget so a notification-write failure cannot
      // block the user's ticket from being created.
      void notifyPlatformSupportStaff(ctx.db, {
        excludeWebUserId: ctx.webUser.id,
        ticketId,
        kindSlug: "support.ticket.new",
        title: `Новый тикет: ${extractTicketSubject(`[${input.subject}]`, "Тикет")}`,
        body: truncateBody(input.message),
        link: `/?ticket=${ticketId}`,
        sourceId: ticketId,
      }).catch((e) =>
        log.error("support.createTicket.notifyStaff", e instanceof Error ? e : new Error(String(e))),
      );

      return { ticketId };
    }),
});

/**
 * Fan-out helper — notify every web_user with a platform support role
 * (system_admin / support / technical_support). Skips the supplied
 * excludeWebUserId so a support agent doesn't ping themselves when they
 * happen to be the ticket creator.
 *
 * Idempotent: relies on the user_notifications partial UNIQUE
 * (web_user_id, source_slug, source_id, kind) — so caller-controlled
 * sourceId determines collapse semantics.
 */
async function notifyPlatformSupportStaff(
  db: any,
  opts: {
    excludeWebUserId: string | null;
    ticketId: string;
    kindSlug: string;
    title: string;
    body: string;
    link: string;
    sourceId: string;
  },
): Promise<void> {
  const staff = await db
    .select({ id: webUsers.id })
    .from(webUsers)
    .where(inArray(webUsers.role, SUPPORT_STAFF_ROLES as unknown as string[]))
    .limit(200);
  const targets: string[] = staff
    .map((s: { id: string }) => s.id)
    .filter((id: string) => id && id !== opts.excludeWebUserId);
  if (targets.length === 0) return;
  await notifyManyWebUsers(db, targets, {
    kind: opts.kindSlug,
    title: opts.title,
    body: opts.body,
    link: opts.link,
    sourceSlug: "support",
    sourceId: opts.sourceId,
    tenantId: null,
  });
}
