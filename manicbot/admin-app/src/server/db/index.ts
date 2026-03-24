import { drizzle } from "drizzle-orm/d1";
import { getRequestContext } from "@cloudflare/next-on-pages";
import * as schema from "./schema";

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
    // Mock DB instance for Next.js build-time RSC parsing
    // This allows the build to succeed without crashing
    DB = {
      prepare: () => ({ bind: () => ({ all: () => [], first: () => null, run: () => null }) }),
      exec: () => null
    };
  }

  return drizzle(DB, { schema });
}
