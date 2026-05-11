import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { eq, and, gte } from "drizzle-orm";
import { getDb } from "~/server/db";
import { webUsers, auditLog } from "~/server/db/schema";
import { verifyPassword, hashPassword, needsRehash } from "./password";
import { signGooglePrefillToken } from "./googlePrefillToken";
import { authPublicBaseUrl } from "./authBaseUrl";
import { hashToken, timingSafeEqualHex } from "./tokens";
import { isResendConfigured } from "~/server/email/resend";
import { sendLoginAlert } from "~/server/email/emailService";
import { checkRateLimit } from "./rateLimit";
import { log } from "~/server/utils/logger";

export { authPublicBaseUrl };

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60; // 15 minutes

function getClientIp(headers: Headers | null | undefined): string {
  return (
    headers?.get("cf-connecting-ip") ??
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Coarse-grain an IP address to a /24 prefix for rate-limit bucketing.
 * - IPv4 `1.2.3.4`     → `1.2.3.0/24`
 * - IPv6 (any)         → the whole address (already opaque enough; an attacker
 *                        on a /48 cellular block can rotate enough sub-prefixes
 *                        to evade — but the per-email and per-IP login limits
 *                        in front are the primary defence)
 * - unknown / malformed → the literal input (still buckets per-attacker)
 *
 * Exported for the rate-limit dedup test.
 */
export function ipv4Slash24(ip: string): string {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (!m) return ip;
  return `${m[1]}.${m[2]}.${m[3]}.0/24`;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      tenantId: string | null;
      webRole: string;
      isEmailVerified: boolean;
    };
  }
  interface User {
    tenantId?: string | null;
    webRole?: string;
    isEmailVerified?: boolean;
  }
}

