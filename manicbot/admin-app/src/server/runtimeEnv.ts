/**
 * Read runtime environment variables on Cloudflare Pages.
 *
 * On @cloudflare/next-on-pages, secrets and env vars configured in the Pages
 * dashboard are ONLY available via getRequestContext().env at request time —
 * process.env is empty on the Edge Runtime for Pages bindings.
 *
 * Outside request scope (build time, tests, Node), we fall back to process.env.
 */
import { getRequestContext } from "@cloudflare/next-on-pages";

export function getRuntimeEnv(key: string): string | undefined {
  try {
    const ctx = getRequestContext();
    const v = (ctx?.env as Record<string, unknown> | undefined)?.[key];
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    // Not in Cloudflare request scope — fall through to process.env
  }
  const p = process.env[key];
  return typeof p === "string" && p.length > 0 ? p : undefined;
}
