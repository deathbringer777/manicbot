# ManicBot Admin Mini App

Telegram **WebApp** (Mini App) для ролей платформы и салона: God Mode, поддержка, владелец салона, мастер. Отдельный деплой на **Cloudflare Pages** (проект `admin-app`).

## Стек

- Next.js 15 (App Router), React 19
- tRPC 11 + TanStack Query, SuperJSON
- Drizzle ORM → та же D1, что у Worker (`manicbot-db`)
- Tailwind CSS 4
- Вход: заголовок `x-telegram-init-data`, проверка HMAC в `src/server/auth/telegram.ts`
- Матрица ролей God Mode: `src/server/api/platformRoles.ts` + `adminProcedure` в `src/server/api/trpc.ts`

## Команды

```bash
npm ci --legacy-peer-deps
npm run dev              # локально: next dev --turbo
npm run typecheck        # tsc --noEmit
npm test                 # vitest
npm run build            # обычный Next build
npx next-on-pages        # сборка для Cloudflare Pages (как в CI)
```

## Переменные окружения

Задаются в Cloudflare Pages (и при локальной разработке — `.env` / `.dev.vars`, не коммитить):

| Переменная | Назначение |
|------------|------------|
| `TELEGRAM_BOT_TOKEN` | Токен бота для проверки подписи WebApp initData |
| `ADMIN_CHAT_ID` | Telegram user id создателя — всегда `system_admin` |
| `DATABASE_URL` | Опционально: LibSQL remote для локальной разработки |
| `WORKER_PUBLIC_URL` | Публичный URL Worker (вебхуки Meta в UI Channels), без `/` в конце |
| `META_VERIFY_TOKEN_WA` / `META_VERIFY_TOKEN_IG` | Verify token для Meta; должны совпадать с секретами Worker |

Остальные секреты/биндинги — по `@t3-oss/env-nextjs` в `src/env.js`.

**Секреты через Wrangler (проект Pages `admin-app`):**

```bash
npx wrangler pages secret put WORKER_PUBLIC_URL --project-name=admin-app
npx wrangler pages secret put META_VERIFY_TOKEN_WA --project-name=admin-app
npx wrangler pages secret put META_VERIFY_TOKEN_IG --project-name=admin-app
```

(значения вводятся интерактивно; должны совпадать с `wrangler secret put` у Worker.)

### Два package-lock.json

В репозитории есть `manicbot/package-lock.json` (Worker) и `manicbot/admin-app/package-lock.json` (Mini App). Так сделано намеренно: **GitHub Actions** кэширует зависимости отдельно по `cache-dependency-path` для каждого job. Next.js при сборке может предупреждать о «multiple lockfiles» — на корректность CI это не влияет; унифицировать lockfile в один корневой монорепо-манифест можно отдельной задачей.

## Связь с Worker

- Worker проксирует ссылки на приложение через `ADMIN_APP_URL` в `wrangler.toml`.
- Каналы и диалоги: роутеры `channels`, `conversations` (tRPC) с `assertTenantOwner` по `tenantId`.

Подробная архитектура: репозиторий **`CLAUDE.md`** (раздел Admin Mini-App).

## Деплой

Push в `main` → GitHub Actions: job `test` (включая `typecheck` + `npm test` для этого пакета) → job `deploy-admin-app` → `pages deploy` в проект `admin-app`.
