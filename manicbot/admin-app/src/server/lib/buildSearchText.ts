import { eq } from "drizzle-orm";
import { services } from "~/server/db/schema";

/**
 * Builds a denormalized search text string for a tenant.
 * Concatenates name + description + city + all service names in ru/en/ua/pl.
 * This is stored in tenants.search_text and indexed by FTS5.
 */
export async function buildSearchText(
  db: any,
  tenantId: string,
  opts: {
    name?: string | null;
    description?: string | null;
    city?: string | null;
  },
): Promise<string> {
  const parts: string[] = [];

  if (opts.name) parts.push(opts.name);
  if (opts.city) parts.push(opts.city);
  if (opts.description) parts.push(opts.description);

  // Fetch all service names for this tenant
  const svcRows = await db.select().from(services).where(eq(services.tenantId, tenantId));
  for (const svc of svcRows) {
    if (!svc.active || svc.hidden) continue;
    try {
      const names: Record<string, string> = svc.names ? JSON.parse(svc.names) : {};
      for (const v of Object.values(names)) {
        if (v) parts.push(v);
      }
    } catch { /* ignore */ }
  }

  return [...new Set(parts)].join(" ");
}
