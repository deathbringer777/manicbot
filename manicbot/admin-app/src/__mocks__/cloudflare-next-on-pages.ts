/**
 * Minimal @cloudflare/next-on-pages stub for Vitest.
 *
 * The real module imports `server-only`, which throws outside Next.js RSC.
 * Tests run in plain Node and should always fall through to the process.env
 * branch of getRuntimeEnv(), so we simulate "not in Cloudflare request scope"
 * by throwing from getRequestContext().
 */
export function getRequestContext(): never {
  throw new Error("getRequestContext is not available in the Vitest test environment");
}
