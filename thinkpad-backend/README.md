# ThinkPad backend (manicbot-backend)

Sidecar cron fleet for ManicBot running on the home ThinkPad (Ubuntu, PM2).
Lives in the public repo on the `thinkpad` branch — **no secrets here**:
runtime credentials stay in `~/manicbot-backend/.env` on the server
(see `.env.example`).

## Crons (PM2 one-shot, `cron_restart`)

| App | Schedule | What it does |
| --- | --- | --- |
| `health-check` | hourly | system stats + Worker `/api/health` probe; TG alert on FAIL |
| `nightly` | 01:00 | tenant roster → `marketing/clients.csv` + full D1 SQL backup (30 days kept) |
| `blog-autopilot` | 02:00 | generates a 4-language blog draft via `claude -p` and sends a Telegram preview with **Publish / Revise / Skip** buttons |
| `lead-scout` | hourly | scrapes one (district, query, source) slot of Warsaw nail salons |
| `booksy-full` | 03:30 | full Booksy catalog crawl via JSON-LD with yield-anomaly alerts |

Blog publishing is button-driven: the tg-bot callback handler shells out to
`crons/blog/publish.js --slug <slug> --action publish|skip|revise`.

## LLM policy

All text generation goes through the **`claude` CLI** (Max subscription,
model `sonnet`, effort `medium`) via `lib/claude.js`. There is intentionally
no `ANTHROPIC_API_KEY` in this project's env: the adapter strips it so usage
always bills the subscription. No Groq/OpenCode fallbacks — if Claude is
unavailable, the cron alerts to Telegram and fails loudly.

## Shared libs (`lib/`)

- `runner.js` — lock file, structured logs, TG alert on failure, exit code 1
- `claude.js` — headless `claude -p` adapter (JSON envelope, no-shell spawn)
- `tg.js` — Bot API client (messages, photos, inline keyboards, chunking)
- `d1.js` — Cloudflare D1 HTTP query/exec
- `http.js` / `log.js` — shared plumbing

## Develop & deploy

```bash
npm test                  # node:test suite (also runs on the server during deploy)
./deploy.sh               # rsync code → server, run tests there, pm2 startOrReload + save
```

`deploy.sh` needs a gitignored `.deploy.local` with `DEPLOY_HOST` /
`DEPLOY_PATH`. Server runtime state (`logs/`, `locks/`, `backups/`, `data/`,
`marketing/`, `.env`) is never touched by deploys.
