import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure, adminProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { webUsers, auditLog, tenants } from "~/server/db/schema";
import type { Lang } from "~/lib/i18n";
import { eq } from "drizzle-orm";
import { verifyPassword, hashPassword } from "~/server/auth/password";
import { verifyGooglePrefillToken } from "~/server/auth/googlePrefillToken";
import { authPublicBaseUrl } from "~/server/auth/authBaseUrl";
import { isResendConfigured } from "~/server/email/resend";
import {
  sendVerificationEmail,
  sendVerificationCodeEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendEmailChangeVerification,
} from "~/server/email/emailService";

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

const resendRl = new Map<string, { count: number; resetAt: number }>();
const RESEND_RL_MAX = 3;

function checkResendRateLimit(email: string): boolean {
  const now = Date.now();
  const entry = resendRl.get(email);
  if (!entry || now > entry.resetAt) {
    resendRl.set(email, { count: 1, resetAt: now + RL_WINDOW });
    return true;
  }
  if (entry.count >= RESEND_RL_MAX) return false;
  entry.count++;
  return true;
}

const verifyRl = new Map<string, { count: number; resetAt: number }>();

function checkVerifyRateLimit(email: string): boolean {
  const now = Date.now();
  const entry = verifyRl.get(email);
  if (!entry || now > entry.resetAt) {
    verifyRl.set(email, { count: 1, resetAt: now + RL_WINDOW });
    return true;
  }
  if (entry.count >= RL_MAX) return false;
  entry.count++;
  return true;
}

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const resetRl = new Map<string, { count: number; resetAt: number }>();

function checkPasswordResetRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = resetRl.get(ip);
  if (!entry || now > entry.resetAt) {
    resetRl.set(ip, { count: 1, resetAt: now + RL_WINDOW });
    return true;
  }
  if (entry.count >= RL_MAX) return false;
  entry.count++;
  return true;
}

function randomId(len = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => chars[b % chars.length])
    .join("");
}

function clientIp(ctx: { headers?: Headers | null }): string {
  const h = ctx.headers;
  if (!h?.get) return "unknown";
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || h.get("cf-connecting-ip") || "unknown";
}

