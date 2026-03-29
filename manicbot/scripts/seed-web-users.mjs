/**
 * Seed web_users table in D1 with 7 accounts (different roles).
 * Uses Web Crypto PBKDF2 — same algorithm as admin-app/src/server/auth/password.ts.
 *
 * Usage:
 *   node scripts/seed-web-users.mjs
 *   (pipe output to wrangler d1 execute or save to .sql file)
 */

const ITERATIONS = 100_000;
const KEY_LEN_BITS = 256;

function hexEncode(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_LEN_BITS,
  );
  return `pbkdf2:${hexEncode(salt.buffer)}:${hexEncode(bits)}`;
}

function uid() {
  return `wu_${hexEncode(globalThis.crypto.getRandomValues(new Uint8Array(12)).buffer)}`;
}

const users = [
  { email: "vdovin.kyrylo@gmail.com", password: "Mb#9kX!vQr2@Lp5", role: "system_admin",      tenant_id: null },
  { email: "ops@manicbot.com",        password: "R7!tGwZq@Xn4Yd8", role: "system_admin",      tenant_id: null },
  { email: "support@manicbot.com",    password: "Sup#4rtH3lp!2mB", role: "support",            tenant_id: null },
  { email: "tech@manicbot.com",       password: "T3ch@Secure!99x", role: "technical_support",  tenant_id: null },
  { email: "anna.k@manicbot.com",     password: "Salon#Waw2026!k", role: "tenant_owner",       tenant_id: null },
  { email: "maria.s@manicbot.com",    password: "Beauty@Wro!7mNq", role: "tenant_owner",       tenant_id: null },
  { email: "daria.l@manicbot.com",    password: "Poznan#St4r!xBv", role: "tenant_owner",       tenant_id: null },
];

const now = Math.floor(Date.now() / 1000);

const rows = [];
for (const u of users) {
  const hash = await hashPassword(u.password);
  const id = uid();
  const tenantVal = u.tenant_id ? `'${u.tenant_id}'` : "NULL";
  rows.push(
    `INSERT OR REPLACE INTO web_users (id, email, password_hash, tenant_id, role, created_at, updated_at) ` +
    `VALUES ('${id}', '${u.email}', '${hash}', ${tenantVal}, '${u.role}', ${now}, ${now});`,
  );
  process.stderr.write(`✓ ${u.email}  [${u.role}]\n`);
}

console.log("-- ManicBot web_users seed (generated " + new Date().toISOString() + ")");
console.log(rows.join("\n"));
