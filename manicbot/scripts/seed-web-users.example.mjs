/**
 * Seed `web_users` table — local-only template.
 *
 * The real seed script (`scripts/seed-web-users.mjs`) is gitignored — it
 * contains plaintext passwords for the platform-staff accounts
 * (system_admin / support / technical_support) plus one or two
 * tenant_owner test fixtures. We keep it off the repo so the credentials
 * never leak via `git log -p` even if the repo goes public.
 *
 * To get your own copy:
 *   1. cp scripts/seed-web-users.example.mjs scripts/seed-web-users.mjs
 *   2. Fill in real values via env vars BEFORE running, e.g.:
 *        export SEED_ADMIN_PASSWORD='your-strong-pass'
 *        export SEED_OPS_PASSWORD='another-strong-pass'
 *        ...
 *   3. node scripts/seed-web-users.mjs > /tmp/seed.sql
 *   4. wrangler d1 execute manicbot-db --remote --file=/tmp/seed.sql
 *
 * `web_users.password_hash` uses PBKDF2-SHA256 / 310k iterations / 16-byte
 * salt — the same primitive as `admin-app/src/server/auth/password.ts`.
 * Re-running this script with `INSERT OR REPLACE` rotates the passwords
 * for the listed accounts; no D1 schema changes needed.
 *
 * Rotation procedure (when a password is suspected exposed):
 *   1. Pick new passwords (use a password manager).
 *   2. `export SEED_*_PASSWORD=...` each one.
 *   3. Re-run the script + wrangler execute as above.
 *   4. Done — the old hashes are overwritten and the leaked plaintext
 *      becomes useless (PBKDF2 doesn't reuse the salt).
 */

const ITERATIONS = 310_000;
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

function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.length < 12) {
    process.stderr.write(
      `✗ ${name} is unset or shorter than 12 chars. Set it before running:\n` +
      `  export ${name}='your-strong-pass'\n`,
    );
    process.exit(1);
  }
  return v;
}

const users = [
  { email: "you@example.com",         password: requireEnv("SEED_ADMIN_PASSWORD"),    role: "system_admin",      tenant_id: null },
  { email: "ops@example.com",         password: requireEnv("SEED_OPS_PASSWORD"),      role: "system_admin",      tenant_id: null },
  { email: "support@example.com",     password: requireEnv("SEED_SUPPORT_PASSWORD"),  role: "support",           tenant_id: null },
  { email: "tech@example.com",        password: requireEnv("SEED_TECH_PASSWORD"),     role: "technical_support", tenant_id: null },
  // Add tenant_owner fixtures as needed.
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
