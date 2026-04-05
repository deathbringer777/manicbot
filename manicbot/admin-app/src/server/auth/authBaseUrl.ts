/** Public origin for OAuth redirects (register prefill). Prefer AUTH_URL or NEXTAUTH_URL. */
export function authPublicBaseUrl(): string {
  const primary = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  if (primary) return primary;
  const v = process.env.VERCEL_URL?.replace(/\/$/, "");
  if (v) return v.startsWith("http") ? v : `https://${v}`;
  return "";
}
