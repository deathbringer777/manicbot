# Google Calendar OAuth Setup

Google Calendar sync has two surfaces:

- **Worker** handles OAuth, webhook callbacks, token encryption, and busy-block sync.
- **Mini App** shows connected calendars, sync state, pause/resume, and disconnect actions.

## End-to-end flow

1. In **Mini App → Settings → Google Calendar**, tap **Open bot to connect**.
2. The salon bot opens the existing Google Calendar panel.
3. The bot creates a short-lived signed OAuth session in KV and sends the user to Worker `/google/connect?...`.
4. Worker redirects to Google OAuth, stores the encrypted refresh token, lets the user pick a calendar, then starts watch/sync.
5. Mini App reads `google_integrations` and shows status, last sync, and errors.

This split is intentional: the secure session is minted in the Worker/bot flow, not by exposing an open `tenant_id` connect URL from Pages.

## Outbound sync (appointment → Google Calendar)

Once connected, ManicBot pushes each booking into the calendar via
`syncAppointmentCalendar` (`src/services/google-calendar-oauth.js`). It fires
**immediately** on every appointment-confirmation path:

- Bot: master taps **Confirm** (`handlers/callback.js`).
- Dashboard: confirm a request — `appointments.updateStatus` / `claimAndConfirm`
  → Worker `POST /admin/appointment-action` `action: "confirm"`.
- Dashboard: **manual booking** — `appointments.createManual` (row is created
  already `confirmed`) → Worker `action: "sync_calendar"`. This action is
  **calendar-only**: it pushes the event but does NOT message the client, so a
  staff-entered booking stays silent to the client.

The `phaseGcalSync` cron (every ~10 min) is the **fallback** that retries any
`status='confirmed'` row still missing `google_event_id` (e.g. the immediate
push failed, or the Worker was unreachable). All outbound paths are gated by the
`calendar` plan feature (`canUse(ctx, 'calendar')` — `pro`/`max` only).

> Note: the "last sync" timestamp shown in the Mini App is the **inbound**
> busy-block sync (Google → ManicBot), not the outbound push — a green "ok"
> there does not by itself prove that bookings are reaching Google.

## Worker env / secrets

Required for OAuth mode:

- `APP_BASE_URL` — public Worker origin, used to build absolute `/google/connect` and `/google/callback` URLs from Telegram callbacks.
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY` or `BOT_ENCRYPTION_KEY`

Optional / recommended:

- `GOOGLE_OAUTH_REDIRECT_URI` — explicit callback URL. If omitted, Worker uses `${APP_BASE_URL}/google/callback`.
- `GOOGLE_SERVICE_ACCOUNT_KEY` — enables the older manual Calendar ID fallback for masters.
- `ADMIN_APP_URL` — useful for cross-linking back to the Mini App.

## Data model

Tables used by the OAuth sync path:

- `google_integrations` — one row per tenant/master integration, refresh token ciphertext, watch state, sync timestamps
- `google_busy_blocks` — cached external busy windows pulled from Google
- `appointments.google_integration_id` — link from synced appointments back to the integration

## Mini App behavior

The Google Calendar card in **SalonDashboard → Settings** now shows:

- connected calendars
- tenant/master scope
- last sync time and status
- last sync error, when present
- sync pause/resume
- disconnect

Connection still begins in Telegram because the Worker must create the OAuth session securely.

## Common issues

- **Connect button opens bot but no OAuth link appears:** verify `APP_BASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`, and `GOOGLE_OAUTH_CLIENT_SECRET` on the Worker.
- **Calendar connects but sync stays red:** check `last_sync_error` in `google_integrations` and Worker logs from `google-calendar-oauth.js`.
- **Disconnect removes status but Google still lists the app:** Mini App disconnect removes ManicBot sync state. If you also want to revoke Google consent immediately, do it from the bot flow or the Google account security page.
- **Nothing appears in Mini App:** make sure the tenant owner is opening the Mini App for the same tenant whose bot started the OAuth flow.

---

## Backoff and Rate Limiting

Google Calendar sync in cron implements exponential backoff to protect against API quota exhaustion:

- **MAX_SYNC_PER_CRON = 10** — maximum 10 sync operations per cron run (every 15 min)
- **Exponential backoff**: `15min * 2^retries` (30min, 60min, 2h, 4h...), maximum 24 hours
- **Permanent failure**: after 5 failed attempts, the appointment is marked as permanently failed
- Appointments with `sync_retry_after > now` are skipped until the retry time arrives

### D1 Columns (migration 0010)

| Column | Type | Description |
|---------|-----|----------|
| `sync_retries` | INTEGER DEFAULT 0 | Failed attempt counter |
| `sync_retry_after` | INTEGER NULL | Timestamp of next retry (ms) |
| `sync_last_error` | TEXT NULL | Last error (up to 200 characters) |

On successful sync, all three columns are reset to 0/NULL.
