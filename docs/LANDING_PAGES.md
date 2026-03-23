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

## Секреты CI

Как и для бота: **`CLOUDFLARE_API_TOKEN`**, **`CLOUDFLARE_ACCOUNT_ID`**.