/** Local type helper for JWT token with custom fields (next-auth v5 beta doesn't export JWT for augmentation). */
type ExtendedJWT = {
  tenantId?: string | null;
  webRole?: string;
  emailVerified?: boolean;
  /** #S8: snapshot of web_users.password_changed_at at JWT issue time. */
  passwordChangedAt?: number;
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // #P1-6 — one-time post-verification login token. Mutually exclusive
        // with `password`: when present, we look it up against
        // web_users.login_token_hash and consume on first use. Replaces the
        // pre-existing sessionStorage password stash on the verify-email
        // page so the password never lives in JS-accessible storage.
        loginToken: { label: "LoginToken", type: "text" },
      },
      async authorize(credentials, request) {
        const parsed = z
          .object({
            email: z.string().email(),
            password: z.string().min(1).optional(),
            loginToken: z.string().min(1).optional(),
          })
          .refine((d) => !!d.password || !!d.loginToken, { message: "password or loginToken required" })
          .safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase().trim();
        const db = getDb();
        const ip = getClientIp(request?.headers);
        const now = Math.floor(Date.now() / 1000);

        // #P1-6 — login-token branch: single-use, 5-minute TTL token issued
        // by webUsers.verifyEmail. Looked up by SHA-256(token), checked for
        // expiry, then consumed atomically (clear hash + expires_at).
        if (parsed.data.loginToken) {
          const tokenHash = await hashToken(parsed.data.loginToken);
          const tRows = await db
            .select()
            .from(webUsers)
            .where(and(
              eq(webUsers.email, email),
              eq(webUsers.loginTokenHash, tokenHash),
              gte(webUsers.loginTokenExpiresAt, now),
            ))
            .limit(1);
          const tUser = tRows[0];
          if (!tUser) {
            try {
              await db.insert(auditLog).values({
                tenantId: null,
                actor: email,
                action: "login_failed",
                detail: JSON.stringify({ reason: "bad_login_token" }),
                ip,
                createdAt: now,
              });
            } catch { /* non-critical */ }
            return null;
          }
          // Defence-in-depth: constant-time hash compare even though the
          // SQL eq() already enforced equality. Costs nothing in practice
          // and preserves the contract documented on hashToken.
          if (!timingSafeEqualHex(tokenHash, tUser.loginTokenHash ?? "")) return null;
          // Single-use: consume immediately so a replay can't reuse the
          // same token if intercepted.
          try {
            await db
              .update(webUsers)
              .set({
                loginTokenHash: null,
                loginTokenExpiresAt: null,
                lastLoginIp: ip,
                lastLoginAt: now,
                updatedAt: now,
              })
              .where(eq(webUsers.id, tUser.id));
          } catch { /* non-critical */ }
          return {
            id: tUser.id,
            email: tUser.email,
            tenantId: tUser.tenantId ?? null,
            webRole: tUser.role,
            isEmailVerified: !!tUser.emailVerified,
          };
        }

        // From here on we are in the password branch. The refined parser
        // guarantees `password` is set when `loginToken` is not, but TS
        // sees it as optional — assert and bail out defensively.
        const passwordInput = parsed.data.password;
        if (!passwordInput) return null;

        // IP-based rate limiting (D1-backed) — blocks credential stuffing across accounts
        const ipRl = await checkRateLimit(db, ip, "login", 20, 15 * 60 * 1000);
        if (!ipRl.allowed) {
          throw new Error("Too many login attempts from this address. Try again later.");
        }

        const rows = await db
          .select()
          .from(webUsers)
          .where(eq(webUsers.email, email))
          .limit(1);

        const user = rows[0];

        // Unknown email or no password set — log attempt, return null
        if (!user?.passwordHash || user.passwordHash === "") {
          try {
            await db.insert(auditLog).values({
              tenantId: null,
              actor: email,
              action: "login_failed",
              detail: JSON.stringify({ reason: "user_not_found" }),
              ip,
              createdAt: now,
            });
          } catch { /* non-critical */ }
          return null;
        }

        // Lockout check
        if (user.lockedUntil && now < user.lockedUntil) {
          const minutesLeft = Math.ceil((user.lockedUntil - now) / 60);
          throw new Error(
            `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
          );
        }

        const valid = await verifyPassword(passwordInput, user.passwordHash);

        if (!valid) {
          const newAttempts = (user.loginAttempts ?? 0) + 1;
          const shouldLock = newAttempts >= LOGIN_MAX_ATTEMPTS;
          try {
            await db
              .update(webUsers)
              .set({
                loginAttempts: newAttempts,
                lockedUntil: shouldLock ? now + LOGIN_LOCKOUT_SECONDS : null,
                updatedAt: now,
              })
              .where(eq(webUsers.id, user.id));
          } catch (e) { log.error("auth.loginAttempts", e instanceof Error ? e : new Error(String(e))); }
          try {
            await db.insert(auditLog).values({
              tenantId: user.tenantId ?? null,
              actor: email,
              action: "login_failed",
              detail: JSON.stringify({ reason: "bad_password", attempts: newAttempts, locked: shouldLock }),
              ip,
              createdAt: now,
            });
          } catch { /* non-critical */ }
          return null;
        }

        // Allow unverified email users to log in — gated in dashboard layout
        // Success — reset lockout counter + track IP for login alerts.
        // If the stored hash uses legacy iterations, transparently upgrade to current params.
        let newPasswordHash: string | null = null;
        if (needsRehash(user.passwordHash)) {
          try {
            newPasswordHash = await hashPassword(passwordInput);
          } catch { /* non-critical — continue with old hash */ }
        }
        try {
          await db
            .update(webUsers)
            .set({
              loginAttempts: 0,
              lockedUntil: null,
              lastLoginIp: ip,
              lastLoginAt: now,
              updatedAt: now,
              ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
            })
            .where(eq(webUsers.id, user.id));
        } catch { /* non-critical */ }

        // Non-blocking: alert if login from new IP.
        //
        // P1-5p — dedup to 1 alert per (user_id, IP/24 prefix) per 24h. The
        // pre-existing flow fired an email on every IP change, which a mobile
        // user with rotating carrier IPs (or an attacker holding credentials)
        // could weaponize as an outbound spam channel from RESEND_FROM. The
        // /24 prefix tolerates same-network rotations.
        if (user.lastLoginIp && user.lastLoginIp !== ip && isResendConfigured()) {
          const ipPrefix = ipv4Slash24(ip);
          const action = `loginalert:${user.id}:${ipPrefix}`;
          const rl = await checkRateLimit(db, user.id, action, 1, 24 * 60 * 60 * 1000).catch(() => ({ allowed: true } as { allowed: boolean }));
          if (rl.allowed) {
            sendLoginAlert(user.email, ip, (user.lang ?? "en") as import("~/lib/i18n").Lang).catch(() => {});
          }
        }

        return {
          id: user.id,
          email: user.email,
          tenantId: user.tenantId ?? null,
          webRole: user.role,
          isEmailVerified: !!user.emailVerified,
        };
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          authorization: {
            params: {
              prompt: "select_account",
            },
          },
        })]
      : []),
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours
  callbacks: {
    async signIn({ user, account, profile }) {
      // Google OAuth: existing web_users → session; new → signed redirect to complete registration
      if (account?.provider === "google" && user.email) {
        try {
          const db = getDb();
          const rows = await db
            .select()
            .from(webUsers)
            .where(eq(webUsers.email, user.email.toLowerCase().trim()))
            .limit(1);
          if (rows.length) {
            const webUser = rows[0]!;
            user.tenantId = webUser.tenantId ?? null;
            user.webRole = webUser.role;
            user.id = webUser.id;
            user.isEmailVerified = !!webUser.emailVerified;
          } else {
            const secret = process.env.AUTH_SECRET;
            if (!secret) {
              log.error("auth.googleSignIn", new Error("AUTH_SECRET missing"));
              return false;
            }
            const p = profile as { sub?: string; given_name?: string; family_name?: string } | null | undefined;
            const sub = p?.sub ?? account.providerAccountId ?? "";
            if (!sub) {
              log.warn("auth.googleSignIn", { message: "missing subject, cannot prefill registration" });
              return false;
            }
            const nameFromParts = [p?.given_name, p?.family_name].filter(Boolean).join(" ").trim();
            const displayName = nameFromParts || (typeof user.name === "string" ? user.name.trim() : "") || null;
            const token = await signGooglePrefillToken(secret, {
              email: user.email,
              name: displayName,
              sub: String(sub),
            });
            const base = authPublicBaseUrl();
            const path = `/register?g=${encodeURIComponent(token)}`;
            return base ? `${base}${path}` : path;
          }
        } catch (err) {
          log.error("auth.googleSignIn", err instanceof Error ? err : new Error(String(err)));
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      const t = token as typeof token & ExtendedJWT;
      if (user) {
        t.tenantId = user.tenantId ?? null;
        t.webRole = user.webRole ?? "tenant_owner";
        t.emailVerified = user.isEmailVerified ?? true;
        // #S8: snapshot password_changed_at so a password change / reset
        // issued AFTER this JWT will cause the session callback to reject it.
        try {
          if (user.id) {
            const db = getDb();
            const rows = await db
              .select({ pca: webUsers.passwordChangedAt })
              .from(webUsers)
              .where(eq(webUsers.id, user.id))
              .limit(1);
            t.passwordChangedAt = rows[0]?.pca ?? 0;
          } else {
            t.passwordChangedAt = 0;
          }
        } catch {
          t.passwordChangedAt = 0;
        }
      } else if (t.sub) {
        // Always re-check DB for role, tenant, emailVerified, AND passwordChangedAt —
        // ensures role demotions + password changes take effect immediately.
        try {
          const db = getDb();
          const rows = await db
            .select({
              tenantId: webUsers.tenantId,
              emailVerified: webUsers.emailVerified,
              role: webUsers.role,
              passwordChangedAt: webUsers.passwordChangedAt,
              sessionsInvalidatedAt: webUsers.sessionsInvalidatedAt,
            })
            .from(webUsers)
            .where(eq(webUsers.id, t.sub))
            .limit(1);
          if (rows[0]) {
            if (rows[0].tenantId) t.tenantId = rows[0].tenantId;
            t.emailVerified = !!rows[0].emailVerified;
            t.webRole = rows[0].role;
            // #S8: if password was changed AFTER this JWT was issued,
            // or admin bumped sessionsInvalidatedAt past the token's iat,
            // the session callback will return null and force re-login.
            const jwtIat = typeof token.iat === "number" ? token.iat : 0;
            const storedPca = rows[0].passwordChangedAt ?? 0;
            const storedSia = rows[0].sessionsInvalidatedAt ?? 0;
            if (storedPca > jwtIat || storedSia > jwtIat) {
              // Mark token as stale — session callback checks this below
              (t as { stale?: boolean }).stale = true;
            }
            t.passwordChangedAt = storedPca;
          }
        } catch { /* non-critical — next request will retry */ }
      }
      return token;
    },
    session({ session, token }) {
      const t = token as typeof token & ExtendedJWT & { stale?: boolean };
      // #S8: if JWT was marked stale by the jwt callback (password changed /
      // sessions invalidated after token issue), reject this session so the
      // client is forced to re-login.
      if (t.stale) {
        return null as unknown as typeof session;
      }
      session.user.id = token.sub ?? "";
      session.user.tenantId = t.tenantId ?? null;
      session.user.webRole = t.webRole ?? "tenant_owner";
      session.user.isEmailVerified = t.emailVerified ?? true;
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
