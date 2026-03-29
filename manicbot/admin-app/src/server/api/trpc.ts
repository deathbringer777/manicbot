/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { getDb } from "~/server/db";
import { platformRoles } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { validateWebAppData } from "~/server/auth/telegram";
import { env } from "~/env";
import { isAdminProcedurePlatformRole } from "~/server/api/platformRoles";
import { auth } from "~/server/auth/auth";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  // 1. Try Telegram Mini App auth (x-telegram-init-data header)
  const telegramInitData = opts.headers.get("x-telegram-init-data");
  let user = null;
  if (telegramInitData) {
    const validData = await validateWebAppData(telegramInitData);
    if (validData.valid) {
      user = validData.user;
    }
  }

  // 2. Fallback: next-auth web session (JWT cookie) for browser-based logins
  let webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null = null;
  if (!user) {
    try {
      const session = await auth();
      if (session?.user?.email) {
        webUser = {
          id: (session.user as any).id ?? session.user.email,
          email: session.user.email,
          tenantId: (session.user as any).tenantId ?? null,
          webRole: (session.user as any).webRole ?? "tenant_owner",
        };
      }
    } catch {
      // auth() may throw in non-request contexts — ignore
    }
  }

  const db = getDb();

  return {
    db,
    user,       // Telegram user (id = Telegram chatId)
    webUser,    // Web session user (id = web user UUID)
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Authenticated procedure — requires valid Telegram WebApp init data OR a web session.
 */
export const protectedProcedure = t.procedure.use(timingMiddleware).use(async ({ ctx, next }) => {
  if (!ctx.user && !ctx.webUser) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  return next({ ctx });
});

/**
 * Protected (authenticated) procedure for Bot Admins
 */
export const adminProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Telegram Verification Failed",
      });
    }

    // Always allow the platform creator (ADMIN_CHAT_ID secret)
    let isAdmin = env.ADMIN_CHAT_ID ? String(ctx.user.id) === env.ADMIN_CHAT_ID : false;

    if (!isAdmin) {
      const dbRole = await ctx.db
        .select()
        .from(platformRoles)
        .where(eq(platformRoles.chatId, ctx.user.id))
        .limit(1);
      
      if (dbRole.length > 0 && isAdminProcedurePlatformRole(dbRole[0]?.role)) {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have administration privileges.",
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
