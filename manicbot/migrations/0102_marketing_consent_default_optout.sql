-- 0102_marketing_consent_default_optout.sql — 2026-06-02
--
-- MKT-01 (GDPR): marketing_contacts.consent_email defaulted to 1 (opt-out by
-- default) and no 'subscribed' event was ever logged, so email marketing could
-- go out on assumed consent. The schema default is now 0 (schema.sql + Drizzle)
-- and email consent is granted only via a logged opt-in: newsletter
-- double-opt-in, or an owner/God-Mode toggle that writes marketing_consent_log.
--
-- This one-shot reset brings EXISTING rows in line: any contact still flagged
-- consent_email=1 WITHOUT a demonstrable 'subscribed' event in
-- marketing_consent_log loses the email flag (GDPR: no proof of consent -> do
-- not send). consent_sms already defaulted to 0 and is left untouched.
-- Idempotent (a re-run finds nothing to change) and a safe no-op on a clean
-- pre-launch DB. A contact re-acquires consent the moment a 'subscribed' event
-- is logged (owner toggle / double-opt-in).
UPDATE marketing_contacts
SET consent_email = 0
WHERE consent_email = 1
  AND id NOT IN (SELECT contact_id FROM marketing_consent_log WHERE event = 'subscribed');
