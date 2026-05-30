/**
 * Legacy `/conversations` route — consolidated into the single messenger
 * inbox at `/messages`. The God-Mode cross-tenant client inbox now lives as
 * the "Client chats" tab inside `/messages` (see GodClientInbox). `redirect()`
 * is server-side, so a direct hit never renders the retired surface.
 */
import { redirect } from "next/navigation";

export const runtime = "edge";

export default function LegacyConversationsRedirect() {
  redirect("/messages");
}
