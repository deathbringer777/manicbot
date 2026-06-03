#!/usr/bin/env node
// @ts-nocheck — standalone Node CLI/CI script (run via `node scripts/...`), not
// part of the app type-graph. The unit test imports its pure helpers; without
// this, `checkJs` would type-check this heuristic regex code as app source.
/**
 * Tenant-isolation scanner for admin-app tRPC routers (CI guard).
 *
 * Every SELECT/UPDATE/DELETE/INSERT against a tenant-scoped table MUST carry
 * a `tenantId` predicate. This script flags any Drizzle query callsite
 * (`.from()`, `.update()`, `.delete()`, `.insert()`) on a tenant-scoped table
 * whose statement chain does not mention `tenantId`.
 *
 * It is a heuristic — it cannot fully parse TypeScript — but it catches the
 * regression we care about: a query against `appointments` / `masters` /
 * `marketingContacts` / etc. that forgets the `eq(<table>.tenantId, …)` predicate.
 *
 * Design (rewritten 2026-06-02 — closes the blind spots an audit found):
 *   1. MUTATIONS ARE COVERED. The previous version only matched `.from()` (i.e.
 *      SELECT); `db.update()/delete()/insert()` have no `.from()` and slipped
 *      through entirely. We now match all four operations. For UPDATE/DELETE the
 *      tenant predicate must sit in the `.where(...)` filter (not in `.set()` —
 *      writing the tenant column does not scope which rows are touched), and
 *      comments are stripped so a commented-out `tenantId` can't spoof the guard.
 *   2. THE TABLE SET IS DERIVED FROM THE SCHEMA. `deriveTenantScopedTables()`
 *      reads schema.ts and treats any `sqliteTable` declaring a `text("tenant_id")`
 *      column as tenant-scoped, minus an explicit PLATFORM_GLOBAL set. No more
 *      hand-maintained list that silently drifts behind new tables.
 *   3. EXCEPTIONS ARE CONTENT-ANCHORED. Instead of a brittle `file:line`
 *      allowlist (which had to be re-bumped ~30× as code moved), an intentional
 *      cross-tenant query is annotated inline with `// tenant-scan-ignore: <reason>`
 *      on (or just above) the query. Survives line drift; self-documents.
 *   4. WHERE-VARIABLE AWARENESS. A `.where(scope)` whose `scope`/`conditions`
 *      variable is built with a tenantId predicate nearby is accepted.
 *
 * Run:
 *   cd manicbot/admin-app && node scripts/check-tenant-isolation.mjs
 *   exit 0 → all good
 *   exit 1 → found a query that needs a tenantId predicate (or a directive)
 *
 * Wired into CI alongside `npm test` (see .github/workflows/deploy.yml).
 */
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTERS_DIR = join(process.cwd(), "src", "server", "api", "routers");
const SCHEMA_FILE = join(process.cwd(), "src", "server", "db", "schema.ts");

/**
 * Tables that carry a `tenant_id` column but are NOT partitioned per tenant —
 * access is by web-user identity, a cross-tenant audit trail, or the platform
 * support queue. Subtracted from the auto-derived tenant-scoped set.
 *
 * Keep this list SMALL and documented. Everything else with a `tenant_id`
 * column is enforced. Adding an entry here is a deliberate audit decision.
 */
export const PLATFORM_GLOBAL_TABLES = new Set([
  "webUsers", // auth identity — looked up by id/email/session; tenant_id nullable
  "auditLog", // cross-tenant audit trail; tenant_id nullable for platform events
  "platformTickets", // platform support queue; tenant_id nullable until a tenant is linked
]);

/**
 * Pure system_admin god-mode routers — every query is cross-tenant by design.
 * Verified (2026-06-02): each of these files uses ONLY `adminProcedure`.
 *
 * NOTE: `appointments.ts`, `billing.ts`, and `support.ts` were REMOVED from this
 * list. They mix `publicProcedure` / `tenantOwnerProcedure` / `protectedProcedure`
 * with admin routes, so skipping the whole file hid tenant-scoped queries. They
 * are now scanned; their genuine god-mode queries carry `// tenant-scan-ignore`.
 */
