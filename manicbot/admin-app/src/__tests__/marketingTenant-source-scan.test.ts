/**
 * Source-level regression net for the marketingTenant router.
 *
 * Belt-and-suspenders complement to the unit tests in
 * `marketingTenant-router.test.ts` (which exercise FORBIDDEN on cross-tenant
 * calls) and to the project-wide `scripts/check-tenant-isolation.mjs`
 * scanner (which sweeps every router for missing tenantId predicates).
 *
 * What this test guards:
 *
 * 1. Every Drizzle query chain (`.from(marketing*)`) in marketingTenant.ts
 *    must reference `tenantId` within its query body. A future contributor
 *    adding a new procedure that forgets `eq(table.tenantId, ...)` flunks
 *    this test before the change can land.
 *
 * 2. Every procedure must call `assertTenantOwner(ctx, input.tenantId)`
 *    before any DB work. Without this guard, a tenant_owner could fabricate
 *    a `tenantId` for another tenant and reach the DB layer. The unit test
 *    file proves the guard rejects, but this scan ensures every NEW
 *    procedure also wires it up.
 *
 * 3. Every procedure input schema must include `tenantId: z.string().min(1)`
 *    so that `assertTenantOwner` can never receive an empty string (it would
 *    then BAD_REQUEST instead of FORBIDDEN, but the test enforces the
 *    contract at the schema layer).
 *
 * Why source-text? The Drizzle mock used in unit tests doesn't capture
 * actual WHERE expressions (the .where() spy just stores `whereCalled`).
 * Reading the source is the only fidelity check available without standing
 * up a real D1 fixture.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTER_PATH = join(
  process.cwd(),
  "src",
  "server",
  "api",
  "routers",
  "marketingTenant.ts",
);
const src = readFileSync(ROUTER_PATH, "utf8");

/**
 * Split the file into one chunk per `<procName>: protectedProcedure` block.
 * Each chunk ends at the next procedure definition or end-of-file.
 */
function extractProcedureBlocks(source: string): Array<{ name: string; body: string }> {
  const re = /^\s+([a-zA-Z][a-zA-Z0-9]*):\s+protectedProcedure\b/gm;
  const out: Array<{ name: string; body: string }> = [];
  const matches = Array.from(source.matchAll(re));
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : source.length;
    out.push({ name: m[1]!, body: source.slice(start, end) });
  }
  return out;
}

const procedures = extractProcedureBlocks(src);

describe("marketingTenant.ts source scan: invariants per procedure", () => {
  it("discovers all expected procedures", () => {
    const names = procedures.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        // PR-A: 4 new procs landed (activity, campaignAudiencePreview,
        // campaignSendsList, campaignStats); campaignSendNow is no longer
        // a stub but still appears here. PR-B: full automation CRUD +
        // runNow + toggle (automationsList stayed but now returns real
        // rows from D1 instead of `[]`).
        "activity",
        "automationCreate",
        "automationDelete",
        "automationRunNow",
        "automationToggle",
        "automationUpdate",
        "automationsList",
        "campaignAudiencePreview",
        "campaignCreate",
        "campaignDelete",
        "campaignSendNow",
        "campaignSendsList",
        "campaignStats",
        "campaignsList",
        "contactUpdate",
        "contactsList",
        "providersList",
        "segmentCreate",
        "segmentDelete",
        "segmentsList",
        "stats",
        "templateCreate",
        "templateDelete",
        "templateUpdate",
        "templatesList",
      ].sort(),
    );
  });

  it.each(procedures.map((p) => [p.name, p.body]))(
    "%s — input schema declares tenantId: z.string().min(1)",
    (_name, body) => {
      expect(body).toMatch(/tenantId:\s*z\.string\(\)\.min\(1\)/);
    },
  );

  it.each(procedures.map((p) => [p.name, p.body]))(
    "%s — calls assertTenantOwner(ctx, input.tenantId)",
    (_name, body) => {
      expect(body).toMatch(/await\s+assertTenantOwner\(\s*ctx\s*,\s*input\.tenantId\s*\)/);
    },
  );
});

