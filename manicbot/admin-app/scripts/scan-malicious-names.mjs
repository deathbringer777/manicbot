#!/usr/bin/env node
/**
 * One-time scan of `web_users.name` and `users.name` for values that would
 * fail the new `isSafeDisplayName` predicate from `src/server/security/sanitize.ts`.
 *
 * Output format: CSV to stdout. The script does NOT delete or rewrite rows
 * — that's deliberate. The founder decides per-row what to do (rename via
 * the dashboard, archive the user, contact them, etc.).
 *
 * Usage:
 *   node scripts/scan-malicious-names.mjs --remote
 *   node scripts/scan-malicious-names.mjs --remote > /tmp/bad-names.csv
 *
 * Flags:
 *   --remote          Query the production D1 (default --local).
 *   --db <name>       Override the database name (default: manicbot-db).
 *   --include <pat>   Comma-separated table:column pairs to additionally
 *                     scan (default: just `web_users:name` and `users:name`).
 *
 * No npm dependencies — uses `wrangler d1 execute` under the hood. Run
 * from the `manicbot/` directory.
 *
 * Exit codes:
 *   0 — scan completed; output the row count + CSV
 *   1 — wrangler failure or invalid args
 */

import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = parseArgs(process.argv.slice(2));
const REMOTE = args.remote ? "--remote" : "--local";
const DB = args.db || "manicbot-db";

const TARGETS = [
  { table: "web_users", column: "name", idColumn: "id" },
  { table: "users", column: "name", idColumn: "chat_id" },
];

if (args.include) {
  for (const pair of args.include.split(",")) {
    const [table, column] = pair.split(":");
    if (table && column) TARGETS.push({ table: table.trim(), column: column.trim(), idColumn: "id" });
  }
}

if (args.help) {
  console.log(__usage());
  process.exit(0);
}

run().catch((e) => {
  console.error(`[scan-names] FAIL — ${e.message}`);
  process.exit(1);
});

async function run() {
  process.stderr.write(`[scan-names] target: ${DB} (${REMOTE.slice(2)})\n`);
  process.stdout.write("source,id,bad_chars,raw\n");
  let total = 0;
  for (const t of TARGETS) {
    const rows = await wranglerQuery(
      `SELECT ${t.idColumn} AS id, ${t.column} AS val FROM ${t.table} WHERE ${t.column} IS NOT NULL AND ${t.column} != ''`,
    );
    process.stderr.write(`[scan-names] ${t.table}.${t.column}: ${rows.length} rows scanned\n`);
    for (const row of rows) {
      const verdict = inspect(String(row.val));
      if (verdict.bad) {
        total++;
        const csvLine = [
          `${t.table}.${t.column}`,
          quoteCsv(String(row.id)),
          quoteCsv(verdict.reasons.join("|")),
          quoteCsv(String(row.val).slice(0, 200)),
        ].join(",");
        process.stdout.write(csvLine + "\n");
      }
    }
  }
  process.stderr.write(`[scan-names] DONE — ${total} malicious row(s) found\n`);
}

function inspect(s) {
  const reasons = [];
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(s)) reasons.push("control_byte");
  if (/[\r\n]/.test(s)) reasons.push("crlf");
  if (/[<>]/.test(s)) reasons.push("angle_bracket");
  if (/[&"]/.test(s)) reasons.push("html_meta");
  if (/[​-‍﻿]/.test(s)) reasons.push("zero_width");
  if (/^[‪-‮⁦-⁩‎‏]/.test(s)) reasons.push("leading_rtl_override");
  return { bad: reasons.length > 0, reasons };
}

function quoteCsv(v) {
  if (/[,"\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function wranglerQuery(sql) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "wquery-"));
    const file = join(dir, "q.sql");
    writeFileSync(file, sql + ";\n");
    const proc = spawn(
      "npx",
      ["wrangler", "d1", "execute", DB, REMOTE, "--json", "--file", file],
      { stdio: ["ignore", "pipe", "inherit"], env: process.env },
    );
    let buf = "";
    proc.stdout.on("data", (chunk) => { buf += chunk.toString(); });
    proc.on("exit", (code) => {
      try { unlinkSync(file); } catch { /* ok */ }
      if (code !== 0) return reject(new Error(`wrangler exited ${code}`));
      try {
        const parsed = JSON.parse(buf);
        const results = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
        resolve(results || []);
      } catch (e) {
        reject(new Error(`could not parse wrangler output: ${e.message}`));
      }
    });
    proc.on("error", reject);
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--remote") out.remote = true;
    else if (a === "--local") out.remote = false;
    else if (a === "--db") out.db = argv[++i];
    else if (a === "--include") out.include = argv[++i];
  }
  return out;
}

function __usage() {
  return `Usage: node scripts/scan-malicious-names.mjs [--remote|--local] [--db <name>]

Scans web_users.name + users.name for values that fail isSafeDisplayName().
Writes a CSV to stdout: source,id,bad_chars,raw.
Does NOT modify any row — read-only.

Operator runbook: docs/runbooks/d1-restore.md companion (Blocker 4
remediation report). Manually decide per row: rename via dashboard,
archive the user, or contact them.
`;
}
