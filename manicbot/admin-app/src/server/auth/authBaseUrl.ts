import { getRuntimeEnv } from "~/server/runtimeEnv";

/**
 * Public origin for OAuth redirects and email links. Prefer AUTH_URL / NEXTAUTH_URL.
 *
 * On Cloudflare Pages these values come from getRequestContext().env at runtime
 * — plain process.env is empty on the Edge Runtime. getRuntimeEnv() handles the
 * fallback chain (Cloudflare context → process.env for tests/build time).
 */
export function authPublicBaseUrl(): string {
  const primary = (getRuntimeEnv("AUTH_URL") || getRuntimeEnv("NEXTAUTH_URL") || "").replace(/\/$/, "");
  if (primary) return primary;
  const v = getRuntimeEnv("VERCEL_URL")?.replace(/\/$/, "");
  if (v) return v.startsWith("http") ? v : `https://${v}`;
  return "";
}
