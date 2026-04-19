-- 0034_tenant_manager.sql — Phase 2 role redesign.
--
-- Adds three tables supporting the new salon-level `tenant_manager` role:
--
-- 1. tenant_member_permissions — per-(tenant, web user) permission grants.
--    tenant_manager has a default set at invite time; sensitive permissions
--    require email-verified elevation to add.
--
-- 2. tenant_action_requests — tenant_manager → owner approval queue for
--    actions they lack permission to execute (e.g., create master).
--
-- 3. permission_elevation_codes — short-lived 6-digit codes sent to the
--    OWNER'S email to confirm granting sensitive permissions.
--
-- No CHECK constraints on existing `role` TEXT columns — tenant_roles and
-- web_users.role continue to accept the extended set in-code.

CREATE TABLE IF NOT EXISTS tenant_member_permissions (
  tenant_id   TEXT    NOT NULL,
  web_user_id TEXT    NOT NULL,
  permission  TEXT    NOT NULL,
  granted_at  INTEGER NOT NULL,
  granted_by  TEXT    NOT NULL,
  PRIMARY KEY (tenant_id, web_user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_tmp_user ON tenant_member_permissions (web_user_id);
CREATE INDEX IF NOT EXISTS idx_tmp_tenant ON tenant_member_permissions (tenant_id);

CREATE TABLE IF NOT EXISTS tenant_action_requests (
  id           TEXT    PRIMARY KEY,
  tenant_id    TEXT    NOT NULL,
  requester_id TEXT    NOT NULL,
  action       TEXT    NOT NULL,
  payload      TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending',
  owner_note   TEXT,
  reviewed_by  TEXT,
  reviewed_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tar_tenant_status ON tenant_action_requests (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tar_requester ON tenant_action_requests (requester_id, created_at);

CREATE TABLE IF NOT EXISTS permission_elevation_codes (
  id             TEXT    PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  owner_user_id  TEXT    NOT NULL,
  target_user_id TEXT    NOT NULL,
  permissions    TEXT    NOT NULL,
  code_hash      TEXT    NOT NULL,
  expires_at     INTEGER NOT NULL,
  consumed_at    INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pec_owner ON permission_elevation_codes (owner_user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_pec_tenant ON permission_elevation_codes (tenant_id, expires_at);
