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
  sendPasswordResetCodeEmail,
  sendWelcomeEmail,
  sendEmailChangeCodeVerification,
} from "~/server/email/emailService";

import { checkRateLimit } from "~/server/auth/rateLimit";
import { log } from "~/server/utils/logger";
import { writeAudit } from "~/server/security/audit";

/*
 * D1-based rate limiting — durable across Cloudflare edge isolates.
 * See server/auth/rateLimit.ts for implementation.
 */
const RL_WINDOW = 10 * 60 * 1000; // 10 minutes
const RL_REGISTER_MAX = 5;
const RL_RESEND_MAX = 3;
const RL_VERIFY_MAX = 5;
const RL_RESET_MAX = 5;
/**
 * #N6 — per-email rate limit on requestPasswordReset. The pre-existing
 * per-IP limit (RL_RESET_MAX) does nothing against an attacker rotating IPs
 * (Tor / botnet / cheap residential proxies). 3 reset emails per address per
 * 10 min is enough for legitimate retry but blocks mailbox-flooding abuse.
 */
const RL_RESET_PER_EMAIL_MAX = 3;
const RL_EMAIL_CHANGE_MAX = 3; // max email change requests per IP per window
const RL_LOGIN_IP_MAX = 20; // max login attempts per IP across all accounts
const RL_LOGIN_IP_WINDOW = 15 * 60 * 1000; // 15 minutes
/**
 * #P1-6 — TTL for one-time post-verification login tokens. Short window
 * keeps the exchange surface small; the token is single-use anyway.
 */
