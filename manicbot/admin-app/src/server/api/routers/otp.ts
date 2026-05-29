/**
 * OTP router — issues fresh confirmation codes for destructive / role-escalation
 * mutations. Verification happens inline inside each gated mutation via
 * `requireOtpConfirmation` (server/auth/otp.ts); this router only handles the
 * issuance + email step.
 *
 * Whitelisted actions (`action` field) — anything outside this set is refused
 * so a misbehaving client cannot spam OTP emails for arbitrary names.
 *
 * Rate-limit: 5 issuances per 10 min per web_user_id (per action). Caller emails
 * are routed through the existing Resend transport.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkRateLimit } from "~/server/auth/rateLimit";
import { requestActionOtp } from "~/server/auth/otp";
import { sendActionOtpEmail } from "~/server/email/emailService";
import { log } from "~/server/utils/logger";
import { webUsers } from "~/server/db/schema";
import type { Lang } from "~/lib/i18n";

const ACTION_WHITELIST = [
  "archive_master",
  "unarchive_master",
  "reset_master_password",
  "peek_master_password",
  // Self-service sensitive-account changes. The code is emailed to the actor's
  // OWN (current) account address — see otp.request below, which always sends
  // to ctx.webUser.email — so a session-hijacker still cannot complete the
  // change without access to the registered mailbox.
  "change_password",
  "change_email",
  "change_role",
] as const;

type WhitelistedAction = (typeof ACTION_WHITELIST)[number];

const requestInput = z.object({
  action: z.enum(ACTION_WHITELIST),
  /** Arbitrary JSON-serializable params for the action — payload is hashed,
   *  binds the code to a specific operation. Caller MUST pass the exact same
   *  payload when verifying. */
  payload: z.unknown(),
  /** Localized action summary shown in the email body, e.g. "Archive master
   *  Olga". Capped at 200 chars; HTML stripped client-side too. */
  actionLabel: z.string().min(1).max(200),
});

const RL_MAX = 5;
const RL_WINDOW_MS = 10 * 60 * 1000;

export const otpRouter = createTRPCRouter({
  /**
   * Issue a fresh 6-digit OTP for (web_user_id, action, payload). Hashes are
   * stored in `global_otp_codes`; the plain code is emailed to the caller's
   * own email and returned only as a tracking id.
   *
   * The action is whitelisted to a small set of destructive/role-escalation
   * operations (see ACTION_WHITELIST). Adding new actions requires both a
   * caller (gated tRPC mutation) and an entry here so we don't let arbitrary
   * client-supplied labels trigger emails.
   */
  request: protectedProcedure
    .input(requestInput)
    .mutation(async ({ ctx, input }) => {
      const webUser = ctx.webUser;
      if (!webUser?.email) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "missing_email",
        });
      }

      const rl = await checkRateLimit(
        ctx.db,
        `otp:${webUser.id}:${input.action}`,
        "otp_request",
        RL_MAX,
        RL_WINDOW_MS,
      );
      if (!rl.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "rate_limited",
        });
      }

      const { otpId, code } = await requestActionOtp({
        db: ctx.db,
        webUserId: webUser.id,
        action: input.action as WhitelistedAction,
        payload: input.payload,
      });

      // Resolve the actor's preferred language from web_users.lang. The tRPC
      // ctx only carries identity fields; lang lives in D1.
      const userRows = await ctx.db
        .select({ lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.id, webUser.id))
        .limit(1);
      const lang = ((userRows[0]?.lang as Lang | null) ?? "en") as Lang;

      // Fire-and-forget email — failure to send is logged but does not block
      // the user from re-requesting (rate-limited above). The code is already
      // written to D1, so a retry on the request side would issue a fresh code.
      void sendActionOtpEmail(webUser.email, code, input.actionLabel, lang).catch(
        (e) =>
          log.error(
            "otp.send",
            e instanceof Error ? e : new Error(String(e)),
            { action: input.action },
          ),
      );

      // `sentTo` lets the UI display the authoritative recipient address.
      // Some surfaces (master detail modal) render mixed identities — the
      // master's synthetic salon.manicbot.local email lives in props, but
      // the OTP went to the CALLER (the salon owner). Without this field
      // the UI had to guess and showed the wrong address.
      return { otpId, sentTo: webUser.email };
    }),
});
