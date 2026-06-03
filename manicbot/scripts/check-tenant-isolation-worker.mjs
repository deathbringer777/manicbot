#!/usr/bin/env node
// @ts-nocheck — standalone Node CLI/CI script (run via `node scripts/...`).
/**
 * Tenant-isolation scanner for the Cloudflare Worker (raw D1 SQL).
 *
 * The Worker has no automated tenant-isolation guard (the admin-app scanner only
 * covers the Drizzle routers). The Worker queries D1 with RAW SQL — single-line
 * strings and multi-line template literals — via `dbAll/dbRun/dbGet(ctx, sql, …)`
 * and `env.DB.prepare(sql).bind(…)`. This script flags any SQL statement that
 * touches a tenant-scoped table (`FROM/INTO/UPDATE/JOIN <table>`) without a
 * `tenant_id` predicate/column scoping the rows it reads or writes.
 *
 * It is a heuristic (it does not parse SQL): for each `FROM/INTO/UPDATE/JOIN
 * <tenant_table>` it looks ~450 chars forward (the rest of the statement) for
 * `tenant_id` / `web_user_id`. Two refinements close write-side false-negatives
 * (mirrors the admin-app scanner, PR #350):
 *   - ROW MUTATIONS (UPDATE / DELETE) must carry the predicate in their WHERE
 *     filter, not merely anywhere in the statement: `UPDATE t SET tenant_id = ?
 *     WHERE id = ?` writes the tenant column but filters rows by id alone — a
 *     cross-tenant write. A mutation with no WHERE at all is likewise flagged.
 *   - SQL COMMENTS are stripped before the keyword test, so a `/* tenant_id *\/`
 *     or `-- tenant_id` note can't spoof the presence check.
 *
 * Intentional cross-tenant queries — the bot/webhook→tenant RESOLVERS the Worker
 * uses to discover which tenant an inbound message belongs to, signature-verified
 * webhook handlers, and genuinely global tables — are annotated inline with
 * `// tenant-scan-ignore: <reason>` on the line above the query.
 *
 * Run:
 *   cd manicbot && node scripts/check-tenant-isolation-worker.mjs
 *   exit 0 → all good   |   exit 1 → a query needs a tenant_id predicate / directive
 *
 * Wired into CI (see .github/workflows/deploy.yml) so the Worker deploy gate
 * fails on a regression, the same way the admin-app scanner gates Pages.
 */
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(process.cwd(), "src");
const SCHEMA_FILE = join(process.cwd(), "src", "db", "schema.sql");

/**
 * Tables that carry a `tenant_id` column but are global / telemetry / platform
 * by design (append-only logs, cross-tenant audit, web-user identity, platform
 * support). Access is not partitioned per tenant. Keep small + documented.
 */
export const PLATFORM_GLOBAL_TABLES = new Set([
  "web_users", // auth identity
  "audit_log", // cross-tenant audit trail
  "analytics_events", // append-only telemetry
  "error_events", // append-only telemetry
  "error_log", // append-only telemetry
  "ai_usage", // usage metering (aggregated cross-tenant)
  "platform_tickets", // platform support queue
]);

/**
 * Derive tenant-scoped table names (snake_case) from schema.sql: any CREATE
 * TABLE whose body declares a `tenant_id` column. `\btenant_id\b` does NOT
 * match relationship columns like `referrer_tenant_id` / `owner_tenant_id`
 * (no word boundary before `tenant`), so two-tenant tables (referrals) are
 * correctly excluded.
 */
