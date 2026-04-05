> **DEPRECATED (2026-04-05):** Директория `manicbot-landing/` архивирована и перемещена из проекта. Единственный активный лендинг — `manicbot-analysis/`. Для rollback используйте архив на Desktop (`manicbot-archive/old-landing/`).

# Лендинг manicbot.com (Cloudflare Pages)

## Что в проде по умолчанию

После **push в `main`** job **Landing — Deploy Pages** собирает **`manicbot-analysis`** и публикует в проект Pages **`manicbot-landing`** (тот же, что обычно привязан к manicbot.com).

## Как вернуть **прежнюю** версию сайта

### 1. Cloudflare (самый быстрый)

**Workers & Pages → manicbot-landing → Deployments** → выбрать предыдущий успешный деплой → **Rollback** / **Promote to production**.

Не требует коммитов в Git.

### 2. GitHub Actions (пересобрать старый код из репо)

1. **Actions → CI / Deploy → Run workflow**
2. В поле **landing_source** выбрать **`manicbot-landing`**
3. Запустить.

Соберётся и задеплоится папка **`manicbot-landing`** (legacy React/Vite), в тот же Pages-проект.

### 3. Git-тег «на память» перед большим переключением

Перед мержем в `main` можно пометить состояние ветки:

```bash
git fetch origin
git tag -a landing/pre-manicbot-analysis -m "Последний main до переключения Pages на manicbot-analysis" origin/main
git push origin landing/pre-manicbot-analysis
```

Откат кода: `git checkout landing/pre-manicbot-analysis` (и при необходимости вернуть старый `deploy.yml` из этого коммита).

## Блог (SEO) — путь `/blog/` на manicbot.com

Статические статьи на **4 языках** (RU/EN/UA/PL) **не требуют отдельного поддомена и DNS**: HTML лежит в **`manicbot-analysis/public/blog/`** (в git, чтобы прод всегда получал `/blog/*` даже если lifecycle npm на CI сбойнул). Перед сборкой `prebuild` всё равно перегенерирует папку из `manicbot-blog/generate.mjs`. Итог попадает в один деплой Pages **`manicbot-landing`**.

Публичные URL: **`https://manicbot.com/blog/...`**. Worker (`manicbot/src/worker.js`) проксирует запросы `/blog` и `/blog/*` на `LANDING_URL`, редирект **`/blog` → `/blog/`** (308).

Отдельный проект **`manicbot-blog`** в Cloudflare и запись **`blog.manicbot.com`** **не обязательны** (старый поддомен можно не настраивать или позже сделать редирект на `/blog/` в Cloudflare Rules).

Локально только блог: из корня репо `node manicbot-blog/generate.mjs` → вывод в `manicbot-blog/dist/` (базовый URL всё равно `https://manicbot.com/blog` в HTML).

## «Not Found» на manicbot.com или /blog/

1. **Worker** проксирует `/` и `/blog/*` на **`LANDING_URL`** (по умолчанию `https://manicbot-landing.pages.dev`). В **Cloudflare → Workers → manicbot → Settings → Variables** не задавайте `LANDING_URL` пустым и **не указывайте `https://manicbot.com`** (петля запроса). Если переменная пустая или указывает на сам домен, в коде используется fallback на `manicbot-landing.pages.dev`.
2. Убедитесь, что последний деплой **Landing — Deploy Pages** прошёл и в логе есть шаг **Verify dist** (в `dist/` есть `blog/…`).
3. В **Pages → manicbot-landing → Custom domains** домен `manicbot.com` должен быть привязан к этому проекту (как в документации Cloudflare для Worker + Pages).

## Секреты CI

Как и для бота: **`CLOUDFLARE_API_TOKEN`**, **`CLOUDFLARE_ACCOUNT_ID`**.
