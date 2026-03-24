import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "project-analysis");

const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".vercel",
  ".wrangler",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
  "project-analysis",
]);

const PACKAGE_ROOTS = [
  { key: "worker", label: "manicbot/src", root: "manicbot/src" },
  { key: "tests", label: "manicbot/test", root: "manicbot/test" },
  { key: "admin", label: "manicbot/admin-app/src", root: "manicbot/admin-app/src" },
  { key: "analysis", label: "manicbot-analysis/src", root: "manicbot-analysis/src" },
  { key: "landing", label: "manicbot-landing/src", root: "manicbot-landing/src" },
];

const IMPORTANT_FILES = [
  "README.md",
  "MULTI_BOT_SETUP.md",
  "manicbot/wrangler.toml",
  "manicbot/src/worker.js",
  "manicbot/src/handlers/message.js",
  "manicbot/src/handlers/callback.js",
  "manicbot/src/handlers/cron.js",
  "manicbot/src/services/appointments.js",
  "manicbot/src/services/users.js",
  "manicbot/src/services/services.js",
  "manicbot/src/services/google-calendar-oauth.js",
  "manicbot/src/roles/roles.js",
  "manicbot/src/support/tickets.js",
  "manicbot/src/billing/webhooks.js",
  "manicbot/src/db/schema.sql",
  "manicbot/admin-app/src/app/layout.tsx",
  "manicbot/admin-app/src/app/api/trpc/[trpc]/route.ts",
  "manicbot/admin-app/src/server/api/trpc.ts",
  "manicbot/admin-app/src/server/api/root.ts",
  "manicbot/admin-app/src/server/db/schema.ts",
  "manicbot/admin-app/src/components/TelegramGate.tsx",
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function rel(file) {
  return toPosix(path.relative(repoRoot, file));
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
      continue;
    }
    acc.push(full);
  }
  return acc;
}

function sourceFiles(root) {
  return walk(path.join(repoRoot, root)).filter((file) =>
    /\.(js|jsx|ts|tsx|sql|md)$/.test(file),
  );
}

function lineCount(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).length;
}

function scanPackages() {
  return PACKAGE_ROOTS.map((pkg) => {
    const files = sourceFiles(pkg.root);
    return {
      ...pkg,
      files: files.length,
      lines: files.reduce((sum, file) => sum + lineCount(file), 0),
      topLevelFolders: topLevelBreakdown(pkg.root),
      topFiles: files
        .filter((file) => /\.(js|jsx|ts|tsx)$/.test(file))
        .map((file) => ({ file: rel(file), lines: lineCount(file) }))
        .sort((a, b) => b.lines - a.lines)
        .slice(0, 8),
    };
  });
}

function topLevelBreakdown(root) {
  const counts = new Map();
  for (const file of sourceFiles(root).filter((item) => /\.(js|jsx|ts|tsx)$/.test(item))) {
    const relative = toPosix(path.relative(path.join(repoRoot, root), file));
    const bucket = relative.includes("/") ? relative.split("/")[0] : "(root)";
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "en"))
    .map(([name, count]) => ({ name, count }));
}

function scanTests() {
  const files = walk(path.join(repoRoot, "manicbot", "test")).filter((file) =>
    /\.test\.js$/.test(file),
  );
  return {
    count: files.length,
    files: files.map(rel).sort(),
  };
}

function resolveImport(file, spec) {
  if (spec.startsWith("~/")) {
    return resolveModule(path.join(repoRoot, "manicbot", "admin-app", "src"), spec.slice(2));
  }
  if (spec.startsWith("@/")) {
    return resolveModule(path.join(repoRoot, "manicbot-analysis", "src"), spec.slice(2));
  }
  if (spec.startsWith(".")) {
    const base = path.resolve(path.dirname(file), spec);
    return resolvePath(base);
  }
  return null;
}

function resolveModule(root, spec) {
  return resolvePath(path.join(root, spec));
}

function resolvePath(base) {
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const item of candidates) {
    if (fs.existsSync(item) && fs.statSync(item).isFile()) return item;
  }
  return null;
}

function importsFrom(file) {
  const content = fs.readFileSync(file, "utf8");
  const matches = [];
  const re = /import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  let result;
  while ((result = re.exec(content))) matches.push(result[1]);
  return matches;
}

function internalConnectivity(root) {
  const absoluteRoot = path.join(repoRoot, root);
  const files = sourceFiles(root).filter((file) => /\.(js|jsx|ts|tsx)$/.test(file));
  return files
    .map((file) => {
      const uniqueImports = new Set();
      for (const spec of importsFrom(file)) {
        const resolved = resolveImport(file, spec);
        if (resolved && resolved.startsWith(absoluteRoot)) uniqueImports.add(rel(resolved));
      }
      return {
        file: rel(file),
        imports: uniqueImports.size,
      };
    })
    .sort((a, b) => b.imports - a.imports)
    .slice(0, 10);
}

function gatherMetrics() {
  const packages = scanPackages();
  return {
    generatedAt: new Date().toISOString(),
    packages,
    tests: scanTests(),
    hotspots: {
      worker: internalConnectivity("manicbot/src"),
      admin: internalConnectivity("manicbot/admin-app/src"),
    },
    importantFiles: IMPORTANT_FILES,
  };
}

function packageByKey(metrics, key) {
  return metrics.packages.find((item) => item.key === key);
}

function table(rows) {
  return rows.join("\n");
}

function mdList(items, prefix = "- ") {
  return items.map((item) => `${prefix}${item}`).join("\n");
}