const LOGIN_TOKEN_TTL_SEC = 5 * 60;

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
    .query(async ({ ctx, input }) => {
      // #S-16 — rate-limit per IP. Token verification is HMAC-cheap, but
      // unrestricted requests are a fingerprinting / brute-force oracle and
      // give a way to amplify DoS via large token payloads (8KB max).
      const ip = clientIp(ctx as { headers?: Headers | null });
      const rl = await checkRateLimit(ctx.db, ip, "google_prefill", 30, RL_WINDOW);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Try again later." });
      }
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
        referralSource: z.enum(["google", "instagram", "telegram", "friends", "other"]).nullish(),
        referralNote: z.string().max(200).nullish(),
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
        // Set isSynthetic=1 so cron post-visit + future Telegram-dependent
        // jobs can explicitly skip these rows (0052 migration).
        if (input.role === "master") {
          const syntheticChatId = 10_000_000_000 + (parseInt(id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);
          await ctx.db.insert(masters).values({
            tenantId: tid,
            chatId: syntheticChatId,
            name: (input.name ?? email.split("@")[0] ?? "Master").trim(),
            active: 1,
            addedAt: now,
            // #S-01 — bind to the just-created webUser so getMyRole and
            // master-router authorization work without relying on the
            // personal-tenant fallback.
            webUserId: id,
            isSynthetic: 1,
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
          referralNote: input.referralNote ?? null,
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

      // #P1-6 — issue a one-time login token alongside the email verification.
      // The client exchanges this token (single-use, 5-minute TTL) via the
      // NextAuth credentials provider so the password never has to traverse
      // sessionStorage. The token is hashed at rest and consumed on first use.
      const loginToken = generateToken();
      const loginTokenHash = await hashToken(loginToken);
      const loginTokenExpiresAt = now + LOGIN_TOKEN_TTL_SEC;

      await ctx.db
        .update(webUsers)
        .set({
          emailVerified: 1,
          verificationToken: null,
          verificationTokenExpiresAt: null,
          loginTokenHash,
          loginTokenExpiresAt,
          updatedAt: now,
        })
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

      return { success: true, loginToken, loginTokenExpiresAt };
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
        log.error("webUsers.resendVerificationCode", new Error(sent.error ?? "email_send_failed"));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: sent.error === "resend_not_configured"
            ? "Email service not configured. Contact support."
            : "Could not send verification email. Try again later.",
        });
      }

      return { ok: true };
    }),

  /**
   * Request password reset email (public).
   *
   * Anti-enumeration: returns the same shape whether or not the email exists.
   *
   * Server config errors (Resend not configured, or configured without
   * AUTH_URL) throw — those block ALL resets, leak nothing about the user,
   * and surface in error monitoring instead of silently swallowing the request.
   *
   * Runtime Resend failures for an existing user are logged with high
   * severity (so ops see the bounce/rate-limit) but still return ok:true to
   * preserve anti-enumeration.
   */
  /**
   * #N1 — request a password reset code. Anti-enumeration: always returns
   * `ok: true`. If the email is registered, mints a 6-digit code (CSPRNG),
   * stores its SHA-256 hash with a 1h TTL, and emails the code to the user.
   * The code is what the user types into the reset form — no URL, no leakage.
   */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx as { headers?: Headers | null });
      const email = input.email.toLowerCase().trim();

      // Two rate limits, both must allow:
      //  1. per-IP: blocks single attacker on one network from spraying many emails
      //  2. per-email (#N6): blocks attacker rotating IPs (Tor / proxy farm) from
      //     hammering a single target's mailbox or burning through their reset codes
      const rlIp = await checkRateLimit(ctx.db, ip, "password_reset", RL_RESET_MAX, RL_WINDOW);
      if (!rlIp.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Try again later.",
        });
      }
      const rlEmail = await checkRateLimit(ctx.db, email, "password_reset_email", RL_RESET_PER_EMAIL_MAX, RL_WINDOW);
      if (!rlEmail.allowed) {
        // Same generic message — does not leak whether the address is registered.
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Try again later.",
        });
      }

      // Server-config gap: surface loudly. Not anti-enumeration sensitive —
      // affects every user equally and indicates ops misconfig.
      if (!isResendConfigured()) {
        log.error("webUsers.requestPasswordReset", new Error("RESEND_API_KEY/RESEND_FROM not configured — password reset disabled"));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Email service is temporarily unavailable. Please contact support.",
        });
      }

      const rows = await ctx.db
        .select({ id: webUsers.id, lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);

      if (rows.length) {
        // Mint a 6-digit code (same primitive as verifyEmail) and store its
        // SHA-256 hash. The plaintext code travels only via email; the DB
        // never holds it directly.
        const code = generateVerificationCode();
        const codeHash = await hashToken(code);
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + 3600; // 1 hour
        await ctx.db
          .update(webUsers)
          .set({
            passwordResetToken: codeHash,
            passwordResetExpiresAt: expiresAt,
            updatedAt: now,
          })
          .where(eq(webUsers.id, rows[0]!.id));

        const sent = await sendPasswordResetCodeEmail(email, code, (rows[0]!.lang ?? "en") as Lang);
        if (!sent.ok) {
          // Roll the code back so the user can retry without a phantom record.
          // Anti-enumeration: still return ok:true — but log loudly so ops
          // see runtime delivery failures (bounce, suppression list, rate limit).
          await ctx.db
            .update(webUsers)
            .set({
              passwordResetToken: null,
              passwordResetExpiresAt: null,
              updatedAt: now,
            })
            .where(eq(webUsers.id, rows[0]!.id));
          log.error("webUsers.requestPasswordReset", new Error(`resend_delivery_failed: ${sent.error ?? "unknown"}`), {
            userId: rows[0]!.id,
            // email intentionally omitted — log aggregator may persist; ops can correlate via userId
          });
        }
      }

      return { ok: true as const };
    }),

  /**
   * #N1 — complete password reset with email + 6-digit code. The code is
   * compared against the stored hash via timingSafeEqualHex; the code is
   * single-use (cleared on success) and TTL-bound to 1h.
   *
   * Anti-enumeration: the same generic error message is returned for
   *   - email not registered
   *   - code mismatch
   *   - code expired
   * so an attacker cannot tell which condition fired.
   */
  resetPassword: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        code: z.string().length(6),
        newPassword: z.string().min(12, "Минимум 12 символов"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ip = clientIp(ctx as { headers?: Headers | null });
      // Rate limit by IP to slow code-guessing across many email targets.
      const rl = await checkRateLimit(ctx.db, ip, "password_reset_complete", RL_RESET_MAX, RL_WINDOW);
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Try again later.",
        });
      }

      const email = input.email.toLowerCase().trim();
      const generic = new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid or expired reset code",
      });

      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);
      if (!rows.length) throw generic;
      const user = rows[0]!;
      if (!user.passwordResetToken) throw generic;

      const now = Math.floor(Date.now() / 1000);
      if (!user.passwordResetExpiresAt || now > user.passwordResetExpiresAt) {
        throw generic;
      }

      const inputHash = await hashToken(input.code);
      if (!timingSafeEqualHex(inputHash, user.passwordResetToken)) {
        throw generic;
      }

      const newHash = await hashPassword(input.newPassword);
      await ctx.db
        .update(webUsers)
        .set({
          passwordHash: newHash,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
          // #S8: bump password_changed_at so existing JWTs are rejected on next
          // session check (NextAuth callback compares stored value to token).
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(webUsers.id, user.id));

      await writeAudit(ctx.db, {
        actor: user.email,
        action: "auth.password.reset",
        tenantId: user.tenantId ?? null,
        detail: `userId=${user.id}`,
        ip,
      });
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
          log.error("webUsers.create", new Error(sent.error ?? "verification_email_failed"));
        }
      }
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "admin.user.create",
        tenantId: input.tenantId ?? null,
        detail: `email=${email} role=${input.role}`,
        ip: clientIp(ctx as { headers?: Headers | null }),
      });
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

  /**
   * #N1 — Request email change. Mints a 6-digit code (CSPRNG), stores its
   * SHA-256 hash with a 1h TTL, and sends the code to the NEW address. The
   * caller must have an active session (protected) so the row is identified
   * by `ctx.webUser.id` rather than by the token, narrowing the TOCTOU window.
   */
  requestEmailChange: protectedProcedure
    .input(z.object({ newEmail: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Web session required" });
      }

      // Rate limit: max 3 requests per IP per 10 minutes (prevents email flooding)
      const ip = clientIp(ctx as { headers?: Headers | null });
      const rl = await checkRateLimit(ctx.db, ip, "email_change", RL_EMAIL_CHANGE_MAX, RL_WINDOW);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests. Try again later." });
      }

      if (!isResendConfigured()) {
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

      const code = generateVerificationCode();
      const codeHash = await hashToken(code);
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + 3600; // 1 hour

      const [me] = await ctx.db
        .select({ lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);

      await ctx.db
        .update(webUsers)
        .set({
          newEmail,
          emailChangeToken: codeHash,
          emailChangeTokenExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(eq(webUsers.id, ctx.webUser.id));

      const sent = await sendEmailChangeCodeVerification(newEmail, code, newEmail, (me?.lang ?? "en") as Lang);
      if (!sent.ok) {
        await ctx.db
          .update(webUsers)
          .set({ newEmail: null, emailChangeToken: null, emailChangeTokenExpiresAt: null, updatedAt: now })
          .where(eq(webUsers.id, ctx.webUser.id));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not send verification email: ${sent.error}`,
        });
      }

      return { ok: true as const };
    }),

  /**
   * #N1 — Confirm email change with the 6-digit code from the new address.
   * The mutation is now `protectedProcedure` (requires an active session) so
   * the row is identified by `ctx.webUser.id` rather than by token lookup —
   * this closes the TOCTOU window where the legacy flow re-checked email
   * uniqueness in a separate query, then UPDATEd; concurrent confirms could
   * both pass the check. With direct id-based UPDATE, the only race is on
   * the `email` UNIQUE constraint at the DB level, which we surface as
   * CONFLICT to the caller.
   */
  confirmEmailChange: protectedProcedure
    .input(z.object({ code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Web session required" });
      }

      const ip = clientIp(ctx as { headers?: Headers | null });
      const rl = await checkRateLimit(ctx.db, ip, "email_change_confirm", RL_VERIFY_MAX, RL_WINDOW);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Try again later." });
      }

      const rows = await ctx.db
        .select()
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);
      if (!rows.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired code" });
      }
      const user = rows[0]!;
      const now = Math.floor(Date.now() / 1000);

      if (
        !user.emailChangeToken ||
        !user.emailChangeTokenExpiresAt ||
        now > user.emailChangeTokenExpiresAt ||
        !user.newEmail
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired code" });
      }

      const inputHash = await hashToken(input.code);
      if (!timingSafeEqualHex(inputHash, user.emailChangeToken)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired code" });
      }

      // Single id-scoped UPDATE. The DB-level UNIQUE INDEX
      // `idx_web_user_email` (see schema.sql line 429) catches the race where
      // the target email was claimed between requestEmailChange and confirm.
      try {
        await ctx.db
          .update(webUsers)
          .set({
            email: user.newEmail,
            newEmail: null,
            emailChangeToken: null,
            emailChangeTokenExpiresAt: null,
            // #S8: bump password_changed_at so existing JWTs are rejected on next session check.
            passwordChangedAt: now,
            updatedAt: now,
          })
          .where(eq(webUsers.id, user.id));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE|already exists|constraint/i.test(msg)) {
          throw new TRPCError({ code: "CONFLICT", message: "Email already in use" });
        }
        throw err;
      }

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
        .set({
          passwordHash: newHash,
          // #S8: bump password_changed_at so existing JWTs are rejected.
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(webUsers.email, ctx.webUser.email));

      await writeAudit(ctx.db, {
        actor: ctx.webUser.email,
        action: "auth.password.change",
        tenantId: ctx.webUser.tenantId ?? null,
        detail: `userId=${ctx.webUser.id}`,
        ip: clientIp(ctx as { headers?: Headers | null }),
      });
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
      // Independent master: also create a master record. isSynthetic=1
      // because the chatId is synthetic — see 0052 migration.
      if (webRole === "master") {
        const syntheticChatId = 10_000_000_000 + (parseInt(ctx.webUser.id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);
        await ctx.db.insert(masters).values({
          tenantId: tid,
          chatId: syntheticChatId,
          name: input.name.trim(),
          active: 1,
          addedAt: now,
          isSynthetic: 1,
        });
      }
      await ctx.db
        .update(webUsers)
        .set({ tenantId: tid, updatedAt: now })
        .where(eq(webUsers.id, ctx.webUser.id));
      await writeAudit(ctx.db, {
        actor: ctx.webUser.email,
        action: "tenant.create",
        tenantId: tid,
        detail: `role=${webRole} isPersonal=${isPersonal}`,
        ip: clientIp(ctx as { headers?: Headers | null }),
      });
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
      // NOTE: deliberately NOT bumping password_changed_at here — there was no
      // prior password, so there are no other sessions whose authentication
      // basis is invalidated by this change. Keeping the existing JWT valid
      // lets the user continue without an unnecessary force-logout (which
      // also cured a React #300 in the settings page caused by mid-render
      // session invalidation, see AccountSection.SetInitialPasswordSection).
      await ctx.db
        .update(webUsers)
        .set({ passwordHash: newHash, updatedAt: now })
        .where(eq(webUsers.id, ctx.webUser.id));
      await writeAudit(ctx.db, {
        actor: ctx.webUser.email,
        action: "auth.password.set_initial",
        tenantId: ctx.webUser.tenantId ?? null,
        detail: `userId=${ctx.webUser.id}`,
        ip: clientIp(ctx as { headers?: Headers | null }),
      });
      return { success: true };
    }),
});
