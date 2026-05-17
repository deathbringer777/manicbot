import { env } from "~/env";
import { log } from "~/server/utils/logger";

export type AppointmentAction =
  | "confirm"
  | "reject"
  | "cancel"
  | "reschedule"
  | "done"
  | "no_show_client"
  | "no_show_master";

/**
 * Fire-and-forget call to the Worker's POST /admin/appointment-action endpoint
 * to trigger client notifications + Google Calendar sync + analytics + any
 * marketing-automations that match the event. Non-blocking: errors are
 * captured to the logger but never affect the tRPC mutation response.
 *
 * `extra` carries action-specific payload — e.g. the previous date/time for
 * a reschedule action so the Worker can render "Was X → Now Y" in the
 * client message via `sendAptRescheduledToClient`.
 *
 * Lifted from appointments.ts (#S9 retained: ADMIN_KEY via Authorization
 * header, not query string) so salonRouter and masterRouter can share the
 * helper without a cross-router import.
 */
export async function notifyWorker(
  action: AppointmentAction,
  appointmentId: string,
  tenantId: string,
  confirmedBy?: string | number | null,
  extra?: Record<string, unknown>,
): Promise<void> {
  const workerUrl = env.WORKER_PUBLIC_URL;
  const adminKey = env.ADMIN_KEY;
  if (!workerUrl || !adminKey) {
    log.warn("notifyWorker", {
      message: "WORKER_PUBLIC_URL or ADMIN_KEY not set — skipping",
    });
    return;
  }
  try {
    const resp = await fetch(`${workerUrl}/admin/appointment-action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminKey}`,
      },
      body: JSON.stringify({
        action,
        appointmentId,
        tenantId,
        confirmedBy,
        ...(extra ?? {}),
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      log.error(
        "notifyWorker",
        new Error(`Worker notification failed ${resp.status}`),
        { body: text, action, appointmentId },
      );
    }
  } catch (e) {
    log.error(
      "notifyWorker",
      e instanceof Error ? e : new Error(String(e)),
      { action, appointmentId },
    );
  }
}
