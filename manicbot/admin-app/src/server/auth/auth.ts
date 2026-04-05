import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "~/server/db";
import { webUsers } from "~/server/db/schema";
import { verifyPassword } from "./password";
import { signGooglePrefillToken } from "./googlePrefillToken";
import { authPublicBaseUrl } from "./authBaseUrl";

export { authPublicBaseUrl };

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      tenantId: string | null;
      webRole: string;
    };
  }
  interface User {
    tenantId?: string | null;
    webRole?: string;
  }
}

/** Local type helper for JWT token with custom fields (next-auth v5 beta doesn't export JWT for augmentation). */
type ExtendedJWT = { tenantId?: string | null; webRole?: string };

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: process.env.AUTH_SECRET,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = z
          .object({
            email: z.string().email(),
            password: z.string().min(1),
          })
          .safeParse(credentials);
        if (!parsed.success) return null;

        const db = getDb();
        const rows = await db
          .select()
          .from(webUsers)
          .where(eq(webUsers.email, parsed.data.email.toLowerCase().trim()))
          .limit(1);

        const user = rows[0];
        if (!user?.passwordHash) return null;

        const valid = await verifyPassword(
          parsed.data.password,
          user.passwordHash,
        );
        if (!valid) return null;

        // Reject unverified email (admin-created users are auto-verified)
        if (!user.emailVerified) return null;

        return {
          id: user.id,
          email: user.email,
          tenantId: user.tenantId ?? null,
          webRole: user.role,
        };
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })]
      : []),
  ],
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 }, // 7 days
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
            // Google OAuth auto-verifies email
            if (!webUser.emailVerified) {
              await db.update(webUsers).set({ emailVerified: 1 }).where(eq(webUsers.id, webUser.id));
            }
            user.tenantId = webUser.tenantId ?? null;
            user.webRole = webUser.role;
            user.id = webUser.id;
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
          console.error("[auth] Google signIn DB error:", err);
          // Still allow login on DB error, with default role
          user.tenantId = null;
          user.webRole = "client";
        }
      }
      return true;
    },
    jwt({ token, user }) {
      const t = token as typeof token & ExtendedJWT;
      if (user) {
        t.tenantId = user.tenantId ?? null;
        t.webRole = user.webRole ?? "tenant_owner";
      }
      return token;
    },
    session({ session, token }) {
      const t = token as typeof token & ExtendedJWT;
      session.user.tenantId = t.tenantId ?? null;
      session.user.webRole = t.webRole ?? "tenant_owner";
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
