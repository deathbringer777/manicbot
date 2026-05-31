/**
 * Read-time resolution of an appointment's displayed client + service NAME.
 *
 * Appointment rows store only `svc_id` (never a service name) and a NULLABLE
 * `user_name` snapshot — null whenever a manual booking selected an existing
 * client. Without resolution the calendar rendered `#<chatId>` and the raw
 * `svc_...` id. These correlated scalar subqueries pull the canonical name from
 * `users` / `services` at read time.
 *
 * `LIMIT 1` keeps each subquery 1:1 with its appointment row even though
 * `users(tenant_id, chat_id)` and `services(tenant_id, svc_id)` carry no UNIQUE
 * constraint — a plain LEFT JOIN could otherwise multiply rows (and break the
 * paged `total`). The subqueries are correlated on tenant_id, so God-Mode
 * cross-tenant reads cannot leak one salon's names into another's rows.
 */
import { sql } from "drizzle-orm";
import { appointments, users, services } from "~/server/db/schema";
import { parseServiceName } from "~/lib/serviceName";

/** Extra select() columns that carry the resolved names alongside the row. */
export const appointmentNameColumns = {
  resolvedClientName: sql<string | null>`(select ${users.name} from ${users} where ${users.tenantId} = ${appointments.tenantId} and ${users.chatId} = ${appointments.chatId} limit 1)`,
  resolvedClientPhone: sql<string | null>`(select ${users.phone} from ${users} where ${users.tenantId} = ${appointments.tenantId} and ${users.chatId} = ${appointments.chatId} limit 1)`,
  resolvedServiceNames: sql<string | null>`(select ${services.names} from ${services} where ${services.tenantId} = ${appointments.tenantId} and ${services.svcId} = ${appointments.svcId} limit 1)`,
};

type ResolvedExtras = {
  resolvedClientName: string | null;
  resolvedClientPhone: string | null;
  resolvedServiceNames: string | null;
};

/**
 * Fold the resolved-name subquery columns into display fields and drop the
 * helper columns. A non-null snapshot on the row always wins; the resolved
 * value is the fallback. `serviceName` is always present (svcId as last resort).
 */
export function foldAppointmentNames<
  T extends ResolvedExtras & {
    svcId: string;
    userName: string | null;
    userPhone: string | null;
  },
>(row: T): Omit<T, keyof ResolvedExtras> & { serviceName: string } {
  const { resolvedClientName, resolvedClientPhone, resolvedServiceNames, ...rest } = row;
  return {
    ...rest,
    userName: rest.userName ?? resolvedClientName ?? null,
    userPhone: rest.userPhone ?? resolvedClientPhone ?? null,
    serviceName: parseServiceName(resolvedServiceNames, rest.svcId),
  };
}
