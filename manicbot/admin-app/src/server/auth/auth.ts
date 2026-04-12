import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "~/server/db";
import { webUsers, auditLog } from "~/server/db/schema";
import { verifyPassword, hashPassword, needsRehash } from "./password";
import { signGooglePrefillToken } from "./googlePrefillToken";
import { authPublicBaseUrl } from "./authBaseUrl";
import { isResendConfigured } from "~/server/email/resend";
import { sendLoginAlert } from "~/server/email/emailService";

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
type ExtendedJWT = { tenantId?: string | null; webRole?: string; emailVerified?: boolean };

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = z
          .object({
            email: z.string().email(),
            password: z.string().min(1),
          })
          .safeParse(credentials);
        if (!parsed.success) return null;

        const email = parsed.data.email.toLowerCase().trim();
        const db = getDb();
        const ip = getClientIp(request?.headers);
        const now = Math.floor(Date.now() / 1000);

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

        const valid = await verifyPassword(parsed.data.password, user.passwordHash);

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
          } catch { /* non-critical — login is still rejected below */ }
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
            newPasswordHash = await hashPassword(parsed.data.password);
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

        // Non-blocking: alert if login from new IP
        if (user.lastLoginIp && user.lastLoginIp !== ip && isResendConfigured()) {
          sendLoginAlert(user.email, ip, (user.lang ?? "en") as import("~/lib/i18n").Lang).catch(() => {});
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
              console.error("[auth] Google signIn: AUTH_SECRET missing");
              return false;
            }
            const p = profile as { sub?: string; given_name?: string; family_name?: string } | null | undefined;
            const sub = p?.sub ?? account.providerAccountId ?? "";
            if (!sub) {
              console.warn("[auth] Google signIn: missing subject, cannot prefill registration");
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
          console.error("[auth] Google signIn DB error — rejecting login:", err);
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
      } else {
        // Re-check DB for tenant assignment + emailVerified refresh
        if (t.sub && (!t.tenantId || t.emailVerified !== true)) {
          try {
            const db = getDb();
            const rows = await db
              .select({ tenantId: webUsers.tenantId, emailVerified: webUsers.emailVerified })
              .from(webUsers)
              .where(eq(webUsers.id, t.sub))
              .limit(1);
            if (rows[0]) {
              if (rows[0].tenantId) t.tenantId = rows[0].tenantId;
              if (rows[0].emailVerified) t.emailVerified = true;
            }
          } catch { /* non-critical — next request will retry */ }
        }
      }
      return token;
    },
    session({ session, token }) {
      const t = token as typeof token & ExtendedJWT;
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
