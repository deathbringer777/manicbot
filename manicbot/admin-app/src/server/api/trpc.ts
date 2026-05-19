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
    // Bare `throw new Error("...")` from a procedure becomes an INTERNAL_SERVER_ERROR
    // with whatever message the dev wrote — including potentially sensitive
    // details (DB query fragments, user emails, internal IDs, stack frames).
    // Redact those to a generic message and log the original server-side so
    // ops can still correlate.
    //
    // TRPCError instances are intentional, developer-curated messages that
    // are safe to surface (e.g. "Password already set", "Email already in use"),
    // so we pass those through untouched. ZodError validation messages are
    // safe by construction — those come from the schema definition.
    let safeMessage = shape.message;
    let safeData = shape.data;
    const isExpected = error.cause instanceof ZodError || error.code !== "INTERNAL_SERVER_ERROR";
    if (!isExpected) {
      // Log the original cause so operators retain debugging context.
      try {
        log.error("trpc.unhandled", error instanceof Error ? error : new Error(String(error)), {
          path: shape.data?.path,
          code: shape.code,
        });
      } catch { /* logging itself must not throw */ }
      safeMessage = "Internal server error";
      // Strip any leaked stack trace / cause text the underlying tRPC build
      // may have included on the data object. Use Record-spread + delete so
      // the static type from `shape.data` keeps `stack?` etc. as optional.
      const sanitized = { ...shape.data } as Record<string, unknown>;
      delete sanitized.stack;
      delete sanitized.cause;
      safeData = sanitized as typeof shape.data;
    }
    return {
      ...shape,
      message: safeMessage,
      data: {
        ...safeData,
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
 *
 * L-F (audit 2026-05-20): each builder MUST throw UNAUTHORIZED when the
 * caller has no session, and FORBIDDEN when the session exists but the
 * role is wrong. Aligns with `adminProcedure` so the client-side handler
 * can branch on 401 (redirect to /login) vs 403 (show "no access" page).
 * The previous implementation collapsed both cases to FORBIDDEN.
 */
export const tenantOwnerProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.webUser) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const role = ctx.webUser.webRole;
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
    if (!ctx.webUser) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const role = ctx.webUser.webRole;
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
    if (!ctx.webUser) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const role = ctx.webUser.webRole;
    if (role !== "master" && role !== "tenant_owner" && role !== "system_admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "master/tenant_owner/system_admin required" });
    }
    return next({ ctx });
  });

export const systemAdminProcedure = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.webUser) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
    }
    const role = ctx.webUser.webRole;
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
