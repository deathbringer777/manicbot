# ManicBot Admin Mini App

Telegram **WebApp** (Mini App) for platform and salon roles: God Mode, support, salon owner, master. Separate deployment to **Cloudflare Pages** (project `admin-app`).

## Stack

- Next.js 15 (App Router), React 19
- tRPC 11 + TanStack Query, SuperJSON
- Drizzle ORM → same D1 as Worker (`manicbot-db`)
- Tailwind CSS 4
- Auth: `x-telegram-init-data` header, HMAC verification in `src/server/auth/telegram.ts`
- God Mode role matrix: `src/server/api/platformRoles.ts` + `adminProcedure` in `src/server/api/trpc.ts`

## Commands

```bash
npm ci --legacy-peer-deps
npm run dev              # local: next dev --turbo
npm run typecheck        # tsc --noEmit
npm test                 # vitest
npm run build            # standard Next build
npx next-on-pages        # build for Cloudflare Pages (as in CI)
```

## Environment Variables

Set in Cloudflare Pages (and for local development — `.env` / `.dev.vars`, do not commit):

| Variable | Purpose |
|------------|------------|
| `TELEGRAM_BOT_TOKEN` | Bot token for WebApp initData signature verification |
| `ADMIN_CHAT_ID` | Telegram user id of the creator — always `system_admin` |
| `DATABASE_URL` | Optional: LibSQL remote for local development |
| `WORKER_PUBLIC_URL` | Public Worker URL (Meta webhook hints in Channels UI), no trailing `/` |
| `META_VERIFY_TOKEN_WA` / `META_VERIFY_TOKEN_IG` | Verify token for Meta; must match Worker secrets |

Other secrets/bindings — via `@t3-oss/env-nextjs` in `src/env.js`.

**Secrets via Wrangler (Pages project `admin-app`):**

```bash
npx wrangler pages secret put WORKER_PUBLIC_URL --project-name=admin-app
npx wrangler pages secret put META_VERIFY_TOKEN_WA --project-name=admin-app
npx wrangler pages secret put META_VERIFY_TOKEN_IG --project-name=admin-app
```

(values entered interactively; must match `wrangler secret put` on the Worker.)

### Two package-lock.json files

The repository has `manicbot/package-lock.json` (Worker) and `manicbot/admin-app/package-lock.json` (Mini App). This is intentional: **GitHub Actions** caches dependencies separately via `cache-dependency-path` for each job. Next.js may warn about "multiple lockfiles" at build time — this doesn't affect CI correctness; consolidating into a single root monorepo manifest is a separate task.

## Connection to Worker

- Worker proxies links to the app via `ADMIN_APP_URL` in `wrangler.toml`.
- Channels and conversations: `channels`, `conversations` routers (tRPC) with `assertTenantOwner` by `tenantId`.

Detailed architecture: **`CLAUDE.md`** in the repository (Admin Mini-App section).

## Salon Home widget board

The salon Overview («Домой») tab is a configurable widget board
(`src/components/dashboards/home-widgets/`) built on `react-grid-layout`
(`^1.5`, React 19-compatible; mounted `next/dynamic { ssr:false }`).
Drag / resize / add / remove widgets; the layout persists per-user in the
`tenant_config` ui-prefs blob via `useDashboardPrefs.homeWidgets` — **no
migration**. Metrics come from the tenant-scoped `salonMetrics` tRPC
router. **Settings → Виджеты**
(`src/components/settings/sections/WidgetsSection.tsx`) configures the same
state. See `src/components/dashboards/home-widgets/README.md` for the
registry contract and how to add a widget.

## Deploy

Push to `main` → GitHub Actions: `test` job (including `typecheck` + `npm test` for this package) → `deploy-admin-app` job → `pages deploy` to project `admin-app`.
