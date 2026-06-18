/**
 * AUDIT YELLOW #5 — `marketing_sends` has no `tenant_id` column.
 *
 * A send is tenant-scoped only transitively: `marketing_sends.campaign_id ->
 * marketing_campaigns.tenant_id`. So the ONLY safe way to read sends for a
 * tenant is to JOIN `marketing_campaigns` and filter on its `tenant_id`. A read
 * that filters by `campaignId` alone (no join, no tenant predicate) would leak
 * across tenants the moment a campaignId is attacker-supplied.
 *
 * The existing `marketingTenant-source-scan.test.ts` only checks that the word
 * `tenantId` APPEARS near each `.from(marketing*)` chain. This file is sharper:
 * for `marketingSends` specifically it requires the JOIN bridge to be present,
 * which is the exact thing the audit flagged. It also pins `marketing.ts` as a
 * God-Mode (adminProcedure) router so its unscoped sends queries stay legitimate.
 *
 * Source-text scan (not a runtime mock) because the Drizzle test mock doesn't
 * capture `.where()` / `.innerJoin()` expressions — reading the source is the
 * only fidelity check without a live D1 fixture.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TENANT_ROUTER = join(process.cwd(), "src", "server", "api", "routers", "marketingTenant.ts");
const SYSTEM_ROUTER = join(process.cwd(), "src", "server", "api", "routers", "marketing.ts");

/**
 * A tenant-facing read of `marketingSends` is isolated iff, within the chain,
 * it innerJoins `marketingCampaigns` AND references `marketingCampaigns.tenantId`
 * (the only path from a send to a tenant). Exported shape so the teeth-tests
 * below can exercise it against known good/bad fixtures.
 */
function sendsReadIsIsolated(chain: string): boolean {
  const joinsCampaigns = /\.innerJoin\(\s*marketingCampaigns\b/.test(chain);
  const filtersCampaignTenant = /marketingCampaigns\.tenantId/.test(chain);
  return joinsCampaigns && filtersCampaignTenant;
}

/** Every `.from(marketingSends)` callsite + a 800-char window of its chain. */
function findSendsReads(source: string): Array<{ index: number; chain: string }> {
  const out: Array<{ index: number; chain: string }> = [];
  const re = /\.from\(\s*marketingSends\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ index: m.index, chain: source.slice(m.index, m.index + 800) });
  }
  return out;
}

describe("sendsReadIsIsolated predicate has teeth", () => {
  const GOOD =
    ".from(marketingSends).innerJoin(marketingCampaigns, eq(marketingSends.campaignId, marketingCampaigns.id)).where(and(eq(marketingSends.campaignId, input.id), eq(marketingCampaigns.tenantId, input.tenantId)))";
  const BAD_NO_JOIN =
    ".from(marketingSends).where(eq(marketingSends.campaignId, input.id))";
  const BAD_JOIN_NO_TENANT =
    ".from(marketingSends).innerJoin(marketingCampaigns, eq(marketingSends.campaignId, marketingCampaigns.id)).where(eq(marketingSends.campaignId, input.id))";

  it("accepts a join + campaign-tenant filter", () => {
    expect(sendsReadIsIsolated(GOOD)).toBe(true);
  });
  it("rejects a campaignId-only read with no campaign join", () => {
    expect(sendsReadIsIsolated(BAD_NO_JOIN)).toBe(false);
  });
  it("rejects a joined read that forgets the tenant predicate", () => {
    expect(sendsReadIsIsolated(BAD_JOIN_NO_TENANT)).toBe(false);
  });
});

describe("marketingTenant.ts: every marketingSends read joins campaigns on tenantId", () => {
  const src = readFileSync(TENANT_ROUTER, "utf8");
  const reads = findSendsReads(src);

  it("finds the known tenant-facing sends reads (regex sanity)", () => {
    // campaignStats, campaignReport, campaignSendsList, activity (≥4).
    expect(reads.length).toBeGreaterThanOrEqual(4);
  });

  it.each(reads.map((r, i) => [`from(marketingSends) #${i + 1}`, r.chain]))(
    "%s — innerJoins marketingCampaigns and filters marketingCampaigns.tenantId",
    (_label, chain) => {
      expect(sendsReadIsIsolated(chain)).toBe(true);
    },
  );
});

describe("marketing.ts is a God-Mode (system_admin) router by construction", () => {
  const src = readFileSync(SYSTEM_ROUTER, "utf8");

  it("imports adminProcedure (system_admin gate) and not tenant procedures", () => {
    expect(src).toMatch(/import\s*\{[^}]*\badminProcedure\b[^}]*\}\s*from\s*"~\/server\/api\/trpc"/);
    // A God-Mode router must NOT reach for tenant/public procedures — those would
    // imply a tenant context that this cross-tenant router intentionally lacks.
    expect(src).not.toMatch(/\bprotectedProcedure\b/);
    expect(src).not.toMatch(/\bpublicProcedure\b/);
    expect(src).not.toMatch(/\btenantOwnerProcedure\b/);
  });

  it("every procedure is declared with adminProcedure", () => {
    // Match `<name>: <something>Procedure` declarations.
    const procDecls = Array.from(src.matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*):\s+(\w*[Pp]rocedure)\b/gm));
    expect(procDecls.length).toBeGreaterThan(0);
    const nonAdmin = procDecls.filter((m) => m[2] !== "adminProcedure").map((m) => `${m[1]}: ${m[2]}`);
    expect(nonAdmin).toEqual([]);
  });
});
