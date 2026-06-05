#!/usr/bin/env node
/**
 * flag-existing-tenants-test.mjs — mark existing tenants as test (is_test=1).
 *
 * Context: every salon currently in prod was created for testing — many through
 * the normal signup flow, so they never received the seeder's is_test=1. The
 * business metrics now EXCLUDE is_test=1 tenants (see admin-app/src/server/metrics),
 * so flagging the existing tenants makes the dashboard tell the truth
 * (≈0 real paying, 0 MRR) WITHOUT deleting any data.
 *
 * Reversible: re-run with --unflag to clear the flag. Pass --keep to spare the
 * ids of any genuinely-real tenants so they keep counting.
 *
 * Usage:
 *   node scripts/flag-existing-tenants-test.mjs                      # print SQL (dry run)
 *   node scripts/flag-existing-tenants-test.mjs --apply              # apply to remote D1
 *   node scripts/flag-existing-tenants-test.mjs --apply --local      # apply to local D1
 *   node scripts/flag-existing-tenants-test.mjs --keep t_abc,t_def   # spare real tenants
 *   node scripts/flag-existing-tenants-test.mjs --unflag --apply     # reverse the flag
 *
 * Run from the `manicbot/` directory (where wrangler.toml lives). The D1 binding
 * defaults to `manicbot`; override with D1_BINDING.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_BINDING = process.env.D1_BINDING || "manicbot";
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LOCAL = args.includes("--local");
const UNFLAG = args.includes("--unflag");

const keepIdx = args.indexOf("--keep");
const KEEP =
  keepIdx >= 0 && args[keepIdx + 1]
    ? args[keepIdx + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : [];

const target = UNFLAG ? 0 : 1; // value to set is_test to
const from = UNFLAG ? 1 : 0; // only touch rows currently in the opposite state
const now = Math.floor(Date.now() / 1000);

const sqlQuote = (id) => `'${String(id).replace(/'/g, "''")}'`;
const keepClause = KEEP.length ? ` AND id NOT IN (${KEEP.map(sqlQuote).join(", ")})` : "";

const sql = `UPDATE tenants SET is_test = ${target}, updated_at = ${now} WHERE is_test = ${from}${keepClause};`;

process.stdout.write(sql + "\n");

if (APPLY) {
  const dir = mkdtempSync(join(tmpdir(), "flag-tenants-"));
  const file = join(dir, "flag.sql");
  writeFileSync(file, sql);
  const wranglerArgs = ["wrangler", "d1", "execute", DB_BINDING, "--file", file, LOCAL ? "--local" : "--remote"];
  const r = spawnSync("npx", wranglerArgs, { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

process.stderr.write(
  `\nDry run — re-run with --apply to execute.` +
    (KEEP.length ? ` Sparing real tenants: ${KEEP.join(", ")}` : "") +
    "\n",
);
