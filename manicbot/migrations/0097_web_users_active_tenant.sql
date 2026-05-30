-- Multi-tenant salon switcher — active-tenant pointer for web users.
--
-- A web user has one immutable HOME tenant (`web_users.tenant_id` +
-- `web_users.role`) and may additionally hold a master role in other salons
-- (a `masters` row bound by `web_user_id` + a `tenant_roles` row). Until now
-- the active salon WAS the home tenant with no way to switch, so an owner who
-- accepted a master invite into another salon created the rows but could never
-- reach that salon (getMyRole only ever saw the home tenant).
--
-- `active_tenant_id` is the currently-selected salon. NULL = use the home
-- tenant_id (so existing rows are unaffected — zero behavior change for anyone
-- not switching). It is resolved into the NextAuth session in auth.ts via
-- resolveActiveMembership(), which re-derives the active role from the DB on
-- every refresh and clears a stale pointer; membership is proven
-- authoritatively against masters.web_user_id (never synthetic-chatId guesses).
-- Set on accept (acceptInvitationExistingUser) and by webUsers.switchTenant.

ALTER TABLE web_users ADD COLUMN active_tenant_id TEXT;
