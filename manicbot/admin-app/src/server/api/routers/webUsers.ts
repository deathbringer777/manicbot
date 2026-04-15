import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure, adminProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { webUsers, auditLog, tenants, masters } from "~/server/db/schema";
import type { Lang } from "~/lib/i18n";
import { eq } from "drizzle-orm";
import { verifyPassword, hashPassword } from "~/server/auth/password";
import { generateToken, hashToken, timingSafeEqualHex } from "~/server/auth/tokens";
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

import { checkRateLimit } from "~/server/auth/rateLimit";

/*
 * D1-based rate limiting — durable across Cloudflare edge isolates.
 * See server/auth/rateLimit.ts for implementation.
 */
const RL_WINDOW = 10 * 60 * 1000; // 10 minutes
const RL_REGISTER_MAX = 5;
const RL_RESEND_MAX = 3;
const RL_VERIFY_MAX = 5;
const RL_RESET_MAX = 5;
const RL_LOGIN_IP_MAX = 20; // max login attempts per IP across all accounts
const RL_LOGIN_IP_WINDOW = 15 * 60 * 1000; // 15 minutes

/**
 * Generate a 6-digit email verification code using crypto.getRandomValues
 * (NOT Math.random — CSPRNG required so codes are not predictable).
 * 6 digits = 900K codes — safe given rate limiting (5 attempts / 10 min) + 15-min TTL.
 */
function generateVerificationCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // 6-digit range: 100000..999999
  const code = (buf[0]! % 900000) + 100000;
  return code.toString();
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
        password: z.string().min(12, "Минимум 12 символов").optional(),
        role: z.enum(["tenant_owner", "master"]),
        name: z.string().max(200).nullish(),
        lang: z.enum(["ru", "ua", "en", "pl"]).default("en"),
        referralSource: z.string().max(100).nullish(),
        tosAccepted: z.literal(true, { errorMap: () => ({ message: "Terms of Service must be accepted" }) }),
        googlePrefillToken: z.string().min(1).max(8000).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (isResendConfigured() && !authPublicBaseUrl()) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Email verification is enabled but AUTH_URL (or NEXTAUTH_URL) is not set. Configure a public app URL for verification links.",
        });
      }

      // Rate limit by IP (D1-backed — durable across edge isolates)
      const ip = clientIp(ctx as { headers?: Headers | null });
      const rl = await checkRateLimit(ctx.db, ip, "register", RL_REGISTER_MAX, RL_WINDOW);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many registration attempts. Try again later." });
      }
      const email = input.email.toLowerCase().trim();

      // Password is required unless registering via Google prefill
      if (!input.password && !input.googlePrefillToken) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Password is required" });
      }

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
      const passwordHash = input.password ? await hashPassword(input.password) : "";
      const verificationCode = generateVerificationCode();
      // Store hashed code in DB; email contains the plaintext code
      const verificationCodeHash = await hashToken(verificationCode);
      const now = Math.floor(Date.now() / 1000);
      const codeExpiresAt = now + 15 * 60; // 15 minutes
      // Always require email verification when Resend is configured,
      // even for Google OAuth — user must confirm they receive our emails.
      const skipEmailVerification = !isResendConfigured();

      // Auto-create tenant for salon owners AND independent masters
      let assignedTenantId: string | null = null;
      if (input.role === "tenant_owner" || input.role === "master") {
        const tid = "t_" + randomId(6);
        const trialEndsAt = now + 14 * 24 * 3600; // 14 days
        const isPersonal = input.role === "master" ? 1 : 0;
        await ctx.db.insert(tenants).values({
          id: tid,
          name: (input.name ?? email.split("@")[0] ?? "My Salon").trim(),
          active: 1,
          plan: "start",
          billingStatus: "trialing",
          trialEndsAt,
          cancelAtPeriodEnd: 0,
          isPersonal,
          createdAt: now,
          updatedAt: now,
        });
        assignedTenantId = tid;

        // Independent master: also create a master record in the new tenant.
        // Generate a synthetic chatId (web-only masters have no Telegram ID).
        // Range 10B+ avoids collision with real Telegram user IDs.
        if (input.role === "master") {
          const syntheticChatId = 10_000_000_000 + (parseInt(id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);
          await ctx.db.insert(masters).values({
            tenantId: tid,
            chatId: syntheticChatId,
            name: (input.name ?? email.split("@")[0] ?? "Master").trim(),
            active: 1,
            addedAt: now,
          });
        }
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
          verificationToken: skipEmailVerification ? null : verificationCodeHash,
          verificationTokenExpiresAt: skipEmailVerification ? null : codeExpiresAt,
          tosAcceptedAt: now,
          tenantId: assignedTenantId,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err: unknown) {
        // Clean up orphaned tenant + master if webUsers insert fails
        if (assignedTenantId) {
          try { await ctx.db.delete(masters).where(eq(masters.tenantId, assignedTenantId)); } catch { /* best-effort */ }
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

  /** Verify email address with verification code. */
  verifyEmail: publicProcedure
    .input(z.object({ email: z.string().email(), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();

      const rl = await checkRateLimit(ctx.db, email, "verify", RL_VERIFY_MAX, RL_WINDOW);
      if (!rl.allowed) {
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

      // Verification token is stored as a SHA-256 hash; hash the user input and compare.
      const inputHash = await hashToken(input.code);
      if (!timingSafeEqualHex(inputHash, user.verificationToken)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid verification code" });
      }

      await ctx.db
        .update(webUsers)
        .set({ emailVerified: 1, verificationToken: null, verificationTokenExpiresAt: null, updatedAt: now })
        .where(eq(webUsers.id, user.id));

      try {
        await ctx.db.insert(auditLog).values({
          tenantId: user.tenantId ?? null,
          actor: email,
          action: "email_verified",
          detail: JSON.stringify({ userId: user.id, email, channel: "web" }),
          ip: null,
          createdAt: now,
        });
      } catch { /* non-critical */ }

      // Non-blocking welcome email
      sendWelcomeEmail(user.email, user.name ?? null, (user.lang ?? "en") as Lang).catch(() => {});

      return { success: true };
    }),

  /** Resend verification code. */
  resendVerificationCode: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();

      const rl = await checkRateLimit(ctx.db, email, "resend", RL_RESEND_MAX, RL_WINDOW);
      if (!rl.allowed) {
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
      const newCodeHash = await hashToken(newCode);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 15 * 60;

      await ctx.db
        .update(webUsers)
        .set({ verificationToken: newCodeHash, verificationTokenExpiresAt: expiresAt, updatedAt: now })
        .where(eq(webUsers.id, user.id));

      const sent = await sendVerificationCodeEmail(email, newCode, (user.lang ?? "en") as Lang);
      if (!sent.ok) {
        // Roll back token so the user can retry cleanly (no phantom code in DB)
        try {
          await ctx.db
            .update(webUsers)
            .set({ verificationToken: null, verificationTokenExpiresAt: null, updatedAt: now })
            .where(eq(webUsers.id, user.id));
        } catch { /* non-critical */ }
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
      const rl = await checkRateLimit(ctx.db, ip, "password_reset", RL_RESET_MAX, RL_WINDOW);
      if (!rl.allowed) {
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
        // Store a SHA-256 hash of the token in DB; send the plain token via email.
        // If the DB leaks, attacker cannot derive the original reset link.
        const resetToken = generateToken();
        const resetTokenHash = await hashToken(resetToken);
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 3600; // 1 hour
        await ctx.db
          .update(webUsers)
          .set({
            passwordResetToken: resetTokenHash,
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
      // Lookup by hash of the supplied token (tokens are hashed at rest).
      const tokenHash = await hashToken(input.token);
      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.passwordResetToken, tokenHash))
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

  /** Create a web user (God Mode only). Sends verification email. */
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
      const shouldVerify = isResendConfigured();
      const verificationCode = shouldVerify ? generateVerificationCode() : null;
      const verificationCodeHash = verificationCode ? await hashToken(verificationCode) : null;
      const codeExpiresAt = shouldVerify ? now + 15 * 60 : null;
      await ctx.db.insert(webUsers).values({
        id,
        email,
        passwordHash,
        role: input.role,
        emailVerified: shouldVerify ? 0 : 1,
        verificationToken: verificationCodeHash,
        verificationTokenExpiresAt: codeExpiresAt,
        tenantId: input.tenantId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      if (shouldVerify && verificationCode) {
        const sent = await sendVerificationCodeEmail(email, verificationCode, "en");
        if (!sent.ok) {
          console.error("[webUsers] create: verification email failed", sent.error);
        }
      }
      return { id, email, verificationRequired: shouldVerify };
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

      // Store hash in DB, send plain token via email (see tokens.ts rationale).
      const token = generateToken();
      const tokenHash = await hashToken(token);
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
          emailChangeToken: tokenHash,
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
      const tokenHash = await hashToken(input.token);
      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.emailChangeToken, tokenHash))
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
      if (!user.passwordHash || user.passwordHash === "") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No password set. Use 'Set password' instead." });
      }
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

  /** Safety-net: create tenant for logged-in tenant_owner or independent master with no tenant yet. */
  createMyTenant: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Web session required" });
      }
      const webRole = ctx.webUser.webRole;
      if (webRole !== "tenant_owner" && webRole !== "master") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only salon owners or masters can create a workspace" });
      }
      // Prevent double-creation — re-read from DB
      const [me] = await ctx.db
        .select({ tenantId: webUsers.tenantId })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);
      if (me?.tenantId) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a workspace" });
      }
      const tid = "t_" + randomId(6);
      const now = Math.floor(Date.now() / 1000);
      const trialEndsAt = now + 14 * 24 * 3600;
      const isPersonal = webRole === "master" ? 1 : 0;
      await ctx.db.insert(tenants).values({
        id: tid,
        name: input.name.trim(),
        active: 1,
        plan: "start",
        billingStatus: "trialing",
        trialEndsAt,
        cancelAtPeriodEnd: 0,
        isPersonal,
        createdAt: now,
        updatedAt: now,
      });
      // Independent master: also create a master record
      if (webRole === "master") {
        const syntheticChatId = 10_000_000_000 + (parseInt(ctx.webUser.id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);
        await ctx.db.insert(masters).values({
          tenantId: tid,
          chatId: syntheticChatId,
          name: input.name.trim(),
          active: 1,
          addedAt: now,
        });
      }
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

  /** Set initial password for users who registered via Google without one. */
  setInitialPassword: protectedProcedure
    .input(z.object({ newPassword: z.string().min(12, "Минимум 12 символов") }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Web session required" });
      }
      const rows = await ctx.db
        .select({ passwordHash: webUsers.passwordHash })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);
      if (!rows.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      // Only allow setting initial password if none is set (empty string = no password)
      if (rows[0]!.passwordHash && rows[0]!.passwordHash !== "") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Password already set. Use change password instead." });
      }
      const newHash = await hashPassword(input.newPassword);
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .update(webUsers)
        .set({ passwordHash: newHash, updatedAt: now })
        .where(eq(webUsers.id, ctx.webUser.id));
      return { success: true };
    }),
});