function buildMarkdown(metrics) {
  const worker = packageByKey(metrics, "worker");
  const tests = packageByKey(metrics, "tests");
  const admin = packageByKey(metrics, "admin");
  const analysis = packageByKey(metrics, "analysis");
  const landing = packageByKey(metrics, "landing");

  const packageTable = [
    "| Package | Назначение | Файлы | LOC |",
    "|---|---:|---:|---:|",
    `| \`manicbot/src\` | Worker backend, Telegram, billing, AI, multi-tenant runtime | ${worker.files} | ${worker.lines} |`,
    `| \`manicbot/test\` | Unit/integration coverage для backend | ${tests.files} | ${tests.lines} |`,
    `| \`manicbot/admin-app/src\` | Next.js God Mode / tRPC / D1 console | ${admin.files} | ${admin.lines} |`,
    `| \`manicbot-analysis/src\` | Отдельный визуальный аналитический фронтенд | ${analysis.files} | ${analysis.lines} |`,
    `| \`manicbot-landing/src\` | Маркетинговый лендинг | ${landing.files} | ${landing.lines} |`,
  ];

  const workerHotspots = metrics.hotspots.worker
    .slice(0, 8)
    .map((item) => `\`${item.file}\` — ${item.imports} внутренних импортов`);

  const adminHotspots = metrics.hotspots.admin
    .slice(0, 8)
    .map((item) => `\`${item.file}\` — ${item.imports} внутренних импортов`);

  const largestWorkerFiles = worker.topFiles
    .slice(0, 8)
    .map((item) => `\`${item.file}\` — ${item.lines} LOC`);

  const largestAdminFiles = admin.topFiles
    .slice(0, 6)
    .map((item) => `\`${item.file}\` — ${item.lines} LOC`);

  return `# Анализ структуры проекта ManicBot

Файл сгенерирован автоматически ${metrics.generatedAt} после полного прохода по source-деревьям репозитория и ручной проверки ключевых entrypoints, схемы данных, webhook-роутинга, billing, tenancy и admin-app.

## План разбора

1. Определить реальные приложения внутри репозитория и их назначение.
2. Разложить runtime на пользовательские поверхности, входные точки и хранилища.
3. Отдельно разобрать внутренности Worker-ядра и Next.js admin-app.
4. Зафиксировать фактическую модель данных: D1, KV и их зоны ответственности.
5. Подсветить архитектурные расхождения между документацией, SQL-схемой и admin-app schema.
6. Сохранить результаты в масштабируемых артефактах для Miro и последующих ревизий.

## 1. Что лежит в репозитории

${table(packageTable)}

### Быстрый вывод

- Это не один проект, а связка из как минимум четырёх приложений и набора исторических/аналитических артефактов.
- Реальное ядро системы живёт в \`manicbot/src\`: именно этот код обслуживает Telegram webhook, Stripe webhook, cron, landing proxy, HTML admin и Google OAuth callbacks.
- \`manicbot/admin-app\` — это отдельная Next.js mini-app консоль над той же D1 базой, но по факту сейчас она ближе к platform-level “God Mode”, чем к self-service кабинету владельца салона.
- \`manicbot-landing\` — отдельный маркетинговый сайт, который Worker проксирует на корневом домене через \`LANDING_URL\`.
- \`manicbot-analysis\` — самостоятельный Vite frontend, похожий на презентационный/аудиторский интерфейс, а не на часть production runtime.

## 2. Фактическая архитектура по коду

### Пользовательские поверхности

- Telegram клиенты, мастера, владельцы салонов и platform admin взаимодействуют с системой через Telegram Bot API.
- Cloudflare Worker в \`manicbot/src/worker.js\` выступает единым edge gateway: принимает webhook-и, крутит cron, отдаёт HTML admin, проксирует landing и завершает Google OAuth flow.
- Отдельная mini-app консоль в \`manicbot/admin-app\` работает через Next.js App Router, tRPC и D1.
- Есть две разные админские поверхности:
  - HTML-эндпоинты в самом Worker (\`/admin\`, \`/admin/billing\`, CSV export, \`/setup\`, \`/admin/provision\`, миграции).
  - Telegram Mini App / Next.js консоль в \`manicbot/admin-app\`.

### Основные runtime entrypoints

- \`manicbot/src/worker.js\`:
  - \`POST /webhook/:botId\` и \`POST /webhook\`
  - \`POST /stripe/webhook\`
  - \`GET /admin\`, \`/admin/billing\`, \`/admin/export/*\`
  - \`GET /setup\`, \`/remove-webhook\`
  - \`GET /google/connect\`, \`/google/callback\`, \`/google/select\`, \`POST /google/webhook\`
  - \`GET /calendar/:aptId.ics\`
  - \`scheduled()\` для cron по всем tenant-ам
- \`manicbot/admin-app/src/app/api/trpc/[trpc]/route.ts\`: единая server boundary для Next.js mini-app.

### Где находится orchestration

- \`worker.js\` — главный orchestrator инфраструктуры.
- \`handlers/message.js\` и \`handlers/callback.js\` — главный orchestration layer пользовательских сценариев.
- \`services/google-calendar-oauth.js\` — отдельный большой subsystem внутри backend-а.
- \`admin-app/src/server/api/root.ts\` и \`server/api/trpc.ts\` — orchestration слой mini-app.

## 3. Внутренности Worker backend

### Слои внутри \`manicbot/src\`

- \`handlers/\` — message/callback/cron orchestration.
- \`services/\` — предметная логика записи, пользователей, state, chat, каталогов, календаря.
- \`tenant/\` — registry tenant-ов и bot mapping.
- \`billing/\` — Stripe config, checkout/portal, lifecycle, webhook storage.
- \`support/\` и \`roles/\` — платформенные и tenant-level support/roles.
- \`ui/\` — генерация Telegram screens, клавиатур и административных меню.
- \`utils/\` — D1/KV/security/date/helpers/ICS.
- \`i18n/\` — языковые словари, сейчас уже разложенные по папкам и namespace-ам.

### Главные hotspot-модули по связанности

${mdList(workerHotspots)}

### Крупнейшие файлы backend-а

${mdList(largestWorkerFiles)}

### Что это значит архитектурно

- Основной контроль потока сосредоточен в двух очень больших обработчиках: \`message.js\` и \`callback.js\`.
- \`worker.js\` уже не “тонкая точка входа”, а настоящий edge gateway со смешанной ответственностью.
- \`google-calendar-oauth.js\` — отдельный крупный subsystem со своей динамической схемой БД, OAuth session storage и watch renewal.
- UI-слой Telegram находится внутри backend-а и сильно связан с orchestration code, поэтому сценарии размазаны между \`handlers/*\`, \`ui/*\`, \`notifications.js\` и \`ai.js\`.

## 4. Admin-app: что это на самом деле

### Состав

- App Router pages в \`src/app/*\`
- tRPC routers в \`src/server/api/routers/*\`
- Drizzle schema в \`src/server/db/schema.ts\`
- Telegram init-data verification в \`src/server/auth/telegram.ts\`
- UI shell и mobile/desktop navigation в \`src/components/layout/Shell.tsx\`

### Крупнейшие файлы admin-app

${mdList(largestAdminFiles)}

### Hotspots по связанности

${mdList(adminHotspots)}

### Фактическая роль mini-app

- По названию и части документации это выглядит как “admin dashboard для владельца салона”.
- По коду это сейчас platform console:
  - \`TelegramGate.tsx\` пропускает только жёстко захардкоженный \`CREATOR_ID\`.
  - \`adminProcedure\` в \`server/api/trpc.ts\` тоже привязан к creator ID и platform roles.
  - В интерфейсе основной акцент на tenants, agents, users, platform billing и system health.
- Вывод: Next.js app сейчас ближе к God Mode для платформы, а не к tenant-owner panel.

## 5. Хранилища и модель данных

### Реальный storage model: гибрид D1 + KV

- D1:
  - tenants, bots, appointments, users, masters, services, tenant_config
  - platform_roles, support_agents, tenant_support_agents
  - platform_tickets, platform_ticket_messages, stripe_customers
  - runtime-created Google tables: \`google_integrations\`, \`google_busy_blocks\`
- KV:
  - \`bottoken:*\` для bot token-ов
  - \`gcal:oauth:*\` для OAuth session state
  - \`stripe:evt:*\` для Stripe idempotency
  - \`tktlock:*\` для claim race lock support ticket-ов
  - tenant-prefixed state/legacy data в fallback path: \`state:*\`, \`ap:*\`, \`all:*\`, \`d:*\`, \`ua:*\` и т.д.

### Важный вывод

- README и часть старых документов описывают систему как KV-first.
- Фактический код уже D1-first для business entities, но KV всё ещё играет важную инфраструктурную роль.
- То есть migration на D1 не завершена как “полный отказ от KV”; система работает в гибридном режиме.

## 6. Ключевые бизнес-потоки

### Запись клиента

1. Клиент пишет в Telegram.
2. Telegram вызывает \`/webhook/:botId\`.
3. Worker строит tenant context через \`tenant/resolver.js\`.
4. \`handlers/message.js\` или \`handlers/callback.js\` запускает сценарий.
5. \`services/appointments.js\` создаёт/читает запись.
6. \`notifications.js\` уведомляет мастера/админа.
7. При подтверждении создаются ICS и при наличии интеграции синхронизируется Google Calendar.

### Cron

1. \`scheduled()\` в Worker получает список tenant-ов из D1.
2. Для каждого tenant-а поднимается tenant context через первый bot этого tenant-а.
3. \`handlers/cron.js\` проверяет billing expiry, шлёт reminders, retry calendar sync и чистит старые appointments.

### Биллинг

1. Checkout/Portal инициируется из backend или UI.
2. Stripe вызывает \`/stripe/webhook\`.
3. \`billing/webhooks.js\` проверяет подпись, использует KV для idempotency и обновляет \`tenants\` / \`stripe_customers\` в D1.
4. Feature gating дальше применяется в handlers через \`billing/features.js\`.

### Mini-app admin flow

1. Telegram WebApp initData попадает в заголовок \`x-telegram-init-data\`.
2. \`server/auth/telegram.ts\` валидирует подпись.
3. \`adminProcedure\` в tRPC решает, есть ли доступ.
4. Router-ы читают и мутируют D1 напрямую через Drizzle.

## 7. Архитектурные расхождения и зоны риска

### Документация отстаёт от кода

- Корневой \`README.md\` всё ещё описывает KV-first модель как основной источник правды.
- \`MULTI_BOT_SETUP.md\` опирается на устаревшую схему tenant keys и старые setup URL.
- \`manicbot/admin-app/README.md\` — почти чистый template README, не отражающий реальную mini-app.

### Есть drift между worker SQL и admin-app Drizzle schema

- \`services\`: в SQL колонка \`sort_order\`, в Drizzle — \`order\`.
- \`masters\`: SQL и Drizzle описывают разные поля и semantics.
- \`platform_tickets\` и \`platform_ticket_messages\`: структура в worker и admin-app не совпадает по именам полей и модели.
- \`support_agents.type\`: worker ожидает \`technical\`, admin-app пишет \`technical_support\`.
- \`tenant_roles\`: SQL ожидает \`created_at\`, admin-app schema и mutation layer работают иначе.
- \`billingStatus\`: mini-app использует \`grace\`, backend — \`grace_period\`.
- \`platform roles\`: mini-app оперирует \`admin/owner\`, Worker — \`system_admin/tenant_owner\`.

### Есть две разные “админки”

- Worker HTML admin — tenant-scoped basic-auth surface.
- Next.js mini-app — platform-focused surface.
- Для понимания проекта это важно: это не “одна админка в двух формах”, а две параллельные operational surfaces.

## 8. Что читать в первую очередь

1. \`manicbot/src/worker.js\`
2. \`manicbot/src/tenant/resolver.js\`
3. \`manicbot/src/handlers/message.js\`
4. \`manicbot/src/handlers/callback.js\`
5. \`manicbot/src/services/appointments.js\`
6. \`manicbot/src/services/users.js\`
7. \`manicbot/src/services/google-calendar-oauth.js\`
8. \`manicbot/src/db/schema.sql\`
9. \`manicbot/admin-app/src/server/api/root.ts\`
10. \`manicbot/admin-app/src/server/db/schema.ts\`

## 9. Что именно я приложил рядом

- \`PROJECT_STRUCTURE_BOARD.svg\` — большая векторная board-style схема для импорта в Miro.
- \`PROJECT_STRUCTURE_MAP.mmd\` — Mermaid-версия центральной архитектуры.
- \`project-metrics.json\` — численные метрики по пакетам, hotspot-ам и тестам.

## 10. Как использовать в Miro

1. Загрузите \`PROJECT_STRUCTURE_BOARD.svg\` как обычный файл на board.
2. Увеличивайте отдельные панели: runtime, worker internals, data model, flows, risks.
3. Если захотите править связи уже в Miro через Mermaid-плагин, используйте \`PROJECT_STRUCTURE_MAP.mmd\` как исходник.
`;
}

