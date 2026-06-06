import { TRPCError } from "@trpc/server";

function adminAppOrigin(): string {
  return new URL((process.env.AUTH_URL ?? "https://admin.manicbot.com").replace(/\/+$/, "")).origin;
}

/**
 * Accept only same-origin admin-app URLs for callback/return targets.
 *
 * These values are later handed to Stripe or OAuth redirects. `z.string().url()`
 * validates syntax, not trust; without this origin lock an authenticated user
 * could mint a legitimate provider flow that ends on an attacker-controlled
 * domain.
 */
export function assertAdminAppReturnUrl(returnUrl: string | null | undefined): void {
  if (!returnUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "returnUrl must be a valid URL" });
  }
  if (parsed.origin !== adminAppOrigin()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "returnUrl must match the admin-app origin" });
  }
}