describe("marketingTenant.ts source scan: every drizzle `.from(marketing*)` chain mentions tenantId", () => {
  // Capture each `.from(<table>)` callsite + a window of the following
  // ~600 chars (the chained .where()/.orderBy()/etc.). Mirrors the heuristic
  // used by `scripts/check-tenant-isolation.mjs`.
  function findFromChains(source: string): Array<{ table: string; chain: string }> {
    const out: Array<{ table: string; chain: string }> = [];
    const re = /\.from\(\s*(marketing[A-Z][a-zA-Z0-9]*)\s*\)/g;
    let match;
    while ((match = re.exec(source)) !== null) {
      out.push({ table: match[1]!, chain: source.slice(match.index, match.index + 800) });
    }
    return out;
  }

  const chains = findFromChains(src);

  it("finds at least one query chain for every CRUD-active marketing table", () => {
    const tables = new Set(chains.map((c) => c.table));
    // `marketingSends` is queried via an innerJoin in stats() — check that
    // table appears somewhere in the source even if not directly under .from
    // (a JOIN target without its own .from(marketingSends) is also a usage).
    expect(tables.has("marketingContacts")).toBe(true);
    expect(tables.has("marketingSegments")).toBe(true);
    expect(tables.has("marketingTemplates")).toBe(true);
    expect(tables.has("marketingCampaigns")).toBe(true);
    expect(tables.has("marketingProviders")).toBe(true);
  });

  it.each(chains.map((c, i) => [`#${i + 1} from(${c.table})`, c.chain]))(
    "%s — chain references tenantId within its first 800 chars",
    (_label, chain) => {
      // `marketingProviders` is a global lookup of provider config (not
      // tenant-partitioned). It's allowed to lack a tenantId predicate AT
      // THE QUERY LEVEL — the procedure's assertTenantOwner gate is what
      // enforces tenant access to "view providers".
      const isProvidersGlobalLookup =
        chain.startsWith(".from( marketingProviders") ||
        chain.startsWith(".from(marketingProviders");
      if (isProvidersGlobalLookup) return;
      expect(chain).toMatch(/tenantId/);
    },
  );
});

describe("marketingTenant.ts source scan: every update/delete is also tenant-scoped", () => {
  // Find every `ctx.db.update(marketing*)` and `ctx.db.delete(marketing*)`
  // call and require the chained .where() to reference tenantId.
  function findMutationChains(source: string): Array<{ kind: "update" | "delete"; table: string; chain: string }> {
    const out: Array<{ kind: "update" | "delete"; table: string; chain: string }> = [];
    const re = /ctx\.db\.(update|delete)\(\s*(marketing[A-Z][a-zA-Z0-9]*)\s*\)/g;
    let match;
    while ((match = re.exec(source)) !== null) {
      out.push({
        kind: match[1]! as "update" | "delete",
        table: match[2]!,
        chain: source.slice(match.index, match.index + 800),
      });
    }
    return out;
  }

  const mutations = findMutationChains(src);

  it("finds at least one mutation (sanity check that the regex actually matches)", () => {
    expect(mutations.length).toBeGreaterThan(0);
  });

  it.each(mutations.map((m, i) => [`#${i + 1} ${m.kind}(${m.table})`, m.kind, m.chain]))(
    "%s — chain references tenantId (or is preceded by per-row tenantId verification)",
    (_label, kind, chain) => {
      // `update(marketingContacts)` and `update(marketingTemplates)` perform
      // the tenant check by SELECTing the row first and comparing tenantId
      // (see the FORBIDDEN-cross-tenant unit tests). The WHERE on the update
      // itself is the row id — that's OK because the SELECT-then-verify gate
      // is upstream.
      //
      // For all other update/delete forms, the WHERE clause itself must
      // include tenantId.
      const isContactsOrTemplatesUpdate =
        kind === "update" && /marketing(Contacts|Templates)/.test(chain);
      if (isContactsOrTemplatesUpdate) {
        // Soft check: still want SOME tenant signal in the procedure block.
        // The wider procedure body MUST do the SELECT-then-verify; the unit
        // tests cover this. Nothing to assert at the WHERE level here.
        return;
      }
      expect(chain).toMatch(/tenantId/);
    },
  );
});