export function deriveTenantScopedTables(schemaSql) {
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["'`]?([a-z0-9_]+)["'`]?\s*\(/gi;
  const decls = [];
  let m;
  while ((m = re.exec(schemaSql)) !== null) decls.push({ name: m[1], at: m.index });
  const out = new Set();
  for (let i = 0; i < decls.length; i++) {
    const end = i + 1 < decls.length ? decls[i + 1].at : schemaSql.length;
    const body = schemaSql.slice(decls[i].at, end);
    if (/\btenant_id\b/.test(body) && !PLATFORM_GLOBAL_TABLES.has(decls[i].name)) {
      out.add(decls[i].name);
    }
  }
  return out;
}

/**
 * Worker source files that are cross-tenant / platform by design — every query
 * is system-level, not partitioned per tenant. Verified (2026-06-02):
 *   - marketing/autopilot.js  → "@manicbot_com isn't a tenant" (platform's own IG)
 *   - http/adminKeyHttp.js     → ADMIN_KEY-gated system_admin HTTP surface
 *   - services/platformCampaigns.js → platform broadcast campaigns
 * Adding a file here is a deliberate audit decision — review it first.
 */
export const SKIP_FILES = new Set([
  "autopilot.js",
  "adminKeyHttp.js",
  "platformCampaigns.js",
]);

// A table reference inside a SQL statement: the keyword that precedes a table
// name is FROM (SELECT / DELETE FROM), INTO (INSERT), UPDATE, or JOIN. Group 1
// captures the keyword so UPDATE (and DELETE, detected via the FROM that follows
// a `DELETE`) can be treated as a row-mutation that must scope in its WHERE.
const SQL_REF_RE = /\b(FROM|INTO|UPDATE|JOIN)\s+["'`]?([a-z][a-z0-9_]*)\b/gi;
const STATEMENT_WINDOW = 450;

function lineNumberFor(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Strip `-- …` line comments and `/* … *\/` block comments from a SQL snippet so
 * a predicate keyword that only appears inside a comment can't satisfy the
 * isolation check (Gap B — mirrors the admin-app scanner's `stripComments`).
 * A `/* tenant_id handled upstream *\/` note inside the statement previously
 * spoofed the keyword test. Naïve but adequate for a heuristic: a false strip
 * can only make the scanner STRICTER, never looser.
 */
export function stripSqlComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/**
 * Extract the WHERE portion of a (windowed) SQL statement: everything from the
 * first top-level `WHERE` keyword to the end of the window. Returns `null` when
 * the statement has no WHERE at all.
 *
 * Used for row-mutations (UPDATE / DELETE): the isolation predicate must live in
 * the WHERE filter, not merely somewhere in the statement (Gap A). A
 * `UPDATE t SET tenant_id = ? WHERE id = ?` WRITES the tenant column but filters
 * the rows being mutated by id alone — a cross-tenant write the loose
 * anywhere-in-window check would have waved through. The SET clause sits before
 * the WHERE, so slicing from WHERE forward correctly excludes it. Comments are
 * stripped first so a commented-out WHERE keyword can't be picked up.
 */
export function whereClause(windowSrc) {
  const stripped = stripSqlComments(windowSrc);
  const m = /\bWHERE\b/i.exec(stripped);
  if (!m) return null;
  return stripped.slice(m.index);
}

/** An intentional cross-tenant query is annotated `// tenant-scan-ignore: …`. */
function hasIgnoreDirective(src, start) {
  const lineStart = src.lastIndexOf("\n", start) + 1;
  const lineEnd = src.indexOf("\n", start);
  const region = src.slice(Math.max(0, lineStart - 300), lineEnd === -1 ? src.length : lineEnd);
  return /tenant-scan-ignore/.test(region);
}

const ISOLATION_PREDICATE_RE = /\b(?:tenant_id|web_user_id)\b/;

/**
 * Scan one JS source string. Returns `{ line, table }` for each tenant-scoped
 * table reference whose statement lacks a `tenant_id` predicate (and has no
 * tenant-scan-ignore directive).
 */
export function scanSource(src, tenantTables) {
  const findings = [];
  let m;
  SQL_REF_RE.lastIndex = 0;
  while ((m = SQL_REF_RE.exec(src)) !== null) {
    const keyword = m[1].toUpperCase();
    const table = m[2].toLowerCase();
    if (!tenantTables.has(table)) continue;
    const start = m.index;
    const window = src.slice(start, start + STATEMENT_WINDOW);

    // Classify the operation. UPDATE is explicit. A DELETE reaches this loop via
    // its `FROM` keyword (`DELETE FROM <table>`), so peek just behind the match
    // for a preceding `DELETE`. Both are row-mutations whose tenant predicate
    // MUST sit in the WHERE filter, not merely anywhere in the statement.
    const isUpdate = keyword === "UPDATE";
    const precededByDelete =
      keyword === "FROM" && /\bDELETE\s*$/i.test(stripSqlComments(src.slice(Math.max(0, start - 12), start)));
    const isRowMutation = isUpdate || precededByDelete;

    // Accepted isolation predicates: tenant scoping OR per-user scoping
    // (web_user-owned rows — notifications / push subscriptions — isolate by
    // web_user_id, which is at least as strong as tenant_id).
    //
    // SELECT (`FROM`) / INSERT (`INTO`) / JOIN: the predicate may appear anywhere
    // in the (comment-stripped) statement — a SELECT/INSERT has no SET clause,
    // and an INSERT legitimately carries `tenant_id` in its VALUES (that IS how
    // it scopes the new row).
    //
    // UPDATE / DELETE: require the predicate inside the WHERE filter. No WHERE at
    // all (`whereClause` → null) means there is nothing to scope on → flagged.
    const scopeText = isRowMutation ? whereClause(window) : stripSqlComments(window);
    if (scopeText !== null && ISOLATION_PREDICATE_RE.test(scopeText)) continue;
    if (hasIgnoreDirective(src, start)) continue;
    findings.push({ line: lineNumberFor(src, start), table });
  }
  return findings;
}

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

function main() {
  const tenantTables = deriveTenantScopedTables(readFileSync(SCHEMA_FILE, "utf8"));
  const files = listJsFiles(SRC_DIR);
  let found = 0;

  for (const file of files) {
    const base = file.split("/").pop();
    if (SKIP_FILES.has(base)) continue;
    const src = readFileSync(file, "utf8");
    const rel = file.replace(process.cwd() + "/", "");
    for (const f of scanSource(src, tenantTables)) {
      found++;
      console.error(
        `❌ ${rel}:${f.line} — SQL on tenant-scoped table "${f.table}" ` +
        `with no "tenant_id" predicate in the statement.`,
      );
    }
  }

  if (found > 0) {
    console.error("");
    console.error(`Found ${found} potential tenant-isolation gap(s) in the Worker.`);
    console.error(
      "Fix by adding `tenant_id = ?` to the query, or — if the query is an " +
      "intentional cross-tenant operation (bot/webhook→tenant resolver, " +
      "signature-verified webhook, global table) — annotate it with " +
      "`// tenant-scan-ignore: <reason>` on the line above.",
    );
    process.exit(1);
  }

  console.log(
    `✅ Scanned ${files.length} Worker source file(s) against ${tenantTables.size} ` +
    `tenant-scoped table(s); no missing tenant_id predicates.`,
  );
}

const invokedAsCli =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) main();
