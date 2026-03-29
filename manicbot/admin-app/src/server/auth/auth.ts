import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
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
  ],
  session: { strategy: "jwt" },
  callbacks: {
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
  trustHost: true,
});
