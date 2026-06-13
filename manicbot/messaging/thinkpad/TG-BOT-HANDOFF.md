# ThinkPad Telegram Control Bot — Hand-off (2026-06-13)

Operator runbook for the messaging console. Owner-only; runs as PM2 `tg-bot` on the
ThinkPad. All commands below are typed in the Telegram chat with the bot.

## Day-to-day: review & approve seasonal drafts
1. `/menu` — the hub. Or jump straight in:
2. `/drafts` — grouped cards, one per occasion. Tap a card → preview.
   - In the card: tap `🇷🇺/🇺🇦/🇵🇱/🇬🇧` to read each locale (variables filled with
     samples), then `✅ Одобрить` (approves all locales + the campaign) or
     `⏭ Пропустить` (archives). Both ask to confirm first.
   - `🕐 Запланировать` shifts a campaign's date (+7/+14/+30 days).
   - Search: `/drafts christmas`, `/drafts cat:seasonal`, `/drafts missing:pl`.
3. `/plan` — upcoming scheduled campaigns. `/calendar` — the PL occasion calendar.
4. `/stats` — counts by status, deliveries by channel, the send state.

## Sending is OFF (two-key safety)
Real sends require BOTH:
- **env master** `MESSAGING_SEND_ENABLED` (Worker secret) — currently **`0` (OFF)**.
- **operator pause** (`/settings`) — currently not paused.

Effective send = master ON **and** not paused. The bot's `/settings` toggle is the
SECONDARY key; it can only ever pause (restrict). **It cannot start real sends while
the env master is `0`.** Approving a draft just marks it deliverable; the Worker
dispatcher sends it only when both keys allow.

### To actually go live (when ready, deliberately)
1. Set the Worker master flag: `wrangler secret put MESSAGING_SEND_ENABLED` → `1`
   (or set it in the deploy env) and redeploy the Worker. This is the real launch
   gate — do it consciously; all tenants must no longer be `is_test`.
2. Ensure `/settings` shows the operator pause OFF.
Only then does the seasonal dispatcher send to real owners.

## Operate the messaging crons
`/msgcron` — status + last outcome of `msg-holidays-sync`, `msg-content-plan`,
`msg-preset-gen`, `msg-health`. They are `cron_restart` (stopped between runs); tap
`▶️` to run one now. `/regen <occasion>` re-generates one occasion's copy via
`claude -p` (Sonnet, subscription) — the result lands as a NEW draft in `/drafts`,
never auto-sent.

## Deploy / rollback (from the dev machine)
- **Deploy:** `cd <bot working copy> && ./deploy.sh` — rsyncs source (keeps the
  server `.env` + runtime state), `npm install --omit=dev`, `pm2 restart tg-bot`.
  Backs up the live copy to `~/automation/tg-bot.bak.<stamp>` (keeps last 5).
  If `ecosystem.config.js` changed, also run on the server:
  `pm2 restart ~/automation/tg-bot/ecosystem.config.js --update-env && pm2 save`.
- **Rollback:** restore the latest `~/automation/tg-bot.bak.<stamp>` over
  `~/automation/tg-bot` and `pm2 restart tg-bot`. (A single-file revert: the
  pre-deploy `commands/messaging.js.bak.<stamp>` is kept on the server too.)
- **Config required on the server** (`~/automation/tg-bot/.env`, 600, gitignored):
  `TELEGRAM_TOKEN`, `GROQ_KEY`, `ALLOWED_USER_ID`, `WORKER_URL`, `MESSAGING_TOKEN`.
  Only the first three are boot-fatal; the messaging seam degrades to a friendly
  "token not set" if `MESSAGING_TOKEN` is missing (never boot-fatal — see the
  env-boot-fatal landmine).

## Health
`/health` — recent health-check log. PM2: `pm2 logs tg-bot`, `pm2 describe tg-bot`.
Transient `[poll error] fetch failed` (EAI_AGAIN) and Groq rate-limits are caught
in-process and self-heal with backoff — not crashes.

## Source of truth & tests
- Bot source: this directory (deployed via `deploy.sh`), versioned on the Manicbot
  `thinkpad` branch under `thinkpad-bot/`. The messaging module is also mirrored to
  `manicbot/messaging/thinkpad/tg-bot-messaging.js` on `main` for reference.
- Worker seam: `manicbot/src/http/messagingHttp.js` (deployed via CI on `main`).
- Tests: `npm test` here (node:test, 164 green) + the Worker `vitest` suite on `main`.

## Known follow-ups (non-blocking)
- `template-approve` (Worker) and `template-status` overlap — `template-status` is
  the general one (approve+archive) the bot uses; `template-approve` (approve-only,
  from #428) is kept for back-compat and can be folded into `template-status` later.
- `/settings` pause uses a button-confirm (not a typed confirm); justified because
  the env master gate makes unpausing inert pre-launch. Revisit if a typed confirm
  is wanted once the env flag is on.
