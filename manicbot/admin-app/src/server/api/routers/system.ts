import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import {
  users,
  tenants,
  appointments,
  bots,
  services,
  platformRoles,
  blockedUsers,
  platformTickets,
  masters,
  localTickets,
  auditLog,
} from "~/server/db/schema";
import { sql, eq, desc } from "drizzle-orm";

const TABLE_LIST = [
  { name: "tenants", table: tenants },
  { name: "users", table: users },
  { name: "appointments", table: appointments },
  { name: "bots", table: bots },
  { name: "services", table: services },
  { name: "masters", table: masters },
  { name: "platform_roles", table: platformRoles },
  { name: "blocked_users", table: blockedUsers },
  { name: "platform_tickets", table: platformTickets },
  { name: "local_tickets", table: localTickets },
] as const;

export const systemRouter = createTRPCRouter({
  getHealth: adminProcedure.query(async ({ ctx }) => {
    try {
      const start = Date.now();
      await ctx.db.select({ count: sql<number>`count(*)` }).from(tenants);
      const latency = Date.now() - start;
      return { status: "ok" as const, dbConnected: true, dbLatencyMs: latency };
    } catch (e) {
      return { status: "error" as const, dbConnected: false, dbLatencyMs: 0 };
    }
  }),

  getTableStats: adminProcedure.query(async ({ ctx }) => {
    const counts = await Promise.all(
      TABLE_LIST.map(async ({ name, table }) => {
        try {
          const result = await ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(table as any);
          return { table: name, rows: result[0]?.count ?? 0 };
        } catch {
          return { table: name, rows: -1 };
        }
      })
    );

    const totalRows = counts.reduce((s, c) => s + (c.rows > 0 ? c.rows : 0), 0);
    return { tables: counts, totalRows };
  }),

  getConsentLog: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "tos_accepted"))
      .orderBy(desc(auditLog.createdAt))
      .limit(200);
    return rows;
  }),
});