export const SKIP_FILES = new Set([
  "marketing.ts", // adminProcedure-only cross-tenant CRM
  "tenants.ts", // adminProcedure-only platform tenant management
  "users.ts", // adminProcedure-only platform user listing
  "metrics.ts", // adminProcedure-only platform metrics
  "system.ts", // adminProcedure-only
  "events.ts", // adminProcedure-only
  "settings.ts", // adminProcedure-only platform settings
  "stripe.ts", // platform billing webhooks / global
  "provisioning.ts", // adminProcedure-only platform provisioning
  "export.ts", // adminProcedure-only platform export
  "search.ts", // adminProcedure-only global search
  "analyticsEvents.ts", // adminProcedure-only platform analytics (telemetry)
  "errorEvents.ts", // adminProcedure-only platform error observability (telemetry)
  "leads.ts", // adminProcedure-only platform lead/CRM management
  "marketingAutopilot.ts", // adminProcedure-only @manicbot_com platform autopilot
  "platformBroadcasts.ts", // systemAdminProcedure-only platform broadcasts
]);

const WHERE_HELPERS = new Set([
  "eq", "ne", "and", "or", "not", "gt", "gte", "lt", "lte", "inArray",
  "notInArray", "isNull", "isNotNull", "like", "ilike", "between", "exists",
  "sql", "desc", "asc", "count", "sum", "min", "max", "avg", "input", "ctx",
]);

/**
 * Derive the set of tenant-scoped Drizzle table names (camelCase const names)
 * straight from schema.ts: any `sqliteTable` whose column object declares
 * `text("tenant_id")`. Replaces the old hand-maintained list so it cannot
 * drift out of sync with the schema. Multi-tenant relationship tables
 * (e.g. `referrals` with `referrer_tenant_id`/`invitee_tenant_id`) are NOT
 * matched, because the column name is not exactly `tenant_id`.
 */