function buildMermaid() {
  return `flowchart LR

classDef actor fill:#fff7ed,stroke:#c2410c,stroke-width:2px,color:#111827
classDef platform fill:#eff6ff,stroke:#2563eb,stroke-width:2px,color:#111827
classDef worker fill:#ecfeff,stroke:#0f766e,stroke-width:2px,color:#111827
classDef data fill:#f0fdf4,stroke:#15803d,stroke-width:2px,color:#111827
classDef ext fill:#f8fafc,stroke:#475569,stroke-width:2px,color:#111827
classDef note fill:#fffbeb,stroke:#d97706,stroke-width:2px,color:#111827

subgraph Actors["Actors / Surfaces"]
  client["Client (Telegram)"]:::actor
  master["Master (Telegram)"]:::actor
  owner["Tenant owner"]:::actor
  platformAdmin["Platform admin"]:::actor
end

subgraph External["External services"]
  telegram["Telegram Bot API"]:::ext
  stripe["Stripe"]:::ext
  workersAI["Cloudflare Workers AI"]:::ext
  gcal["Google Calendar"]:::ext
  landing["Landing (Cloudflare Pages)"]:::ext
end

subgraph Worker["Cloudflare Worker / manicbot/src"]
  worker["worker.js\\nfetch + scheduled + admin + oauth"]:::worker
  resolver["tenant/resolver.js"]:::worker
  message["handlers/message.js"]:::worker
  callback["handlers/callback.js"]:::worker
  cron["handlers/cron.js"]:::worker
  appts["services/appointments.js"]:::worker
  users["services/users.js"]:::worker
  catalog["services/services.js"]:::worker
  ai["ai.js"]:::worker
  gcalOauth["services/google-calendar-oauth.js"]:::worker
  billing["billing/*"]:::worker
  support["support/tickets.js"]:::worker
  ui["ui/* + notifications.js"]:::worker
end

subgraph Admin["Next.js God Mode / manicbot/admin-app"]
  app["App Router pages"]:::platform
  trpc["tRPC routes"]:::platform
  auth["Telegram init-data auth"]:::platform
  drizzle["Drizzle schema"]:::platform
end

subgraph Data["Persistence"]
  d1["Cloudflare D1\\ntenants, bots, appointments, users, services, roles, tickets"]:::data
  kv["Cloudflare KV\\nbottoken, oauth session, stripe evt, locks, legacy state"]:::data
end

client --> telegram
master --> telegram
owner --> telegram
platformAdmin --> telegram
telegram --> worker

worker --> resolver
resolver --> message
resolver --> callback
worker --> cron
message --> appts
message --> users
message --> catalog
message --> ai
message --> support
message --> ui
callback --> appts
callback --> users
callback --> gcalOauth
callback --> billing
callback --> ui
cron --> appts
cron --> gcalOauth
cron --> billing
ai -.-> workersAI
gcalOauth -.-> gcal
billing -.-> stripe
worker -. proxy .-> landing

worker --> d1
worker --> kv
appts --> d1
users --> d1
catalog --> d1
support --> d1
gcalOauth --> d1
billing --> d1
resolver --> kv
billing --> kv
gcalOauth --> kv
support --> kv

owner --> app
platformAdmin --> app
app --> auth
app --> trpc
trpc --> drizzle
drizzle --> d1

drift["Main drift:\\nDocs still say KV-first,\\nreal runtime is D1 + KV hybrid"]:::note
schema["Schema drift:\\nworker SQL != admin Drizzle in several tables/status enums"]:::note

d1 --> drift
trpc --> schema
`;
}

