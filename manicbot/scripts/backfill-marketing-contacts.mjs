#!/usr/bin/env node
/**
 * backfill-marketing-contacts.mjs — one-time directory sync.
 *
 * Mirrors every existing salon client (`users`) that has no linked
 * `marketing_contact_id` into the shared `marketing_contacts` directory so
 * the Marketing module + the shared "Lists" feature see the full roster
 * (the marketing directory was previously only populated when a client was
 * created/edited through the Clients tab, leaving older/seeded clients out —
 * the "3 contacts vs 21 clients" symptom).
 *
 * This is the bulk complement to two runtime paths that keep the directory
 * in sync going forward:
 *   * `clients.create/update/import` → `syncMarketingContact` (admin-app)
 *   * `clients.addToList` lazily syncs on demand (admin-app)
 *
 * Semantics (a faithful, set-based approximation of `syncMarketingContact`
 * for the common phone/email case — the authoritative per-row logic lives in
 * `admin-app/src/server/clients/marketingSync.ts`):
 *   * Only non-deleted users with a usable phone or email are mirrored.
 *     tg/ig-only clients are left for the runtime sync (rare for salons).
 *   * Phone is normalized (strip spaces / dashes / parens / NBSP) to match
 *     the normalized form stored by the runtime sync and the per-tenant
 *     UNIQUE(tenant_id, phone) index.
 *   * consent_email / consent_sms = 0 — this is a *directory* sync, NOT an
 *     opt-in (opt-in lives in marketing_consent_log).
 *   * Idempotent: a NOT EXISTS guard prevents duplicate contacts, and the
 *     link-back only touches users whose marketing_contact_id IS NULL. Safe
 *     to re-run.
 *
 * Usage (mirrors scripts/seed-test-accounts.mjs):
 *   node scripts/backfill-marketing-contacts.mjs               # print SQL only
 *   node scripts/backfill-marketing-contacts.mjs --apply       # apply to REMOTE D1 via wrangler
 *   node scripts/backfill-marketing-contacts.mjs --apply --local
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_BINDING = process.env.D1_BINDING || "manicbot";
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LOCAL = args.includes("--local");

/**
 * SQLite expression approximating marketingSync.normPhone for the common
 * separators present in salon data. Keeps a leading "+" and all digits.
 */
function phoneNorm(col) {
  return `replace(replace(replace(replace(replace(${col},' ',''),'-',''),'(',''),')',''),char(160),'')`;
}

const PN_USER = phoneNorm("u.phone");
const PN_USER_BARE = phoneNorm("phone");

// 1) Insert a marketing_contact for every unlinked, non-deleted user that has
//    a usable phone/email and no existing contact match in the same tenant.
const INSERT_SQL = `
INSERT INTO marketing_contacts
  (email, name, phone, source, first_seen_at, last_seen_at, lead_count, unsubscribed, tenant_id, consent_email, consent_sms, linked_user_chat_id)
SELECT
  CASE WHEN u.email IS NOT NULL AND trim(u.email) <> '' THEN lower(trim(u.email)) ELSE NULL END,
  u.name,
  CASE WHEN u.phone IS NOT NULL AND ${PN_USER} <> '' THEN ${PN_USER} ELSE NULL END,
  'salon_clients_manual',
  strftime('%s','now'), strftime('%s','now'),
  1, 0, u.tenant_id, 0, 0, u.chat_id
FROM users u
WHERE u.marketing_contact_id IS NULL
  AND u.deleted_at IS NULL
  AND (
    (u.phone IS NOT NULL AND ${PN_USER} <> '')
    OR (u.email IS NOT NULL AND trim(u.email) <> '')
  )
  AND NOT EXISTS (
    SELECT 1 FROM marketing_contacts mc
    WHERE mc.tenant_id = u.tenant_id
      AND (
        (u.phone IS NOT NULL AND mc.phone = ${PN_USER})
        OR (u.email IS NOT NULL AND lower(mc.email) = lower(trim(u.email)))
      )
  );`.trim();

// 2) Link every still-unlinked user back to its (now-existing) contact by the
//    same normalized key. ORDER BY id keeps re-runs deterministic.
const LINK_SQL = `
UPDATE users
SET marketing_contact_id = (
  SELECT mc.id FROM marketing_contacts mc
  WHERE mc.tenant_id = users.tenant_id
    AND (
      (users.phone IS NOT NULL AND mc.phone = ${PN_USER_BARE})
      OR (users.email IS NOT NULL AND lower(mc.email) = lower(trim(users.email)))
    )
  ORDER BY mc.id ASC
  LIMIT 1
)
WHERE marketing_contact_id IS NULL
  AND deleted_at IS NULL
  AND (
    (phone IS NOT NULL AND ${PN_USER_BARE} <> '')
    OR (email IS NOT NULL AND trim(email) <> '')
  );`.trim();

// Preview query — how many users are candidates (printed before applying).
const PREVIEW_SQL = `
SELECT count(*) AS unlinked_candidates
FROM users
WHERE marketing_contact_id IS NULL
  AND deleted_at IS NULL
  AND (
    (phone IS NOT NULL AND ${PN_USER_BARE} <> '')
    OR (email IS NOT NULL AND trim(email) <> '')
  );`.trim();

const FULL_SQL = [
  "-- backfill-marketing-contacts: mirror unlinked salon clients into marketing_contacts",
  "BEGIN TRANSACTION;",
  INSERT_SQL,
  LINK_SQL,
  "COMMIT;",
].join("\n\n");

function runWrangler(sql, label) {
  const dir = mkdtempSync(join(tmpdir(), "mb-backfill-"));
  const file = join(dir, "backfill.sql");
  writeFileSync(file, sql);
  const wranglerArgs = [
    "wrangler", "d1", "execute", DB_BINDING,
    LOCAL ? "--local" : "--remote",
    `--file=${file}`,
  ];
  console.error(`\n▶ ${label}: npx ${wranglerArgs.join(" ")}`);
  const res = spawnSync("npx", wranglerArgs, { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`✗ wrangler exited with status ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

if (!APPLY) {
  console.log(FULL_SQL);
  console.error("\n— dry run — pass --apply to execute against " + (LOCAL ? "local" : "remote") + " D1.");
  console.error("Preview candidate count with:");
  console.error(`  npx wrangler d1 execute ${DB_BINDING} ${LOCAL ? "--local" : "--remote"} --command "${PREVIEW_SQL.replace(/\s+/g, " ")}"`);
  process.exit(0);
}

runWrangler(FULL_SQL, "applying backfill");
console.error("✓ backfill applied. Marketing → Kontakty now reflects the full client roster.");
