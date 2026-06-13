# ThinkPad Telegram Control Bot — Audit (2026-06-13)

Operator/admin bot the founder uses to run ManicBot's autonomous System & Seasonal
Messaging service. Runs on the ThinkPad (`~/automation/tg-bot/`) under PM2 (`tg-bot`),
owner-only. This audit captures the state after the messaging-console overhaul.

## Architecture
- **Transport:** raw `fetch` to the Telegram Bot API, long-poll `getUpdates` (30s).
  No grammY/telegraf — the raw client is small, well-tested, and stable. KEPT.
- **Entry:** `bot.js` (poll loop, command/text/voice routing, graceful shutdown).
- **Commands:** auto-loaded from `commands/*.js` by `commands/index.js`
  (each module exports `commands` and/or `register`). 65+ commands across system,
  AI, music, screen, files, blog, and messaging groups.
- **Inline buttons:** `callbacks.js` routes `callback_data` by prefix
  (`nav:` `ask:` `do:` `blog:` `mus:` `msg:`); modules own their `handleCallback`.
- **Auth:** single owner via `ALLOWED_USER_ID` (exact int match, `telegram.js`
  `isAllowedUser`), enforced in `bot.js` for every message and callback.
- **State:** poll offset persisted to `~/automation/.tg-bot-offset.json` (outside
  `/tmp` and the deploy tree → survives reboot AND deploy). Claude CLI sessions +
  scheduled blog posts in their own files.

## Messaging service seam
The bot is the approval surface for the messaging service. It talks ONLY to the
ManicBot Worker (`$WORKER_URL/admin/messaging/*`, Bearer `MESSAGING_TOKEN`) — it
never writes D1 directly. The Worker owns the D1 binding. ThinkPad crons
(`~/automation/messaging/`: holidays-sync, content-plan-builder, preset-generator,
health) push drafts to the same seam; the bot reads + approves.

Seam endpoints used: `GET drafts|stats|plan|calendar`, `POST approve|template-status|
template-approve|reschedule|flag`. Client (`commands/messaging.js` `seam()`):
15s timeout, 2 retries with backoff, 4xx terminal, friendly errors (never a stack
trace to chat).

## The /drafts console (the overhaul)
Before: a raw dump — `pmt_01KTYV… — New Year's Eve (en) [seasonal_new_years_eve/en]`,
four near-identical locale rows per occasion, no grouping/pagination/buttons/preview.

After (button-driven master-detail, `commands/messaging.js` + `commands/msgconsole.js`):
- **List** — one card per OCCASION (Russian name + emoji, en/ua/ru/pl collapsed),
  locale-ready count, scheduled date; paginated 6/page (`◀ N/M ▶`). ULIDs hidden.
- **Card** — preview the body with sample variable substitution (`{salon_name}` →
  "Demo Studio"), RU/UA/PL/EN locale switch, `✅ Approve · ⏭ Skip · 🕐 Schedule`,
  each behind a confirm. ULID shown here only (`ID: pmt_…`), for debugging.
- **Approve/Skip** act on the whole occasion (all draft locale templates via
  `template-status`, plus the campaign) — the campaign-only `/approve` was a no-op
  for the template-dominated list. Re-fetch + edit-in-place → idempotent.
- **Search:** `/drafts <query>` (occasion name, `cat:<category>`, `missing:<locale>`).

## Console (new commands)
`/menu` (hub) · `/stats` · `/plan` (content plan) · `/calendar` (PL holidays) ·
`/settings` (send-flag state + operator pause) · `/msgcron` (messaging-cron status +
manual run) · `/regen <occasion>` (refresh one occasion's copy via `claude -p`
Sonnet → new draft, never auto-sent).

## Send safety
Real egress is gated by **two keys**: the env master `MESSAGING_SEND_ENABLED`
(currently `0`) AND the operator pause (D1 `platform_settings.messaging_send_paused`,
toggled from `/settings`). Effective send = `enabled && !paused`. The bot's pause
toggle can only ever RESTRICT — it cannot start sends while env is `0`. Approving a
draft only marks it deliverable; the Worker dispatcher does the actual sending.

## Stability & security posture
- Every handler is wrapped (poll loop + per-command + per-callback try/catch);
  a failing handler logs + replies, never crashes the process.
- Idempotent callbacks: a redelivered `callback_query` id is dropped (ring buffer);
  actions are also re-fetch + server-idempotent (defence in depth).
- HTML parse_mode with `render.esc` on all dynamic text — special chars can't break
  rendering.
- PM2: `max_restarts: 50` + `exp_backoff_restart_delay` + `max_memory_restart: 300M`
  (was `max_restarts: 10`, a footgun under transient DNS/rate-limit churn).
- Secrets: clean — all `process.env` + dotenv, `.env` 600/gitignored, no literals
  in source, `ANTHROPIC_API_KEY` stripped before spawning `claude`.

## Tests
`npm test` (node:test, `--test-concurrency=1`): **164 passing**, incl. the messaging
console (grouping, locale collapse, pagination, callback_data ≤64 bytes, variable
substitution, idempotent approve, search, console screens, settings toggle, cron).
