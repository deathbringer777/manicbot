import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure, adminProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { webUsers } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, hashPassword } from "~/server/auth/password";

/* Simple in-memory rate limiter for registration (resets per edge isolate). */
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
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.insert(webUsers).values({
        id,
        email,
        passwordHash,
        role: input.role,
        name: input.name ?? null,
        referralSource: input.referralSource ?? null,
        tenantId: null,
        createdAt: now,
        updatedAt: now,
      });
      return { id, email };
    }),

  /** Create a web user (God Mode only). */
  create: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(12, "Минимум 12 символов"),
        role: z.enum(["system_admin", "tenant_owner", "support", "technical_support"]),
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
