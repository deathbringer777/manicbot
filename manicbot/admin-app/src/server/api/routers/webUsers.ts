import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { webUsers } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, hashPassword } from "~/server/auth/password";

export const webUsersRouter = createTRPCRouter({
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8, "Минимум 8 символов"),
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
});
