#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent
OUT_MD = ROOT / "MANICBOT_FULL_AUDIT_2026-03-24.md"
OUT_PDF = ROOT / "MANICBOT_FULL_AUDIT_2026-03-24.pdf"
METRICS_PATH = ROOT / "project-analysis" / "project-metrics.json"

PAGE_W, PAGE_H = landscape(A4)


def esc(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def register_fonts() -> None:
    candidates = [
        ("AuditSans", "/System/Library/Fonts/Supplemental/Arial.ttf"),
        ("AuditSansBold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ]
    for name, path in candidates:
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, path))


def load_metrics() -> dict:
    if not METRICS_PATH.exists():
        raise FileNotFoundError(f"Metrics file not found: {METRICS_PATH}")
    return json.loads(METRICS_PATH.read_text(encoding="utf-8"))


def pkg(metrics: dict, key: str) -> dict:
    for item in metrics["packages"]:
        if item["key"] == key:
            return item
    raise KeyError(key)


def build_tree(root: Path, ignore: set[str] | None = None) -> str:
    ignore = ignore or {"node_modules", ".next", "dist", ".vite", ".git", "coverage"}
    lines: list[str] = []

    def walk(directory: Path, prefix: str = "") -> None:
        entries = [e for e in sorted(directory.iterdir(), key=lambda p: p.name.lower()) if e.name not in ignore]
        for index, entry in enumerate(entries):
            last = index == len(entries) - 1
            marker = "└── " if last else "├── "
            lines.append(f"{prefix}{marker}{entry.name}")
            if entry.is_dir():
                walk(entry, prefix + ("    " if last else "│   "))

    walk(root)
    return "\n".join(lines)


def detect_analysis_ui_usage(src_root: Path) -> dict:
    ui_dir = src_root / "components" / "ui"
    ui_components = sorted([p.stem for p in ui_dir.glob("*.tsx")])
    product_files: list[Path] = []

    for path in src_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if "components/ui" in path.as_posix():
            continue
        product_files.append(path)

    used: set[str] = set()
    for file_path in product_files:
        content = file_path.read_text(encoding="utf-8")
        for name in ui_components:
            patterns = [
                f"@/components/ui/{name}",
                f"./ui/{name}",
                f"../ui/{name}",
                f"../components/ui/{name}",
            ]
            if any(pattern in content for pattern in patterns):
                used.add(name)

    unused = [name for name in ui_components if name not in used]
    return {
        "total": len(ui_components),
        "used": sorted(used),
        "unused": unused,
    }


def build_content(metrics: dict) -> dict:
    worker = pkg(metrics, "worker")
    tests = pkg(metrics, "tests")
    admin = pkg(metrics, "admin")
    analysis = pkg(metrics, "analysis")
    landing = pkg(metrics, "landing")

    ui_usage = detect_analysis_ui_usage(ROOT / "manicbot-analysis" / "src")

    packages = [
        {
            "package": "manicbot/src",
            "purpose": "Главное runtime-ядро: Cloudflare Worker, Telegram webhook, Stripe webhook, cron, Google OAuth, HTML admin.",
            "files": worker["files"],
            "loc": worker["lines"],
        },
        {
            "package": "manicbot/test",
            "purpose": "Сильный backend test pack для Worker-логики, роутинга, ролей, биллинга и календаря.",
            "files": tests["files"],
            "loc": tests["lines"],
        },
        {
            "package": "manicbot/admin-app/src",
            "purpose": "Next.js + tRPC + Drizzle консоль управления, по факту ближе к platform-level God Mode.",
            "files": admin["files"],
            "loc": admin["lines"],
        },
        {
            "package": "manicbot-analysis/src",
            "purpose": "Новый презентационный/маркетинговый фронтенд с SEO-блогом и heavy UI-kit базой.",
            "files": analysis["files"],
            "loc": analysis["lines"],
        },
        {
            "package": "manicbot-landing/src",
            "purpose": "Старый лендинг на React/Vite, который все еще поддерживается как rollback-вариант.",
            "files": landing["files"],
            "loc": landing["lines"],
        },
        {
            "package": "manicbot-blog",
            "purpose": "Генератор статического SEO-блога, который встроен в деплой нового лендинга.",
            "files": 1,
            "loc": 260,
        },
    ]

    methodology = [
        "Пройден весь основной source-слой репозитория: Worker backend, admin-app, два лендинга, blog generator, схемы D1 и ключевые docs.",
        "Прочитаны реальные entrypoints и самые крупные hotspot-модули: worker.js, handlers/message.js, handlers/callback.js, services/google-calendar-oauth.js, appointments.js, users.js, roles.js, tenant storage/resolver.",
        "Сверены друг с другом три слоя правды: D1 schema.sql, Drizzle schema.ts в admin-app и фактические SQL/ORM-вызовы в runtime-коде.",
        "Проверено состояние исполнения: `manicbot` tests проходят, `manicbot-analysis`, `manicbot-landing` и `admin-app` собираются.",
        "Отдельно оценены продуктовые поверхности, пригодность к продаже, зрелость интерфейсов и долгосрочные точки роста.",
    ]

    executive_summary = [
        "Проект уже выглядит не как один Telegram-бот, а как зачаток vertical SaaS-платформы для beauty-салонов: есть multi-tenant runtime, роли, биллинг, календарь, support, admin surfaces и маркетинговые сайты.",
        "Главная сильная сторона репозитория — реальное рабочее ядро в `manicbot/src`: там уже есть операционная глубина, backend tests и понятная бизнес-модель вокруг записи, напоминаний и управления салоном.",
        "Главная слабая сторона — рост шёл быстрее, чем консолидация архитектуры: в коде одновременно живут legacy/KV-паттерны, D1-first-паттерны, параллельные админки, два лендинга, несколько моделей ролей и расходящиеся схемы.",
        "Перед масштабированием продукта важнее не добавлять ещё одну поверхность, а зафиксировать каноническую модель домена, единый permission layer, единый статусный словарь и единый self-service сценарий для владельца салона.",
    ]

    strengths = [
        "Сильное backend-покрытие: 38 test files и 642 теста в Worker-ядре.",
        "Живой multi-tenant runtime на Cloudflare с webhook, cron, Stripe и Google Calendar.",
        "Понятный коммерческий скелет: Start / Pro / Studio, feature gating, tenant billing.",
        "Многоязычность на уровне продукта и контента: RU / UA / EN / PL.",
        "Уже есть не только бэкенд, но и marketing/storytelling surface, что важно для продаж.",
    ]

    critical_risks = [
        "Schema drift между `manicbot/src/db/schema.sql`, runtime SQL и `manicbot/admin-app/src/server/db/schema.ts`.",
        "Role drift: backend живёт на `system_admin` / `tenant_owner`, admin-app местами живёт на `admin` / `owner`.",
        "Billing status drift: backend использует `grace_period`, admin-app — `grace`.",
        "Timestamp drift: Worker пишет многие значения в миллисекундах, admin-app часто читает и пишет те же поля как секунды.",
        "Worker перегружен инфраструктурными обязанностями и содержит сайд-эффекты уровня provisioning внутри request path.",
        "Продуктово не выбран один владелец админской поверхности: HTML admin в Worker, Telegram God Mode и отдельная Next.js mini-app конкурируют между собой.",
    ]

    health_rows = [
        ["Worker backend tests", "PASS", "642/642 tests, 38 test files. При этом в stderr видны сигналы о хрупкости mock-конфигурации (`KV GET fail`, `undefined/sendMessage`)."],
        ["manicbot-analysis build", "PASS", "Vite build успешен. Bundle: JS 368.73 kB, CSS 108.65 kB."],
        ["manicbot-analysis UI usage", "RISK", f"В `components/ui` лежат {ui_usage['total']} UI-компонента, а напрямую продуктом используются только {len(ui_usage['used'])}: {', '.join(ui_usage['used']) or '—'}."],
        ["manicbot-landing build", "PASS", "Legacy-лендинг собирается. Bundle заметно легче: JS 236.43 kB, CSS 17.98 kB."],
        ["admin-app typecheck", "PASS", "TypeScript-проверка проходит."],
        ["admin-app production build", "PASS", "Next.js build успешен, но есть предупреждение о нескольких lockfile и trade-off edge runtime/static generation."],
        ["Docs consistency", "RISK", "README, MULTI_BOT_SETUP и часть setup-docs уже не отражают фактическую D1-first/Next.js картину."],
    ]

    schema_drifts = [
        ["Services ordering", "Worker SQL: `sort_order`; admin-app Drizzle: `order`.", "Вероятность неконсистентной сортировки и несовместимых миграций."],
        ["Support agent type", "Worker роли используют `technical`, admin-app пишет `technical_support` в `support_agents.type`.", "Часть агентов может не быть видна или не работать одинаково в разных поверхностях."],
        ["Platform tickets", "Worker пишет `client_chat_id`, `claimed_by`, `sender`, `text`; admin-app schema ожидает `chat_id`, `agent_cid`, `sender_cid`, `body`.", "Высокий риск несовместимости при чтении/мутациях тикетов."],
        ["Tenant roles", "SQL schema требует `created_at`, admin-app mutation вставляет role без этого поля.", "Дрейф схемы и потенциальные ошибки записи/миграции."],
        ["Billing statuses", "Backend: `grace_period`; admin-app: `grace`.", "Неверная аналитика, фильтры и ручные мутации статусов."],
        ["Role vocabulary", "Backend опирается на `system_admin` / `tenant_owner`; admin-app местами фильтрует `admin` / `owner`.", "Некорректный доступ и неверная сегментация пользователей."],
        ["Timestamp units", "Worker часто пишет `Date.now()` (ms), admin-app часто пишет/читает `Math.floor(Date.now()/1000)` (sec).", "Ломаются даты триала, createdAt, экспорт и аналитика."],
        ["Google integration column", "Runtime живёт с `google_integration_id`, базовая schema.sql её не содержит и полагается на runtime `ALTER TABLE`.", "Скрытая схема затрудняет clean deploy и перенос окружений."],
    ]

    d1_tables = [
        ["Core tenant data", "tenants, bots, tenant_roles, platform_roles, support_agents, tenant_support_agents", "Реестр тенантов, бот-привязка, роли платформы и tenant-level доступ."],
        ["Customer & scheduling", "users, masters, appointments, services, tenant_config", "Операционные сущности салона: клиенты, мастера, услуги, записи, tenant settings."],
        ["Support & comms", "local_tickets, human_requests, platform_tickets, platform_ticket_messages", "Локальная поддержка салона и платформенная поддержка."],
        ["Billing", "stripe_customers + поля в tenants", "Связка Stripe customer/subscription и статусов подписки."],
        ["Google sync (runtime-created)", "google_integrations, google_busy_blocks", "OAuth-интеграции, busy blocks, watch renewal, двусторонняя синхронизация."],
    ]

    kv_zones = [
        ["Ephemeral state", "`st:*`, `rl:*`, `chat:*`", "State machine, rate limit, AI chat history."],
        ["Bot secrets", "`bottoken:*`", "Bot token-ы остаются в KV, при необходимости в шифрованном виде."],
        ["Global infra", "`stripe:evt:*`, `gcal:oauth:*`, `tktlock:*`", "Idempotency, OAuth sessions, распределённые локи."],
        ["Legacy compatibility", "tenant-prefixed KV fallback (`b:*`, `t:*`)", "Старые пути и graceful degradation для части сценариев."],
    ]

    routes = [
        ["Worker edge routes", "/webhook, /webhook/:botId, /stripe/webhook, /google/*, /admin*, /setup, /remove-webhook, /calendar/:aptId.ics, /", "Единый edge gateway для почти всей системы."],
        ["Cron", "scheduled() -> handleCron()", "Напоминания, billing expiry, calendar resync, cleanup."],
        ["admin-app boundary", "/api/trpc/[trpc]", "Единая backend boundary Next.js mini-app."],
        ["Landing delivery", "Worker proxy -> Pages project", "Новый лендинг и блог живут на Pages, но корень домена завязан на Worker proxy."],
    ]

    module_blocks = [
        ["Worker backend", "handlers/*", "Оркестрация Telegram message/callback/cron потоков."],
        ["Worker backend", "services/*", "Доменные use-case: appointments, users, state, chat, tickets, calendar sync."],
        ["Worker backend", "tenant/* + roles/* + billing/*", "Multi-tenant registry, права, feature gating и Stripe lifecycle."],
        ["Worker backend", "ui/*", "Telegram UI screens, клавиатуры, панели админа и sysadmin."],
        ["admin-app", "app/* + server/api/* + server/db/*", "Platform console, tRPC API, Drizzle ORM schema, Telegram WebApp auth."],
        ["manicbot-analysis", "components/* + i18n/* + blog integration", "Новый лендинг/презентационный слой и SEO-блог."],
        ["manicbot-landing", "App.jsx + i18n + simple components", "Старый маркетинговый лендинг и rollback-вариант Pages."],
    ]

    improvements = [
        {
            "rank": 1,
            "title": "Зафиксировать одну каноническую доменную схему и единый migration contract",
            "why": "Сейчас бизнес-истина размазана между schema.sql, runtime SQL, Drizzle schema и динамическими `ALTER TABLE`.",
            "do": "Свести роли, billing statuses, timestamp units, support types и ticket schema к одному словарю; добавить schema contract tests между Worker и admin-app.",
        },
        {
            "rank": 2,
            "title": "Разрезать большие orchestration-модули по use-case потокам",
            "why": "`handlers/callback.js` и `handlers/message.js` уже слишком велики для безопасного роста.",
            "do": "Вынести booking-flow, support-flow, salon-admin-flow, platform-flow и shared AI-actions в отдельные use-case модули.",
        },
        {
            "rank": 3,
            "title": "Выбрать одну продуктовую админскую поверхность и построить вокруг неё roadmap",
            "why": "Сейчас есть Worker HTML admin, Telegram God Mode и Next.js admin-app, которые пересекаются по функциям и путают product direction.",
            "do": "Оставить admin-app как platform console, а tenant-owner surface сделать отдельно и планомерно вывести HTML admin в режим legacy/maintenance.",
        },
        {
            "rank": 4,
            "title": "Нормализовать модель ролей и разрешений",
            "why": "Разные поверхности говорят о ролях разными словами и проверяют доступ разной логикой.",
            "do": "Ввести один permission matrix, один enum package и обязательную server-side проверку везде.",
        },
        {
            "rank": 5,
            "title": "Нормализовать billing lifecycle и временные единицы",
            "why": "Mix `ms`/`sec` и `grace_period`/`grace` создаёт дорогие скрытые баги в биллинге, экспорте и аналитике.",
            "do": "Принять один стандарт времени, один набор статусов и прогнать backfill/migration для существующих данных.",
        },
        {
            "rank": 6,
            "title": "Довести D1/KV до ясного договора: source of truth vs cache/state",
            "why": "Система уже D1-first, но в коде и документации это ещё не закреплено архитектурно.",
            "do": "Оставить в KV только ephemeral state, locks и secret artifacts; все бизнес-сущности окончательно закрепить за D1.",
        },
        {
            "rank": 7,
            "title": "Вынести demo/provisioning side-effects из request path Worker-а",
            "why": "Автопровижининг demo bots и setWebhook внутри обычного fetch path усложняет runtime и операционную предсказуемость.",
            "do": "Перенести в отдельный admin command, script или one-shot job с явным запуском и логированием.",
        },
        {
            "rank": 8,
            "title": "Добавить cross-surface integration tests и contract tests",
            "why": "Backend tests сильные, но они почти не ловят расхождения между Worker, admin-app и схемой.",
            "do": "Тестировать role matrix, billing states, ticket schema, tenant reads/writes и экспорт сквозным способом.",
        },
        {
            "rank": 9,
            "title": "Сделать observability слоем, а не набором `console.error`",
            "why": "Для SaaS критичны SLA по webhooks, cron, Stripe, Google sync и support ticket routing.",
            "do": "Добавить structured logging, error classes, event names, counters и дашборд по ключевым сбоям.",
        },
        {
            "rank": 10,
            "title": "Упростить и похудеть `manicbot-analysis`",
            "why": "Для маркетинговой поверхности пакет содержит 43 UI-компонента, из которых продукт напрямую использует только 2.",
            "do": "Удалить мёртвый UI-kit, сократить bundle и оставить только реально используемые primitive-компоненты.",
        },
        {
            "rank": 11,
            "title": "Выстроить единый docs/onboarding набор под текущую архитектуру",
            "why": "Часть документации уже описывает проект, которого в коде больше нет.",
            "do": "Сделать актуальные docs для runtime, tenant onboarding, bot provisioning, billing, admin-app и delivery topology.",
        },
        {
            "rank": 12,
            "title": "Ввести централизованный event/audit trail",
            "why": "Для поддержки, биллинга, ролей и ручных действий нужна прозрачная история “кто что сделал и когда”.",
            "do": "Собирать audit events для role grants, billing changes, appointment status transitions, manual cancellations и provisioning.",
        },
        {
            "rank": 13,
            "title": "Усилить security hygiene и operator model",
            "why": "В коде и конфигурации видны hardcoded operator assumptions (`CREATOR_ID`, `ADMIN_CHAT_ID`, локальные secret artifacts).",
            "do": "Убрать жёсткие ID из кода, перевести всё в безопасный operator config и задокументировать процедуру ротации.",
        },
        {
            "rank": 14,
            "title": "Разнести release boundaries по продуктовым пакетам",
            "why": "Сейчас в одном репозитории живут core runtime, platform console, два лендинга и блог; изменения трудно выпускать независимо.",
            "do": "Минимум — формализовать ownership и release notes по пакетам; дальше — workspace conventions и semantic boundaries.",
        },
        {
            "rank": 15,
            "title": "Сделать product analytics first-class слоем",
            "why": "Чтобы продавать и улучшать продукт, нужно видеть не только runtime health, но и conversion, no-show, retention, usage of features.",
            "do": "Собирать воронку от первого сообщения до подтверждённой записи, повторные визиты, активность мастеров и апсейл в платные планы.",
        },
    ]

    long_term = [
        "Нужно выбрать identity продукта: это “AI-бот для записи” или “операционная платформа для салонов красоты”. Второй вариант сильнее и защищённее, но требует консолидации owner-facing UX и аналитики.",
        "Telegram как входной канал хорош для старта и польского рынка, но долгосрочно стоит считать его только первым каналом, а не единственной дверью в продукт.",
        "При масштабировании появятся вопросы GDPR, управления персональными данными, согласий, экспортов, удаления истории и tenant-level auditability.",
        "Если целиться в сети/франшизы, нужно заранее думать о multi-location модели: не просто tenant, а группа салонов, несколько календарей, централизованные роли, единые отчёты.",
        "AI-слой должен стать controllable feature: стоимость, fallback-политика, guardrails, объяснимость действий и ручной override для салона.",
        "Дальняя ценность продукта лежит не в одном бронировании, а в повторных визитах, загрузке мастеров, no-show control и revenue automation.",
    ]

    product_ideas = [
        ["Депозиты и частичная предоплата", "Снижает no-show и сразу повышает monetization power продукта."],
        ["Waitlist + авто-подбор освободившегося слота", "Даёт салону дополнительную выручку без ручной координации."],
        ["Реактивационные кампании по неактивным клиентам", "Поднимает LTV, а не только acquisition."],
        ["Пакеты услуг и membership logic", "Делает продукт ближе к revenue OS, а не только booking tool."],
        ["Автоматический сбор отзывов после визита", "Создаёт growth loop и доверие для новых клиентов."],
        ["Referral engine / “приведи подругу”", "Дешёвый и органичный канал роста для beauty vertical."],
        ["Умный рескейджул и no-show scoring", "Повышает заполняемость и качество расписания."],
        ["Единая inbox-панель по каналам", "Готовит продукт к выходу за пределы одного Telegram-канала."],
        ["Owner analytics dashboard", "Даёт основание платить не за чат-бота, а за управленческую систему."],
        ["Multi-location / franchise mode", "Открывает более дорогой сегмент и повышает ARPU."],
    ]

    website_and_product = [
        "На сайте должен продаваться не “AI”, а измеримый бизнес-результат: меньше неявок, меньше ручной переписки, больше записей вне рабочего времени.",
        "Нужен живой demo flow с одним-двумя реальными сценариями: запись, перенос, напоминание, жалоба/поддержка.",
        "Нужен простой ROI-калькулятор: сколько заявок теряется без автоответа, сколько часов администратора экономится, какой эффект даёт снижение no-show.",
        "Нужна отдельная страница для owner value: роли, контроль мастеров, графики, аналитика, биллинг, интеграции.",
        "Нужен блок доверия: кейсы, скриншоты реального бота, доказательства многоязычности, интеграция с Google Calendar, прозрачные тарифы.",
    ]

    sales_strategy = [
        "ICP на ближайший горизонт: небольшие студии и салоны на 2-5 мастеров в Польше. У них уже есть боль координации, но ещё нет сложного enterprise procurement.",
        "Позиционирование: не “ещё один бот”, а “система записи и загрузки салона в мессенджере, которая работает 24/7 и уменьшает no-show”.",
        "Entry offer: быстрый запуск за 3-7 дней с подключением бота, услуг, мастеров, календаря и готовым demo-script для owner.",
        "Коммерчески имеет смысл добавить setup/onboarding fee поверх recurring plan. Это снижает барьер продаж как “услуги с результатом”, а не только как софт.",
        "Основные каналы первых продаж: founder-led outreach в Telegram/Instagram, локальные beauty-сообщества, партнёры по маркетингу/сайтам для салонов, сарафан через действующих мастеров.",
        "Продажа должна идти от ROI: время ответа, количество записей вне рабочего времени, сокращение пустых окон, количество перенесённых/спасённых визитов.",
        "Апсейл-логика: Start -> Pro через календарь, поддержку и аналитику; Pro -> Studio через white-label, multi-location и advanced automation.",
        "Отдельно нужен partner motion для агентств и консультантов, которые настраивают digital stack салонам. Это дешёвый канал масштабирования без большого sales team.",
    ]

    roadmap = [
        ["0-3 месяца", "Зафиксировать каноническую схему, role/billing словари, timestamp units, убрать критический drift, разрезать большие handlers."],
        ["3-6 месяцев", "Сделать чёткий owner-facing кабинет, нормальную аналитику, audit trail и productized onboarding."],
        ["6-12 месяцев", "Добавить revenue-фичи: депозиты, waitlist, реактивации, отзывы, membership logic, customer segmentation."],
        ["12+ месяцев", "Выход в multi-channel, franchise/multi-location mode, партнёрский канал продаж и более дорогие B2B-пакеты."],
    ]

    conclusion = [
        "ManicBot уже перерос стадию “интересного pet-project бота” и имеет реальную основу для vertical SaaS в beauty. Код показывает, что главная ценность уже есть: multi-tenant runtime, биллинг, календарь, роли, поддержка, языки и живая delivery-модель.",
        "Следующий правильный шаг — не расползаться ещё шире, а сконцентрироваться на консолидации модели данных, прав и owner-facing продукта. Если это сделать, проект можно продавать уже не как автоматизацию чата, а как систему операционного управления записью и загрузкой салона.",
    ]

    trees = {
        "manicbot/src": build_tree(ROOT / "manicbot" / "src"),
        "manicbot/admin-app/src": build_tree(ROOT / "manicbot" / "admin-app" / "src"),
        "manicbot-analysis/src": build_tree(ROOT / "manicbot-analysis" / "src"),
        "manicbot-landing/src": build_tree(ROOT / "manicbot-landing" / "src"),
    }

    return {
        "generated_at": "24 марта 2026",
        "packages": packages,
        "methodology": methodology,
        "executive_summary": executive_summary,
        "strengths": strengths,
        "critical_risks": critical_risks,
        "health_rows": health_rows,
        "schema_drifts": schema_drifts,
        "d1_tables": d1_tables,
        "kv_zones": kv_zones,
        "routes": routes,
        "module_blocks": module_blocks,
        "improvements": improvements,
        "long_term": long_term,
        "product_ideas": product_ideas,
        "website_and_product": website_and_product,
        "sales_strategy": sales_strategy,
        "roadmap": roadmap,
        "conclusion": conclusion,
        "trees": trees,
        "top_backend_files": worker["topFiles"][:10],
        "top_admin_files": admin["topFiles"][:8],
        "ui_usage": ui_usage,
    }


def render_markdown(data: dict) -> str:
    lines: list[str] = []
    lines.append("# ManicBot: полный аудит кода, структуры, продукта и стратегии")
    lines.append("")
    lines.append(f"_Сформировано: {data['generated_at']}_")
    lines.append("")
    lines.append("## Короткий вывод")
    lines.append("")
    for item in data["executive_summary"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Методология")
    lines.append("")
    for item in data["methodology"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Карта репозитория")
    lines.append("")
    lines.append("| Пакет | Назначение | Файлы | LOC |")
    lines.append("|---|---|---:|---:|")
    for row in data["packages"]:
        lines.append(f"| `{row['package']}` | {row['purpose']} | {row['files']} | {row['loc']} |")
    lines.append("")
    lines.append("## Самые крупные файлы")
    lines.append("")
    lines.append("### Worker backend")
    lines.append("")
    for item in data["top_backend_files"]:
        lines.append(f"- `{item['file']}` — {item['lines']} LOC")
    lines.append("")
    lines.append("### admin-app")
    lines.append("")
    for item in data["top_admin_files"]:
        lines.append(f"- `{item['file']}` — {item['lines']} LOC")
    lines.append("")
    lines.append("## Модульная структура")
    lines.append("")
    lines.append("| Зона | Модуль | Роль |")
    lines.append("|---|---|---|")
    for row in data["module_blocks"]:
        lines.append(f"| {row[0]} | `{row[1]}` | {row[2]} |")
    lines.append("")
    lines.append("## Runtime-маршруты")
    lines.append("")
    lines.append("| Поверхность | Пути | Назначение |")
    lines.append("|---|---|---|")
    for row in data["routes"]:
        lines.append(f"| {row[0]} | `{row[1]}` | {row[2]} |")
    lines.append("")
    lines.append("## Схемы данных")
    lines.append("")
    lines.append("### D1")
    lines.append("")
    lines.append("| Блок | Таблицы | Назначение |")
    lines.append("|---|---|---|")
    for row in data["d1_tables"]:
        lines.append(f"| {row[0]} | `{row[1]}` | {row[2]} |")
    lines.append("")
    lines.append("### KV")
    lines.append("")
    lines.append("| Зона | Ключи | Назначение |")
    lines.append("|---|---|---|")
    for row in data["kv_zones"]:
        lines.append(f"| {row[0]} | `{row[1]}` | {row[2]} |")
    lines.append("")
    lines.append("## Сильные стороны")
    lines.append("")
    for item in data["strengths"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Основные риски")
    lines.append("")
    for item in data["critical_risks"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Проверка состояния проекта")
    lines.append("")
    lines.append("| Проверка | Статус | Комментарий |")
    lines.append("|---|---|---|")
    for row in data["health_rows"]:
        lines.append(f"| {row[0]} | **{row[1]}** | {row[2]} |")
    lines.append("")
    lines.append("## Критические расхождения схем и словарей")
    lines.append("")
    lines.append("| Drift | Что расходится | Почему это опасно |")
    lines.append("|---|---|---|")
    for row in data["schema_drifts"]:
        lines.append(f"| {row[0]} | {row[1]} | {row[2]} |")
    lines.append("")
    lines.append("## Топ-15 улучшений по важности")
    lines.append("")
    for item in data["improvements"]:
        lines.append(f"### {item['rank']}. {item['title']}")
        lines.append("")
        lines.append(f"- Почему важно: {item['why']}")
        lines.append(f"- Что делать: {item['do']}")
        lines.append("")
    lines.append("## Долгосрочная перспектива")
    lines.append("")
    for item in data["long_term"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Топ-10 идей для продукта")
    lines.append("")
    lines.append("| Идея | Зачем внедрять |")
    lines.append("|---|---|")
    for row in data["product_ideas"]:
        lines.append(f"| {row[0]} | {row[1]} |")
    lines.append("")
    lines.append("## Что стоит улучшить на сайте и в продуктовой упаковке")
    lines.append("")
    for item in data["website_and_product"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Стратегия продаж и go-to-market")
    lines.append("")
    for item in data["sales_strategy"]:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("## Дорожная карта")
    lines.append("")
    lines.append("| Горизонт | Фокус |")
    lines.append("|---|---|")
    for row in data["roadmap"]:
        lines.append(f"| {row[0]} | {row[1]} |")
    lines.append("")
    lines.append("## Общее резюме")
    lines.append("")
    for item in data["conclusion"]:
        lines.append(item)
        lines.append("")
    lines.append("## Приложение: деревья исходников")
    lines.append("")
    for name, tree in data["trees"].items():
        lines.append(f"### {name}")
        lines.append("")
        lines.append("```text")
        lines.append(tree)
        lines.append("```")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def build_styles() -> dict:
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "AuditTitle",
            parent=styles["Title"],
            fontName="AuditSansBold",
            fontSize=28,
            leading=34,
            alignment=TA_CENTER,
            textColor=HexColor("#0F172A"),
            spaceAfter=10,
        ),
        "subtitle": ParagraphStyle(
            "AuditSubtitle",
            parent=styles["Normal"],
            fontName="AuditSans",
            fontSize=11,
            leading=15,
            alignment=TA_CENTER,
            textColor=HexColor("#475569"),
            spaceAfter=8,
        ),
        "h1": ParagraphStyle(
            "AuditH1",
            parent=styles["Heading1"],
            fontName="AuditSansBold",
            fontSize=18,
            leading=22,
            textColor=HexColor("#0F172A"),
            spaceBefore=6,
            spaceAfter=6,
        ),
        "h2": ParagraphStyle(
            "AuditH2",
            parent=styles["Heading2"],
            fontName="AuditSansBold",
            fontSize=13,
            leading=17,
            textColor=HexColor("#1D4ED8"),
            spaceBefore=4,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "AuditBody",
            parent=styles["Normal"],
            fontName="AuditSans",
            fontSize=9.5,
            leading=13,
            textColor=HexColor("#0F172A"),
            alignment=TA_LEFT,
        ),
        "small": ParagraphStyle(
            "AuditSmall",
            parent=styles["Normal"],
            fontName="AuditSans",
            fontSize=8,
            leading=11,
            textColor=HexColor("#334155"),
        ),
        "table": ParagraphStyle(
            "AuditTable",
            parent=styles["Normal"],
            fontName="AuditSans",
            fontSize=8.5,
            leading=11,
            textColor=HexColor("#0F172A"),
        ),
        "table_head": ParagraphStyle(
            "AuditTableHead",
            parent=styles["Normal"],
            fontName="AuditSansBold",
            fontSize=8.5,
            leading=11,
            textColor=colors.white,
        ),
        "mono": ParagraphStyle(
            "AuditMono",
            parent=styles["Code"],
            fontName="Courier",
            fontSize=6.6,
            leading=8,
            textColor=HexColor("#0F172A"),
        ),
    }


def paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    safe = esc(text).replace("\n", "<br/>")
    return Paragraph(safe, style)


def bullets(items: list[str], style: ParagraphStyle) -> list:
    story = []
    for item in items:
        story.append(paragraph(f"• {item}", style))
        story.append(Spacer(1, 1.2 * mm))
    return story


def make_table(headers: list[str], rows: list[list[str]], styles: dict, col_widths: list[float]) -> Table:
    data = [[Paragraph(esc(h), styles["table_head"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(esc(cell), styles["table"]) for cell in row])
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), HexColor("#0F172A")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#F8FAFC"), colors.white]),
                ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#CBD5E1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def pdf_footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("AuditSans", 7)
    canvas.setFillColor(HexColor("#64748B"))
    canvas.drawString(16 * mm, 9 * mm, "ManicBot audit pack")
    canvas.drawRightString(PAGE_W - 16 * mm, 9 * mm, f"page {doc.page}")
    canvas.restoreState()


def render_pdf(data: dict) -> None:
    register_fonts()
    styles = build_styles()

    doc = SimpleDocTemplate(
        str(OUT_PDF),
        pagesize=landscape(A4),
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title="ManicBot Full Audit",
        author="OpenAI Codex",
    )

    story: list = []

    story.append(Spacer(1, 18 * mm))
    story.append(paragraph("ManicBot", styles["title"]))
    story.append(paragraph("Полный аудит кода, структуры, схем данных, продукта и стратегии продаж", styles["subtitle"]))
    story.append(Spacer(1, 2 * mm))
    story.append(paragraph("Фокус: архитектура, модули, file map, D1/KV contracts, приоритет улучшений, long-term perspective, features, packaging и go-to-market.", styles["subtitle"]))
    story.append(Spacer(1, 6 * mm))
    story.append(
        make_table(
            ["Что проверено", "Факт"],
            [
                ["Worker backend", "Прочитаны entrypoints, orchestration, services, tenancy, roles, billing, Google Calendar."],
                ["Схемы данных", "Сверены D1 schema.sql, Drizzle schema.ts, runtime SQL и docs."],
                ["Состояние проекта", "`manicbot` tests PASS, `admin-app` build PASS, оба лендинга build PASS."],
                ["Продукт", "Разобраны owner/admin surfaces, marketing sites, SEO blog, GTM-потенциал."],
            ],
            styles,
            [62 * mm, 195 * mm],
        )
    )
    story.append(PageBreak())

    story.append(paragraph("Executive Summary", styles["h1"]))
    story.extend(bullets(data["executive_summary"], styles["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(paragraph("Methodology", styles["h2"]))
    story.extend(bullets(data["methodology"], styles["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(paragraph("Сильные стороны", styles["h2"]))
    story.extend(bullets(data["strengths"], styles["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(paragraph("Ключевые риски", styles["h2"]))
    story.extend(bullets(data["critical_risks"], styles["body"]))
    story.append(PageBreak())

    story.append(paragraph("Карта Репозитория", styles["h1"]))
    package_rows = [[row["package"], row["purpose"], str(row["files"]), str(row["loc"])] for row in data["packages"]]
    story.append(make_table(["Пакет", "Назначение", "Файлы", "LOC"], package_rows, styles, [64 * mm, 146 * mm, 20 * mm, 20 * mm]))
    story.append(Spacer(1, 4 * mm))
    story.append(paragraph("Крупнейшие файлы Worker backend", styles["h2"]))
    worker_rows = [[item["file"], str(item["lines"])] for item in data["top_backend_files"]]
    story.append(make_table(["Файл", "LOC"], worker_rows, styles, [200 * mm, 30 * mm]))
    story.append(Spacer(1, 4 * mm))
    story.append(paragraph("Крупнейшие файлы admin-app", styles["h2"]))
    admin_rows = [[item["file"], str(item["lines"])] for item in data["top_admin_files"]]
    story.append(make_table(["Файл", "LOC"], admin_rows, styles, [200 * mm, 30 * mm]))
    story.append(PageBreak())

    story.append(paragraph("Модульная Структура", styles["h1"]))
    story.append(make_table(["Зона", "Модуль", "Роль"], data["module_blocks"], styles, [45 * mm, 70 * mm, 135 * mm]))
    story.append(Spacer(1, 4 * mm))
    story.append(paragraph("Основные runtime boundary", styles["h2"]))
    story.append(make_table(["Поверхность", "Пути", "Назначение"], data["routes"], styles, [50 * mm, 90 * mm, 110 * mm]))
    story.append(PageBreak())

    story.append(paragraph("Схемы Данных", styles["h1"]))
    story.append(paragraph("D1: фактический source of truth для основных business entities", styles["h2"]))
    story.append(make_table(["Блок", "Таблицы", "Назначение"], data["d1_tables"], styles, [48 * mm, 90 * mm, 112 * mm]))
    story.append(Spacer(1, 4 * mm))
    story.append(paragraph("KV: то, что реально осталось важным", styles["h2"]))
    story.append(make_table(["Зона", "Ключи", "Назначение"], data["kv_zones"], styles, [42 * mm, 85 * mm, 123 * mm]))
    story.append(Spacer(1, 4 * mm))
    story.append(paragraph("Schema drift, который надо чинить первым", styles["h2"]))
    story.append(make_table(["Drift", "Что расходится", "Риск"], data["schema_drifts"], styles, [42 * mm, 98 * mm, 110 * mm]))
    story.append(PageBreak())

    story.append(paragraph("Health Check", styles["h1"]))
    story.append(make_table(["Проверка", "Статус", "Комментарий"], data["health_rows"], styles, [58 * mm, 22 * mm, 170 * mm]))
    story.append(Spacer(1, 3 * mm))
    story.append(paragraph("Ключевой вывод по quality layer", styles["h2"]))
    story.extend(
        bullets(
            [
                "Backend не выглядит мёртвым: тесты сильные, сборки проходят, продуктовый скелет реальный.",
                "Но quality guardrails не охватывают весь system boundary: особенно admin-app, contract layer между поверхностями и миграционные расхождения.",
                "Именно поэтому риск здесь не “сломано всё”, а “сложно масштабировать без неожиданных регрессий”.",
            ],
            styles["body"],
        )
    )
    story.append(PageBreak())

    story.append(paragraph("Топ-15 Улучшений", styles["h1"]))
    block_a = [i for i in data["improvements"] if i["rank"] <= 5]
    block_b = [i for i in data["improvements"] if 6 <= i["rank"] <= 10]
    block_c = [i for i in data["improvements"] if i["rank"] >= 11]
    for title, block in [
        ("Блок A. Архитектурное ядро", block_a),
        ("Блок B. Операционная зрелость", block_b),
        ("Блок C. Масштабирование и рост", block_c),
    ]:
        story.append(paragraph(title, styles["h2"]))
        rows = [[str(item["rank"]), item["title"], item["why"], item["do"]] for item in block]
        story.append(make_table(["#", "Улучшение", "Почему сейчас", "Что делать"], rows, styles, [10 * mm, 72 * mm, 86 * mm, 92 * mm]))
        story.append(Spacer(1, 3 * mm))
    story.append(PageBreak())

    story.append(paragraph("Долгосрочная Перспектива", styles["h1"]))
    story.extend(bullets(data["long_term"], styles["body"]))
    story.append(Spacer(1, 2 * mm))
    story.append(paragraph("Топ-10 идей для продукта", styles["h2"]))
    story.append(make_table(["Идея", "Бизнес-смысл"], data["product_ideas"], styles, [90 * mm, 160 * mm]))
    story.append(Spacer(1, 2 * mm))
    story.append(paragraph("Что стоит улучшить на сайте и в упаковке", styles["h2"]))
    story.extend(bullets(data["website_and_product"], styles["body"]))
    story.append(PageBreak())

    story.append(paragraph("Стратегия Продаж", styles["h1"]))
    story.extend(bullets(data["sales_strategy"], styles["body"]))
    story.append(Spacer(1, 3 * mm))
    story.append(paragraph("Roadmap", styles["h2"]))
    story.append(make_table(["Горизонт", "Фокус"], data["roadmap"], styles, [35 * mm, 215 * mm]))
    story.append(Spacer(1, 3 * mm))
    story.append(paragraph("Общее резюме", styles["h2"]))
    for item in data["conclusion"]:
        story.append(paragraph(item, styles["body"]))
        story.append(Spacer(1, 1.5 * mm))
    story.append(PageBreak())

    story.append(paragraph("Приложение: Trees", styles["h1"]))
    for name, tree in data["trees"].items():
        lines = tree.splitlines()
        chunk_size = 58
        for index in range(0, len(lines), chunk_size):
            chunk = "\n".join(lines[index:index + chunk_size])
            suffix = "" if index == 0 else f" (part {index // chunk_size + 1})"
            story.append(paragraph(f"{name}{suffix}", styles["h2"]))
            story.append(
                Table(
                    [[Preformatted(chunk, styles["mono"])]],
                    colWidths=[260 * mm],
                    style=TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#F8FAFC")),
                            ("BOX", (0, 0), (-1, -1), 0.5, HexColor("#CBD5E1")),
                            ("LEFTPADDING", (0, 0), (-1, -1), 6),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                            ("TOPPADDING", (0, 0), (-1, -1), 6),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                        ]
                    ),
                )
            )
            story.append(Spacer(1, 3 * mm))
    doc.build(story, onFirstPage=pdf_footer, onLaterPages=pdf_footer)


def main() -> None:
    metrics = load_metrics()
    data = build_content(metrics)
    OUT_MD.write_text(render_markdown(data), encoding="utf-8")
    render_pdf(data)
    print(f"Markdown: {OUT_MD}")
    print(f"PDF: {OUT_PDF}")


if __name__ == "__main__":
    main()
