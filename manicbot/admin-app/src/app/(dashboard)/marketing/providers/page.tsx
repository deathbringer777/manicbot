/**
 * Legacy `/marketing/providers` route — permanently moved to
 * `/system/providers` (system-admin only). Vendor plumbing (Brevo,
 * Resend, Twilio) is platform infrastructure, not part of the
 * salon-owner Marketing surface. See `CLAUDE.md` and the
 * `marketing-providers-ia.test.ts` pin.
 *
 * `redirect()` is server-side and fires before the (dashboard) client
 * layout mounts, so a tenant typing this URL never sees provider data.
 */
import { redirect } from "next/navigation";

export const runtime = "edge";

export default function LegacyProvidersRedirect() {
  redirect("/system/providers");
}
