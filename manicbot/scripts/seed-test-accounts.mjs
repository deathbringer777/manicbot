#!/usr/bin/env node
/**
 * seed-test-accounts.mjs — provision the canonical 8 test accounts for
 * regression of billing, roles, and the public catalog.
 *
 * Idempotent: tenant IDs and web_user IDs are derived deterministically from
 * the lower-cased email, so re-runs do not create duplicates (uses
 * INSERT OR IGNORE).
 *
 * Usage:
 *   node scripts/seed-test-accounts.mjs                # print SQL to stdout
 *   node scripts/seed-test-accounts.mjs --apply        # also apply to remote D1 via wrangler
 *   node scripts/seed-test-accounts.mjs --apply --local
 *   node scripts/seed-test-accounts.mjs --password 'Custom!Pass1'
 *
 * The hash format matches `admin-app/src/server/auth/password.ts` v2:
 *   pbkdf2:{iterations}:{saltHex}:{hashHex}
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_PASSWORD = "TestPass!2026";
const DB_BINDING = process.env.D1_BINDING || "manicbot";
const ITERATIONS = 100_000; // matches admin-app/src/server/auth/password.ts DEFAULT_ITERATIONS
const KEY_LEN_BITS = 256;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LOCAL = args.includes("--local");
const passwordIdx = args.indexOf("--password");
const PASSWORD = passwordIdx >= 0 ? args[passwordIdx + 1] : DEFAULT_PASSWORD;

if (!PASSWORD || PASSWORD.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}

// ─── Deterministic IDs ──────────────────────────────────────────────────────
const enc = new TextEncoder();
function hexEncode(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return hexEncode(buf);
}
function deterministicTenantId(email) {
  // Hash → first 12 hex chars; prefix with "t_test_"
  // (computed sync via FNV-1a since we want a usable ID without await chains)
  let h = 2166136261n;
  for (const c of email) {
    h ^= BigInt(c.charCodeAt(0));
    h = (h * 16777619n) & 0xffffffffn;
  }
  return "t_test_" + h.toString(16).padStart(8, "0");
}
function deterministicWebUserId(email) {
  let h = 2166136261n;
  for (const c of "wu" + email) {
    h ^= BigInt(c.charCodeAt(0));
    h = (h * 16777619n) & 0xffffffffn;
  }
  return "wu_test_" + h.toString(16).padStart(8, "0");
}
function deterministicMasterChatId(email) {
  let h = 2166136261n;
  for (const c of "m" + email) {
    h ^= BigInt(c.charCodeAt(0));
    h = (h * 16777619n) & 0xffffffffn;
  }
  return 10_000_000_000 + Number(h % 1_000_000_000n);
}

// ─── PBKDF2 (Web Crypto) ────────────────────────────────────────────────────
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_LEN_BITS,
  );
  return `pbkdf2:${ITERATIONS}:${hexEncode(salt.buffer)}:${hexEncode(bits)}`;
}

// ─── SQL helpers ────────────────────────────────────────────────────────────
function sqlString(s) {
  if (s == null) return "NULL";
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function sqlInt(n) {
  if (n == null) return "NULL";
  return String(Math.floor(n));
}

function slugify(name) {
  const map = {
    а:"a",б:"b",в:"v",г:"g",ґ:"g",д:"d",е:"e",є:"ie",ё:"e",ж:"zh",з:"z",и:"y",
    і:"i",ї:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",
    у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"iu",я:"ia",
  };
  return name
    .toLowerCase()
    .replace(/[а-яёіїєґ]/g, (c) => map[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ─── Account roster ─────────────────────────────────────────────────────────
// Group A — annual paid subscriptions (active, current_period_end = now + 365d)
// Group B — expired trials (trialing, trial_ends_at = now - 86400)
const ACCOUNTS = [
  { kind: "salon",  plan: "start", email: "salon-start@test.manicbot.local",  name: "Test Салон Start",  city: "Київ" },
  { kind: "salon",  plan: "pro",   email: "salon-pro@test.manicbot.local",    name: "Test Салон Pro",    city: "Київ" },
  { kind: "salon",  plan: "max",   email: "salon-max@test.manicbot.local",    name: "Test Салон Max",    city: "Київ" },
  { kind: "master", plan: "start", email: "master-start@test.manicbot.local", name: "Test Майстер Start", city: "Київ" },
  { kind: "master", plan: "pro",   email: "master-pro@test.manicbot.local",   name: "Test Майстер Pro",   city: "Київ" },
  { kind: "master", plan: "max",   email: "master-max@test.manicbot.local",   name: "Test Майстер Max",   city: "Київ" },
  { kind: "salon",  plan: "expired_trial", email: "salon-trial@test.manicbot.local",  name: "Test Салон Trial",  city: "Київ" },
  { kind: "master", plan: "expired_trial", email: "master-trial@test.manicbot.local", name: "Test Майстер Trial", city: "Київ" },
];

// ─── Build SQL ──────────────────────────────────────────────────────────────
const now = Math.floor(Date.now() / 1000);
const sqlLines = [`-- ManicBot test-accounts seed (generated ${new Date().toISOString()})`];
const summary = [];

for (const acc of ACCOUNTS) {
  const email = acc.email.toLowerCase().trim();
  const tenantId = deterministicTenantId(email);
  const webUserId = deterministicWebUserId(email);
  const slug = `${slugify(acc.name)}-${tenantId.slice(-4)}`;
  const isPersonal = acc.kind === "master" ? 1 : 0;
  const isExpired = acc.plan === "expired_trial";
  const planValue = isExpired ? "start" : acc.plan;
  const billingStatus = isExpired ? "trialing" : "active";
  const currentPeriodEnd = isExpired ? null : now + 365 * 86400;
  const trialEndsAt = isExpired ? now - 86400 : null;

  sqlLines.push(
    `INSERT OR IGNORE INTO tenants (id, name, active, plan, billing_status, trial_ends_at, grace_ends_at, current_period_end, cancel_at_period_end, slug, city, public_active, is_personal, industry, is_test, created_at, updated_at) VALUES (` +
      [
        sqlString(tenantId),
        sqlString(acc.name),
        "1",
        sqlString(planValue),
        sqlString(billingStatus),
        sqlInt(trialEndsAt),
        "NULL",
        sqlInt(currentPeriodEnd),
        "0",
        sqlString(slug),
        sqlString(acc.city),
        "1",
        String(isPersonal),
        sqlString("beauty"),
        "1",
        sqlInt(now),
        sqlInt(now),
      ].join(", ") +
      `);`,
  );

  if (acc.kind === "master") {
    const masterChatId = deterministicMasterChatId(email);
    sqlLines.push(
      `INSERT OR IGNORE INTO masters (tenant_id, chat_id, name, active, added_at) VALUES (` +
        [sqlString(tenantId), String(masterChatId), sqlString(acc.name), "1", sqlInt(now)].join(", ") +
        `);`,
    );
  }

  const passwordHash = await hashPassword(PASSWORD);
  const role = acc.kind === "master" ? "master" : "tenant_owner";
  sqlLines.push(
    `INSERT OR IGNORE INTO web_users (id, email, password_hash, role, tenant_id, name, lang, email_verified, tos_accepted_at, created_at, updated_at) VALUES (` +
      [
        sqlString(webUserId),
        sqlString(email),
        sqlString(passwordHash),
        sqlString(role),
        sqlString(tenantId),
        sqlString(acc.name),
        sqlString("ua"),
        "1",
        sqlInt(now),
        sqlInt(now),
        sqlInt(now),
      ].join(", ") +
      `);`,
  );

  summary.push({
    email,
    role,
    plan: planValue,
    billing: billingStatus,
    tenantId,
    expires: isExpired
      ? `trial_ends_at=${trialEndsAt} (expired)`
      : `current_period_end=${currentPeriodEnd}`,
  });
}

const sqlText = sqlLines.join("\n") + "\n";

if (APPLY) {
  const dir = mkdtempSync(join(tmpdir(), "manicbot-seed-"));
  const file = join(dir, "test-accounts.sql");
  writeFileSync(file, sqlText);
  process.stderr.write(`Applying ${ACCOUNTS.length} accounts to D1 (${LOCAL ? "local" : "remote"})…\n`);
  const wranglerArgs = ["wrangler", "d1", "execute", DB_BINDING, "--file", file, LOCAL ? "--local" : "--remote"];
  const r = spawnSync("npx", wranglerArgs, { stdio: "inherit" });
  if (r.status !== 0) {
    process.stderr.write(`Wrangler exited with status ${r.status}\n`);
    process.exit(r.status ?? 1);
  }
} else {
  process.stdout.write(sqlText);
}

// ─── Summary ────────────────────────────────────────────────────────────────
process.stderr.write(`\n## Test accounts (password: ${PASSWORD})\n\n`);
process.stderr.write(`| email | role | plan | billing | tenant | expires |\n`);
process.stderr.write(`|---|---|---|---|---|---|\n`);
for (const r of summary) {
  process.stderr.write(`| ${r.email} | ${r.role} | ${r.plan} | ${r.billing} | ${r.tenantId} | ${r.expires} |\n`);
}
process.stderr.write(`\nDone. ${APPLY ? "Applied to D1." : "Pipe stdout into wrangler or re-run with --apply."}\n`);
