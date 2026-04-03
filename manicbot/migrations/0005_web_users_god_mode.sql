-- Web users table (email/password login for dashboard)
CREATE TABLE IF NOT EXISTS web_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id TEXT,
  role TEXT NOT NULL DEFAULT 'tenant_owner',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_user_email ON web_users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_user_tenant ON web_users(tenant_id);

-- God Mode user: vdovin.kyrylo@gmail.com
INSERT OR IGNORE INTO web_users (id, email, password_hash, tenant_id, role, created_at, updated_at)
VALUES (
  'god_vdovin_001',
  'vdovin.kyrylo@gmail.com',
  'pbkdf2:8dfdb19459c52d9367350aac31fc39f4:27e2baa92e7d2caa41c3fcec8c182a10d97181239819347053ee964aa5f3c00b',
  NULL,
  'system_admin',
  1743710400,
  1743710400
);
