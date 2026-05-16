#!/usr/bin/env node
/**
 * seed-calendar-demo.mjs — populate the calendar of a real test account
 * (default `manicbot.com@gmail.com`) with enough data to stress-test the
 * 2026-05-16 calendar overhaul UI:
 *
 *   * 4 masters (RU first names) with distinct palette positions.
 *   * 6 services (mix of durations: 30 / 45 / 60 / 90 / 120 min).
 *   * 60+ appointments spread across `today-3d … today+14d`, weekday-
 *     biased, with realistic status mix (70% confirmed, 20% pending,
 *     5% cancelled, 5% done for past dates). Appointments are marked
 *     "confirmed by client" via `confirmed_by = synthetic_client_chat_id`
 *     so they show up green/done in the new view exactly like a real
 *     Telegram-confirmed booking would.
 *   * 3 reservation blocks + 2 time-off rows (one weekend off, one
 *     3-day vacation range) so the block renderer + DragCreateLayer
 *     interact with real data.
 *
 * Idempotent: tenant id, master chat ids, and appointment ids are all
 * derived from a deterministic FNV-1a hash of the email, so re-running
 * the script does not create duplicates (uses `INSERT OR IGNORE` and
 * `INSERT OR REPLACE` where sensible).
 *
 * Usage:
 *   node scripts/seed-calendar-demo.mjs                       # print SQL to stdout
 *   node scripts/seed-calendar-demo.mjs --apply               # apply to remote D1
 *   node scripts/seed-calendar-demo.mjs --apply --local       # apply to local D1
 *   node scripts/seed-calendar-demo.mjs --email me@example.com   # different account
 *   node scripts/seed-calendar-demo.mjs --password 'X!2026'   # override pw on create
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_EMAIL = "manicbot.com@gmail.com";
const DEFAULT_PASSWORD = "TestPass!2026";
const DB_BINDING = process.env.D1_BINDING || "manicbot";
const ITERATIONS = 100_000;
const KEY_LEN_BITS = 256;

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LOCAL = args.includes("--local");
// `--attach-existing` reflashes web_users.tenant_id to the demo tenant for
// the target email — destructive in the sense that it overrides whatever
// tenant the user previously belonged to. Use this when you want the
// seeded data to show up under an account that already exists with a
// different (or no) tenant binding. Without the flag the seed only
// creates the demo tenant + INSERT OR IGNOREs the web_user row, so a
// real existing account stays untouched (and the demo data ends up
// stranded under a tenant the user can't reach).
const ATTACH_EXISTING = args.includes("--attach-existing");
const emailIdx = args.indexOf("--email");
const passwordIdx = args.indexOf("--password");
const EMAIL = (emailIdx >= 0 ? args[emailIdx + 1] : DEFAULT_EMAIL).toLowerCase().trim();
const PASSWORD = passwordIdx >= 0 ? args[passwordIdx + 1] : DEFAULT_PASSWORD;
if (!EMAIL || !EMAIL.includes("@")) {
  console.error("--email must be a valid address");
  process.exit(1);
}

// ── Deterministic IDs (FNV-1a, matches seed-test-accounts.mjs pattern) ──
const enc = new TextEncoder();
function hexEncode(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fnv(seed, salt = "") {
  let h = 2166136261n;
  for (const c of salt + seed) {
    h ^= BigInt(c.charCodeAt(0));
    h = (h * 16777619n) & 0xffffffffn;
  }
  return h;
}
function deterministicTenantId(email) { return "t_demo_" + fnv(email, "tenant").toString(16).padStart(8, "0"); }
function deterministicWebUserId(email) { return "wu_demo_" + fnv(email, "wu").toString(16).padStart(8, "0"); }
function deterministicMasterChatId(email, idx) {
  // Synthetic chat_id (>= 10B) for web-only masters (mirrors `is_synthetic`
  // semantics from migration 0052). Idx keeps each of the 4 masters
  // unique within the same tenant.
  return 10_000_000_000 + Number(fnv(`m${idx}`, email) % 1_000_000_000n);
}
function deterministicClientChatId(email, idx) {
  // Negative chat_id signals "synthetic / no Telegram" client (matches
  // appointments.createManual fallback when the client has no telegram).
  return -Number((fnv(`c${idx}`, email) % 9_000_000n) + 1_000_000n);
}
function deterministicAppointmentId(seed) {
  const h = fnv(seed, "apt").toString(16).padStart(8, "0");
  return `a_demo_${h}`;
}
function deterministicBlockId(seed) {
  const h = fnv(seed, "blk").toString(16).padStart(8, "0");
  return `b_demo_${h}`;
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer, iterations: ITERATIONS, hash: "SHA-256" },
    km, KEY_LEN_BITS,
  );
  return `pbkdf2:${ITERATIONS}:${hexEncode(salt.buffer)}:${hexEncode(bits)}`;
}

function sqlString(s) { return s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'"; }
function sqlInt(n) { return n == null ? "NULL" : String(Math.floor(n)); }

// ── Demo content ─────────────────────────────────────────────────────────
const MASTER_NAMES = ["Анна", "Ольга", "Карина", "Юлия"];
const SERVICES = [
  { svcId: "manicure_classic", name: "Маникюр классический",   duration:  60, price: 130 },
  { svcId: "gel_polish",       name: "Покрытие гель-лак",       duration:  90, price: 180 },
  { svcId: "pedicure_spa",     name: "Педикюр SPA",             duration: 120, price: 220 },
  { svcId: "french",           name: "Френч",                   duration:  60, price: 150 },
  { svcId: "removal",          name: "Снятие покрытия",         duration:  30, price:  60 },
  { svcId: "design",           name: "Дизайн (per nail)",       duration:  45, price:  80 },
];
const CLIENT_NAMES = [
  "Мария Иванова", "Елена Петрова", "Карина Соколова", "Анастасия Орлова",
  "Виктория Романова", "Юлия Кузнецова", "Анна Лебедева", "Дарья Васильева",
  "Полина Морозова", "Ксения Ковалёва", "Ольга Зайцева", "Ева Семёнова",
  "Татьяна Голубева", "Ирина Соловьёва", "Алина Михайлова", "Маргарита Тарасова",
];
const PHONE_PREFIXES = ["+48", "+380", "+7"];

function pickPhone(idx) {
  const prefix = PHONE_PREFIXES[idx % PHONE_PREFIXES.length];
  const tail = String(500_000_000 + idx * 13_579).slice(-9);
  return `${prefix} ${tail.slice(0, 3)} ${tail.slice(3, 6)} ${tail.slice(6)}`;
}

const TENANT_ID = deterministicTenantId(EMAIL);
const WEB_USER_ID = deterministicWebUserId(EMAIL);
const MASTERS = MASTER_NAMES.map((name, idx) => ({
  idx,
  name,
  chatId: deterministicMasterChatId(EMAIL, idx),
}));

// ── Build SQL ────────────────────────────────────────────────────────────
const now = Math.floor(Date.now() / 1000);
const sqlLines = [`-- ManicBot calendar-demo seed for ${EMAIL} (${new Date().toISOString()})`];
const summary = [];

// Tenant + web_user. Both INSERT OR IGNORE so a real existing account
// for this email is left untouched (we just attach masters/services/apts).
const passwordHash = await hashPassword(PASSWORD);
sqlLines.push(
  `INSERT OR IGNORE INTO tenants (id, name, active, plan, billing_status, current_period_end, slug, city, public_active, is_personal, industry, is_test, created_at, updated_at) VALUES (` +
    [
      sqlString(TENANT_ID),
      sqlString("ManicBot Demo Studio"),
      "1",
      sqlString("max"),
      sqlString("active"),
      sqlInt(now + 365 * 86400),
      sqlString("manicbot-demo"),
      sqlString("Warszawa"),
      "1",
      "0",
      sqlString("beauty"),
      "1",
      sqlInt(now),
      sqlInt(now),
    ].join(", ") + `);`,
);
sqlLines.push(
  `INSERT OR IGNORE INTO web_users (id, email, password_hash, role, tenant_id, name, lang, email_verified, tos_accepted_at, created_at, updated_at) VALUES (` +
    [
      sqlString(WEB_USER_ID),
      sqlString(EMAIL),
      sqlString(passwordHash),
      sqlString("tenant_owner"),
      sqlString(TENANT_ID),
      sqlString("ManicBot Owner"),
      sqlString("ru"),
      "1",
      sqlInt(now),
      sqlInt(now),
      sqlInt(now),
    ].join(", ") + `);`,
);
if (ATTACH_EXISTING) {
  // Re-flash an existing web_user row so it points at the demo tenant.
  // Use a LOWER() match to be case-insensitive — auth.getMyRole already
  // does the same lower-casing on lookup. We deliberately keep the
  // user's existing password_hash and id so they don't lose their login.
  sqlLines.push(
    `UPDATE web_users SET tenant_id=${sqlString(TENANT_ID)}, role='tenant_owner', updated_at=${sqlInt(now)} WHERE LOWER(email)=${sqlString(EMAIL)};`,
  );
}

// Masters — synthetic web-only (is_synthetic=1, large chat_id range).
for (const m of MASTERS) {
  sqlLines.push(
    `INSERT OR IGNORE INTO masters (tenant_id, chat_id, name, active, is_synthetic, added_at) VALUES (` +
      [sqlString(TENANT_ID), String(m.chatId), sqlString(m.name), "1", "1", sqlInt(now)].join(", ") + `);`,
  );
}

// Services. INSERT OR REPLACE so duration/price tweaks land on re-run
// without us having to delete by hand.
for (const s of SERVICES) {
  sqlLines.push(
    `INSERT OR REPLACE INTO services (tenant_id, svc_id, names, duration, price, active) VALUES (` +
      [
        sqlString(TENANT_ID),
        sqlString(s.svcId),
        sqlString(JSON.stringify({ ru: s.name })),
        sqlInt(s.duration),
        sqlInt(s.price),
        "1",
      ].join(", ") + `);`,
  );
}

// Synthetic clients (16 deterministic). Phones rotate prefixes so the
// public salon page filters get exercised on a mix of locales.
const CLIENT_CHAT_IDS = CLIENT_NAMES.map((_, idx) => deterministicClientChatId(EMAIL, idx));
for (let idx = 0; idx < CLIENT_NAMES.length; idx += 1) {
  sqlLines.push(
    `INSERT OR IGNORE INTO users (tenant_id, chat_id, name, phone, registered_at, first_source) VALUES (` +
      [
        sqlString(TENANT_ID),
        String(CLIENT_CHAT_IDS[idx]),
        sqlString(CLIENT_NAMES[idx]),
        sqlString(pickPhone(idx)),
        sqlInt(now - 30 * 86400 + idx * 1800),
        sqlString("manual_dashboard"),
      ].join(", ") + `);`,
  );
}

// Appointments — distribute across [-3d … +14d] window.
// Skip Sundays (salon closed). Each weekday gets 6–10 bookings spread
// 09:00 → 19:00 across the 4 masters. Status mix:
//   past dates  → 50% done, 30% confirmed, 15% cancelled, 5% pending
//   today/future→ 70% confirmed, 20% pending, 5% cancelled, 5% confirmed-by-client
//
// `ts` = UTC timestamp at the start of the slot — keeps the existing
// `idx_apt_unsynced` cron index in usable shape after seed. `confirmed_by`
// = the client's synthetic chat_id mirrors what a real
// "Подтвердить" button on Telegram writes.
const HOURS_RANGE = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const DAY_OFFSETS = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const TODAY_START = new Date();
TODAY_START.setHours(0, 0, 0, 0);

let aptCounter = 0;
function pseudoRandom(seed) { return Number(fnv(String(seed), "rng") % 10_000n) / 10_000; }

for (const offsetDays of DAY_OFFSETS) {
  const day = new Date(TODAY_START);
  day.setDate(day.getDate() + offsetDays);
  const dow = day.getDay();
  if (dow === 0) continue; // Sunday closed
  const isPast = offsetDays < 0;

  // 6–10 appointments per weekday, biased to the morning.
  const aptsToday = 6 + Math.floor(pseudoRandom(`count_${offsetDays}`) * 5);
  const usedSlots = new Set(); // master:hour → already booked

  for (let n = 0; n < aptsToday; n += 1) {
    // JS `%` preserves sign for negative operands, so wrap to non-negative.
    const masterIdx = ((n + offsetDays + Math.floor(pseudoRandom(`mIdx_${offsetDays}_${n}`) * 4)) % MASTERS.length + MASTERS.length) % MASTERS.length;
    const master = MASTERS[masterIdx];
    const hour = HOURS_RANGE[((n + Math.floor(pseudoRandom(`h_${offsetDays}_${n}`) * HOURS_RANGE.length)) % HOURS_RANGE.length + HOURS_RANGE.length) % HOURS_RANGE.length];
    const minute = (n % 2) * 30;
    const slotKey = `${master.chatId}:${hour}:${minute}`;
    if (usedSlots.has(slotKey)) continue;
    usedSlots.add(slotKey);

    const svcIdx = Math.floor(pseudoRandom(`svc_${offsetDays}_${n}`) * SERVICES.length);
    const svc = SERVICES[svcIdx];
    const clientIdx = Math.floor(pseudoRandom(`cl_${offsetDays}_${n}`) * CLIENT_NAMES.length);
    const clientName = CLIENT_NAMES[clientIdx];
    const clientChatId = CLIENT_CHAT_IDS[clientIdx];

    // Status distribution
    const r = pseudoRandom(`st_${offsetDays}_${n}`);
    let status, cancelled = 0, noShow = 0, confirmedBy = null;
    if (isPast) {
      if (r < 0.5)       { status = "done";      confirmedBy = clientChatId; }
      else if (r < 0.8)  { status = "confirmed"; confirmedBy = clientChatId; }
      else if (r < 0.95) { status = "cancelled"; cancelled = 1; }
      else               { status = "pending"; }
    } else {
      if (r < 0.7)       { status = "confirmed"; confirmedBy = clientChatId; }
      else if (r < 0.9)  { status = "pending"; }
      else if (r < 0.95) { status = "cancelled"; cancelled = 1; }
      else               { status = "confirmed"; confirmedBy = clientChatId; }
    }

    const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const ts = Math.floor(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute) / 1000);
    const aptId = deterministicAppointmentId(`${dateStr}_${master.chatId}_${timeStr}_${aptCounter}`);
    aptCounter += 1;

    sqlLines.push(
      `INSERT OR IGNORE INTO appointments (id, tenant_id, chat_id, svc_id, date, time, ts, status, master_id, user_name, user_phone, confirmed_by, cancelled, no_show, rem_h24, rem_h2, created_at) VALUES (` +
        [
          sqlString(aptId),
          sqlString(TENANT_ID),
          String(clientChatId),
          sqlString(svc.svcId),
          sqlString(dateStr),
          sqlString(timeStr),
          sqlInt(ts),
          sqlString(status),
          String(master.chatId),
          sqlString(clientName),
          sqlString(pickPhone(clientIdx)),
          confirmedBy == null ? "NULL" : String(confirmedBy),
          String(cancelled),
          String(noShow),
          "0",
          "0",
          sqlInt(now - Math.floor(pseudoRandom(`crt_${aptCounter}`) * 7 * 86400)),
        ].join(", ") + `);`,
    );
  }
}

// Appointment blocks — exercise both kinds.
function isoOf(offsetDays) {
  const d = new Date(TODAY_START);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const BLOCKS = [
  // 1) Anna keeps a 13:00 reservation today (Lunch prep).
  { masterIdx: 0, type: "reservation", date: isoOf(0), time: "13:00", durationMin: 30, reason: "Подготовка лампы" },
  // 2) Karina holds an evening slot tomorrow for "Образец дизайна".
  { masterIdx: 2, type: "reservation", date: isoOf(1), time: "18:00", durationMin: 60, reason: "Образец дизайна" },
  // 3) Olga blocks Saturday morning for own client (no booking yet).
  { masterIdx: 1, type: "reservation", date: isoOf(2), time: "10:00", durationMin: 90, reason: "Резерв" },
  // 4) Yulia takes a full day off in 5 days (e.g. medical).
  { masterIdx: 3, type: "time_off",    date: isoOf(5), time: "00:00", durationMin: 60 * 24, reason: "Выходной" },
  // 5) Anna takes a 3-day vacation 8–10 days out.
  { masterIdx: 0, type: "time_off",    date: isoOf(8), time: "00:00", durationMin: 60 * 24, endDate: isoOf(10), reason: "Отпуск" },
];
for (let i = 0; i < BLOCKS.length; i += 1) {
  const b = BLOCKS[i];
  const id = deterministicBlockId(`${b.date}_${MASTERS[b.masterIdx].chatId}_${b.time}_${i}`);
  sqlLines.push(
    `INSERT OR IGNORE INTO appointment_blocks (id, tenant_id, master_id, type, date, time, duration_min, end_date, reason, created_at, created_by, cancelled) VALUES (` +
      [
        sqlString(id),
        sqlString(TENANT_ID),
        String(MASTERS[b.masterIdx].chatId),
        sqlString(b.type),
        sqlString(b.date),
        sqlString(b.time),
        sqlInt(b.durationMin),
        b.endDate ? sqlString(b.endDate) : "NULL",
        sqlString(b.reason),
        sqlInt(now),
        sqlString(WEB_USER_ID),
        "0",
      ].join(", ") + `);`,
  );
}

summary.push({ tenantId: TENANT_ID, email: EMAIL, masters: MASTERS.length, services: SERVICES.length, appointments: aptCounter, blocks: BLOCKS.length });

const sqlText = sqlLines.join("\n") + "\n";

if (APPLY) {
  const dir = mkdtempSync(join(tmpdir(), "manicbot-cal-demo-"));
  const file = join(dir, "calendar-demo.sql");
  writeFileSync(file, sqlText);
  process.stderr.write(`Applying calendar demo seed (${aptCounter} appts, ${BLOCKS.length} blocks) for ${EMAIL} → D1 (${LOCAL ? "local" : "remote"})…\n`);
  const r = spawnSync("npx", ["wrangler", "d1", "execute", DB_BINDING, "--file", file, LOCAL ? "--local" : "--remote"], { stdio: "inherit" });
  if (r.status !== 0) {
    process.stderr.write(`Wrangler exited with status ${r.status}\n`);
    process.exit(r.status ?? 1);
  }
} else {
  process.stdout.write(sqlText);
}

process.stderr.write(`\n## Calendar demo seed (password: ${PASSWORD})\n\n`);
for (const r of summary) {
  process.stderr.write(`tenant=${r.tenantId} email=${r.email} masters=${r.masters} services=${r.services} appointments=${r.appointments} blocks=${r.blocks}\n`);
}
process.stderr.write(`\nDone. ${APPLY ? "Applied to D1." : "Pipe stdout into wrangler or re-run with --apply."}\n`);
