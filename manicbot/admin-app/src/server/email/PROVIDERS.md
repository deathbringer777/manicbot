# Email/SMS Providers

Two transports live side by side:

| File | Role | Status |
|---|---|---|
| [`resend.ts`](./resend.ts) | Transactional email (verification, reset, welcome, alerts) | **ACTIVE** — wired into `emailService.ts` |
| [`brevo.ts`](./brevo.ts)   | Transactional + marketing email + SMS | **DORMANT** — integrated but never called |

Both are thin fetch-based wrappers, edge-safe, and read secrets through `getRuntimeEnv()`.

## Comparison — Resend vs Brevo

| Aspect | **Resend** (active) | **Brevo** (dormant) |
|---|---|---|
| Endpoint | `api.resend.com/emails` | `api.brevo.com/v3/smtp/email` |
| Auth header | `Authorization: Bearer <key>` | `api-key: <key>` |
| Sender format | `"Name <addr>"` string | `{ email, name }` object |
| Recipient format | `to: ["addr"]` | `to: [{ email, name? }]` |
| HTML field | `html` | `htmlContent` |
| Success ID | `{ id }` | `{ messageId }` |
| Free tier | 3k/mo, 100/day | 9k/mo, 300/day |
| Above free | $20/mo (50k) | €9/mo (20k) |
| Data residency | US | EU (FR) |
| SMS support | ❌ | ✅ `/v3/transactionalSMS/sms` |
| WhatsApp | ❌ | ✅ |
| Templates UI | minimal | drag-drop editor |
| Marketing campaigns | ❌ | ✅ |
| SDK | — (HTTP) | — (HTTP) |
| Edge/Workers | ✅ | ✅ |

## Env vars

```
# Active (Resend)
RESEND_API_KEY=re_xxx
RESEND_FROM="ManicBot <noreply@manicbot.com>"

# Dormant (Brevo) — optional, safe to set
BREVO_API_KEY=xkeysib-xxx
BREVO_FROM="ManicBot <noreply@manicbot.com>"
BREVO_SMS_SENDER="ManicBot"   # 11 chars max, alphanumeric
```

## Switching a call site from Resend to Brevo

1. Set `BREVO_API_KEY` + `BREVO_FROM` on Cloudflare Pages.
2. Verify sender domain in Brevo dashboard.
3. Swap the import in [`emailService.ts`](./emailService.ts):
   ```ts
   // before
   import { sendResendEmail } from "./resend";
   // after
   import { sendBrevoEmail as sendResendEmail } from "./brevo";
   ```
   (The `SendEmailResult` shape is compatible; `messageId` is returned but ignored by the current service layer.)
4. Or swap by email type — e.g. keep Resend for verification codes, route marketing blasts through Brevo.

## Marketing module

The `admin-app/src/server/marketing/providers/` abstraction wraps both transports behind a unified `MarketingProvider` interface. See [`providers/index.ts`](../marketing/providers/index.ts). The God Mode → Marketing → Providers page calls `checkBrevoHealth()` / `isResendConfigured()` for the status dashboard.

Enable/disable flags live in the `marketing_providers` D1 table (rows seeded by migration `0032_marketing_schema.sql`).

## Health check

Brevo exposes `GET /v3/account` — implemented in `checkBrevoHealth()`. Resend has no equivalent; we treat "configured" as "ok" for now.
