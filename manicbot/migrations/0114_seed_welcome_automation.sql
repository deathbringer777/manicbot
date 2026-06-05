-- 0114_seed_welcome_automation.sql — 2026-06-06
--
-- Killer-feature scaffolding: a DISABLED platform-default marketing automation
-- that greets a client right after they leave their email in chat. The capture
-- path (services/marketing/contacts.js) fires the `contact.email_captured`
-- event; this row is the welcome responder.
--
-- Shipped enabled=0 so NOTHING sends until the salon owner (a) creates the
-- referenced email template and (b) flips it on from the Marketing tab.
-- fireAutomationForEvent only selects enabled=1 rows, so the placeholder
-- templateId ('tpl_welcome_email') is inert until the owner wires it.
--
-- tenant_id IS NULL = platform default: fires for every tenant that triggers
-- the event, unless a tenant-specific row shadows it on the same trigger_type.
-- INSERT OR IGNORE → re-running the migration is a no-op (id is the PK).
INSERT OR IGNORE INTO marketing_automations
  (id, tenant_id, name, trigger_type, trigger_config_json, steps_json, enabled, created_at, updated_at)
VALUES
  ('auto_welcome_email_capture', NULL, 'Welcome — first email (chat capture)',
   'contact.email_captured', NULL,
   '[{"channel":"email","templateId":"tpl_welcome_email"}]', 0,
   1780704000, 1780704000);
