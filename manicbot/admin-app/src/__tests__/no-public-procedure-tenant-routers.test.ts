/**
 * TODO(#259) closure (audit 2026-06-12, TI-2) — source-scan gate.
 *
 * Tenant-facing dashboard routers historically used `publicProcedure` with
 * the auth living entirely in an in-handler `assertTenantOwner(...)` call.
 * That was functionally closed but fragile: a refactor dropping the assert
 * would silently expose the procedure. These routers now use
 * `protectedProcedure` as the typed baseline (session required at the
 * boundary) while the in-handler assert remains the tenant-scope authority.
 *
 * `protectedProcedure` (not `tenantOwnerProcedure`) is deliberate:
 * tenantOwnerProcedure rejects webRole "master", which would break
 * independent/personal masters — assertTenantOwner grants them owner-level
 * access on their personal tenant via the tenants.is_personal lookup.
 *
 * This test is a regression gate: any NEW `publicProcedure` in these files
 * must either be added to the explicit allowlist below (with a reason) or
 * use a protected builder.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTERS_DIR = join(__dirname, "..", "server", "api", "routers");

/** file → procedures allowed to stay on publicProcedure, with the reason. */
const PUBLIC_ALLOWLIST: Record<string, string[]> = {
  // Public salon storefront (/salon/[slug]) — unauthenticated by design,
  // content-gated on the reviews_public flag + redacted fields.
  "reviews.ts": ["getPublicReviews"],
};

const TARGET_FILES = [
  "stampCard.ts",
  "reviews.ts",
  "promoCodes.ts",
  "onboarding.ts",
  "appointments.ts",
  "analytics.ts",
];

function publicProcedureNames(source: string): string[] {
  // Matches `  <name>: publicProcedure` procedure declarations.
  const re = /^\s{2}(\w+):\s*publicProcedure/gm;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.push(m[1]!);
  return names;
}

describe("TODO(#259) — tenant routers use a typed auth baseline", () => {
  for (const file of TARGET_FILES) {
    it(`${file} has no publicProcedure outside the allowlist`, () => {
      const src = readFileSync(join(ROUTERS_DIR, file), "utf8");
      const offenders = publicProcedureNames(src).filter(
        (name) => !(PUBLIC_ALLOWLIST[file] ?? []).includes(name),
      );
      expect(offenders).toEqual([]);
    });

    it(`${file} carries no stale TODO(#259) markers`, () => {
      const src = readFileSync(join(ROUTERS_DIR, file), "utf8");
      expect(src.includes("TODO(#259)")).toBe(false);
    });
  }
});
