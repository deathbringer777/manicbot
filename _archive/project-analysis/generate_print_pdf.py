from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent
METRICS_PATH = ROOT / "project-metrics.json"
OUTPUT_PATH = ROOT / "PROJECT_STRUCTURE_PRINT_BW.pdf"

PAGE_W, PAGE_H = landscape(A4)
MARGIN = 32

BLACK = colors.HexColor("#111111")
DARK = colors.HexColor("#2f2f2f")
MID = colors.HexColor("#6a6a6a")
LIGHT = colors.HexColor("#c7c7c7")
LIGHTER = colors.HexColor("#ededed")
WHITE = colors.white

FONT_REG = "PrintSans"
FONT_BOLD = "PrintSansBold"


def register_fonts() -> None:
    font_candidates = [
        (FONT_REG, "/System/Library/Fonts/Supplemental/Arial.ttf"),
        (FONT_BOLD, "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ]
    for name, path in font_candidates:
        if name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(name, path))


def load_metrics() -> dict:
    return json.loads(METRICS_PATH.read_text(encoding="utf-8"))


def rel_metrics(metrics: dict, key: str) -> dict:
    for pkg in metrics["packages"]:
        if pkg["key"] == key:
            return pkg
    raise KeyError(key)


def draw_header(c: canvas.Canvas, title: str, subtitle: str, page_num: int) -> None:
    c.setFillColor(BLACK)
    c.setStrokeColor(BLACK)
    c.setLineWidth(1)
    c.rect(MARGIN, PAGE_H - 52, PAGE_W - MARGIN * 2, 32, fill=0, stroke=1)
    c.setFont(FONT_BOLD, 18)
    c.drawString(MARGIN + 12, PAGE_H - 31, title)
    c.setFont(FONT_REG, 10)
    c.setFillColor(DARK)
    c.drawRightString(PAGE_W - MARGIN - 12, PAGE_H - 31, subtitle)
    c.setFillColor(MID)
    c.setFont(FONT_REG, 9)
    c.drawString(MARGIN, 18, "ManicBot architecture print pack")
    c.drawRightString(PAGE_W - MARGIN, 18, f"page {page_num}")
    c.setStrokeColor(LIGHT)
    c.line(MARGIN, 28, PAGE_W - MARGIN, 28)


def draw_box(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    title: str,
    lines: list[str] | None = None,
    fill: colors.Color = WHITE,
    stroke: colors.Color = BLACK,
    title_bg: colors.Color | None = None,
    title_size: int = 12,
    text_size: int = 9,
    line_step: int = 12,
) -> None:
    c.setStrokeColor(stroke)
    c.setFillColor(fill)
    c.setLineWidth(1)
    c.rect(x, y, w, h, fill=1, stroke=1)
    if title_bg:
        c.setFillColor(title_bg)
        c.rect(x, y + h - 24, w, 24, fill=1, stroke=0)
        c.setFillColor(WHITE)
    else:
        c.setFillColor(BLACK)
    c.setFont(FONT_BOLD, title_size)
    c.drawString(x + 8, y + h - 16, title)
    c.setFillColor(DARK)
    if lines:
        c.setFont(FONT_REG, text_size)
        cursor_y = y + h - 34
        for line in lines:
            wrapped = simpleSplit(line, FONT_REG, text_size, w - 16)
            for part in wrapped:
                c.drawString(x + 8, cursor_y, part)
                cursor_y -= line_step


def draw_paragraph(
    c: canvas.Canvas,
    x: float,
    y_top: float,
    w: float,
    text: str,
    font: str = FONT_REG,
    size: int = 10,
    leading: int = 13,
    color: colors.Color = DARK,
) -> float:
    c.setFillColor(color)
    c.setFont(font, size)
    y = y_top
    for raw_line in text.split("\n"):
        wrapped = simpleSplit(raw_line, font, size, w)
        if not wrapped:
            y -= leading
            continue
        for line in wrapped:
            c.drawString(x, y, line)
            y -= leading
    return y


def draw_bullets(
    c: canvas.Canvas,
    x: float,
    y_top: float,
    w: float,
    items: list[str],
    size: int = 10,
    leading: int = 13,
) -> float:
    y = y_top
    for item in items:
        wrapped = simpleSplit(item, FONT_REG, size, w - 18)
        if not wrapped:
            continue
        c.setFillColor(BLACK)
        c.circle(x + 4, y - 3, 2.1, fill=1, stroke=0)
        c.setFillColor(DARK)
        c.setFont(FONT_REG, size)
        c.drawString(x + 12, y, wrapped[0])
        y -= leading
        for line in wrapped[1:]:
            c.drawString(x + 12, y, line)
            y -= leading
        y -= 3
    return y


def draw_arrow(
    c: canvas.Canvas,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    label: str | None = None,
) -> None:
    c.setStrokeColor(MID)
    c.setFillColor(MID)
    c.setLineWidth(1)
    c.line(x1, y1, x2, y2)
    dx = x2 - x1
    dy = y2 - y1
    length = max((dx**2 + dy**2) ** 0.5, 1)
    ux = dx / length
    uy = dy / length
    hx = x2 - ux * 8
    hy = y2 - uy * 8
    px = -uy * 4
    py = ux * 4
    c.line(x2, y2, hx + px, hy + py)
    c.line(x2, y2, hx - px, hy - py)
    if label:
        c.setFont(FONT_REG, 8)
        c.setFillColor(BLACK)
        c.drawCentredString((x1 + x2) / 2, (y1 + y2) / 2 + 6, label)


def metric_card(c: canvas.Canvas, x: float, y: float, title: str, value: str, note: str) -> None:
    draw_box(
        c,
        x,
        y,
        170,
        78,
        title,
        [value, note],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
        title_size=10,
        text_size=11,
        line_step=14,
    )


def page_cover(c: canvas.Canvas, metrics: dict) -> None:
    worker = rel_metrics(metrics, "worker")
    admin = rel_metrics(metrics, "admin")
    tests = rel_metrics(metrics, "tests")
    draw_header(c, "ManicBot: printable architecture pack", "black / white structured PDF", 1)

    c.setFillColor(BLACK)
    c.setFont(FONT_BOLD, 28)
    c.drawString(MARGIN, PAGE_H - 100, "Структура проекта и реальные контуры системы")
    c.setFont(FONT_REG, 13)
    c.setFillColor(DARK)
    c.drawString(
        MARGIN,
        PAGE_H - 126,
        "Подготовлено как печатный пакет: без цвета, без декоративного мусора, с упором на читаемость на бумаге.",
    )

    metric_card(c, MARGIN, PAGE_H - 220, "Worker backend", f"{worker['lines']} LOC", f"{worker['files']} files")
    metric_card(c, MARGIN + 186, PAGE_H - 220, "Admin mini-app", f"{admin['lines']} LOC", f"{admin['files']} files")
    metric_card(c, MARGIN + 372, PAGE_H - 220, "Backend tests", f"{tests['lines']} LOC", f"{metrics['tests']['count']} test files")
    metric_card(c, MARGIN + 558, PAGE_H - 220, "Storage", "D1 + KV", "hybrid runtime")
    metric_card(c, MARGIN + 744, PAGE_H - 220, "Main entry", "worker.js", "fetch + scheduled")

    draw_box(
        c,
        MARGIN,
        PAGE_H - 470,
        430,
        210,
        "Зачем этот PDF",
        [
            "1. Быстро понять, что в репозитории является ядром, а что боковыми приложениями.",
            "2. Увидеть настоящую runtime-схему без старых предположений из README.",
            "3. Разложить Worker, admin-app, D1 и KV по реальным зонам ответственности.",
            "4. Зафиксировать архитектурные расхождения, которые мешают думать о проекте цельно.",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_box(
        c,
        MARGIN + 450,
        PAGE_H - 470,
        338,
        210,
        "Главные выводы",
        [
            "Это не один проект, а связка из нескольких приложений.",
            "Worker — главный системный orchestrator.",
            "Admin-app сейчас platform-oriented God Mode.",
            "Persistence уже D1-first, но KV всё ещё критичен.",
            "Есть drift между docs, worker SQL и admin schema.",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_box(
        c,
        MARGIN + 806,
        PAGE_H - 470,
        336,
        210,
        "Что внутри",
        [
            "page 2  system overview",
            "page 3  repository landscape",
            "page 4  worker internals",
            "page 5  admin-app + data model",
            "page 6  critical flows",
            "page 7  drift + cleanup order",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    y = PAGE_H - 520
    c.setFont(FONT_BOLD, 14)
    c.setFillColor(BLACK)
    c.drawString(MARGIN, y, "Ключевые точки входа")
    draw_bullets(
        c,
        MARGIN,
        y - 22,
        PAGE_W - MARGIN * 2,
        [
            "manicbot/src/worker.js — webhook routing, Stripe, cron, HTML admin, Google OAuth callbacks, landing proxy.",
            "manicbot/src/handlers/message.js и callback.js — главный control flow пользовательских сценариев.",
            "manicbot/admin-app/src/app/api/trpc/[trpc]/route.ts — API boundary для mini-app.",
            "manicbot/src/db/schema.sql и manicbot/admin-app/src/server/db/schema.ts — две competing схемы, которые сейчас расходятся.",
        ],
        size=11,
        leading=15,
    )

    c.setFont(FONT_REG, 10)
    c.setFillColor(MID)
    generated = datetime.fromisoformat(metrics["generatedAt"].replace("Z", "+00:00"))
    c.drawString(MARGIN, 42, f"generated from repository state at {generated.isoformat()}")


def page_system_overview(c: canvas.Canvas, metrics: dict) -> None:
    draw_header(c, "System overview", "actors, runtimes, storage and major boundaries", 2)

    # actors
    draw_box(c, 46, 390, 170, 64, "Client", ["Telegram user"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)
    draw_box(c, 46, 310, 170, 64, "Master", ["Telegram operator"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)
    draw_box(c, 46, 230, 170, 64, "Tenant owner", ["Telegram and web"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)
    draw_box(c, 46, 150, 170, 64, "Platform admin", ["bot + mini-app"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 260, 295, 180, 90, "Telegram Bot API", ["transport for", "messages and callbacks"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(
        c,
        480,
        280,
        280,
        150,
        "Cloudflare Worker",
        [
            "worker.js",
            "fetch + scheduled",
            "all public runtime entrypoints",
            "main system hub",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_box(
        c,
        480,
        120,
        280,
        120,
        "Next.js admin-app",
        [
            "Telegram Mini App",
            "App Router + tRPC + D1",
            "currently God Mode oriented",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_box(c, 804, 370, 150, 64, "Workers AI", ["LLM assistant"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)
    draw_box(c, 804, 286, 150, 64, "Stripe", ["billing + webhooks"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)
    draw_box(c, 804, 202, 150, 64, "Google Calendar", ["OAuth + sync"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)
    draw_box(c, 804, 118, 150, 64, "Landing app", ["Cloudflare Pages"], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(
        c,
        994,
        285,
        150,
        104,
        "Cloudflare D1",
        [
            "entities",
            "tenants / bots / appointments",
            "users / roles / services",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )
    draw_box(
        c,
        994,
        150,
        150,
        104,
        "Cloudflare KV",
        [
            "sidecars",
            "bot tokens / sessions",
            "locks / idempotency",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_arrow(c, 216, 422, 260, 340, "messages")
    draw_arrow(c, 216, 342, 260, 340)
    draw_arrow(c, 216, 262, 260, 330)
    draw_arrow(c, 216, 182, 260, 320)
    draw_arrow(c, 440, 340, 480, 340, "webhook")
    draw_arrow(c, 760, 385, 804, 402, "AI")
    draw_arrow(c, 760, 350, 804, 318, "billing")
    draw_arrow(c, 760, 314, 804, 234, "calendar")
    draw_arrow(c, 760, 168, 804, 150, "proxy")
    draw_arrow(c, 760, 320, 994, 336, "SQL")
    draw_arrow(c, 760, 300, 994, 202, "KV")
    draw_arrow(c, 760, 180, 994, 336, "tRPC")

    draw_box(
        c,
        46,
        56,
        1098,
        44,
        "Interpretation",
        [
            "Система строится вокруг одного Worker-а: mini-app идёт параллельной дорожкой, а не прячется за ним. Persistence уже не KV-only: сейчас реальная модель — D1 + KV sidecars.",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
        text_size=10,
    )


def page_repository(c: canvas.Canvas, metrics: dict) -> None:
    draw_header(c, "Repository landscape", "packages, scale and code concentration", 3)
    worker = rel_metrics(metrics, "worker")
    admin = rel_metrics(metrics, "admin")
    analysis = rel_metrics(metrics, "analysis")
    landing = rel_metrics(metrics, "landing")
    tests = rel_metrics(metrics, "tests")

    draw_box(
        c,
        40,
        290,
        420,
        250,
        "Main packages",
        [
            f"manicbot/src — Worker backend — {worker['files']} files / {worker['lines']} LOC",
            f"manicbot/test — backend tests — {tests['files']} files / {tests['lines']} LOC",
            f"manicbot/admin-app/src — mini-app — {admin['files']} files / {admin['lines']} LOC",
            f"manicbot-analysis/src — separate analysis UI — {analysis['files']} files / {analysis['lines']} LOC",
            f"manicbot-landing/src — marketing site — {landing['files']} files / {landing['lines']} LOC",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    worker_breakdown = [f"{item['name']} — {item['count']} files" for item in worker["topLevelFolders"]]
    draw_box(
        c,
        490,
        290,
        300,
        250,
        "Worker folder breakdown",
        worker_breakdown,
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    admin_breakdown = [f"{item['name']} — {item['count']} files" for item in admin["topLevelFolders"]]
    draw_box(
        c,
        820,
        290,
        320,
        250,
        "Admin-app breakdown",
        admin_breakdown,
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    worker_hot = [f"{row['file']} — {row['imports']} internal imports" for row in metrics["hotspots"]["worker"][:8]]
    draw_box(
        c,
        40,
        52,
        550,
        200,
        "Backend hotspots by connectedness",
        worker_hot,
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
        text_size=8,
        line_step=11,
    )

    admin_hot = [f"{row['file']} — {row['imports']} internal imports" for row in metrics["hotspots"]["admin"][:8]]
    draw_box(
        c,
        620,
        52,
        520,
        200,
        "Admin-app hotspots by connectedness",
        admin_hot,
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
        text_size=8,
        line_step=11,
    )

    draw_box(
        c,
        40,
        560,
        520,
        90,
        "Meaning",
        [
            "Репозиторий уже живёт как маленькая платформа: production Worker, отдельная web mini-app, отдельный landing и отдельный analysis frontend.",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_box(
        c,
        580,
        560,
        560,
        90,
        "Where to read first",
        [
            "worker.js -> tenant/resolver.js -> handlers/message.js -> handlers/callback.js -> services/appointments.js -> services/google-calendar-oauth.js",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )


def page_worker(c: canvas.Canvas, metrics: dict) -> None:
    draw_header(c, "Worker internals", "how manicbot/src is actually organized", 4)

    # Columns
    draw_box(c, 36, 308, 260, 250, "Gateway / context", [
        "worker.js",
        "tenant/resolver.js",
        "tenant/storage.js",
        "utils/db.js",
        "wrangler routes + cron",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 320, 268, 250, 290, "Handlers", [
        "handlers/message.js",
        "handlers/callback.js",
        "handlers/cron.js",
        "",
        "These files carry a lot of",
        "real orchestration burden.",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 594, 248, 250, 310, "Domain services", [
        "services/appointments.js",
        "services/users.js",
        "services/services.js",
        "services/state.js",
        "services/chat.js",
        "roles/roles.js",
        "support/tickets.js",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 868, 228, 260, 330, "Cross-cutting subsystems", [
        "ai.js",
        "services/google-calendar-oauth.js",
        "billing/*",
        "notifications.js",
        "admin/provisioning.js",
        "admin/seed.js",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 36, 52, 1092, 140, "UI and shared text", [
        "ui/screens.js, ui/admin.js, ui/sysadmin.js, ui/booking.js, ui/keyboards.js, i18n/*",
        "UI is not an outer shell here: it is wired directly into flow control from handlers and AI actions.",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_arrow(c, 296, 430, 320, 430)
    draw_arrow(c, 570, 420, 594, 420)
    draw_arrow(c, 844, 410, 868, 410)
    draw_arrow(c, 450, 268, 220, 192, "screens")
    draw_arrow(c, 718, 248, 380, 192, "lists")
    draw_arrow(c, 998, 228, 620, 192, "menus / prompts")

    draw_box(
        c,
        36,
        580,
        540,
        82,
        "Reading heuristic",
        [
            "Если надо понять поведение бота, почти всегда правда живёт в связке worker.js + message.js + callback.js + appointments/users/calendar services.",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_box(
        c,
        600,
        580,
        528,
        82,
        "Main complexity hotspot",
        [
            "Сценарии, роли, UI и side effects сильно сходятся в двух giant handlers. Это основной участок, где легче всего потерять архитектурную ясность.",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )


def page_admin_and_data(c: canvas.Canvas, metrics: dict) -> None:
    draw_header(c, "Admin-app and persistence", "what the web console is, and where data really lives", 5)

    draw_box(
        c,
        36,
        350,
        360,
        208,
        "Admin-app actual role",
        [
            "Next.js App Router mini-app",
            "TelegramGate hardcodes creator access",
            "adminProcedure also checks creator / platform role",
            "So this is platform God Mode, not tenant self-service yet",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )
    draw_box(
        c,
        420,
        350,
        320,
        208,
        "Admin-app stack",
        [
            "layout.tsx + Shell.tsx",
            "app/api/trpc/[trpc]/route.ts",
            "server/api/root.ts",
            "server/api/routers/*",
            "server/db/schema.ts",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )
    draw_box(
        c,
        764,
        350,
        380,
        208,
        "Important admin pages",
        [
            "Dashboard",
            "Tenants",
            "Users",
            "Appointments",
            "Agents",
            "Billing / System / Settings",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_box(
        c,
        36,
        122,
        340,
        186,
        "D1: global/platform tables",
        [
            "tenants",
            "bots",
            "platform_roles",
            "support_agents",
            "tenant_support_agents",
            "stripe_customers",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )
    draw_box(
        c,
        398,
        122,
        360,
        186,
        "D1: tenant-scoped business tables",
        [
            "appointments",
            "users",
            "masters",
            "tenant_roles",
            "services",
            "tenant_config",
            "blocked_users",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )
    draw_box(
        c,
        780,
        122,
        364,
        186,
        "KV sidecars",
        [
            "bottoken:*",
            "gcal:oauth:*",
            "stripe:evt:*",
            "tktlock:*",
            "legacy tenant-prefixed state",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )

    draw_box(
        c,
        36,
        52,
        1108,
        48,
        "Storage reality",
        [
            "Система уже D1-first для сущностей, но KV остаётся обязательной operational прослойкой. Это не чистая D1-архитектура и не старый KV-only режим — это гибрид.",
        ],
        fill=WHITE,
        stroke=BLACK,
        title_bg=LIGHTER,
    )


def page_flows(c: canvas.Canvas, metrics: dict) -> None:
    draw_header(c, "Critical flows", "the shortest way to understand system behavior", 6)

    flow_specs = [
        (
            "A. Booking from Telegram",
            490,
            [
                "1. Client writes in Telegram",
                "2. Telegram calls /webhook/:botId",
                "3. worker.js resolves tenant context",
                "4. message.js / callback.js runs scenario",
                "5. appointments.js stores or updates record",
                "6. notifications.js informs master/admin",
                "7. confirmation may trigger ICS + Google sync",
            ],
        ),
        (
            "B. Mini-app request path",
            360,
            [
                "1. Telegram Mini App sends initData",
                "2. TelegramGate checks creator locally",
                "3. tRPC route receives request",
                "4. server/auth/telegram validates signature",
                "5. adminProcedure applies role gate",
                "6. routers query or mutate D1 via Drizzle",
            ],
        ),
        (
            "C. Billing lifecycle",
            220,
            [
                "1. Checkout or portal is requested",
                "2. Stripe returns webhook to Worker",
                "3. billing/webhooks verifies signature",
                "4. KV stores idempotency marker",
                "5. D1 tenants / stripe_customers are updated",
                "6. feature gating changes handler behavior",
                "7. cron can expire trial / grace states later",
            ],
        ),
        (
            "D. Multi-tenant cron",
            80,
            [
                "1. scheduled() fires",
                "2. Worker loads all tenant ids from D1",
                "3. first bot per tenant builds tenant context",
                "4. handleCron runs per tenant",
                "5. reminders / calendar retry / billing expiry / cleanup",
            ],
        ),
    ]

    for title, y, steps in flow_specs:
        draw_box(c, 40, y, 1104, 110, title, [], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)
        x = 52
        step_w = 150
        gap = 8
        for idx, step in enumerate(steps):
            w = 150 if idx < len(steps) - 1 else 170
            lines = simpleSplit(step, FONT_REG, 8, w - 12)
            draw_box(c, x, y + 18, w, 56, f"{idx + 1}", lines, fill=WHITE, stroke=BLACK, title_bg=LIGHTER, title_size=10, text_size=8, line_step=10)
            if idx < len(steps) - 1:
                draw_arrow(c, x + w, y + 46, x + w + gap, y + 46)
            x += w + gap + 10


def page_drift(c: canvas.Canvas, metrics: dict) -> None:
    draw_header(c, "Drift and cleanup order", "where the project disagrees with itself", 7)

    draw_box(c, 40, 330, 260, 210, "Docs drift", [
        "README still speaks KV-first.",
        "MULTI_BOT_SETUP is outdated.",
        "admin-app README is generic template.",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 320, 330, 260, 210, "Schema drift", [
        "worker SQL != admin schema",
        "services ordering differs",
        "ticket tables differ",
        "masters fields differ",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 600, 330, 260, 210, "Role drift", [
        "Worker uses system_admin",
        "tenant_owner / master",
        "Mini-app still uses admin / owner",
        "in some places",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 880, 330, 264, 210, "Status drift", [
        "billing uses grace_period in backend",
        "grace in mini-app",
        "support agent type names differ too",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 40, 118, 560, 170, "Most important architectural truth", [
        "There are two admin surfaces now: Worker HTML admin and Next.js God Mode. They are not two views over one clean backend surface; they are parallel operational tools.",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 620, 118, 524, 170, "Highest leverage cleanup order", [
        "1. Unify role vocabulary across Worker and admin-app.",
        "2. Unify billing status vocabulary and enum meanings.",
        "3. Reconcile worker SQL schema with admin Drizzle schema.",
        "4. Decide explicitly whether admin-app is platform-only or tenant-facing.",
        "5. Update README and setup docs to the real hybrid D1 + KV model.",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)

    draw_box(c, 40, 52, 1104, 44, "Print note", [
        "Этот PDF сделан именно для бумажного чтения: нормальная иерархия, чёрно-белая палитра и разбивка по страницам вместо одной огромной доски.",
    ], fill=WHITE, stroke=BLACK, title_bg=LIGHTER)


def build_pdf() -> None:
    register_fonts()
    metrics = load_metrics()
    c = canvas.Canvas(str(OUTPUT_PATH), pagesize=landscape(A4))
    pages = [
        page_cover,
        page_system_overview,
        page_repository,
        page_worker,
        page_admin_and_data,
        page_flows,
        page_drift,
    ]
    for page in pages:
        page(c, metrics)
        c.showPage()
    c.save()


if __name__ == "__main__":
    build_pdf()
    print(f"Generated {OUTPUT_PATH}")
