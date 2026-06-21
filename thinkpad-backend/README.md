# ThinkPad backend (manicbot-backend)

Sidecar cron fleet for ManicBot running on the home ThinkPad (Ubuntu, PM2).
Lives in the public repo on the `thinkpad` branch — **no secrets here**:
runtime credentials stay in `~/manicbot-backend/.env` on the server
(see `.env.example`).

## Crons (PM2 one-shot, `cron_restart`)

| App | Schedule | What it does |
| --- | --- | --- |
| `health-check` | every 30 min | system stats + Worker `/api/health` probe; TG alert on FAIL |
| `nightly` | 01:00 + 13:00 | tenant roster → `marketing/clients.csv` + full D1 SQL backup (30 days kept) |
| `blog-autopilot` | 02:00 + 14:00 | generates a long-form (~2000 words/language) blog draft via `claude -p` (i18n: write RU once, localize ua/en/pl) and sends a Telegram preview with **Читать / Publish / Revise / Skip** buttons; skips generation while a draft awaits approval |
| `lead-scout` | every 15 min | scrapes one (location, query, source) slot of PL nail salons/masters (Warsaw districts + major cities) |
| `booksy-full` | 03:30 + 15:30 | full Booksy catalog crawl via JSON-LD with yield-anomaly alerts |
| `gsc-monitor` | 08:00 daily | Google Search Console 7d-over-7d trend + sitemap status + index coverage of priority URLs → TG; no-ops until `GSC_SERVICE_ACCOUNT_JSON` is set |

Blog publishing is button-driven: the tg-bot callback handler shells out to
`crons/blog/publish.js --slug <slug> --action publish|skip|revise`.

## Lead sources (`crons/lead-scout/`)

The rotation cycles 38 locations (14 Warsaw districts + 24 largest PL cities)
× 15 query templates × 3 sources:

| Source | How | Notes |
| --- | --- | --- |
| `google_maps` | Playwright (headless Chrome) | richest — name + phone + website |
| `booksy` | HTTP + JSON-LD | salons; phones behind login |
| `olx` | HTTP + `__PRERENDERED_STATE__` | solo masters via classified ads; services-only, phone regex'd from description; national, so each city is a fresh pool |

`google` (Custom Search JSON API, needs `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX`) and
`bing` (JS-gated HTML scrape) were **retired from the rotation** — both returned
0 results every run, wasting 40% of slots. Their scraper modules are kept so a
future `GOOGLE_CSE_KEY` can re-enable `google` by adding it back to `SOURCES`.

Dedup (`dedup.js`, shared with `scripts/clean-leads.js`) collapses leads that
share any of: phone / website / instagram / booksy / maps / olx url. One-off
maintenance: `node scripts/clean-leads.js [--drops quality-drop.json]`.

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