export function deriveTenantScopedTables(schemaSrc) {
  const re = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*sqliteTable\(/g;
  const decls = [];
  let m;
  while ((m = re.exec(schemaSrc)) !== null) decls.push({ name: m[1], at: m.index });
  const out = new Set();
  for (let i = 0; i < decls.length; i++) {
    const end = i + 1 < decls.length ? decls[i + 1].at : schemaSrc.length;
    const body = schemaSrc.slice(decls[i].at, end);
    if (/text\(\s*["'`]tenant_id["'`]\s*\)/.test(body) && !PLATFORM_GLOBAL_TABLES.has(decls[i].name)) {
      out.add(decls[i].name);
    }
  }
  return out;
}

const CALLSITE_RE = /\.(from|update|delete|insert)\(\s*([A-Za-z_$][\w$]*)\s*\)/g;

function lineNumberFor(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Grab the statement chain starting at the callsite — up to the next top-level
 * `;` (capped at 1200 chars) — so a chained `.where(...)` / `.values({...})` is
 * captured even when it spans several lines.
 */
function statementChain(src, start) {
  let end = src.indexOf(";", start);
  if (end === -1 || end - start > 1200) end = Math.min(src.length, start + 1200);
  return src.slice(start, end);
}

/**
 * Strip `//` line comments and `/* … *\/` block comments from a snippet so a
 * predicate keyword that only appears in a comment can't satisfy the isolation
 * check. (The Worker-side scanner hit exactly this comment false-positive: a
 * `/* tenantId handled upstream *\/` note inside the chain spoofed the guard.)
 * Naïve but adequate for a heuristic: strings rarely contain comment markers in
 * these query chains, and a false strip can only make the scanner STRICTER.
 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/**
 * Extract the argument substring of the LAST `.where(...)` in a statement chain,
 * with balanced-paren matching (the inner `and(eq(...), eq(...))` nests parens,
 * so a lazy `\)` regex truncates at the first close paren). Returns `null` when
 * the chain has no `.where(...)`. Comments are stripped from the result.
 *
 * Used for MUTATIONS (`.update()` / `.delete()`): the isolation predicate must
 * live in the WHERE filter, not merely somewhere in the chain — a
 * `.set({ tenantId })` assignment WRITES the column but does NOT scope the rows
 * being mutated, so it must not count as a tenant predicate.
 */
function whereClauseArg(chain) {
  const marker = ".where(";
  const at = chain.lastIndexOf(marker);
  if (at === -1) return null;
  let depth = 0;
  const open = at + marker.length - 1; // index of the '('
  for (let i = open; i < chain.length; i++) {
    const c = chain[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return stripComments(chain.slice(open + 1, i));
    }
  }
  return stripComments(chain.slice(open + 1)); // unterminated → take the rest
}

/**
 * Accept a `.where(scope)` / `.where(and(...conditions))` whose variable is
 * associated with a `tenantId` predicate within a local window before the
 * callsite (the common "build the conditions array first" pattern, and the
 * `const where = and(eq(t.tenantId, …), …)` pattern).
 *
 * Only BAREWORD variables count — identifiers that are NOT a property access
 * (`t.id`), NOT a function call (`eq(...)`), NOT a query helper, and NOT a
 * tenant-table name. This is critical: `.where(eq(contacts.id, x))` must NOT
 * be accepted just because an earlier scoped SELECT mentioned `contacts` and
 * `tenantId` within the window.
 */
function whereVarCarriesTenant(src, start, chain, tenantTables) {
  const argMatch =
    chain.match(/\.where\(([\s\S]*?)\)\s*(?:\.\w|;|$)/) ||
    chain.match(/\.values\(([\s\S]*?)\)\s*(?:\.\w|;|$)/);
  if (!argMatch) return false;
  const idents = new Set();
  // Lookbehind `(?<![.\w$])` (zero-width) excludes property accesses (`t.id`)
  // without consuming the anchor char — important so a spread `...conditions`
  // is still matched. group1 = optional spread; group2 = identifier;
  // group3 = following `.`/`(` (→ a property access or call, not a variable).
  const idRe = /(?<![.\w$])(\.\.\.)?([A-Za-z_$][\w$]*)\s*([.(]?)/g;
  let mm;
  while ((mm = idRe.exec(argMatch[1])) !== null) {
    const id = mm[2];
    const next = mm[3];
    if (next === "." || next === "(") continue; // property access or fn call
    if (WHERE_HELPERS.has(id)) continue;
    if (tenantTables.has(id)) continue; // a table reference, not a variable
    idents.add(id);
  }
  if (idents.size === 0) return false;
  const win = src.slice(Math.max(0, start - 2600), start);
  for (const id of idents) {
    const esc = id.replace(/[$]/g, "\\$");
    // The variable is associated with an isolation predicate (tenant or user).
    if (new RegExp("\\b" + esc + "\\b[\\s\\S]{0,400}(?:tenantId|webUserId)").test(win)) return true;
  }
  return false;
}

/** An intentional cross-tenant query is annotated `// tenant-scan-ignore: …`. */
function hasIgnoreDirective(src, start) {
  const lineStart = src.lastIndexOf("\n", start) + 1;
  const lineEnd = src.indexOf("\n", start);
  const region = src.slice(Math.max(0, lineStart - 260), lineEnd === -1 ? src.length : lineEnd);
  return /tenant-scan-ignore/.test(region);
}

/**
 * Authorize-then-act: this codebase frequently establishes the tenant boundary
 * with an explicit guard (`assertTenantOwner` / `assertTenantMember` /
 * `assertMaster` / `assertCanWriteScope`, …) at the top of a route handler, then
 * loads/mutates the row by primary id (having verified `row.tenantId === input
 * .tenantId`). Accept a query when such an `assert*(…)` guard appears earlier in
 * the SAME `.mutation()/.query()` handler. The mutation-by-id is then operating
 * inside an authorized tenant scope. A query with NO scope, NO user predicate,
 * and NO preceding guard is still flagged — that's the careless case we catch.
 */
function enclosingHasAuthGuard(src, start) {
  const handlerStart = Math.max(
    src.lastIndexOf(".mutation(", start),
    src.lastIndexOf(".query(", start),
    0,
  );
  // `assert*` is the dominant guard family; `ownerOnlyForTenant` is the one
  // tenant-ownership guard that doesn't follow the assert* naming.
  return /\b(?:assert[A-Z]\w*|ownerOnlyForTenant)\s*\(/.test(src.slice(handlerStart, start));
}

/**
 * Scan one TS source string. Returns an array of findings:
 * `{ line, op, table }` for each tenant-scoped query missing a tenantId
 * predicate (and lacking a tenant-scan-ignore directive).
 */
export function scanSource(src, tenantTables) {
  const findings = [];
  let m;
  CALLSITE_RE.lastIndex = 0;
  while ((m = CALLSITE_RE.exec(src)) !== null) {
    const op = m[1];
    const table = m[2];
    const start = m.index;
    if (!tenantTables.has(table)) continue;
    const chain = statementChain(src, start);
    // Accepted isolation predicates: tenant scoping OR per-user scoping
    // (web-user-owned rows like notifications / push subscriptions isolate by
    // webUserId, which is at least as strong as tenantId).
    //
    // SELECT (`.from`) / INSERT (`.values`): the predicate may appear anywhere in
    // the chain — a SELECT has no `.set()`, and an INSERT legitimately carries
    // `tenantId` in its `.values({...})` payload (that IS how it scopes the new
    // row). Comments are stripped so a commented-out keyword can't spoof it.
    //
    // UPDATE / DELETE: the predicate MUST be in the `.where(...)` filter. A
    // `.update(t).set({ tenantId }).where(eq(t.id, …))` writes the tenant column
    // but filters rows by id alone — a cross-tenant write the loose chain check
    // would have waved through. Require the isolation predicate in the WHERE.
    const isMutationByRows = op === "update" || op === "delete";
    const predicateScope = isMutationByRows
      ? whereClauseArg(chain) // null when there is no .where() at all
      : stripComments(chain);
    if (predicateScope !== null && /\b(tenantId|webUserId)\b/.test(predicateScope)) continue;
    if (whereVarCarriesTenant(src, start, chain, tenantTables)) continue;
    if (enclosingHasAuthGuard(src, start)) continue;
    if (hasIgnoreDirective(src, start)) continue;
    findings.push({ line: lineNumberFor(src, start), op, table });
  }
  return findings;
}

function listRouterFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listRouterFiles(full));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function main() {
  const tenantTables = deriveTenantScopedTables(readFileSync(SCHEMA_FILE, "utf8"));
  const files = listRouterFiles(ROUTERS_DIR);
  let found = 0;

  for (const file of files) {
    const base = file.split("/").pop();
    if (SKIP_FILES.has(base)) continue;
    const src = readFileSync(file, "utf8");
    const rel = file.replace(process.cwd() + "/", "");
    for (const f of scanSource(src, tenantTables)) {
      found++;
      console.error(
        `❌ ${rel}:${f.line} — .${f.op}(${f.table}) on a tenant-scoped table ` +
        `with no "tenantId" predicate in its query chain.`,
      );
    }
  }

  if (found > 0) {
    console.error("");
    console.error(`Found ${found} potential tenant-isolation gap(s).`);
    console.error(
      "Fix by adding a tenantId predicate to the query, or — if the query is an " +
      "intentional cross-tenant (system_admin) operation — annotate it with " +
      "`// tenant-scan-ignore: <reason>` on the line above.",
    );
    process.exit(1);
  }

  console.log(
    `✅ Scanned ${files.length} router file(s) against ${tenantTables.size} ` +
    `tenant-scoped table(s); no missing tenantId predicates.`,
  );
}

// Run as CLI only — importing the module (unit tests) must not invoke main().
const invokedAsCli =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) main();
