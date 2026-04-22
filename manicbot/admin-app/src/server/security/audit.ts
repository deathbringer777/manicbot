/**
 * Audit log helpers — thin wrappers around `audit_log` D1 table.
 *
 * Usage:
 *   await writeAudit(ctx.db, {
 *     actor: ctx.webUser.email,
 *     action: "export.users",
 *     tenantId: input.tenantId ?? null,
 *     detail: `format=${input.format}`,
 *     ip: clientIp(ctx),
 *   });
 */
import { auditLog } from "~/server/db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export interface AuditEntry {
  actor: string | null;
  action: string;
  tenantId?: string | null;
  detail?: string | null;
  ip?: string | null;
}

/**
 * Write a non-blocking audit record. Errors are silently swallowed so that
 * audit failures never break the main request flow.
 */
export async function writeAudit(
  db: DrizzleD1Database<Record<string, unknown>>,
  entry: AuditEntry,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      tenantId: entry.tenantId ?? null,
      actor: entry.actor ?? null,
      action: entry.action,
      detail: entry.detail ?? null,
      ip: entry.ip ?? null,
      createdAt: Math.floor(Date.now() / 1000),
    });
  } catch {
    // Non-critical — never block the caller
  }
}

/**
 * Extract client IP from a tRPC context (headers are available in edge context).
 */
export function ctxIp(ctx: { headers?: Headers | null }): string {
  const h = ctx.headers;
  if (!h?.get) return "unknown";
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