function buildSvg(metrics) {
  const worker = packageByKey(metrics, "worker");
  const tests = packageByKey(metrics, "tests");
  const admin = packageByKey(metrics, "admin");
  const analysis = packageByKey(metrics, "analysis");
  const landing = packageByKey(metrics, "landing");

  const width = 5600;
  const height = 3320;
  const parts = [];

  function add(value) {
    parts.push(value);
  }

  function rect({ x, y, w, h, fill = "#fff", stroke = "#d6d3d1", radius = 24, dash = "", width: sw = 2 }) {
    add(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""} />`,
    );
  }

  function panel({ x, y, w, h, title, subtitle, accent, fill = "#fffdf8" }) {
    rect({ x, y, w, h, fill, stroke: accent, radius: 30, sw: 3 });
    add(`<rect x="${x}" y="${y}" width="${w}" height="66" rx="30" fill="${accent}" />`);
    add(`<rect x="${x}" y="${y + 32}" width="${w}" height="34" fill="${accent}" />`);
    add(
      `<text x="${x + 28}" y="${y + 40}" font-size="28" font-weight="700" fill="#fff">${xml(title)}</text>`,
    );
    add(
      `<text x="${x + 28}" y="${y + 92}" font-size="16" font-weight="500" fill="#6b7280">${xml(subtitle)}</text>`,
    );
  }

  function pill({ x, y, text, fill, color = "#111827" }) {
    const w = Math.max(90, 22 + text.length * 8.5);
    rect({ x, y, w, h: 28, fill, stroke: "none", radius: 14, sw: 0 });
    add(`<text x="${x + 14}" y="${y + 19}" font-size="14" font-weight="700" fill="${color}">${xml(text)}</text>`);
  }

  function card({ x, y, w, h, title, lines = [], accent, fill = "#ffffff", badge = null }) {
    rect({ x, y, w, h, fill, stroke: accent, radius: 22, sw: 2 });
    add(`<text x="${x + 18}" y="${y + 28}" font-size="20" font-weight="700" fill="#102542">${xml(title)}</text>`);
    if (badge) pill({ x: x + w - Math.max(96, badge.length * 9 + 24) - 16, y: y + 12, text: badge, fill: accent, color: "#fff" });
    lines.forEach((line, index) => {
      add(`<text x="${x + 18}" y="${y + 58 + index * 19}" font-size="15" font-weight="500" fill="#334155">${xml(line)}</text>`);
    });
  }

  function sticky({ x, y, w, h, title, lines, fill = "#fef3c7", accent = "#d97706" }) {
    rect({ x, y, w, h, fill, stroke: accent, radius: 18, sw: 2 });
    add(`<text x="${x + 18}" y="${y + 28}" font-size="18" font-weight="800" fill="#7c2d12">${xml(title)}</text>`);
    lines.forEach((line, index) => {
      add(`<text x="${x + 18}" y="${y + 54 + index * 18}" font-size="14" font-weight="600" fill="#7c2d12">${xml(line)}</text>`);
    });
  }

  function label({ x, y, text, size = 16, color = "#475569", weight = 700 }) {
    add(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(text)}</text>`);
  }

  function arrow({ points, color = "#64748b", width: sw = 3, label: text = "", dash = "" }) {
    const d = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`)
      .join(" ");
    add(
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#arrowhead)"${dash ? ` stroke-dasharray="${dash}"` : ""} />`,
    );
    if (text) {
      const mid = points[Math.floor(points.length / 2)];
      rect({ x: mid[0] - text.length * 4.3 - 14, y: mid[1] - 18, w: text.length * 8.6 + 28, h: 28, fill: "#fffdf8", stroke: color, radius: 14, sw: 1.5 });
      add(`<text x="${mid[0] - text.length * 4.3}" y="${mid[1] + 1}" font-size="13" font-weight="700" fill="${color}">${xml(text)}</text>`);
    }
  }

  add(`<?xml version="1.0" encoding="UTF-8"?>`);
  add(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
  );
  add(`
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f6efe5" />
        <stop offset="100%" stop-color="#eceff6" />
      </linearGradient>
      <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
        <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#d6d3d1" stroke-width="1" opacity="0.35" />
      </pattern>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#0f172a" flood-opacity="0.08" />
      </filter>
      <marker id="arrowhead" markerWidth="14" markerHeight="14" refX="10" refY="7" orient="auto">
        <path d="M 0 0 L 14 7 L 0 14 z" fill="#64748b" />
      </marker>
    </defs>
  `);
  add(`<rect width="${width}" height="${height}" fill="url(#bg)" />`);
  add(`<rect width="${width}" height="${height}" fill="url(#grid)" />`);

  rect({ x: 60, y: 52, w: 5480, h: 132, fill: "#102542", stroke: "#102542", radius: 34, sw: 0 });
  label({ x: 96, y: 110, text: "ManicBot Project Structure Board", size: 40, color: "#fff", weight: 800 });
  label({
    x: 96,
    y: 146,
    text: "Большая карта репозитория: пакеты, runtime, Worker internals, данные, ключевые потоки и архитектурные расхождения.",
    size: 18,
    color: "#dbeafe",
    weight: 600,
  });
  pill({ x: 4920, y: 92, text: "Miro-ready SVG", fill: "#ea580c", color: "#fff" });

  const statCards = [
    { title: "Worker backend", lines: [`${worker.files} files`, `${worker.lines} LOC`], color: "#0f766e" },
    { title: "Backend tests", lines: [`${metrics.tests.count} test files`, `${tests.lines} LOC`], color: "#15803d" },
    { title: "Admin mini-app", lines: [`${admin.files} files`, `${admin.lines} LOC`], color: "#2563eb" },
    { title: "Analysis app", lines: [`${analysis.files} files`, `${analysis.lines} LOC`], color: "#7c3aed" },
    { title: "Landing app", lines: [`${landing.files} files`, `${landing.lines} LOC`], color: "#c2410c" },
    { title: "Storage model", lines: ["Cloudflare D1", "+ Cloudflare KV sidecars"], color: "#ca8a04" },
    { title: "Languages", lines: ["RU, UA, EN, PL", "Telegram + landing UI"], color: "#be123c" },
  ];

  statCards.forEach((item, index) => {
    const x = 60 + index * 780;
    card({
      x,
      y: 214,
      w: 740,
      h: 108,
      title: item.title,
      lines: item.lines,
      accent: item.color,
      fill: "#fffdfa",
    });
  });

  panel({
    x: 60,
    y: 360,
    w: 1680,
    h: 900,
    title: "1. Repository Landscape",
    subtitle: "Что реально входит в монорепо и как это связано.",
    accent: "#b45309",
  });
  panel({
    x: 1780,
    y: 360,
    w: 1760,
    h: 1400,
    title: "2. Runtime Architecture",
    subtitle: "Пользовательские поверхности, внешние сервисы и центральные execution paths.",
    accent: "#0f766e",
  });
  panel({
    x: 3580,
    y: 360,
    w: 1960,
    h: 1760,
    title: "3. Worker Internals",
    subtitle: "Главные модули внутри manicbot/src и их точки сцепления.",
    accent: "#2563eb",
  });
  panel({
    x: 60,
    y: 1300,
    w: 1680,
    h: 1960,
    title: "4. Data Model",
    subtitle: "D1 tables, KV sidecars и зоны ответственности источников данных.",
    accent: "#15803d",
  });
  panel({
    x: 1780,
    y: 1800,
    w: 1760,
    h: 1460,
    title: "5. Critical Flows",
    subtitle: "Последовательности, которые объясняют систему лучше всего.",
    accent: "#7c3aed",
  });
  panel({
    x: 3580,
    y: 2160,
    w: 1960,
    h: 1100,
    title: "6. Drift & Risks",
    subtitle: "Где документация, схемы и поверхности расходятся между собой.",
    accent: "#be123c",
  });

  // Repository landscape
  card({
    x: 120,
    y: 470,
    w: 440,
    h: 160,
    title: "Root docs / artifacts",
    lines: [
      "README.md",
      "MULTI_BOT_SETUP.md",
      "ManicBot_Stack_Analysis.html",
      "architecture_analysis.md (external draft)",
    ],
    accent: "#a16207",
    fill: "#fff9ed",
  });
  card({
    x: 680,
    y: 470,
    w: 500,
    h: 220,
    title: "manicbot",
    lines: [
      "Cloudflare Worker production runtime",
      "Telegram webhook + Stripe + cron",
      "HTML admin endpoints + setup + export",
      "D1-first business model with KV sidecars",
    ],
    accent: "#0f766e",
    badge: `${worker.lines} LOC`,
  });
  card({
    x: 1240,
    y: 470,
    w: 420,
    h: 190,
    title: "admin-app",
    lines: [
      "Next.js App Router",
      "Telegram Mini App",
      "tRPC + Drizzle + D1",
    ],
    accent: "#2563eb",
    badge: `${admin.lines} LOC`,
  });
  card({
    x: 680,
    y: 760,
    w: 500,
    h: 170,
    title: "manicbot-landing",
    lines: [
      "Marketing site on Cloudflare Pages",
      "Worker proxies root domain to LANDING_URL",
      "No business logic inside",
    ],
    accent: "#c2410c",
    badge: `${landing.lines} LOC`,
  });
  card({
    x: 1240,
    y: 760,
    w: 420,
    h: 210,
    title: "manicbot-analysis",
    lines: [
      "Separate Vite presentation/audit UI",
      "Looks like explainer/report app",
      "Not part of production request path",
    ],
    accent: "#7c3aed",
    badge: `${analysis.lines} LOC`,
  });
  sticky({
    x: 120,
    y: 740,
    w: 440,
    h: 210,
    title: "What matters",
    lines: [
      "Repo = not one app, but a stack.",
      "Worker is source of runtime truth.",
      "Next.js app is platform console,",
      "not general tenant cabinet yet.",
      "Landing and analysis are sidecars.",
    ],
  });
  arrow({ points: [[560, 550], [660, 550]], color: "#a16207", label: "documents describe / support" });
  arrow({ points: [[1180, 560], [1240, 560]], color: "#2563eb", label: "same D1" });
  arrow({ points: [[930, 690], [930, 760]], color: "#c2410c", label: "proxies home" });
  arrow({ points: [[1450, 690], [1450, 760]], color: "#7c3aed", label: "separate explainer" });

  // Runtime architecture
  card({ x: 1820, y: 500, w: 250, h: 120, title: "Client", lines: ["Telegram private chat"], accent: "#ea580c", fill: "#fff7ed" });
  card({ x: 1820, y: 650, w: 250, h: 120, title: "Master", lines: ["Telegram + callbacks"], accent: "#ea580c", fill: "#fff7ed" });
  card({ x: 1820, y: 800, w: 250, h: 120, title: "Tenant owner", lines: ["Telegram + some admin flows"], accent: "#ea580c", fill: "#fff7ed" });
  card({ x: 1820, y: 950, w: 250, h: 120, title: "Platform admin", lines: ["Bot + mini-app God Mode"], accent: "#ea580c", fill: "#fff7ed" });

  card({ x: 2190, y: 560, w: 280, h: 150, title: "Telegram Bot API", lines: ["Webhook source", "Command / callback transport"], accent: "#475569", fill: "#f8fafc" });
  card({
    x: 2510,
    y: 510,
    w: 620,
    h: 240,
    title: "Cloudflare Worker (manicbot/src/worker.js)",
    lines: [
      "fetch() + scheduled()",
      "webhook routing + tenant context build",
      "stripe webhook + html admin + setup",
      "google oauth callbacks + landing proxy",
    ],
    accent: "#0f766e",
    fill: "#ecfeff",
  });
  card({
    x: 2510,
    y: 860,
    w: 620,
    h: 190,
    title: "Next.js God Mode (manicbot/admin-app)",
    lines: [
      "Telegram Mini App shell",
      "App Router pages + tRPC route",
      "creator/platform-focused access model",
    ],
    accent: "#2563eb",
    fill: "#eff6ff",
  });
  card({ x: 3210, y: 470, w: 280, h: 120, title: "Workers AI", lines: ["Natural-language assistant"], accent: "#475569", fill: "#f8fafc" });
  card({ x: 3210, y: 630, w: 280, h: 120, title: "Stripe", lines: ["Checkout / Portal / webhooks"], accent: "#475569", fill: "#f8fafc" });
  card({ x: 3210, y: 790, w: 280, h: 120, title: "Google Calendar", lines: ["OAuth + sync + push watch"], accent: "#475569", fill: "#f8fafc" });
  card({ x: 3210, y: 950, w: 280, h: 120, title: "Landing app", lines: ["Cloudflare Pages origin"], accent: "#475569", fill: "#f8fafc" });
  card({
    x: 2240,
    y: 1140,
    w: 520,
    h: 150,
    title: "Cloudflare D1",
    lines: [
      "tenants, bots, appointments, users, services",
      "roles, support agents, tickets, stripe customers",
    ],
    accent: "#15803d",
    fill: "#f0fdf4",
  });
  card({
    x: 2820,
    y: 1140,
    w: 520,
    h: 170,
    title: "Cloudflare KV",
    lines: [
      "bottoken:*  /  gcal:oauth:*",
      "stripe:evt:* / tktlock:*",
      "legacy tenant-prefixed state fallback",
    ],
    accent: "#ca8a04",
    fill: "#fffbeb",
  });
  sticky({
    x: 2240,
    y: 1380,
    w: 1100,
    h: 220,
    title: "Interpretation",
    lines: [
      "The Worker is the system hub.",
      "Admin-app is parallel to it, not behind it.",
      "Runtime truth is hybrid: D1 for entities, KV for secrets/session/locks.",
      "Telegram remains the main UX surface even when web console exists.",
    ],
  });

  arrow({ points: [[2070, 560], [2190, 560]], color: "#64748b", label: "messages" });
  arrow({ points: [[2070, 710], [2190, 620], [2190, 620]], color: "#64748b" });
  arrow({ points: [[2070, 860], [2190, 650]], color: "#64748b" });
  arrow({ points: [[2070, 1010], [2190, 680]], color: "#64748b" });
  arrow({ points: [[2470, 615], [2510, 615]], color: "#0f766e", label: "webhook" });
  arrow({ points: [[3130, 590], [3210, 530]], color: "#0f766e", label: "AI calls" });
  arrow({ points: [[3130, 640], [3210, 690]], color: "#0f766e", label: "billing" });
  arrow({ points: [[3130, 710], [3210, 850]], color: "#0f766e", label: "calendar" });
  arrow({ points: [[3130, 590], [3210, 1010]], color: "#0f766e", dash: "8 8", label: "landing proxy" });
  arrow({ points: [[2820, 970], [2820, 1140]], color: "#2563eb", label: "tRPC / D1" });
  arrow({ points: [[2820, 750], [2500, 1140]], color: "#15803d", label: "SQL" });
  arrow({ points: [[2900, 750], [3080, 1140]], color: "#ca8a04", label: "KV" });

  // Worker internals
  label({ x: 3630, y: 500, text: "Gateway / Context", size: 18, color: "#1d4ed8" });
  card({ x: 3620, y: 530, w: 360, h: 150, title: "worker.js", lines: ["fetch + scheduled", "all public routes", "orchestrates tenant context"], accent: "#2563eb", badge: "613 LOC" });
  card({ x: 4010, y: 530, w: 320, h: 130, title: "tenant/resolver.js", lines: ["resolve botId -> tenant", "build tenant / legacy ctx"], accent: "#2563eb" });
  card({ x: 4360, y: 530, w: 320, h: 130, title: "tenant/storage.js", lines: ["tenants + bots registry", "bot token stays in KV"], accent: "#2563eb" });
  card({ x: 4710, y: 530, w: 320, h: 130, title: "utils/db.js", lines: ["thin D1 wrappers", "dbGet / dbAll / dbRun"], accent: "#2563eb" });

  label({ x: 3630, y: 740, text: "Telegram orchestration", size: 18, color: "#0f766e" });
  card({ x: 3620, y: 770, w: 450, h: 180, title: "handlers/message.js", lines: ["commands, role routing, AI chat, support", "state-machine transitions, booking entry", "one of the heaviest orchestration files"], accent: "#0f766e", fill: "#ecfeff", badge: "1222 LOC" });
  card({ x: 4100, y: 770, w: 450, h: 180, title: "handlers/callback.js", lines: ["inline buttons, confirm/reject/counter", "billing menu, calendar menu, admin actions", "main callback orchestrator"], accent: "#0f766e", fill: "#ecfeff", badge: "1337 LOC" });
  card({ x: 4580, y: 770, w: 450, h: 160, title: "handlers/cron.js", lines: ["billing expiry", "reminders", "calendar resync", "cleanup"], accent: "#0f766e", fill: "#ecfeff" });

  label({ x: 3630, y: 1020, text: "Domain services", size: 18, color: "#15803d" });
  card({ x: 3620, y: 1050, w: 300, h: 150, title: "services/appointments.js", lines: ["create/cancel/list slots", "D1 first, KV fallback"], accent: "#15803d", badge: "414 LOC" });
  card({ x: 3950, y: 1050, w: 300, h: 150, title: "services/users.js", lines: ["roles, masters, users", "lookup by username / phone"], accent: "#15803d", badge: "375 LOC" });
  card({ x: 4280, y: 1050, w: 300, h: 150, title: "services/services.js", lines: ["catalog + tenant config", "about / photos / instagram"], accent: "#15803d" });
  card({ x: 4610, y: 1050, w: 300, h: 150, title: "roles/roles.js", lines: ["platform roles", "tenant roles", "support agents"], accent: "#15803d" });
  card({ x: 4940, y: 1050, w: 300, h: 150, title: "support/tickets.js", lines: ["platform support tickets", "D1 + KV race lock"], accent: "#15803d" });

  label({ x: 3630, y: 1270, text: "Cross-cutting subsystems", size: 18, color: "#7c3aed" });
  card({ x: 3620, y: 1300, w: 420, h: 170, title: "ai.js", lines: ["prompting + action tags", "navigates UI through LLM intents", "invokes Workers AI"], accent: "#7c3aed", fill: "#f5f3ff", badge: "434 LOC" });
  card({ x: 4070, y: 1300, w: 480, h: 210, title: "services/google-calendar-oauth.js", lines: ["OAuth session flow", "watch renewal", "busy block sync", "runtime schema patching"], accent: "#7c3aed", fill: "#f5f3ff", badge: "1013 LOC" });
  card({ x: 4580, y: 1300, w: 300, h: 170, title: "billing/*", lines: ["stripe.js", "webhooks.js", "lifecycle.js", "features.js"], accent: "#7c3aed", fill: "#f5f3ff" });
  card({ x: 4910, y: 1300, w: 300, h: 170, title: "admin/*", lines: ["provisioning.js", "seed.js"], accent: "#7c3aed", fill: "#f5f3ff" });

  label({ x: 3630, y: 1560, text: "UI / helpers / shared text", size: 18, color: "#b45309" });
  card({ x: 3620, y: 1590, w: 320, h: 150, title: "ui/screens.js", lines: ["client screens", "home, catalog, contacts, my appointments"], accent: "#b45309", fill: "#fff7ed" });
  card({ x: 3970, y: 1590, w: 320, h: 150, title: "ui/admin.js", lines: ["tenant admin + master panels", "lists, settings, service editors"], accent: "#b45309", fill: "#fff7ed", badge: "421 LOC" });
  card({ x: 4320, y: 1590, w: 320, h: 150, title: "ui/sysadmin.js", lines: ["platform bot menus", "tenants / bots / support"], accent: "#b45309", fill: "#fff7ed" });
  card({ x: 4670, y: 1590, w: 320, h: 150, title: "ui/booking.js", lines: ["booking flow steps", "master pick / confirm"], accent: "#b45309", fill: "#fff7ed" });
  card({ x: 5020, y: 1590, w: 250, h: 150, title: "notifications.js", lines: ["notify staff/client", "ICS + calendar sync bridge"], accent: "#b45309", fill: "#fff7ed" });

  sticky({
    x: 3620,
    y: 1810,
    w: 1600,
    h: 230,
    title: "Reading hint",
    lines: [
      "Start with worker.js, then resolver/storage, then message.js and callback.js.",
      "After that, open appointments.js, users.js and google-calendar-oauth.js.",
      "UI files are not decorative: they are part of the actual control flow.",
      "The largest coordination pressure is in handlers/message.js + handlers/callback.js.",
    ],
    fill: "#dbeafe",
    accent: "#2563eb",
  });

  arrow({ points: [[3980, 605], [4010, 605]], color: "#2563eb" });
  arrow({ points: [[4330, 605], [4360, 605]], color: "#2563eb" });
  arrow({ points: [[3790, 680], [3790, 770]], color: "#0f766e" });
  arrow({ points: [[4260, 680], [4320, 770]], color: "#0f766e" });
  arrow({ points: [[4680, 680], [4810, 770]], color: "#0f766e" });
  arrow({ points: [[3840, 950], [3770, 1050]], color: "#15803d" });
  arrow({ points: [[4200, 950], [4100, 1050]], color: "#15803d" });
  arrow({ points: [[4510, 950], [4440, 1300]], color: "#7c3aed" });
  arrow({ points: [[4460, 950], [4790, 1590]], color: "#b45309", dash: "8 8" });
  arrow({ points: [[3900, 1470], [3810, 1590]], color: "#b45309" });
  arrow({ points: [[4280, 1470], [4130, 1590]], color: "#b45309" });
  arrow({ points: [[4420, 1200], [4420, 1300]], color: "#7c3aed" });

  // Data model
  label({ x: 110, y: 1435, text: "D1: global / platform tables", size: 18, color: "#15803d" });
  card({ x: 110, y: 1465, w: 470, h: 200, title: "Platform tables", lines: ["tenants", "bots", "platform_roles", "support_agents", "tenant_support_agents", "stripe_customers"], accent: "#15803d", fill: "#f0fdf4" });
  card({ x: 610, y: 1465, w: 470, h: 200, title: "Support tables", lines: ["platform_tickets", "platform_ticket_messages", "local_tickets", "human_requests"], accent: "#15803d", fill: "#f0fdf4" });
  card({ x: 1110, y: 1465, w: 570, h: 200, title: "Tenant data tables", lines: ["appointments", "users", "masters", "tenant_roles", "services", "tenant_config", "blocked_users"], accent: "#15803d", fill: "#f0fdf4" });

  label({ x: 110, y: 1725, text: "Runtime-added Google tables", size: 18, color: "#15803d" });
  card({ x: 110, y: 1755, w: 760, h: 170, title: "google-calendar-oauth.js mutates schema at runtime", lines: ["google_integrations", "google_busy_blocks", "ALTER appointments ADD COLUMN google_integration_id"], accent: "#15803d", fill: "#dcfce7" });

  label({ x: 110, y: 2000, text: "KV sidecars", size: 18, color: "#ca8a04" });
  card({ x: 110, y: 2030, w: 500, h: 210, title: "Global KV keys", lines: ["bottoken:{botId}", "gcal:oauth:{sessionId}", "stripe:evt:{eventId}", "tktlock:{ticketId}"], accent: "#ca8a04", fill: "#fffbeb" });
  card({ x: 640, y: 2030, w: 500, h: 210, title: "Tenant-prefixed / legacy KV", lines: ["state:*  chat:*  ap:*  ua:*", "all:*  d:*  master:*", "used in fallback mode and legacy paths"], accent: "#ca8a04", fill: "#fffbeb" });
  card({ x: 1170, y: 2030, w: 510, h: 210, title: "Why KV still matters", lines: ["token secrecy", "OAuth handoff", "idempotency", "race locks", "legacy context compatibility"], accent: "#ca8a04", fill: "#fffbeb" });

  sticky({
    x: 110,
    y: 2290,
    w: 1570,
    h: 260,
    title: "Source-of-truth summary",
    lines: [
      "Business entities are mostly D1-first now.",
      "Context secrets and operational sidecars still live in KV.",
      "Some services keep explicit fallback branches for no-DB / legacy paths.",
      "This means the project is not 'fully migrated off KV'; it is hybrid by design today.",
    ],
    fill: "#ecfccb",
    accent: "#65a30d",
  });

  label({ x: 110, y: 2620, text: "Folder breakdown (worker package)", size: 18, color: "#15803d" });
  const breakdownColumns = [
    worker.topLevelFolders.slice(0, 6),
    worker.topLevelFolders.slice(6, 12),
  ];
  breakdownColumns.forEach((group, columnIndex) => {
    const baseX = 110 + columnIndex * 520;
    group.forEach((item, index) => {
      card({
        x: baseX,
        y: 2660 + index * 84,
        w: 480,
        h: 64,
        title: item.name,
        lines: [`${item.count} source files`],
        accent: columnIndex === 0 ? "#15803d" : "#16a34a",
        fill: "#f7fee7",
      });
    });
  });
  card({
    x: 1170,
    y: 2660,
    w: 510,
    h: 380,
    title: "Schema / model drift notes",
    lines: [
      "SQL schema and admin-app Drizzle schema differ",
      "in service ordering, ticket tables, masters fields,",
      "support agent type values and some status enums.",
      "",
      "Treat D1 SQL used by worker as the safer runtime truth",
      "until schema contracts are unified.",
    ],
    accent: "#be123c",
    fill: "#fff1f2",
  });

  // Critical flows
  const flowAccent = "#7c3aed";
  card({ x: 1840, y: 1900, w: 1640, h: 240, title: "Flow A. Booking from Telegram", lines: [], accent: flowAccent, fill: "#faf5ff" });
  card({ x: 1860, y: 1960, w: 180, h: 90, title: "1. Client", lines: ["writes in chat"], accent: "#ea580c", fill: "#fff7ed" });
  card({ x: 2080, y: 1960, w: 180, h: 90, title: "2. Telegram", lines: ["webhook event"], accent: "#475569", fill: "#f8fafc" });
  card({ x: 2300, y: 1960, w: 220, h: 90, title: "3. worker.js", lines: ["tenant ctx"], accent: "#0f766e", fill: "#ecfeff" });
  card({ x: 2560, y: 1960, w: 220, h: 90, title: "4. message/callback", lines: ["flow routing"], accent: "#0f766e", fill: "#ecfeff" });
  card({ x: 2820, y: 1960, w: 220, h: 90, title: "5. appointments", lines: ["save / read"], accent: "#15803d", fill: "#f0fdf4" });
  card({ x: 3080, y: 1960, w: 180, h: 90, title: "6. D1", lines: ["state"], accent: "#15803d", fill: "#f0fdf4" });
  card({ x: 3300, y: 1960, w: 160, h: 90, title: "7. notify", lines: ["master/admin"], accent: "#b45309", fill: "#fff7ed" });
  arrow({ points: [[2040, 2005], [2080, 2005]], color: "#7c3aed" });
  arrow({ points: [[2260, 2005], [2300, 2005]], color: "#7c3aed" });
  arrow({ points: [[2520, 2005], [2560, 2005]], color: "#7c3aed" });
  arrow({ points: [[2780, 2005], [2820, 2005]], color: "#7c3aed" });
  arrow({ points: [[3040, 2005], [3080, 2005]], color: "#7c3aed" });
  arrow({ points: [[3260, 2005], [3300, 2005]], color: "#7c3aed" });
  label({ x: 1880, y: 2100, text: "Confirmation path can continue to ICS generation and Google Calendar sync.", size: 15, color: "#6b21a8" });

  card({ x: 1840, y: 2180, w: 1640, h: 250, title: "Flow B. Platform mini-app", lines: [], accent: flowAccent, fill: "#faf5ff" });
  card({ x: 1860, y: 2245, w: 210, h: 90, title: "1. Telegram Mini App", lines: ["initData"], accent: "#ea580c", fill: "#fff7ed" });
  card({ x: 2110, y: 2245, w: 210, h: 90, title: "2. TelegramGate", lines: ["creator gate"], accent: "#2563eb", fill: "#eff6ff" });
  card({ x: 2360, y: 2245, w: 210, h: 90, title: "3. tRPC route", lines: ["fetch adapter"], accent: "#2563eb", fill: "#eff6ff" });
  card({ x: 2610, y: 2245, w: 240, h: 90, title: "4. createTRPCContext", lines: ["validate initData"], accent: "#2563eb", fill: "#eff6ff" });
  card({ x: 2890, y: 2245, w: 210, h: 90, title: "5. adminProcedure", lines: ["role gate"], accent: "#2563eb", fill: "#eff6ff" });
  card({ x: 3140, y: 2245, w: 210, h: 90, title: "6. Drizzle / D1", lines: ["query + mutate"], accent: "#15803d", fill: "#f0fdf4" });
  arrow({ points: [[2070, 2290], [2110, 2290]], color: "#7c3aed" });
  arrow({ points: [[2320, 2290], [2360, 2290]], color: "#7c3aed" });
  arrow({ points: [[2570, 2290], [2610, 2290]], color: "#7c3aed" });
  arrow({ points: [[2850, 2290], [2890, 2290]], color: "#7c3aed" });
  arrow({ points: [[3100, 2290], [3140, 2290]], color: "#7c3aed" });
  label({ x: 1880, y: 2388, text: "Important: this path is platform-oriented today and not a tenant self-service dashboard yet.", size: 15, color: "#6b21a8" });

  card({ x: 1840, y: 2470, w: 1640, h: 250, title: "Flow C. Billing lifecycle", lines: [], accent: flowAccent, fill: "#faf5ff" });
  card({ x: 1860, y: 2535, w: 220, h: 90, title: "1. Billing UI", lines: ["checkout / portal"], accent: "#ea580c", fill: "#fff7ed" });
  card({ x: 2120, y: 2535, w: 210, h: 90, title: "2. Stripe", lines: ["session / webhook"], accent: "#475569", fill: "#f8fafc" });
  card({ x: 2370, y: 2535, w: 210, h: 90, title: "3. billing/webhooks", lines: ["verify + dedupe"], accent: "#7c3aed", fill: "#f5f3ff" });
  card({ x: 2620, y: 2535, w: 220, h: 90, title: "4. tenants table", lines: ["billing status"], accent: "#15803d", fill: "#f0fdf4" });
  card({ x: 2880, y: 2535, w: 240, h: 90, title: "5. handlers/features", lines: ["feature gating"], accent: "#0f766e", fill: "#ecfeff" });
  card({ x: 3160, y: 2535, w: 300, h: 90, title: "6. cron lifecycle", lines: ["trial/grace expiry transitions"], accent: "#0f766e", fill: "#ecfeff" });
  arrow({ points: [[2080, 2580], [2120, 2580]], color: "#7c3aed" });
  arrow({ points: [[2330, 2580], [2370, 2580]], color: "#7c3aed" });
  arrow({ points: [[2580, 2580], [2620, 2580]], color: "#7c3aed" });
  arrow({ points: [[2840, 2580], [2880, 2580]], color: "#7c3aed" });
  arrow({ points: [[3120, 2580], [3160, 2580]], color: "#7c3aed" });

  card({ x: 1840, y: 2760, w: 1640, h: 390, title: "Flow D. Multi-tenant cron execution", lines: [], accent: flowAccent, fill: "#faf5ff" });
  card({ x: 1860, y: 2835, w: 220, h: 90, title: "1. scheduled()", lines: ["Cloudflare cron"], accent: "#0f766e", fill: "#ecfeff" });
  card({ x: 2120, y: 2835, w: 220, h: 90, title: "2. listTenantIds", lines: ["read D1 registry"], accent: "#2563eb", fill: "#eff6ff" });
  card({ x: 2380, y: 2835, w: 240, h: 90, title: "3. buildTenantCtx", lines: ["first bot per tenant"], accent: "#2563eb", fill: "#eff6ff" });
  card({ x: 2660, y: 2835, w: 220, h: 90, title: "4. handleCron", lines: ["tenant loop"], accent: "#0f766e", fill: "#ecfeff" });
  card({ x: 2920, y: 2805, w: 240, h: 90, title: "5a. reminders", lines: ["24h / 2h"], accent: "#15803d", fill: "#f0fdf4" });
  card({ x: 2920, y: 2925, w: 240, h: 90, title: "5b. gcal resync", lines: ["retry unsynced"], accent: "#15803d", fill: "#f0fdf4" });
  card({ x: 3200, y: 2835, w: 240, h: 90, title: "5c. billing expiry", lines: ["trial / grace"], accent: "#15803d", fill: "#f0fdf4" });
  card({ x: 3200, y: 2955, w: 240, h: 90, title: "5d. cleanup", lines: ["old cancelled / past"], accent: "#15803d", fill: "#f0fdf4" });
  arrow({ points: [[2080, 2880], [2120, 2880]], color: "#7c3aed" });
  arrow({ points: [[2340, 2880], [2380, 2880]], color: "#7c3aed" });
  arrow({ points: [[2620, 2880], [2660, 2880]], color: "#7c3aed" });
  arrow({ points: [[2880, 2880], [2920, 2850]], color: "#7c3aed" });
  arrow({ points: [[2880, 2880], [2920, 2970]], color: "#7c3aed" });
  arrow({ points: [[2880, 2880], [3200, 2880]], color: "#7c3aed" });
  arrow({ points: [[2880, 2880], [3200, 3000]], color: "#7c3aed" });

  // Drift panel
  sticky({
    x: 3620,
    y: 2275,
    w: 430,
    h: 220,
    title: "Docs drift",
    lines: [
      "README still presents KV-first model.",
      "MULTI_BOT_SETUP uses outdated setup ideas.",
      "admin-app README is still generic template.",
    ],
    fill: "#fff1f2",
    accent: "#be123c",
  });
  sticky({
    x: 4080,
    y: 2275,
    w: 430,
    h: 260,
    title: "Schema drift",
    lines: [
      "worker SQL != admin Drizzle schema",
      "for services ordering, tickets, masters,",
      "support agents and status/value naming.",
    ],
    fill: "#fff1f2",
    accent: "#be123c",
  });
  sticky({
    x: 4540,
    y: 2275,
    w: 430,
    h: 250,
    title: "Role drift",
    lines: [
      "Worker speaks system_admin / tenant_owner.",
      "Mini-app still uses admin / owner in places.",
      "Auth semantics are not fully unified.",
    ],
    fill: "#fff1f2",
    accent: "#be123c",
  });
  sticky({
    x: 5000,
    y: 2275,
    w: 500,
    h: 250,
    title: "Surface drift",
    lines: [
      "There are two admin surfaces:",
      "Worker HTML admin and Next.js God Mode.",
      "They are parallel, not one coherent panel.",
    ],
    fill: "#fff1f2",
    accent: "#be123c",
  });
  sticky({
    x: 3620,
    y: 2555,
    w: 430,
    h: 260,
    title: "Platform-only mini-app",
    lines: [
      "TelegramGate hardcodes creator access.",
      "So app is not open tenant dashboard yet,",
      "even if some docs imply that direction.",
    ],
    fill: "#fff1f2",
    accent: "#be123c",
  });
  sticky({
    x: 4080,
    y: 2555,
    w: 430,
    h: 260,
    title: "Hybrid persistence",
    lines: [
      "D1 is dominant but KV is still critical.",
      "Treat migration as partial, not finished.",
      "Some code paths still branch on no-DB mode.",
    ],
    fill: "#fff1f2",
    accent: "#be123c",
  });
  sticky({
    x: 4540,
    y: 2555,
    w: 430,
    h: 260,
    title: "Concentrated orchestration",
    lines: [
      "message.js and callback.js carry large",
      "amounts of feature routing and control flow.",
      "This is the main complexity hotspot.",
    ],
    fill: "#fff1f2",
    accent: "#be123c",
  });
  sticky({
    x: 5000,
    y: 2555,
    w: 500,
    h: 290,
    title: "Unification candidates",
    lines: [
      "1. One role vocabulary",
      "2. One billing status vocabulary",
      "3. One schema contract between worker/admin",
      "4. One explicit admin surface strategy",
    ],
    fill: "#fff1f2",
    accent: "#be123c",
  });
  card({
    x: 3620,
    y: 2875,
    w: 1880,
    h: 280,
    title: "Bottom line",
    lines: [
      "The repo already contains a substantial platform, but its mental model is split across Worker runtime, HTML admin, God Mode mini-app, D1-first data and KV sidecars.",
      "The board above is meant to give you one zoomable picture of that split so you can reason about change safely.",
      "If you continue architecture cleanup, the highest leverage move is to choose a single source of truth for schema + role vocabulary and document the intended admin surface explicitly.",
    ],
    accent: "#102542",
    fill: "#eff6ff",
  });

  add(`</svg>`);
  return parts.join("\n");
}

function writeOutputs(metrics) {
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, "project-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "PROJECT_STRUCTURE_ANALYSIS.md"), `${buildMarkdown(metrics)}\n`);
  fs.writeFileSync(path.join(outDir, "PROJECT_STRUCTURE_MAP.mmd"), `${buildMermaid()}\n`);
  fs.writeFileSync(path.join(outDir, "PROJECT_STRUCTURE_BOARD.svg"), buildSvg(metrics));
}

const metrics = gatherMetrics();
writeOutputs(metrics);
console.log(`Generated project-analysis artifacts in ${outDir}`);
