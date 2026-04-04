import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure, adminProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { webUsers } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, hashPassword } from "~/server/auth/password";

/*
 * Simple in-memory rate limiter for registration.
 * NOTE: resets per Cloudflare edge isolate (not shared across regions).
 * This is a best-effort first-pass defense — the DB UNIQUE constraint is the
 * authoritative guard against duplicate registrations.
 */
const registerRl = new Map<string, { count: number; resetAt: number }>();
const RL_MAX = 5;
const RL_WINDOW = 10 * 60 * 1000; // 10 minutes

function checkRegisterRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = registerRl.get(ip);
  if (!entry || now > entry.resetAt) {
    registerRl.set(ip, { count: 1, resetAt: now + RL_WINDOW });
    return true;
  }
  if (entry.count >= RL_MAX) return false;
  entry.count++;
  return true;
}

export const webUsersRouter = createTRPCRouter({
  /** Self-registration (public). */
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(12, "Минимум 12 символов"),
        role: z.enum(["tenant_owner", "master"]),
        name: z.string().max(200).optional(),
        referralSource: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const hasEmailVerificationDelivery = Boolean(
        process.env.RESEND_API_KEY ||
        process.env.SMTP_HOST ||
        process.env.MAILGUN_API_KEY ||
        process.env.SENDGRID_API_KEY
      );

      // Rate limit by IP
      const ip = (ctx as any).headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim()
        ?? (ctx as any).headers?.get?.("cf-connecting-ip")
        ?? "unknown";
      if (!checkRegisterRateLimit(ip)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many registration attempts. Try again later." });
      }
      const email = input.email.toLowerCase().trim();
      const existing = await ctx.db
        .select({ id: webUsers.id })
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Registration failed. Please try again or use a different email." });
      }
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(input.password);
      const verificationToken = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const tokenExpiresAt = now + 24 * 3600; // 24 hours
      try {
        await ctx.db.insert(webUsers).values({
          id,
          email,
          passwordHash,
          role: input.role,
          name: input.name ?? null,
          referralSource: input.referralSource ?? null,
          emailVerified: hasEmailVerificationDelivery ? 0 : 1,
          verificationToken: hasEmailVerificationDelivery ? verificationToken : null,
          verificationTokenExpiresAt: hasEmailVerificationDelivery ? tokenExpiresAt : null,
          tenantId: null,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err: unknown) {
        // Handle race condition: another request inserted the same email between our check and insert
        if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
          throw new TRPCError({ code: "CONFLICT", message: "Registration failed. Please try again or use a different email." });
        }
        throw err;
      }
      return {
        id,
        email,
        verificationRequired: hasEmailVerificationDelivery,
        verificationToken: hasEmailVerificationDelivery ? verificationToken : null,
      };
    }),

  /** Verify email address with token. */
  verifyEmail: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.verificationToken, input.token))
        .limit(1);
      if (!rows.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid verification token" });
      }
      const user = rows[0]!;
      if (user.emailVerified) {
        return { success: true, alreadyVerified: true };
      }
      const now = Math.floor(Date.now() / 1000);
      if (user.verificationTokenExpiresAt && now > user.verificationTokenExpiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Verification token expired" });
      }
      await ctx.db
        .update(webUsers)
        .set({ emailVerified: 1, verificationToken: null, verificationTokenExpiresAt: null, updatedAt: now })
        .where(eq(webUsers.id, user.id));
      return { success: true };
    }),

  /** Create a web user (God Mode only). Auto-verified. */
  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(12, "Минимум 12 символов"),
        role: z.enum(["tenant_owner", "support", "technical_support"]),
        tenantId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();
      const existing = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "User with this email already exists" });
      }
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(input.password);
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.insert(webUsers).values({
        id,
        email,
        passwordHash,
        role: input.role,
        emailVerified: 1, // Admin-created users are auto-verified
        tenantId: input.tenantId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return { id, email };
    }),

  /** List all web users (God Mode only). */
  list: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.select({
      id: webUsers.id,
      email: webUsers.email,
      role: webUsers.role,
      tenantId: webUsers.tenantId,
      createdAt: webUsers.createdAt,
    }).from(webUsers);
    return rows;
  }),

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(12, "Минимум 12 символов"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Require web session (not Telegram)
      if (!ctx.webUser) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Web session required to change password",
        });
      }

      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.email, ctx.webUser.email))
        .limit(1);

      if (!rows.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const user = rows[0]!;
      const valid = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Неверный текущий пароль" });
      }

      const newHash = await hashPassword(input.newPassword);
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .update(webUsers)
        .set({ passwordHash: newHash, updatedAt: now })
        .where(eq(webUsers.email, ctx.webUser.email));

      return { success: true };
    }),
});