export const webUsersRouter = createTRPCRouter({
  /** Decode Google OAuth prefill token (public). */
  googlePrefillPreview: publicProcedure
    .input(z.object({ token: z.string().min(1).max(8000) }))
    .query(async ({ input }) => {
      const secret = process.env.AUTH_SECRET;
      if (!secret) return { ok: false as const };
      const payload = await verifyGooglePrefillToken(secret, input.token);
      if (!payload) return { ok: false as const };
      return { ok: true as const, email: payload.email, name: payload.name };
    }),

  /** Self-registration (public). */
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(12, "Минимум 12 символов"),
        role: z.enum(["tenant_owner", "master"]),
        name: z.string().max(200).optional(),
        lang: z.enum(["ru", "ua", "en", "pl"]).default("en"),
        referralSource: z.string().max(100).optional(),
        tosAccepted: z.literal(true, { errorMap: () => ({ message: "Terms of Service must be accepted" }) }),
        googlePrefillToken: z.string().min(1).max(8000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (isResendConfigured() && !authPublicBaseUrl()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Email verification is enabled but AUTH_URL (or NEXTAUTH_URL) is not set. Configure a public app URL for verification links.",
        });
      }

      // Rate limit by IP
      const ip = clientIp(ctx as { headers?: Headers | null });
      if (!checkRegisterRateLimit(ip)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many registration attempts. Try again later." });
      }
      const email = input.email.toLowerCase().trim();

      let googleVerified = false;
      if (input.googlePrefillToken) {
        const secret = process.env.AUTH_SECRET;
        if (!secret) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Server misconfiguration" });
        }
        const payload = await verifyGooglePrefillToken(secret, input.googlePrefillToken);
        if (!payload || payload.email !== email) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid or expired Google sign-in. Please use Google sign-in again or register without it.",
          });
        }
        googleVerified = true;
      }

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
      const verificationCode = generateVerificationCode();
      const now = Math.floor(Date.now() / 1000);
      const codeExpiresAt = now + 15 * 60; // 15 minutes
      const skipEmailVerification = googleVerified || !isResendConfigured();

      // Auto-create tenant for salon owners
      let assignedTenantId: string | null = null;
      if (input.role === "tenant_owner") {
        const tid = "t_" + randomId(6);
        const trialEndsAt = now + 7 * 24 * 3600; // 7 days
        await ctx.db.insert(tenants).values({
          id: tid,
          name: (input.name ?? email.split("@")[0] ?? "My Salon").trim(),
          active: 1,
          plan: "start",
          billingStatus: "trialing",
          trialEndsAt,
          cancelAtPeriodEnd: 0,
          createdAt: now,
          updatedAt: now,
        });
        assignedTenantId = tid;
      }

      try {
        await ctx.db.insert(webUsers).values({
          id,
          email,
          passwordHash,
          role: input.role,
          name: input.name ?? null,
          lang: input.lang,
          referralSource: input.referralSource ?? null,
          emailVerified: skipEmailVerification ? 1 : 0,
          verificationToken: skipEmailVerification ? null : verificationCode,
          verificationTokenExpiresAt: skipEmailVerification ? null : codeExpiresAt,
          tosAcceptedAt: now,
          tenantId: assignedTenantId,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err: unknown) {
        // Clean up orphaned tenant if webUsers insert fails
        if (assignedTenantId) {
          try { await ctx.db.delete(tenants).where(eq(tenants.id, assignedTenantId)); } catch { /* best-effort */ }
        }
        // Handle race condition: another request inserted the same email between our check and insert
        if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
          throw new TRPCError({ code: "CONFLICT", message: "Registration failed. Please try again or use a different email." });
        }
        throw err;
      }
      try {
        await ctx.db.insert(auditLog).values({
          tenantId: assignedTenantId,
          actor: email,
          action: "tos_accepted",
          detail: JSON.stringify({
            channel: "web",
            userId: id,
            email,
            referralSource: input.referralSource ?? null,
            role: input.role,
            tenantId: assignedTenantId,
          }),
          ip,
          createdAt: now,
        });
      } catch { /* non-critical */ }

      if (!skipEmailVerification) {
        const sent = await sendVerificationCodeEmail(email, verificationCode, input.lang);
        if (!sent.ok) {
          await ctx.db.delete(webUsers).where(eq(webUsers.id, id));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              sent.error === "resend_not_configured"
                ? "Email could not be sent. Check Resend configuration."
                : `Could not send verification email: ${sent.error}`,
          });
        }
      }

      return {
        id,
        email,
        verificationRequired: !skipEmailVerification,
      };
    }),

  /** Verify email address with 6-digit code. */
  verifyEmail: publicProcedure
    .input(z.object({ email: z.string().email(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();

      if (!checkVerifyRateLimit(email)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many verification attempts. Try again later." });
      }

      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);
      if (!rows.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid verification code" });
      }
      const user = rows[0]!;

      // Already verified — no code check, just confirm to the UI
      if (user.emailVerified) {
        return { success: true, alreadyVerified: true };
      }

      // Must have a pending verification token to proceed
      if (!user.verificationToken) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No verification code pending. Request a new one." });
      }

      const now = Math.floor(Date.now() / 1000);
      if (user.verificationTokenExpiresAt && now > user.verificationTokenExpiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Verification code expired. Request a new one." });
      }

      // Constant-time comparison
      if (user.verificationToken.length !== input.code.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid verification code" });
      }
      let match = 0;
      for (let i = 0; i < input.code.length; i++) {
        match |= input.code.charCodeAt(i) ^ user.verificationToken.charCodeAt(i);
      }
      if (match !== 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid verification code" });
      }

      await ctx.db
        .update(webUsers)
        .set({ emailVerified: 1, verificationToken: null, verificationTokenExpiresAt: null, updatedAt: now })
        .where(eq(webUsers.id, user.id));

      // Non-blocking welcome email
      sendWelcomeEmail(user.email, user.name ?? null, (user.lang ?? "en") as Lang).catch(() => {});

      return { success: true };
    }),

  /** Resend verification code. */
  resendVerificationCode: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();

      if (!checkResendRateLimit(email)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many resend attempts. Try again later." });
      }

      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);
      // Silent success even if user not found (prevent enumeration)
      if (!rows.length || rows[0]!.emailVerified) {
        return { ok: true };
      }
      const user = rows[0]!;
      const newCode = generateVerificationCode();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 15 * 60;

      await ctx.db
        .update(webUsers)
        .set({ verificationToken: newCode, verificationTokenExpiresAt: expiresAt, updatedAt: now })
        .where(eq(webUsers.id, user.id));

      const sent = await sendVerificationCodeEmail(email, newCode, (user.lang ?? "en") as Lang);
      if (!sent.ok) {
        console.error(`[webUsers] resendVerificationCode: email send failed for ${email}: ${sent.error}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: sent.error === "resend_not_configured"
            ? "Email service not configured. Contact support."
            : "Could not send verification email. Try again later.",
        });
      }

      return { ok: true };
    }),

  /** Request password reset email (public). Same response whether or not the email exists. */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx as { headers?: Headers | null });
      if (!checkPasswordResetRateLimit(ip)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Try again later.",
        });
      }

      const email = input.email.toLowerCase().trim();
      const base = authPublicBaseUrl();
      const canSend = isResendConfigured() && Boolean(base);

      if (isResendConfigured() && !base) {
        console.error("[webUsers] requestPasswordReset: Resend configured but AUTH_URL is empty");
      }

      const rows = await ctx.db
        .select({ id: webUsers.id, lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);

      if (rows.length && canSend) {
        const resetToken = crypto.randomUUID();
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 3600; // 1 hour
        await ctx.db
          .update(webUsers)
          .set({
            passwordResetToken: resetToken,
            passwordResetExpiresAt: expiresAt,
            updatedAt: now,
          })
          .where(eq(webUsers.id, rows[0]!.id));

        const sent = await sendPasswordResetEmail(email, resetToken, (rows[0]!.lang ?? "en") as Lang);
        if (!sent.ok) {
          await ctx.db
            .update(webUsers)
            .set({
              passwordResetToken: null,
              passwordResetExpiresAt: null,
              updatedAt: now,
            })
            .where(eq(webUsers.id, rows[0]!.id));
          console.error("[webUsers] requestPasswordReset: Resend failed", sent.error);
        }
      }

      return { ok: true as const };
    }),

  /** Complete password reset with token from email (public). */
  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        newPassword: z.string().min(12, "Минимум 12 символов"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.passwordResetToken, input.token))
        .limit(1);
      if (!rows.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired reset link",
        });
      }
      const user = rows[0]!;
      const now = Math.floor(Date.now() / 1000);
      if (!user.passwordResetExpiresAt || now > user.passwordResetExpiresAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired reset link",
        });
      }

      const newHash = await hashPassword(input.newPassword);
      await ctx.db
        .update(webUsers)
        .set({
          passwordHash: newHash,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(webUsers.id, user.id));

      return { success: true as const };
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
      referralSource: webUsers.referralSource,
      createdAt: webUsers.createdAt,
    }).from(webUsers);
    return rows;
  }),

  /** Request email change — sends verification to NEW email. */
  requestEmailChange: protectedProcedure
    .input(z.object({ newEmail: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Web session required" });
      }
      if (!isResendConfigured() || !authPublicBaseUrl()) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Email service not configured" });
      }

      const newEmail = input.newEmail.toLowerCase().trim();
      if (newEmail === ctx.webUser.email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "New email is the same as current" });
      }

      const existing = await ctx.db
        .select({ id: webUsers.id })
        .from(webUsers)
        .where(eq(webUsers.email, newEmail))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }

      const token = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 3600; // 1 hour

      const [me] = await ctx.db
        .select({ lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.email, ctx.webUser.email))
        .limit(1);

      await ctx.db
        .update(webUsers)
        .set({
          newEmail,
          emailChangeToken: token,
          emailChangeTokenExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(eq(webUsers.email, ctx.webUser.email));

      const sent = await sendEmailChangeVerification(newEmail, token, newEmail, (me?.lang ?? "en") as Lang);
      if (!sent.ok) {
        await ctx.db
          .update(webUsers)
          .set({ newEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null, updatedAt: now })
          .where(eq(webUsers.email, ctx.webUser.email));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not send verification email: ${sent.error}`,
        });
      }

      return { ok: true as const };
    }),

  /** Confirm email change with token (public — user clicks link from email). */
  confirmEmailChange: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.emailChangeToken, input.token))
        .limit(1);
      if (!rows.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired link" });
      }
      const user = rows[0]!;
      const now = Math.floor(Date.now() / 1000);
      if (!user.emailChangeTokenExpiresAt || now > user.emailChangeTokenExpiresAt || !user.newEmail) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired link" });
      }

      // Check the new email hasn't been taken since the request
      const taken = await ctx.db
        .select({ id: webUsers.id })
        .from(webUsers)
        .where(eq(webUsers.email, user.newEmail))
        .limit(1);
      if (taken.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
      }

      await ctx.db
        .update(webUsers)
        .set({
          email: user.newEmail,
          newEmail: null,
          emailChangeToken: null,
          emailChangeTokenExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(webUsers.id, user.id));

      return { success: true as const };
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

  /** Safety-net: create tenant for logged-in tenant_owner with no salon yet. */
  createMyTenant: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Web session required" });
      }
      if (ctx.webUser.webRole !== "tenant_owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only salon owners can create a salon" });
      }
      // Prevent double-creation — re-read from DB
      const [me] = await ctx.db
        .select({ tenantId: webUsers.tenantId })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);
      if (me?.tenantId) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a salon" });
      }
      const tid = "t_" + randomId(6);
      const now = Math.floor(Date.now() / 1000);
      const trialEndsAt = now + 7 * 24 * 3600;
      await ctx.db.insert(tenants).values({
        id: tid,
        name: input.name.trim(),
        active: 1,
        plan: "start",
        billingStatus: "trialing",
        trialEndsAt,
        cancelAtPeriodEnd: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db
        .update(webUsers)
        .set({ tenantId: tid, updatedAt: now })
        .where(eq(webUsers.id, ctx.webUser.id));
      return { tenantId: tid };
    }),

  /** Assign or clear tenantId for a web user (God Mode only). */
  setTenant: adminProcedure
    .input(z.object({
      userId: z.string(),
      tenantId: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.select({ id: webUsers.id }).from(webUsers).where(eq(webUsers.id, input.userId)).limit(1);
      if (!rows.length) throw new TRPCError({ code: "NOT_FOUND", message: "Web user not found" });
      await ctx.db.update(webUsers).set({ tenantId: input.tenantId }).where(eq(webUsers.id, input.userId));
      return { success: true };
    }),
});
