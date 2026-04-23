import { drizzle } from "drizzle-orm/d1";
import { getRequestContext } from "@cloudflare/next-on-pages";
import * as schema from "./schema";
import { log } from "~/server/utils/logger";

export function getDb() {
  let DB: any = null;
  try {
    const ctx = getRequestContext();
    if (ctx && ctx.env) {
      DB = (ctx.env as any).DB;
    }
  } catch (e) {
    // Ignore errors when called outside Cloudflare worker environment
  }

  if (!DB) {
    // At build-time this is expected; at runtime it means D1 binding is missing
    log.warn("db.getDb", { message: "D1 binding not found — using mock (build-time only!)" });
    DB = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: () => null, run: () => null }) }),
      exec: () => null
    };
  }

  return drizzle(DB, { schema });
}
