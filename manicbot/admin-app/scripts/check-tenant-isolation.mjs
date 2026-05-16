#!/usr/bin/env node
/**
 * Tenant-isolation scanner for admin-app tRPC routers (CI guard).
 *
 * Reads every Drizzle query expression in `src/server/api/routers/*.ts`,
 * looks at any `.from(<table>)` call referencing a tenant-scoped table, and
 * fails if the chained `.where(...)` for that query does not mention
 * `tenantId`. This is a heuristic — it cannot fully understand TypeScript —
 * but it catches the regression we care about: a developer adding a new
 * query against `appointments` / `masters` / `services` / etc. that forgets
 * the `eq(<table>.tenantId, ...)` predicate.
 *
 * Run:
 *   cd manicbot/admin-app && node scripts/check-tenant-isolation.mjs
 *   exit 0 → all good
 *   exit 1 → found a query that needs review
 *
 * Wired into CI alongside `npm test` (see .github/workflows/deploy.yml).
 *
 * Maintenance: extend `TENANT_SCOPED_TABLES` when a new tenant-scoped table
 * is added to the Drizzle schema. The list is intentionally hand-maintained
 * because Drizzle's tableConfig metadata is awkward to read at script time.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROUTERS_DIR = join(process.cwd(), "src", "server", "api", "routers");

/**
 * Tables whose rows are partitioned per tenant. Every SELECT/UPDATE/DELETE
 * against these tables MUST carry a `tenantId` predicate in WHERE.
 */
const TENANT_SCOPED_TABLES = new Set([
  "appointments",
  "masters",
  "services",
  "users",
  "tenantConfig",
  "conversations",
  "messageWindows",
  "channelConfigs",
  "googleIntegrations",
  "googleBusyBlocks",
  "marketingSegments",
  "marketingTemplates",
  "marketingCampaigns",
  "marketingSends",
  "localTickets",
  "tenantRoles",
  "tenantMemberPermissions",
  "tenantActionRequests",
  "permissionElevationCodes",
  "bots",
]);

/**
 * Tables that look tenant-scoped but are intentionally NOT — they're
 * keyed by something else (web-user id, global resources, etc.). The
 * scanner skips queries touching only these.
 */
const GLOBAL_OR_USER_SCOPED_TABLES = new Set([
  "tenants",
  "platformRoles",
  "platformTickets",
  "platformTicketMessages",
  "supportAgents",
  "stripeEvents",
  "stripeCustomers",
  "rateLimits",
  "webUsers",
  "auditLog",
  "marketingContacts",
  "marketingProviders",
  "marketingConsentLog",
  "marketingAutomations",
  "pluginInstallations",
  "pluginEvents",
  "emailSubscribers",
  "emailSuppressions",
  "leads",
  "tenantFts",
  "roleChangeRequests",
]);

/**
 * Files that are explicitly cross-tenant by design (system_admin god-mode
 * routers). The scanner skips these to avoid false positives. Adding a file
 * here is a deliberate audit decision — review the file before adding it.
 */
const SKIP_FILES = new Set([
  "marketing.ts",            // adminProcedure-only, by design cross-tenant CRM
  "tenants.ts",              // adminProcedure-only platform tenant management
  "users.ts",                // adminProcedure-only platform user listing
  "metrics.ts",
  "system.ts",
  "events.ts",
  "settings.ts",
  "stripe.ts",
  "billing.ts",
  "provisioning.ts",
  "export.ts",
  "support.ts",              // platform staff cross-tenant by design
  "search.ts",               // global search (system_admin)
  "appointments.ts",         // adminProcedure-only (system_admin); tenantId filter is optional
]);

/**
 * Specific (file, line) hits that have been audited and confirmed as
 * intentional. The scanner skips them. Each entry MUST be commented with
 * the rationale so a future reader can re-validate.
 */
const ALLOWLIST = new Set([
  // salon.ts:<LINE> — bot_id collision check across tenants (intentional
  // global lookup, cross-tenant by design). The procedure is
  // tenantOwnerProcedure-gated; this read confirms the bot isn't already
  // claimed by SOMEONE ELSE before we accept it. Line drift history: 883
  // (initial) → 913 → 920 → 937 → 964 (master-invitation imports +
  // URL-hardening regexes from clients/public-profile PR) → current
  // (after PR-A permission unification + PR-B referral helpers merged).
  "src/server/api/routers/salon.ts:1049",
  // tenantStaff.ts — permissionElevationCodes lookup by primary key.
  // Owner/system_admin check on next line gates access; tenantId predicate
  // is unnecessary because the row id is globally unique and authorization
  // is by ownerUserId. Line drifted after listMembers extension for masters (PR-A).
  "src/server/api/routers/tenantStaff.ts:381",
  // tenantStaff.ts:540 — tenantActionRequests query. The `where` variable is
  // built two lines above and DOES include eq(table.tenantId, input.tenantId).
  // The scanner's 800-char window misses the prior assignment. Line drifted
  // 525 → 540 after listMembers extension for masters (PR-A).
  "src/server/api/routers/tenantStaff.ts:540",
]);

function listRouterFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listRouterFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Walk a TS source string and yield each `.from(<id>)` callsite plus a
 * heuristic snippet covering its query chain. We grab ~600 chars after the
 * `.from(` so chained `.where(...)` is included; that's enough for the
 * existing router patterns and avoids parsing TS for real.
 */
function findFromCallsites(src) {
  const out = [];
  const re = /\.from\(\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\)/g;
  let match;
  while ((match = re.exec(src)) !== null) {
    const tableName = match[1];
    const start = match.index;
    // Capture up to the next semicolon-ending statement or 600 chars.
    const tail = src.slice(start, start + 800);
    out.push({ tableName, snippet: tail, lineNumber: lineNumberFor(src, start) });
  }
  return out;
}

function lineNumberFor(src, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function isWhitelisted(snippet) {
  // Snippet must reference `tenantId` somewhere in its chain. Allow
  // either `.tenantId,` (Drizzle column ref) or string literal `tenantId`
  // (manual query construction is rare but happens in marketing).
  return /tenantId/.test(snippet);
}

function main() {
  const files = listRouterFiles(ROUTERS_DIR);
  let found = 0;

  for (const file of files) {
    const base = file.split("/").pop();
    if (SKIP_FILES.has(base)) continue;
    const src = readFileSync(file, "utf8");
    const relPath = file.replace(process.cwd() + "/", "");
    for (const cs of findFromCallsites(src)) {
      const t = cs.tableName;
      if (!TENANT_SCOPED_TABLES.has(t)) continue; // skip global/user-scoped
      if (isWhitelisted(cs.snippet)) continue;
      const allowKey = `${relPath}:${cs.lineNumber}`;
      if (ALLOWLIST.has(allowKey)) continue;
      found++;
      console.error(
        `❌ Possible tenant-isolation gap: ${allowKey} — ` +
        `query .from(${t}) chain does not mention "tenantId" in the next 800 chars.`,
      );
    }
  }

  if (found > 0) {
    console.error("");
    console.error(`Found ${found} potential gap(s).`);
    console.error(
      "If a hit is intentional (e.g. cross-tenant system_admin operation), add the router file " +
      "to SKIP_FILES in scripts/check-tenant-isolation.mjs with a comment explaining why.",
    );
    process.exit(1);
  }

  console.log(`✅ Scanned ${files.length} router file(s); no missing tenantId predicates.`);
}

main();
