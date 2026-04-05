import { eq } from "drizzle-orm";
import { services } from "~/server/db/schema";
import { buildSearchVariants, hasCyrillic } from "~/lib/searchNormalize";

/**
 * Builds a denormalized search text string for a tenant.
 * Concatenates name + description + city + all service names in ru/en/ua/pl,
 * expanding each Latin token into [original, deaccented, Cyrillic phonetic] variants
 * so users can search in both Cyrillic and Latin (e.g. "варшава" finds "Warszawa").
 *
 * Note: this function is a utility for future use.
 * The actual search text for existing tenants is rebuilt via /admin/index-salons.
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
  const rawParts: string[] = [];

  if (opts.name) rawParts.push(opts.name);
  if (opts.city) rawParts.push(opts.city);
  if (opts.description) rawParts.push(opts.description);

  const parts: string[] = [];
  for (const p of rawParts) {
    parts.push(...buildSearchVariants(p));
  }

  // Fetch all service names for this tenant
  const svcRows = await db.select().from(services).where(eq(services.tenantId, tenantId));
  for (const svc of svcRows) {
    if (!svc.active || svc.hidden) continue;
    try {
      const names: Record<string, string> = svc.names ? JSON.parse(svc.names) : {};
      for (const v of Object.values(names)) {
        if (!v) continue;
        if (hasCyrillic(v)) {
          // Already Cyrillic — just lowercase; don't re-transliterate
          parts.push(v.toLowerCase());
        } else {
          parts.push(...buildSearchVariants(v));
        }
      }
    } catch { /* ignore */ }
  }

  // buildSearchVariants already returns lowercase strings
  return [...new Set(parts)].join(" ");
}
