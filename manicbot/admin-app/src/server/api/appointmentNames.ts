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
 * paged `total`). The correlation columns MUST be table-qualified (see `col`
 * below) so the subqueries are genuinely scoped to the appointment's own
 * tenant + key — otherwise they collapse to a tautology and leak another
 * salon's first row (the bug fixed in this file's git history).
 */
import { sql, getTableName, type Column, type Table } from "drizzle-orm";
import { appointments, users, services } from "~/server/db/schema";
import { parseServiceName } from "~/lib/serviceName";

/**
 * Fully-qualified `"table"."column"` reference for the correlated subqueries.
 *
 * Why this is REQUIRED (not cosmetic): Drizzle interpolates a bare column
 * (`${tbl.col}`) into a raw `sql` template as an UNQUALIFIED identifier —
 * `"tenant_id"`, with no table prefix. So the natural-looking
 * `where ${services.tenantId} = ${appointments.tenantId}` compiled to
 * `where "tenant_id" = "tenant_id"`, which SQLite resolves against the
 * INNERMOST scope (the subquery's own table) on both sides — a tautology that
 * matches every row. The subquery then degraded to `select … from services
 * limit 1`, returning the globally-FIRST services/users row regardless of
 * tenant or svc_id → a CROSS-TENANT LEAK: every appointment showed another
 * salon's first service name, and rows with a NULL `user_name` snapshot showed
 * another salon's client name/phone. Qualifying BOTH sides restores the join:
 * `where "services"."tenant_id" = "appointments"."tenant_id"`.
 *
 * `sql.identifier` quotes from schema metadata (table + column names), so a
 * future column rename can't silently re-break the correlation.
 */
function col(table: Table, column: Column): ReturnType<typeof sql> {
  return sql`${sql.identifier(getTableName(table))}.${sql.identifier(column.name)}`;
}

/** Extra select() columns that carry the resolved names alongside the row. */
export const appointmentNameColumns = {
  resolvedClientName: sql<string | null>`(select ${users.name} from ${users} where ${col(users, users.tenantId)} = ${col(appointments, appointments.tenantId)} and ${col(users, users.chatId)} = ${col(appointments, appointments.chatId)} limit 1)`,
  resolvedClientPhone: sql<string | null>`(select ${users.phone} from ${users} where ${col(users, users.tenantId)} = ${col(appointments, appointments.tenantId)} and ${col(users, users.chatId)} = ${col(appointments, appointments.chatId)} limit 1)`,
  resolvedServiceNames: sql<string | null>`(select ${services.names} from ${services} where ${col(services, services.tenantId)} = ${col(appointments, appointments.tenantId)} and ${col(services, services.svcId)} = ${col(appointments, appointments.svcId)} limit 1)`,
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
