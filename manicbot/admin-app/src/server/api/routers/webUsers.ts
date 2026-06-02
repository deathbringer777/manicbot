import { z } from "zod";
import { createTRPCRouter, publicProcedure, protectedProcedure, adminProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { webUsers, auditLog, tenants, masters, tenantConfig, tenantRoles, masterInvitations, googlePrefillConsumed } from "~/server/db/schema";
import type { Lang } from "~/lib/i18n";
import { and, eq } from "drizzle-orm";
import { assertTenantMember } from "~/server/api/tenantAccess";
import { verifyPassword, hashPassword } from "~/server/auth/password";
import { generateToken, hashToken, timingSafeEqualHex } from "~/server/auth/tokens";
import { requireOtpConfirmation, requestActionOtp } from "~/server/auth/otp";
import { verifyGooglePrefillToken } from "~/server/auth/googlePrefillToken";
import { listPendingInvitationsForEmail } from "~/server/auth/pendingInvitations";
import { authPublicBaseUrl } from "~/server/auth/authBaseUrl";
import { isResendConfigured } from "~/server/email/resend";
import {
  sendVerificationEmail,
  sendVerificationCodeEmail,
  sendPasswordResetCodeEmail,
  sendWelcomeEmail,
  sendActionOtpEmail,
} from "~/server/email/emailService";

import { checkRateLimit } from "~/server/auth/rateLimit";
import { log } from "~/server/utils/logger";
import { writeAudit } from "~/server/security/audit";
import { isSafeDisplayName } from "~/server/security/sanitize";
import { recordEvent, ANALYTICS_EVENTS } from "~/server/services/recordEvent";
import { linkMasterPlaceholderToWebUserFireAndForget } from "~/server/messenger/linkMasterPlaceholder";
import { addMasterToDefaultGroup } from "~/server/messenger/defaultStaffGroup";

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

/**
 * Localized action label shown in the body of the email-change OTP message
 * (the shared sendActionOtpEmail template renders it). Kept tiny + local — the
 * email-change flow is the only server-side issuer of this code.
 */
const CHANGE_EMAIL_OTP_LABEL: Record<Lang, string> = {
  ru: "Смена email",
  ua: "Зміна email",
  en: "Email change",
  pl: "Zmiana adresu e-mail",
};
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
        // Blocker 4 — reject names that contain HTML metacharacters, CRLF,
        // leading RTL override, control bytes, or zero-width characters
        // before they reach the DB or any email template. See
        // `~/server/security/sanitize.ts` for the predicate; the
        // localized failure key is `auth.errors.nameContainsForbiddenChars`.
        name: z
          .string()
          .max(200)
          .nullish()
          .refine((v) => v == null || v === "" || isSafeDisplayName(v), {
            message: "auth.errors.nameContainsForbiddenChars",
          }),
        lang: z.enum(["ru", "ua", "en", "pl"]).default("en"),
        referralSource: z.enum(["google", "instagram", "telegram", "friends", "other"]).nullish(),
        referralNote: z.string().max(200).nullish(),
        // Optional referral code redeemed via /register?ref=XXXX or the
        // "Friends" flow. Server-side validation is loose: a malformed/expired/
        // self-referral code logs + continues — registration must never fail
        // because of a bad code.
        referralCode: z.string().regex(/^[A-Z0-9-]{6,16}$/, "Invalid code format").nullish(),
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
        // #P0-1 (2026-05-24 audit) — atomic single-use claim on the prefill
        // token's jti. INSERT OR IGNORE returns an empty rowset when the jti
        // already exists, which means the token was already consumed (within
        // the 15-min TTL). Reject with the same error string as an
        // invalid/expired token so an attacker can't distinguish replay
        // from expiry.
        const claim = await ctx.db
          .insert(googlePrefillConsumed)
          .values({
            jti: payload.jti,
            email: payload.email,
            consumedAt: Math.floor(Date.now() / 1000),
            exp: payload.exp,
          })
          .onConflictDoNothing()
          .returning({ jti: googlePrefillConsumed.jti });
        if (claim.length === 0) {
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
          // P1-9 — rolling-window: write the hash to both columns. The legacy
          // column will be nulled in a follow-up migration once verifyEmail
          // never falls back to it.
          verificationToken: skipEmailVerification ? null : verificationCodeHash,
          verificationTokenHash: skipEmailVerification ? null : verificationCodeHash,
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

      // Redeem the code AFTER everything else succeeds. Fail-open: a bad code
      // logs but never blocks signup. An admin "service" grant code (reserved
      // SVC- prefix) is routed to the one-time subscription-grant flow; any
      // other code is treated as a peer referral. Both share this one field.
      if (input.referralCode && assignedTenantId) {
        try {
          const grants = await import("~/server/api/routers/subscriptionGrantCodes");
          if (grants.isGrantCode(input.referralCode)) {
            const g = await grants.redeemGrantCodeAtRegistration(ctx.db, {
              code: input.referralCode,
              tenantId: assignedTenantId,
              webUserId: id,
              actor: email,
            });
            if (!g.ok) {
              // Log only the non-secret prefix — never the full plaintext code.
              log.info(`webUsers.register: grant code redemption rejected (${g.reason})`, { codePrefix: input.referralCode.slice(0, 7) });
            }
          } else {
            const { recordRedemption } = await import("~/server/api/routers/referrals");
            const r = await recordRedemption(ctx.db, {
              code: input.referralCode,
              inviteeWebUserId: id,
              inviteeTenantId: assignedTenantId,
            });
            if (!r.ok) {
              log.info(`webUsers.register: referral code redemption rejected (${r.reason})`, { code: input.referralCode });
            }
          }
        } catch (err: unknown) {
          log.error("webUsers.register: code redemption threw", err instanceof Error ? err : new Error(String(err)));
        }
      }

      // Blocker 5 — fire signup analytics (fire-and-forget; failure never
      // blocks the user-visible flow). We fire BOTH signup.started AND
      // signup.completed here because we don't have a separate /register
      // page-view event yet. Once the analytics layer is wired into the
      // client too, we can split them.
      void recordEvent({
        db: ctx.db,
        event: ANALYTICS_EVENTS.SIGNUP_STARTED,
        userId: id,
        properties: {
          role: input.role,
          lang: input.lang,
          via_google: googleVerified,
          referral_source: input.referralSource ?? null,
          had_referral_code: !!input.referralCode,
        },
      });
      if (skipEmailVerification) {
        void recordEvent({
          db: ctx.db,
          event: ANALYTICS_EVENTS.SIGNUP_COMPLETED,
          userId: id,
          properties: { role: input.role, lang: input.lang, via_google: true },
        });
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

      // P1-9 — prefer the hash-named column; fall back to the legacy column
      // for tokens minted before migration 0053. Both store SHA-256 hex.
      const storedHash = user.verificationTokenHash ?? user.verificationToken;
      if (!storedHash) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No verification code pending. Request a new one." });
      }

      const now = Math.floor(Date.now() / 1000);
      if (user.verificationTokenExpiresAt && now > user.verificationTokenExpiresAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Verification code expired. Request a new one." });
      }

      // Verification token is stored as a SHA-256 hash; hash the user input and compare.
      const inputHash = await hashToken(input.code);
      if (!timingSafeEqualHex(inputHash, storedHash)) {
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
          // P1-9 — clear BOTH columns so the next read can't accidentally
          // see a half-consumed token via the legacy path.
          verificationToken: null,
          verificationTokenHash: null,
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

      // Blocker 5 — fire signup.email_verified + signup.completed events.
      void recordEvent({
        db: ctx.db,
        event: ANALYTICS_EVENTS.SIGNUP_EMAIL_VERIFIED,
        userId: user.id,
        properties: { role: user.role, lang: user.lang ?? "en" },
      });
      void recordEvent({
        db: ctx.db,
        event: ANALYTICS_EVENTS.SIGNUP_COMPLETED,
        userId: user.id,
        properties: { role: user.role, lang: user.lang ?? "en" },
      });

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
        .set({
          // P1-9 — rolling-window write.
          verificationToken: newCodeHash,
          verificationTokenHash: newCodeHash,
          verificationTokenExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(eq(webUsers.id, user.id));

      const sent = await sendVerificationCodeEmail(email, newCode, (user.lang ?? "en") as Lang);
      if (!sent.ok) {
        // Roll back token so the user can retry cleanly (no phantom code in DB)
        try {
          await ctx.db
            .update(webUsers)
            .set({
              verificationToken: null,
              verificationTokenHash: null,
              verificationTokenExpiresAt: null,
              updatedAt: now,
            })
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
            // P1-9 — rolling-window write.
            passwordResetToken: codeHash,
            passwordResetTokenHash: codeHash,
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
              passwordResetTokenHash: null,
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
      // P1-9 — prefer the hash-named column; legacy column kept for rolling
      // window only.
      const storedHash = user.passwordResetTokenHash ?? user.passwordResetToken;
      if (!storedHash) throw generic;

      const now = Math.floor(Date.now() / 1000);
      if (!user.passwordResetExpiresAt || now > user.passwordResetExpiresAt) {
        throw generic;
      }

      const inputHash = await hashToken(input.code);
      if (!timingSafeEqualHex(inputHash, storedHash)) {
        throw generic;
      }

      const newHash = await hashPassword(input.newPassword);
      await ctx.db
        .update(webUsers)
        .set({
          passwordHash: newHash,
          // P1-9 — clear BOTH columns on consume.
          passwordResetToken: null,
          passwordResetTokenHash: null,
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
        // P1-9 — rolling-window write.
        verificationToken: verificationCodeHash,
        verificationTokenHash: verificationCodeHash,
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
   * Request an email change. Issues a single 6-digit OTP via the shared
   * global_otp_codes framework (action "change_email", bound to the target
   * address) and emails it to the user's CURRENT account address — the same
   * step-up mechanism used for password and role changes, so there is no
   * second bespoke email-code system.
   *
   * The new address is NOT persisted here: the code's payload hash binds it,
   * and the client re-sends `newEmail` at confirm time where the binding is
   * verified. A hijacked session alone cannot complete the change without
   * access to the registered mailbox.
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

      const [me] = await ctx.db
        .select({ lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);
      const lang = (me?.lang ?? "en") as Lang;

      // Issue the OTP bound to the target address; send the code to the CURRENT
      // account email so identity is proven before the address is switched.
      const { code } = await requestActionOtp({
        db: ctx.db,
        webUserId: ctx.webUser.id,
        action: "change_email",
        payload: { newEmail },
      });

      const sent = await sendActionOtpEmail(
        ctx.webUser.email,
        code,
        CHANGE_EMAIL_OTP_LABEL[lang] ?? CHANGE_EMAIL_OTP_LABEL.en,
        lang,
      );
      if (!sent.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Could not send verification email: ${sent.error}`,
        });
      }

      return { ok: true as const };
    }),

  /**
   * Confirm an email change. Verifies the single 6-digit OTP (emailed to the
   * CURRENT address, action "change_email") via the shared framework, then
   * swaps the address. The OTP payload binds the code to `newEmail`, so the
   * caller MUST re-send the exact address the code was issued for — a wrong or
   * substituted address has no matching code. `protectedProcedure` identifies
   * the row by `ctx.webUser.id`; the DB-level UNIQUE index on `email` catches
   * the race where the target was claimed between request and confirm.
   */
  confirmEmailChange: protectedProcedure
    .input(z.object({
      // Re-sent so the OTP's payload binding can be verified server-side; a
      // mismatch against the issued code surfaces as PRECONDITION_FAILED.
      newEmail: z.string().email(),
      otpCode: z.string().length(6),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Web session required" });
      }

      const ip = clientIp(ctx as { headers?: Headers | null });
      const rl = await checkRateLimit(ctx.db, ip, "email_change_confirm", RL_VERIFY_MAX, RL_WINDOW);
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Try again later." });
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

      // Verify the current-address OTP, bound to this exact target address.
      // Throws PRECONDITION_FAILED (otp_required / otp_invalid / otp_expired /
      // otp_exhausted) on any mismatch — single-use, timing-safe, attempt-capped.
      await requireOtpConfirmation({
        db: ctx.db,
        webUserId: ctx.webUser.id,
        action: "change_email",
        payload: { newEmail },
        code: input.otpCode,
      });

      const now = Math.floor(Date.now() / 1000);
      // Single id-scoped UPDATE. The DB-level UNIQUE INDEX `idx_web_user_email`
      // catches the race where the target email was claimed after the OTP issue.
      try {
        await ctx.db
          .update(webUsers)
          .set({
            email: newEmail,
            // #S8: bump password_changed_at so existing JWTs are rejected on next session check.
            passwordChangedAt: now,
            updatedAt: now,
          })
          .where(eq(webUsers.id, ctx.webUser.id));
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
        // Sensitive-action OTP — 6-digit code emailed to the current account
        // address (issued client-side via otp.request, action change_password).
        otpCode: z.string().length(6),
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

      // Confirm with the one-time code emailed to the current account address.
      // Verified before any password work so a hijacked session alone — without
      // access to the registered mailbox — cannot rotate the password.
      await requireOtpConfirmation({
        db: ctx.db,
        webUserId: ctx.webUser.id,
        action: "change_password",
        payload: {},
        code: input.otpCode,
      });

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

  /**
   * Read the caller's UI prefs (sidebar layout, pinned tabs, etc.) for a given
   * tenant. Stored as JSON in `tenant_config[ui_prefs:user:{webUserId}]`. The
   * read path is client-tolerant: if the row is missing or malformed, we
   * return an empty object so the caller's defaults apply.
   *
   * Per-tenant scoping (rather than global on `web_users`) is deliberate:
   * the same user can be a tenant_owner in one salon and a master in another,
   * and they should be able to keep different layouts in each.
   */
  getMyUiPrefs: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.webUser) return {};
      // Tenant-membership guard: a user from tenant A must not be able to
      // probe tenant B's config table. assertTenantMember throws on mismatch.
      await assertTenantMember(ctx, input.tenantId);
      const key = `ui_prefs:user:${ctx.webUser.id}`;
      const [row] = await ctx.db
        .select({ value: tenantConfig.value })
        .from(tenantConfig)
        .where(and(eq(tenantConfig.tenantId, input.tenantId), eq(tenantConfig.key, key)))
        .limit(1);
      if (!row?.value) return {};
      try {
        const parsed = JSON.parse(row.value);
        return (parsed && typeof parsed === "object") ? parsed : {};
      } catch {
        return {};
      }
    }),

  /**
   * Write the caller's UI prefs for a given tenant. The full object is sent —
   * we don't merge partials server-side because the client owns the schema
   * (extending the shape doesn't require a backend deploy). Validate only the
   * outer shape and a max byte budget so a bug client-side can't fill the row.
   */
  setMyUiPrefs: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      prefs: z.record(z.unknown()),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      // Tenant-membership guard: writes must target a tenant the caller
      // belongs to. Without this, any logged-in user could spam tenant_config
      // rows in any tenant.
      await assertTenantMember(ctx, input.tenantId);
      const serialized = JSON.stringify(input.prefs);
      if (serialized.length > 8 * 1024) {
        // 8 KB hard cap; the sidebar prefs payload is < 1 KB in practice.
        throw new TRPCError({ code: "BAD_REQUEST", message: "UI prefs payload too large" });
      }
      const key = `ui_prefs:user:${ctx.webUser.id}`;
      // UPSERT — tenant_config has a unique constraint on (tenant_id, key).
      await ctx.db
        .insert(tenantConfig)
        .values({ tenantId: input.tenantId, key, value: serialized })
        .onConflictDoUpdate({
          target: [tenantConfig.tenantId, tenantConfig.key],
          set: { value: serialized },
        });
      return { ok: true as const };
    }),

  // ─── Master invitations (migration 0063) ────────────────────────────────

  /**
   * Public preview for the /register?invite=<token> page. Returns the
   * invitation email (so the register form can pre-fill + lock) and salon
   * name (banner) WITHOUT requiring authentication. Token must hash to a
   * pending row and not be expired.
   *
   * Rate-limited by token-prefix-hash to prevent enumeration. We don't reveal
   * existence vs invalid — both paths return null.
   */
  getInvitationPreview: publicProcedure
    .input(z.object({ token: z.string().min(8).max(200) }))
    .query(async ({ ctx, input }) => {
      const tokenHash = await hashToken(input.token);
      const now = Math.floor(Date.now() / 1000);
      const rows = await ctx.db
        .select({
          id: masterInvitations.id,
          email: masterInvitations.email,
          tenantId: masterInvitations.tenantId,
          tokenExpiresAt: masterInvitations.tokenExpiresAt,
          status: masterInvitations.status,
          scenario: masterInvitations.scenario,
        })
        .from(masterInvitations)
        .where(eq(masterInvitations.tokenHash, tokenHash))
        .limit(1);
      const inv = rows[0];
      if (!inv || inv.status !== "pending" || inv.scenario !== "new_user" || inv.tokenExpiresAt < now) {
        return null;
      }
      const tenantRow = await ctx.db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, inv.tenantId))
        .limit(1);
      return {
        email: inv.email,
        salonName: tenantRow[0]?.name ?? "ManicBot",
      };
    }),

  /**
   * myPendingInvitations — pending master invitations addressed to the
   * caller's own email (case-insensitive), non-expired. Drives the sidebar
   * "Invitations" section + its count badge, and is invalidated alongside
   * the bell after an invite is accepted. Scoped by recipient email, so it
   * is safe behind a plain protectedProcedure (not tenant data).
   */
  myPendingInvitations: protectedProcedure.query(async ({ ctx }) => {
    return listPendingInvitationsForEmail(ctx.db, { email: ctx.webUser?.email ?? null });
  }),

  /**
   * Scenario A — accept an existing-user invitation. The caller is already
   * logged in; their session email must match the invitation email. On
   * success, creates a `masters` row (origin='invited_email') bound to the
   * existing web_user, inserts a tenant_roles row, and marks the invitation
   * accepted.
   */
  acceptInvitationExistingUser: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const caller = ctx.webUser;
      if (!caller?.email) throw new TRPCError({ code: "UNAUTHORIZED" });

      const now = Math.floor(Date.now() / 1000);
      const rows = await ctx.db
        .select({
          id: masterInvitations.id,
          tenantId: masterInvitations.tenantId,
          email: masterInvitations.email,
          status: masterInvitations.status,
          tokenExpiresAt: masterInvitations.tokenExpiresAt,
        })
        // tenant-scan-ignore: invitation fetched by id; authorized by the caller-email === invitation-email check below.
        .from(masterInvitations)
        .where(eq(masterInvitations.id, input.invitationId))
        .limit(1);
      const inv = rows[0];
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "invitation_not_found" });
      if (inv.status !== "pending") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "invitation_not_pending" });
      }
      if (inv.tokenExpiresAt < now) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "invitation_expired" });
      }
      if (caller.email.toLowerCase() !== inv.email.toLowerCase()) {
        // Don't leak the invitation target — generic mismatch.
        throw new TRPCError({ code: "FORBIDDEN", message: "email_mismatch" });
      }

      // Synthetic chatId (same convention as createMasterAccount).
      const syntheticChatId =
        10_000_000_000 + (parseInt(caller.id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);

      // Insert masters row; tolerate the case where the caller is already a
      // master of this tenant by surfacing CONFLICT.
      try {
        await ctx.db.insert(masters).values({
          tenantId: inv.tenantId,
          chatId: syntheticChatId,
          name: caller.email.split("@")[0]!.slice(0, 200),
          active: 1,
          addedAt: now,
          webUserId: caller.id,
          isSynthetic: 1,
          origin: "invited_email",
        });
      } catch (e) {
        const msg = String((e as Error)?.message ?? "");
        if (/UNIQUE constraint failed/i.test(msg)) {
          // Already a master — mark invitation accepted anyway and return.
        } else {
          throw e;
        }
      }

      await ctx.db
        .insert(tenantRoles)
        .values({ tenantId: inv.tenantId, chatId: syntheticChatId, role: "master", createdAt: now })
        .onConflictDoUpdate({
          target: [tenantRoles.tenantId, tenantRoles.chatId],
          set: { role: "master", createdAt: now },
        });

      await ctx.db
        .update(masterInvitations)
        .set({ status: "accepted", acceptedAt: now, acceptedMasterId: syntheticChatId })
        .where(and(eq(masterInvitations.id, inv.id), eq(masterInvitations.tenantId, inv.tenantId)));

      // Make the just-joined salon the caller's ACTIVE tenant so accepting
      // actually lands them in it (multi-tenant switcher; migration 0097).
      // The next session refresh resolves (tenantId, role) = (inv.tenantId,
      // master) via resolveActiveMembership; the accept page calls
      // useSession().update() to trigger that refresh. Without this the rows
      // existed but an owner stayed on their own salon — the end-to-end gap.
      await ctx.db
        .update(webUsers)
        .set({ activeTenantId: inv.tenantId })
        .where(eq(webUsers.id, caller.id));

      await writeAudit(ctx.db, {
        actor: caller.email,
        action: "tenant.master.invite.accept_existing",
        tenantId: inv.tenantId,
        detail: `invitationId=${inv.id} masterChatId=${syntheticChatId}`,
        ip: clientIp(ctx as { headers?: Headers | null }),
      });

      // Fire-and-forget: backfill any placeholder messenger threads that
      // the salon owner opened with this master BEFORE the invite was
      // accepted. Failure must NOT abort the accept flow — the master
      // would otherwise be stuck unable to confirm membership.
      void linkMasterPlaceholderToWebUserFireAndForget(ctx.db, {
        tenantId: inv.tenantId,
        masterChatId: syntheticChatId,
        webUserId: caller.id,
      });
      // 0093: auto-add to the salon's default "Команда" group. Fire-and-
      // forget like the placeholder backfill above.
      void addMasterToDefaultGroup(ctx.db, inv.tenantId, syntheticChatId);

      return { tenantId: inv.tenantId, masterChatId: syntheticChatId };
    }),

  /**
   * Scenario B — accept a new-user invitation by token. Public procedure (the
   * caller is registering, has no session yet). Creates a fresh web_user
   * (role=master, email_verified=1 since the token IS the verification),
   * masters row, tenant_roles row, and returns a one-time loginToken so the
   * UI can auto-log in.
   *
   * Does NOT create a personal tenant — the invited master joins the
   * inviter's tenant only.
   */
  // nosemgrep: trpc-public-procedure-mutation -- token-validated public flow (no session by design, rate-limited)
  acceptInvitationByToken: publicProcedure
    .input(z.object({
      token: z.string().min(8).max(200),
      password: z.string().min(12).max(200),
      name: z.string().min(1).max(200),
      lang: z.enum(["ru", "ua", "en", "pl"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const tokenHash = await hashToken(input.token);
      const now = Math.floor(Date.now() / 1000);
      const rows = await ctx.db
        .select({
          id: masterInvitations.id,
          tenantId: masterInvitations.tenantId,
          email: masterInvitations.email,
          status: masterInvitations.status,
          tokenExpiresAt: masterInvitations.tokenExpiresAt,
          scenario: masterInvitations.scenario,
        })
        .from(masterInvitations)
        .where(eq(masterInvitations.tokenHash, tokenHash))
        .limit(1);
      const inv = rows[0];
      if (!inv || inv.status !== "pending" || inv.scenario !== "new_user" || inv.tokenExpiresAt < now) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "invitation_invalid" });
      }

      // Reject if a web_user already exists for that email — the invite
      // scenario was set at send time, so a race (someone registered between
      // send + accept) is a clear PRECONDITION_FAILED. The salon owner needs
      // to revoke + resend, which will pick existing_user.
      const existing = await ctx.db
        .select({ id: webUsers.id })
        .from(webUsers)
        .where(eq(webUsers.email, inv.email))
        .limit(1);
      if (existing.length) {
        throw new TRPCError({ code: "CONFLICT", message: "email_already_registered" });
      }

      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(input.password);
      const syntheticChatId =
        10_000_000_000 + (parseInt(id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);

      await ctx.db.insert(webUsers).values({
        id,
        email: inv.email,
        passwordHash,
        // No passwordEncrypted: this user owns their own password.
        role: "master",
        tenantId: inv.tenantId,
        name: input.name,
        lang: input.lang ?? "en",
        emailVerified: 1, // token IS the verification — invite-only flow.
        tosAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.insert(masters).values({
        tenantId: inv.tenantId,
        chatId: syntheticChatId,
        name: input.name,
        active: 1,
        addedAt: now,
        webUserId: id,
        isSynthetic: 1,
        origin: "invited_email",
      });

      await ctx.db
        .insert(tenantRoles)
        .values({ tenantId: inv.tenantId, chatId: syntheticChatId, role: "master", createdAt: now })
        .onConflictDoUpdate({
          target: [tenantRoles.tenantId, tenantRoles.chatId],
          set: { role: "master", createdAt: now },
        });

      await ctx.db
        .update(masterInvitations)
        .set({ status: "accepted", acceptedAt: now, acceptedMasterId: syntheticChatId })
        .where(and(eq(masterInvitations.id, inv.id), eq(masterInvitations.tenantId, inv.tenantId)));

      // Mint a one-time login token (mirror existing post-verify flow).
      const loginToken = generateToken();
      const loginTokenHash = await hashToken(loginToken);
      await ctx.db
        .update(webUsers)
        .set({
          loginTokenHash,
          loginTokenExpiresAt: now + 5 * 60, // 5-min one-shot
        })
        .where(eq(webUsers.id, id));

      await writeAudit(ctx.db, {
        actor: inv.email,
        action: "tenant.master.invite.accept_new",
        tenantId: inv.tenantId,
        detail: `invitationId=${inv.id} masterChatId=${syntheticChatId} webUserId=${id}`,
        ip: clientIp(ctx as { headers?: Headers | null }),
      });

      // Fire-and-forget: this Scenario B path is "fresh user registers" so
      // a placeholder thread is extremely unlikely (the owner couldn't have
      // started one — there was no masters row yet). Calling the helper is
      // still cheap (one SELECT returning zero rows), and it cleans up the
      // weird edge where someone races invite_telegram + invite_email.
      void linkMasterPlaceholderToWebUserFireAndForget(ctx.db, {
        tenantId: inv.tenantId,
        masterChatId: syntheticChatId,
        webUserId: id,
      });
      // 0093: auto-add to the salon's default "Команда" group.
      void addMasterToDefaultGroup(ctx.db, inv.tenantId, syntheticChatId);

      return { loginToken, tenantId: inv.tenantId };
    }),
});
