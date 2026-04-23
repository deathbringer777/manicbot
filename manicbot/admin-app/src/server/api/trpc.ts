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
import { auth } from "~/server/auth/auth";
import { log } from "~/server/utils/logger";

/**
 * 1. CONTEXT
 *
 * Auth is web-session only (NextAuth email/password). The legacy Telegram Mini App path
 * (x-telegram-init-data HMAC) has been removed in Phase 1.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  let webUser: { id: string; email: string; tenantId: string | null; webRole: string } | null = null;
  try {
    const session = await auth();
    if (session?.user?.email) {
      webUser = {
        id: session.user.id ?? session.user.email,
        email: session.user.email,
        tenantId: session.user.tenantId ?? null,
        webRole: session.user.webRole ?? "tenant_owner",
      };
    }
  } catch {
    // auth() may throw in non-request contexts — ignore
  }

  const db = getDb();

  return {
    db,
    webUser,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
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
 */

export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
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
  log.debug("trpc.timing", { path, ms: end - start });

  return result;
});

/**
 * Public (unauthenticated) procedure.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Authenticated procedure — requires a valid web session.
 */
export const protectedProcedure = t.procedure.use(timingMiddleware).use(async ({ ctx, next }) => {
  if (!ctx.webUser) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
    });
  }
  return next({ ctx });
});

/**
 * Role-scoped procedure builders — use these instead of `publicProcedure + assertTenantOwner()`
 * so authorization is type-enforced at the procedure boundary.
 */
export const tenantOwnerProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    const role = ctx.webUser?.webRole;
    if (role !== "tenant_owner" && role !== "system_admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "tenant_owner or system_admin required" });
    }
    return next({ ctx });
  });

/**
 * Allows tenant_owner, tenant_manager, master, or system_admin — use for shared dashboards
 * where finer-grained permissions are checked inside the procedure via assertPermission().
 */
export const managerProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    const role = ctx.webUser?.webRole;
    if (
      role !== "tenant_owner" &&
      role !== "tenant_manager" &&
      role !== "master" &&
      role !== "system_admin"
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: "tenant member role required" });
    }
    return next({ ctx });
  });

export const masterProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    const role = ctx.webUser?.webRole;
    if (role !== "master" && role !== "tenant_owner" && role !== "system_admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "master/tenant_owner/system_admin required" });
    }
    return next({ ctx });
  });

export const systemAdminProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    const role = ctx.webUser?.webRole;
    if (role !== "system_admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "system_admin required" });
    }
    return next({ ctx });
  });

/** God Mode API — only web session with role system_admin. */
export const adminProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.webUser) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      });
    }
    if (ctx.webUser.webRole !== "system_admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have administration privileges.",
      });
    }
    return next({ ctx });
  });
