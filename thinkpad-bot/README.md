# ThinkPad ops-bot (`tg-bot`)

A single-owner Telegram bot that turns a Telegram chat into a remote control for
a Linux machine (a Lenovo ThinkPad running Ubuntu / GNOME-Wayland). It answers
slash-commands, runs free-text requests through an LLM with computer-control
tools, takes screenshots, controls input, manages PM2 processes, plays music,
transcribes voice notes, and more.

> Lives in the ManicBot repo on the long-lived **`thinkpad`** branch. Runtime
> secrets and infra details are gitignored — see [Security](#security).

## Stack

- **Runtime:** vanilla Node.js (CommonJS), no web framework. Telegram long-polling
  via `fetch`. Managed by **PM2** (`ecosystem.config.js`).
- **Brain:** Groq Chat Completions (`llama-3.3-70b-versatile`) with a tool-calling
  loop (`llm.js` + `tools.js`).
- **Computer control (GNOME Wayland):** `ydotool` (mouse/keys, needs `ydotoold`),
  `wtype` (typing). Screenshots go through the bundled GNOME Shell extension
  (`gnome-extension/`) — on Mutter no external screenshot tool works (grim lacks
  wlr-screencopy, the Shell D-Bus is AccessDenied, the portal is interactive).
- **Deps:** only `dotenv`. Tests run on the built-in `node --test`.

## Layout

```
bot.js              Long-poll loop + command router + callback/voice handling
telegram.js         Telegram Bot API wrapper (send, chunking, keyboards, setMyCommands)
llm.js              Groq client + agentic tool loop + token/rate-limit accounting
tools.js            Tool definitions + tool runner + system prompt
config.js           Env loading + graphical-session ENV for child processes
commands.js         Built-in slash commands (/status, /screenshot, /cron, …)
commands/*.js       Dynamic command modules (auto-registered)
tools/*.js          Computer-control primitives (screenshot, input, clipboard, window…)
context/*.md        System-prompt context (machine.md is local-only — see below)
test/*.test.js      Unit tests
deploy.sh           Backup → rsync → pm2 restart (reads .deploy.local)
```

## Setup (on the server)

1. `npm install`
2. Create `.env` (see `.env.example`):
   - `TELEGRAM_TOKEN` — bot token from @BotFather
   - `GROQ_KEY` — Groq API key (`gsk_…`)
   - `GROQ_KEY` — Groq Whisper for voice notes; text LLM is the `claude` CLI on the Max subscription (no API key)
   - `ALLOWED_USER_ID` — the single Telegram user id allowed to use the bot
   - `CHAT_ID` — optional, defaults to `ALLOWED_USER_ID`
3. (Optional) create `context/machine.md` to give the LLM context about the box
   (hardware, directory layout, useful commands). Kept local — see Security.
4. `pm2 start ecosystem.config.js` (or `pm2 restart tg-bot`).
5. Screenshots (GNOME Wayland): run `gnome-extension/install.sh`, then log out and
   back in once so GNOME loads the `mbshot` extension. Verify with the `Ping` call
   the installer prints.

For computer control to work, the bot process must inherit the graphical
session env (`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`,
`YDOTOOL_SOCKET`) and `ydotoold` must be running with access to `/dev/uinput`.

## Deploy (from a dev machine)

```bash
cp .deploy.local.example .deploy.local   # set DEPLOY_HOST / DEPLOY_PATH
./deploy.sh                              # backup → rsync → pm2 restart → status
```

## Tests

```bash
npm test
```

## Security

- Single-owner gate: only `ALLOWED_USER_ID` is served; everyone else is ignored.
- This is a **public repo**. Never commit `.env`, tokens, or `context/machine.md`
  (it holds infra topology). They are gitignored. Only `.env.example` and
  `.deploy.local.example` (placeholders) are tracked.
- Destructive operations (process stop, `rm`/reboot/shutdown, etc.) are
  confirm-gated to guard against accidental or hallucinated commands.
