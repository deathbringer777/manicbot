import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "~/server/db";
import { webUsers } from "~/server/db/schema";
import { verifyPassword } from "./password";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      tenantId: string | null;
      webRole: string;
    };
  }
}


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

        return {
          id: user.id,
          email: user.email,
          tenantId: user.tenantId ?? null,
          webRole: user.role,
        } as any;
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
    async signIn({ user, account }) {
      // Google OAuth: look up user in web_users; allow login even if DB fails
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
            (user as any).tenantId = webUser.tenantId ?? null;
            (user as any).webRole = webUser.role;
            (user as any).id = webUser.id;
          } else {
            console.warn("[auth] Google signIn: email not in web_users, rejecting:", user.email);
            return false;
          }
        } catch (err) {
          console.error("[auth] Google signIn DB error:", err);
          // Still allow login on DB error, with default role
          (user as any).tenantId = null;
          (user as any).webRole = "client";
        }
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.tenantId = (user as any).tenantId ?? null;
        token.webRole = (user as any).webRole ?? "tenant_owner";
      }
      return token;
    },
    session({ session, token }) {
      (session.user as any).tenantId = token.tenantId ?? null;
      (session.user as any).webRole = token.webRole ?? "tenant_owner";
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
