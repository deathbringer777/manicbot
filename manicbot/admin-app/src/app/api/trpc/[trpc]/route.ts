import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";

export const runtime = "edge";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { log } from "~/server/utils/logger";
import {
  PUBLIC_CACHE_CONTROL,
  shouldCacheTrpcPath,
} from "~/server/api/publicSalon/publicSalonSearchLogic";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
  return createTRPCContext({
    headers: req.headers,
  });
};

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req),
    // Always log on error — the prior implementation only logged in dev,
    // which meant production tRPC failures were invisible to ops. The
    // structured logger redacts/sanitises by configuration; bare console
    // calls here would also break edge-runtime log routing.
    onError: ({ path, error }) => {
      log.error("trpc.handler", error instanceof Error ? error : new Error(String(error)), {
        path: path ?? "<no-path>",
        code: error.code,
      });
    },
    // Edge cache headers for public salon directory endpoints (relax.md
    // §4 P2-9). Only applied when *every* procedure in the batch is on
    // the public allow-list AND there were no errors — keeps user-
    // session-bearing queries far away from edge caches.
    responseMeta: ({ ctx, paths, errors, type }) => {
      void ctx;
      if (type !== "query") return {};
      if (errors.length > 0) return {};
      const pathParam = paths?.join(",") ?? "";
      if (!shouldCacheTrpcPath(pathParam)) return {};
      return {
        headers: new Headers({
          "Cache-Control": PUBLIC_CACHE_CONTROL,
        }),
      };
    },
  });

export { handler as GET, handler as POST };
