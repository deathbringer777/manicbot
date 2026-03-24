#!/usr/bin/env python3
"""Generate ManicBot Architecture PDF — landscape, Russian, clean blocks."""

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ── Fonts ──
pdfmetrics.registerFont(TTFont('Main', '/Library/Fonts/Arial Unicode.ttf'))
pdfmetrics.registerFont(TTFont('Mono', '/System/Library/Fonts/SFNSMono.ttf'))

# ── Colors ──
C_BG       = HexColor('#F8FAFC')
C_PRIMARY  = HexColor('#1E3A5F')
C_ACCENT   = HexColor('#2563EB')
C_ACCENT2  = HexColor('#7C3AED')
C_GREEN    = HexColor('#059669')
C_ORANGE   = HexColor('#D97706')
C_RED      = HexColor('#DC2626')
C_GRAY     = HexColor('#64748B')
C_LIGHT    = HexColor('#E2E8F0')
C_LIGHTER  = HexColor('#F1F5F9')
C_TBL_HEAD = HexColor('#1E3A5F')
C_TBL_ALT  = HexColor('#F1F5F9')
C_DARK_BG  = HexColor('#0F172A')
C_WHITE    = white

PAGE_W, PAGE_H = landscape(A4)

# ── Styles ──
def s(name, **kw):
    defaults = dict(fontName='Main', fontSize=10, leading=14, textColor=C_PRIMARY)
    defaults.update(kw)
    return ParagraphStyle(name, **defaults)

S_TITLE    = s('title', fontSize=36, leading=44, alignment=TA_CENTER, textColor=C_ACCENT)
S_SUBTITLE = s('subtitle', fontSize=18, leading=24, alignment=TA_CENTER, textColor=C_GRAY)
S_H1       = s('h1', fontSize=22, leading=28, textColor=C_ACCENT, spaceBefore=14, spaceAfter=8)
S_H2       = s('h2', fontSize=16, leading=20, textColor=C_ACCENT2, spaceBefore=10, spaceAfter=6)
S_H3       = s('h3', fontSize=13, leading=17, textColor=C_PRIMARY, spaceBefore=8, spaceAfter=4)
S_BODY     = s('body', fontSize=10, leading=14, textColor=C_PRIMARY)
S_BODY_SM  = s('bodysm', fontSize=9, leading=12, textColor=C_PRIMARY)
S_MONO     = s('mono', fontName='Mono', fontSize=8.5, leading=12, textColor=C_PRIMARY)
S_MONO_SM  = s('monosm', fontName='Mono', fontSize=7.5, leading=10, textColor=C_PRIMARY)
S_CENTER   = s('center', alignment=TA_CENTER)
S_FOOT     = s('foot', fontSize=7, textColor=C_GRAY, alignment=TA_CENTER)
S_TBL      = s('tbl', fontSize=9, leading=12, textColor=C_PRIMARY)
S_TBL_HD   = s('tblhd', fontSize=9, leading=12, textColor=C_WHITE)
S_TBL_MONO = s('tblmono', fontName='Mono', fontSize=8, leading=11, textColor=C_PRIMARY)
S_TAG      = s('tag', fontName='Mono', fontSize=9, leading=12, textColor=C_ACCENT)

# ── Helpers ──
def p(text, style=S_BODY):
    return Paragraph(text, style)

def mono(text):
    return Paragraph(text, S_MONO)

def mono_sm(text):
    return Paragraph(text, S_MONO_SM)

def heading(text, level=1):
    st = {1: S_H1, 2: S_H2, 3: S_H3}[level]
    return Paragraph(text, st)

def hr():
    return Table([['']],
        colWidths=[PAGE_W - 50*mm],
        rowHeights=[1],
        style=TableStyle([('LINEBELOW', (0,0), (-1,-1), 1, C_LIGHT)])
    )

def make_table(headers, rows, col_widths=None, mono_cols=None):
    """Build a styled table. mono_cols = set of column indices to render in mono."""
    mono_cols = mono_cols or set()
    hdr = [Paragraph(h, S_TBL_HD) for h in headers]
    data = [hdr]
    for row in rows:
        r = []
        for i, cell in enumerate(row):
            st = S_TBL_MONO if i in mono_cols else S_TBL
            r.append(Paragraph(str(cell), st))
        data.append(r)

    ncols = len(headers)
    if col_widths is None:
        avail = PAGE_W - 50*mm
        col_widths = [avail / ncols] * ncols

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), C_TBL_HEAD),
        ('TEXTCOLOR', (0, 0), (-1, 0), C_WHITE),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, C_LIGHT),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [C_WHITE, C_TBL_ALT]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]
    t.setStyle(TableStyle(style_cmds))
    return t

def colored_block(text, color=C_ACCENT, bg=None):
    """Inline colored label."""
    if bg is None:
        bg = HexColor('#EFF6FF')
    return Paragraph(
        f'<font color="{color.hexval()}">{text}</font>', S_TBL
    )

def info_block(title, items, color=C_ACCENT):
    """A titled block with bullet items."""
    elems = [Paragraph(f'<font color="{color.hexval()}"><b>{title}</b></font>', S_BODY)]
    for item in items:
        elems.append(Paragraph(f'  \u2022  {item}', S_BODY_SM))
    return KeepTogether(elems)

def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Main', 7)
    canvas.setFillColor(C_GRAY)
    canvas.drawCentredString(PAGE_W / 2, 12*mm,
        f'ManicBot \u2014 Architecture Document  \u2022  22 \u043c\u0430\u0440\u0442\u0430 2026  \u2022  \u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 {doc.page}')
    canvas.restoreState()

# ── Build ──
OUT = '/Users/vdovin/Desktop/44444444/ManicBot_Architecture.pdf'

doc = SimpleDocTemplate(
    OUT,
    pagesize=landscape(A4),
    leftMargin=20*mm, rightMargin=20*mm,
    topMargin=18*mm, bottomMargin=18*mm,
)

story = []
W = PAGE_W - 40*mm  # usable width

# ════════════════════════════════════════════════════════════
# PAGE 1: Title
# ════════════════════════════════════════════════════════════
story.append(Spacer(1, 50*mm))
story.append(Paragraph('ManicBot', s('t1', fontSize=52, leading=60, alignment=TA_CENTER, textColor=C_ACCENT)))
story.append(Spacer(1, 8*mm))
story.append(Paragraph('\u041f\u043e\u043b\u043d\u0430\u044f \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0430 \u043f\u0440\u043e\u0435\u043a\u0442\u0430', S_TITLE))
story.append(Spacer(1, 6*mm))
story.append(hr())
story.append(Spacer(1, 6*mm))
story.append(Paragraph('Telegram-\u0431\u043e\u0442 \u0434\u043b\u044f \u0437\u0430\u043f\u0438\u0441\u0438 \u0432 \u0441\u0430\u043b\u043e\u043d \u043a\u0440\u0430\u0441\u043e\u0442\u044b', S_SUBTITLE))
story.append(Spacer(1, 4*mm))
story.append(Paragraph('Cloudflare Workers  \u2022  D1  \u2022  KV  \u2022  Stripe  \u2022  Google Calendar  \u2022  Workers AI', S_SUBTITLE))
story.append(Spacer(1, 15*mm))
story.append(Paragraph('22 \u043c\u0430\u0440\u0442\u0430 2026', s('date', fontSize=14, alignment=TA_CENTER, textColor=C_GRAY)))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 2: Stack
# ════════════════════════════════════════════════════════════
story.append(heading('\u041e\u0431\u0437\u043e\u0440 \u0441\u0442\u0435\u043a\u0430 \u0442\u0435\u0445\u043d\u043e\u043b\u043e\u0433\u0438\u0439'))
story.append(Spacer(1, 3*mm))

stack_headers = ['\u041a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442', '\u0422\u0435\u0445\u043d\u043e\u043b\u043e\u0433\u0438\u044f', '\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435']
stack_rows = [
    ['Runtime',          'Cloudflare Workers',         'Serverless-\u0444\u0443\u043d\u043a\u0446\u0438\u0438, \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430 webhook'],
    ['\u0425\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0435 KV', 'Cloudflare KV', '\u0411\u044b\u0441\u0442\u0440\u044b\u0439 key-value: \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435, \u043a\u0435\u0448, \u0441\u0435\u0441\u0441\u0438\u0438'],
    ['\u0411\u0430\u0437\u0430 \u0434\u0430\u043d\u043d\u044b\u0445', 'Cloudflare D1 (SQLite)', '\u0420\u0435\u043b\u044f\u0446\u0438\u043e\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435: \u0437\u0430\u043f\u0438\u0441\u0438, \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438, \u0442\u0435\u043d\u0430\u043d\u0442\u044b'],
    ['AI',               'Workers AI (LLM)',            '\u0418\u043d\u0442\u0435\u043b\u043b\u0435\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u044b\u0439 \u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043d\u0442, \u0440\u0430\u0441\u043f\u043e\u0437\u043d\u0430\u0432\u0430\u043d\u0438\u0435 \u043d\u0430\u043c\u0435\u0440\u0435\u043d\u0438\u0439'],
    ['\u041e\u043f\u043b\u0430\u0442\u0430', 'Stripe API', '\u041f\u043e\u0434\u043f\u0438\u0441\u043a\u0438, \u0431\u0438\u043b\u043b\u0438\u043d\u0433, checkout'],
    ['\u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c', 'Google Calendar API', 'OAuth2 + Service Account, \u0434\u0432\u0443\u0441\u0442\u043e\u0440\u043e\u043d\u043d\u044f\u044f \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u044f'],
    ['\u041c\u0435\u0441\u0441\u0435\u043d\u0434\u0436\u0435\u0440', 'Telegram Bot API', '\u0418\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441 \u043a\u043b\u0438\u0435\u043d\u0442\u043e\u0432, \u043c\u0430\u0441\u0442\u0435\u0440\u043e\u0432, \u0430\u0434\u043c\u0438\u043d\u043e\u0432'],
    ['\u0422\u0435\u0441\u0442\u044b', 'Vitest 4.x + Miniflare', '40+ \u0442\u0435\u0441\u0442\u043e\u0432\u044b\u0445 \u0444\u0430\u0439\u043b\u043e\u0432'],
    ['\u0414\u0435\u043f\u043b\u043e\u0439', 'GitHub Actions \u2192 Wrangler', 'CI/CD pipeline'],
    ['\u0410\u0434\u043c\u0438\u043d\u043a\u0430', 'Next.js \u043d\u0430 Vercel', '\u0412\u0435\u0431-\u0434\u0430\u0448\u0431\u043e\u0440\u0434 \u0434\u043b\u044f \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u044b'],
]
story.append(make_table(stack_headers, stack_rows, col_widths=[55*mm, 70*mm, W - 125*mm]))
story.append(Spacer(1, 8*mm))

story.append(heading('\u0417\u0430\u0432\u0438\u0441\u0438\u043c\u043e\u0441\u0442\u0438 (package.json)', 2))
deps = [
    ['vitest ^4.0.18', '\u0422\u0435\u0441\u0442\u043e\u0432\u044b\u0439 \u0444\u0440\u0435\u0439\u043c\u0432\u043e\u0440\u043a'],
    ['wrangler ^4.71.0', 'Cloudflare CLI \u0434\u043b\u044f \u0434\u0435\u043f\u043b\u043e\u044f \u0438 \u0440\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u043a\u0438'],
    ['@cloudflare/vitest-pool-workers ^0.12.20', 'Vitest \u0430\u0434\u0430\u043f\u0442\u0435\u0440 \u0434\u043b\u044f Workers'],
]
story.append(make_table(['\u041f\u0430\u043a\u0435\u0442', '\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435'], deps, col_widths=[100*mm, W - 100*mm]))

story.append(Spacer(1, 6*mm))
story.append(Paragraph('<b>Runtime-\u0431\u0438\u043d\u0434\u0438\u043d\u0433\u0438 Cloudflare:</b>  MANICBOT (KV)  \u2022  DB (D1 SQLite)  \u2022  AI (Workers AI)', S_BODY))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 3: File structure
# ════════════════════════════════════════════════════════════
story.append(heading('\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 \u0444\u0430\u0439\u043b\u043e\u0432 \u043f\u0440\u043e\u0435\u043a\u0442\u0430'))
story.append(Spacer(1, 2*mm))

# Split into two columns using a table
left_tree = """manicbot/
\u251c\u2500 src/
\u2502  \u251c\u2500 worker.js           \u2014 \u0422\u043e\u0447\u043a\u0430 \u0432\u0445\u043e\u0434\u0430, \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u044f
\u2502  \u251c\u2500 config.js           \u2014 \u041a\u043e\u043d\u0441\u0442\u0430\u043d\u0442\u044b: CB, STEP
\u2502  \u251c\u2500 ai.js               \u2014 AI \u043f\u0440\u043e\u043c\u043f\u0442\u044b, \u043f\u0430\u0440\u0441\u0438\u043d\u0433
\u2502  \u251c\u2500 telegram.js         \u2014 Telegram API
\u2502  \u251c\u2500 patterns.js         \u2014 Regex \u043d\u0430\u043c\u0435\u0440\u0435\u043d\u0438\u044f
\u2502  \u251c\u2500 notifications.js    \u2014 \u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u044f
\u2502  \u2502
\u2502  \u251c\u2500 handlers/
\u2502  \u2502  \u251c\u2500 message.js      \u2014 \u0422\u0435\u043a\u0441\u0442\u043e\u0432\u044b\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f
\u2502  \u2502  \u251c\u2500 callback.js     \u2014 \u041a\u043d\u043e\u043f\u043a\u0438 (150+)
\u2502  \u2502  \u2514\u2500 cron.js         \u2014 \u041a\u0430\u0436\u0434\u044b\u0435 15 \u043c\u0438\u043d
\u2502  \u2502
\u2502  \u251c\u2500 services/
\u2502  \u2502  \u251c\u2500 users.js        \u2014 \u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438, \u0440\u043e\u043b\u0438
\u2502  \u2502  \u251c\u2500 appointments.js \u2014 \u0417\u0430\u043f\u0438\u0441\u0438, \u0441\u043b\u043e\u0442\u044b
\u2502  \u2502  \u251c\u2500 chat.js         \u2014 \u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0447\u0430\u0442\u0430
\u2502  \u2502  \u251c\u2500 state.js        \u2014 \u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 (KV)
\u2502  \u2502  \u251c\u2500 services.js     \u2014 \u0423\u0441\u043b\u0443\u0433\u0438 \u0441\u0430\u043b\u043e\u043d\u0430
\u2502  \u2502  \u251c\u2500 tickets.js      \u2014 \u0422\u0438\u043a\u0435\u0442\u044b
\u2502  \u2502  \u251c\u2500 google-cal*.js  \u2014 OAuth2, \u0441\u0438\u043d\u0445
\u2502  \u2502  \u2514\u2500 calendar.js     \u2014 Google Cal API"""

right_tree = """\u2502  \u251c\u2500 roles/roles.js      \u2014 \u0420\u043e\u043b\u0438
\u2502  \u2502
\u2502  \u251c\u2500 tenant/
\u2502  \u2502  \u251c\u2500 resolver.js     \u2014 \u041e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0438\u0435 tenant
\u2502  \u2502  \u251c\u2500 storage.js      \u2014 \u0420\u0435\u0435\u0441\u0442\u0440 (D1+KV)
\u2502  \u2502  \u2514\u2500 migration.js    \u2014 Legacy \u2192 multi
\u2502  \u2502
\u2502  \u251c\u2500 billing/
\u2502  \u2502  \u251c\u2500 config.js       \u2014 START/PRO/STUDIO
\u2502  \u2502  \u251c\u2500 features.js     \u2014 \u0413\u0435\u0439\u0442\u0438\u043d\u0433 \u0444\u0438\u0447
\u2502  \u2502  \u251c\u2500 lifecycle.js    \u2014 Trial, grace
\u2502  \u2502  \u251c\u2500 stripe.js       \u2014 Checkout, \u043f\u043e\u0440\u0442\u0430\u043b
\u2502  \u2502  \u2514\u2500 webhooks.js     \u2014 Stripe webhook
\u2502  \u2502
\u2502  \u251c\u2500 ui/
\u2502  \u2502  \u251c\u2500 screens.js      \u2014 \u042d\u043a\u0440\u0430\u043d\u044b
\u2502  \u2502  \u251c\u2500 booking.js      \u2014 \u041f\u0440\u043e\u0446\u0435\u0441\u0441 \u0437\u0430\u043f\u0438\u0441\u0438
\u2502  \u2502  \u251c\u2500 keyboards.js    \u2014 Inline-\u043a\u043b\u0430\u0432\u0438\u0430\u0442\u0443\u0440\u044b
\u2502  \u2502  \u251c\u2500 admin.js        \u2014 \u0410\u0434\u043c\u0438\u043d-\u043f\u0430\u043d\u0435\u043b\u044c
\u2502  \u2502  \u2514\u2500 sysadmin.js     \u2014 \u041f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430
\u2502  \u2502
\u2502  \u251c\u2500 i18n/  (RU, UA, EN, PL \u00d7 12 \u043c\u043e\u0434\u0443\u043b\u0435\u0439)
\u2502  \u2514\u2500 utils/  (kv, db, date, security, helpers, ics)
\u2502
\u251c\u2500 test/      40+ \u0442\u0435\u0441\u0442\u043e\u0432 (Vitest)
\u251c\u2500 admin-app/ Next.js \u0434\u0430\u0448\u0431\u043e\u0440\u0434
\u251c\u2500 scripts/   \u041c\u0438\u0433\u0440\u0430\u0446\u0438\u044f, \u043f\u0440\u043e\u0432\u0438\u0436\u0438\u043d\u0438\u043d\u0433
\u2514\u2500 wrangler.toml  CF \u043a\u043e\u043d\u0444\u0438\u0433"""

tree_data = [[Paragraph(left_tree.replace('\n', '<br/>'), S_MONO_SM),
               Paragraph(right_tree.replace('\n', '<br/>'), S_MONO_SM)]]
tree_tbl = Table(tree_data, colWidths=[W*0.52, W*0.48])
tree_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), C_LIGHTER),
    ('TOPPADDING', (0, 0), (-1, -1), 8),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ('LEFTPADDING', (0, 0), (-1, -1), 10),
    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('BOX', (0, 0), (-1, -1), 1, C_LIGHT),
]))
story.append(tree_tbl)
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 4: Architecture diagram
# ════════════════════════════════════════════════════════════
story.append(heading('\u0410\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0430 \u0441\u0438\u0441\u0442\u0435\u043c\u044b'))
story.append(Spacer(1, 3*mm))

# Top: Users
users_block = [[Paragraph('<b>Telegram Users</b><br/>\u041a\u043b\u0438\u0435\u043d\u0442\u044b / \u041c\u0430\u0441\u0442\u0435\u0440\u0430 / \u0410\u0434\u043c\u0438\u043d\u044b / \u0421\u0438\u0441\u0430\u0434\u043c\u0438\u043d\u044b', s('ub', fontSize=11, alignment=TA_CENTER, textColor=C_WHITE))]]
users_tbl = Table(users_block, colWidths=[W])
users_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), C_ACCENT),
    ('TOPPADDING', (0,0), (-1,-1), 8),
    ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ('ALIGN', (0,0), (-1,-1), 'CENTER'),
    ('ROUNDEDCORNERS', [6,6,6,6]),
]))
story.append(users_tbl)
story.append(Spacer(1, 2*mm))
story.append(Paragraph('\u25bc  POST /webhook/:botId', s('arr', fontSize=10, alignment=TA_CENTER, textColor=C_GRAY)))
story.append(Spacer(1, 2*mm))

# Worker box — 3 rows
row1_data = [
    [Paragraph('<b>getCtx()</b><br/>Resolve Tenant<br/>\u043f\u043e botId', s('c1', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('<b>\u041c\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u044f</b><br/>/webhook \u2192 Telegram<br/>/stripe \u2192 Billing<br/>/admin \u2192 Dashboard<br/>Scheduled \u2192 Cron', s('c2', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('<b>HANDLERS</b><br/>message.js \u2014 \u0442\u0435\u043a\u0441\u0442\u044b<br/>callback.js \u2014 \u043a\u043d\u043e\u043f\u043a\u0438 (150+)<br/>cron.js \u2014 */15 \u043c\u0438\u043d', s('c3', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('<b>SERVICES</b><br/>appointments \u2014 \u0437\u0430\u043f\u0438\u0441\u0438<br/>users \u2014 \u043f\u0440\u043e\u0444\u0438\u043b\u0438<br/>state \u2014 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435<br/>google-calendar', s('c4', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER))]
]

worker_tbl = Table(row1_data, colWidths=[W*0.2, W*0.25, W*0.25, W*0.3])
worker_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), C_PRIMARY),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('LEFTPADDING', (0,0), (-1,-1), 8),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#2D4A6F')),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('BOX', (0,0), (-1,-1), 2, C_ACCENT),
]))

story.append(Paragraph('<b>CLOUDFLARE WORKER  (worker.js)</b>', s('wt', fontSize=12, alignment=TA_CENTER, textColor=C_ACCENT)))
story.append(Spacer(1, 1*mm))
story.append(worker_tbl)
story.append(Spacer(1, 2*mm))
story.append(Paragraph('\u25bc', s('arr2', fontSize=12, alignment=TA_CENTER, textColor=C_GRAY)))
story.append(Spacer(1, 2*mm))

# Storage + External
store_data = [
    [Paragraph('<b>Cloudflare KV</b><br/>\u041a\u0435\u0448, \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435, \u0441\u0435\u0441\u0441\u0438\u0438<br/>kvGet / kvPut / kvDel', s('st', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('<b>Cloudflare D1</b><br/>SQLite: \u0437\u0430\u043f\u0438\u0441\u0438, \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438<br/>dbGet / dbAll / dbRun', s('st2', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('<b>Telegram API</b><br/>\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f, \u043a\u043d\u043e\u043f\u043a\u0438,<br/>\u0444\u043e\u0442\u043e, webhook', s('st3', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('<b>Stripe API</b><br/>Checkout, \u043f\u043e\u0440\u0442\u0430\u043b,<br/>\u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0438, webhook', s('st4', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('<b>Google Calendar</b><br/>OAuth2 + Service Acc<br/>\u0414\u0432\u0443\u0441\u0442\u043e\u0440\u043e\u043d\u043d\u0438\u0439 \u0441\u0438\u043d\u0445\u0440', s('st5', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('<b>Workers AI</b><br/>LLM \u043c\u043e\u0434\u0435\u043b\u0438<br/>REST + Binding', s('st6', fontSize=9, textColor=C_WHITE, alignment=TA_CENTER))]
]
store_tbl = Table(store_data, colWidths=[W/6]*6)
store_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (1,0), C_GREEN),
    ('BACKGROUND', (2,0), (2,0), C_ACCENT),
    ('BACKGROUND', (3,0), (3,0), C_ACCENT2),
    ('BACKGROUND', (4,0), (4,0), C_ORANGE),
    ('BACKGROUND', (5,0), (5,0), C_RED),
    ('TOPPADDING', (0,0), (-1,-1), 8),
    ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ('GRID', (0,0), (-1,-1), 1, C_WHITE),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
]))
story.append(store_tbl)
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 5: Multi-tenancy
# ════════════════════════════════════════════════════════════
story.append(heading('\u041c\u0443\u043b\u044c\u0442\u0438\u0442\u0435\u043d\u0430\u043d\u0442\u043d\u043e\u0441\u0442\u044c'))
story.append(Spacer(1, 3*mm))

# Concept block
concept_data = [[
    Paragraph('<b>1 Salon = 1 Tenant = 1+ Bots</b>', s('cc', fontSize=14, alignment=TA_CENTER, textColor=C_WHITE))
]]
concept_tbl = Table(concept_data, colWidths=[W])
concept_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), C_ACCENT2),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
]))
story.append(concept_tbl)
story.append(Spacer(1, 4*mm))

# 3 info blocks side by side
tenant_info = [
    [Paragraph('<b>Tenant ID</b><br/>t_&lt;random&gt;<br/><br/><b>KV \u043a\u043b\u044e\u0447\u0438:</b><br/>t:{tenantId}:...<br/><br/><b>D1 \u0442\u0430\u0431\u043b\u0438\u0446\u044b:</b><br/>tenants, bots, tenant_roles', s('ti', fontSize=9, textColor=C_PRIMARY)),
     Paragraph('<b>\u0420\u0435\u0437\u043e\u043b\u044e\u0446\u0438\u044f \u0440\u043e\u043b\u0435\u0439</b><br/><br/>1. Platform roles (D1: platform_roles)<br/>\u2193<br/>2. Tenant roles (D1: tenant_roles)<br/>\u2193<br/>3. Client (\u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e)<br/><br/><b>\u0424\u0443\u043d\u043a\u0446\u0438\u044f:</b> resolveRole(ctx, chatId)', s('ti2', fontSize=9, textColor=C_PRIMARY)),
     Paragraph('<b>\u041a\u043e\u043d\u0442\u0435\u043a\u0441\u0442 (ctx)</b><br/><br/>buildTenantCtx(env, resolved):<br/>  \u2022 ctx.kv = KV namespace<br/>  \u2022 ctx.db = D1 database<br/>  \u2022 ctx.prefix = "t:{id}:"<br/>  \u2022 ctx.tenantId<br/>  \u2022 ctx.botToken<br/>  \u2022 ...env vars', s('ti3', fontSize=9, textColor=C_PRIMARY))]
]
ti_tbl = Table(tenant_info, colWidths=[W*0.3, W*0.35, W*0.35])
ti_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), C_LIGHTER),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('LEFTPADDING', (0,0), (-1,-1), 10),
    ('GRID', (0,0), (-1,-1), 1, C_LIGHT),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
]))
story.append(ti_tbl)
story.append(Spacer(1, 6*mm))

# Roles table
story.append(heading('\u0422\u0430\u0431\u043b\u0438\u0446\u0430 \u0440\u043e\u043b\u0435\u0439', 2))
roles_h = ['\u0423\u0440\u043e\u0432\u0435\u043d\u044c', '\u0420\u043e\u043b\u044c', '\u0414\u043e\u0441\u0442\u0443\u043f']
roles_r = [
    ['\u041f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430', 'system_admin', '\u041f\u043e\u043b\u043d\u044b\u0439 \u0434\u043e\u0441\u0442\u0443\u043f \u043a\u043e \u0432\u0441\u0435\u0439 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0435: \u0442\u0435\u043d\u0430\u043d\u0442\u044b, \u0431\u043e\u0442\u044b, \u0430\u0433\u0435\u043d\u0442\u044b'],
    ['\u041f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430', 'support', '\u0422\u0438\u043a\u0435\u0442\u044b \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0438 \u0441\u043e \u0432\u0441\u0435\u0445 \u0441\u0430\u043b\u043e\u043d\u043e\u0432'],
    ['\u041f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430', 'technical_support', '\u0422\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0442\u0438\u043a\u0435\u0442\u044b'],
    ['\u0422\u0435\u043d\u0430\u043d\u0442', 'tenant_owner', '\u0412\u043b\u0430\u0434\u0435\u043b\u0435\u0446 \u0441\u0430\u043b\u043e\u043d\u0430: \u043c\u0430\u0441\u0442\u0435\u0440\u0430, \u0443\u0441\u043b\u0443\u0433\u0438, \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438, \u0431\u0438\u043b\u043b\u0438\u043d\u0433'],
    ['\u0422\u0435\u043d\u0430\u043d\u0442', 'master', '\u041c\u0430\u0441\u0442\u0435\u0440: \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0438\u0441\u0435\u0439, \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c, \u043e\u0442\u043f\u0443\u0441\u043a'],
    ['\u041f\u043e \u0443\u043c\u043e\u043b\u0447.', 'client', '\u041a\u043b\u0438\u0435\u043d\u0442: \u0437\u0430\u043f\u0438\u0441\u044c, \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440, \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0430'],
]
story.append(make_table(roles_h, roles_r, col_widths=[45*mm, 55*mm, W - 100*mm], mono_cols={1}))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 6: Billing
# ════════════════════════════════════════════════════════════
story.append(heading('\u0411\u0438\u043b\u043b\u0438\u043d\u0433 \u0438 \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0438 (Stripe)'))
story.append(Spacer(1, 3*mm))

plans_h = ['\u041f\u043b\u0430\u043d', '\u041c\u0430\u0441\u0442\u0435\u0440\u043e\u0432', 'AI', '\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0430', '\u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c', 'White-label']
plans_r = [
    ['START', '1', '\u2014', '\u2014', '\u2014', '\u2014'],
    ['PRO',   '5', '\u2713', '\u2713', '\u2713', '\u2014'],
    ['STUDIO', '\u221e', '\u2713', '\u2713', '\u2713', '\u2713'],
]
story.append(make_table(plans_h, plans_r, col_widths=[40*mm, 35*mm, 30*mm, 35*mm, 35*mm, W - 175*mm]))
story.append(Spacer(1, 6*mm))

story.append(heading('\u0416\u0438\u0437\u043d\u0435\u043d\u043d\u044b\u0439 \u0446\u0438\u043a\u043b \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0438', 2))
story.append(Spacer(1, 2*mm))

lifecycle_data = [
    [Paragraph('<b>trialing</b><br/>7 \u0434\u043d\u0435\u0439 \u0431\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u043e', s('lc', fontSize=10, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('\u2192', s('ar', fontSize=18, alignment=TA_CENTER, textColor=C_GRAY)),
     Paragraph('<b>active</b><br/>\u041e\u043f\u043b\u0430\u0447\u0435\u043d\u043e', s('lc2', fontSize=10, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('\u2192', s('ar2', fontSize=18, alignment=TA_CENTER, textColor=C_GRAY)),
     Paragraph('<b>grace_period</b><br/>7 \u0434\u043d\u0435\u0439 \u043f\u043e\u0441\u043b\u0435<br/>\u043d\u0435\u0443\u0434\u0430\u0447\u043d\u043e\u0439 \u043e\u043f\u043b\u0430\u0442\u044b', s('lc3', fontSize=10, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('\u2192', s('ar3', fontSize=18, alignment=TA_CENTER, textColor=C_GRAY)),
     Paragraph('<b>inactive</b><br/>\u0417\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d', s('lc4', fontSize=10, textColor=C_WHITE, alignment=TA_CENTER))]
]
lc_tbl = Table(lifecycle_data, colWidths=[W*0.18, W*0.04, W*0.15, W*0.04, W*0.25, W*0.04, W*0.18])
lc_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (0,0), C_ACCENT),
    ('BACKGROUND', (2,0), (2,0), C_GREEN),
    ('BACKGROUND', (4,0), (4,0), C_ORANGE),
    ('BACKGROUND', (6,0), (6,0), C_RED),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(lc_tbl)
story.append(Spacer(1, 6*mm))

story.append(heading('Stripe \u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u044f', 2))
stripe_h = ['\u041a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442', '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435']
stripe_r = [
    ['Webhook', '/stripe/webhook \u2014 \u043f\u043e\u0434\u043f\u0438\u0441\u044c \u0432\u0435\u0440\u0438\u0444\u0438\u0446\u0438\u0440\u0443\u0435\u0442\u0441\u044f \u0447\u0435\u0440\u0435\u0437 HMAC-SHA256'],
    ['\u0421\u043e\u0431\u044b\u0442\u0438\u044f', 'subscription.updated, subscription.deleted, invoice.payment_failed'],
    ['Checkout', 'Stripe Checkout Session \u2192 \u041f\u043e\u0434\u043f\u0438\u0441\u043a\u0430 \u2192 D1 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435'],
    ['\u041f\u043e\u0440\u0442\u0430\u043b', 'Customer Portal \u0434\u043b\u044f \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u043e\u0439'],
    ['Feature gating', 'canUse(ctx, feature) \u2014 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043f\u043e \u043f\u043b\u0430\u043d\u0443'],
]
story.append(make_table(stripe_h, stripe_r, col_widths=[55*mm, W - 55*mm]))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 7: Booking Flow
# ════════════════════════════════════════════════════════════
story.append(heading('\u041f\u0440\u043e\u0446\u0435\u0441\u0441 \u0437\u0430\u043f\u0438\u0441\u0438 (Booking Flow)'))
story.append(Spacer(1, 3*mm))

steps = [
    ['1', '\u0412\u044b\u0431\u043e\u0440 \u0443\u0441\u043b\u0443\u0433\u0438', '\u041a\u043b\u0438\u0435\u043d\u0442 \u043d\u0430\u0436\u0438\u043c\u0430\u0435\u0442 "\u0417\u0430\u043f\u0438\u0441\u0430\u0442\u044c\u0441\u044f" \u2192 \u0441\u043f\u0438\u0441\u043e\u043a \u0443\u0441\u043b\u0443\u0433 (classic, gel, pedi, ext, design, combo)', 'ui/booking.js'],
    ['2', '\u0412\u044b\u0431\u043e\u0440 \u0434\u0430\u0442\u044b', '\u041a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044c \u0441 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u043c\u0438 \u0434\u043d\u044f\u043c\u0438 (30 \u0434\u043d\u0435\u0439 \u0432\u043f\u0435\u0440\u0451\u0434)', 'ui/keyboards.js'],
    ['3', '\u0412\u044b\u0431\u043e\u0440 \u0432\u0440\u0435\u043c\u0435\u043d\u0438', '\u0421\u043b\u043e\u0442\u044b \u043f\u043e 30 \u043c\u0438\u043d (9:00\u201319:00). \u0423\u0447\u0451\u0442: \u0437\u0430\u043f\u0438\u0441\u0438, \u043e\u0442\u043f\u0443\u0441\u043a, Google Calendar', 'services/appointments.js'],
    ['4', '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435', '\u0421\u0442\u0430\u0442\u0443\u0441: pending. \u0423\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435 \u043c\u0430\u0441\u0442\u0435\u0440\u0430\u043c', 'notifications.js'],
    ['5', '\u0420\u0435\u0430\u043a\u0446\u0438\u044f \u043c\u0430\u0441\u0442\u0435\u0440\u0430', '\u041a\u043d\u043e\u043f\u043a\u0438: \u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c / \u041e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c / \u041f\u0440\u0435\u0434\u043b\u043e\u0436\u0438\u0442\u044c \u0434\u0440\u0443\u0433\u043e\u0435 \u0432\u0440\u0435\u043c\u044f', 'handlers/callback.js'],
    ['6', '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043e', '\u0421\u0442\u0430\u0442\u0443\u0441: confirmed. Google Calendar event. \u041a\u043b\u0438\u0435\u043d\u0442\u0443 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435', 'services/calendar.js'],
    ['7', '\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f', 'Cron: \u0437\u0430 24\u0447 \u0438 \u0437\u0430 2\u0447 \u0434\u043e \u0437\u0430\u043f\u0438\u0441\u0438', 'handlers/cron.js'],
]
story.append(make_table(
    ['\u2116', '\u0428\u0430\u0433', '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435', '\u0424\u0430\u0439\u043b'],
    steps,
    col_widths=[12*mm, 50*mm, W - 112*mm, 50*mm],
    mono_cols={3}
))
story.append(Spacer(1, 6*mm))

story.append(heading('\u0421\u0442\u0430\u0442\u0443\u0441\u044b \u0437\u0430\u043f\u0438\u0441\u0438', 2))
status_h = ['\u0421\u0442\u0430\u0442\u0443\u0441', '\u0417\u043d\u0430\u0447\u0435\u043d\u0438\u0435', '\u041f\u0435\u0440\u0435\u0445\u043e\u0434\u044b']
status_r = [
    ['pending', '\u041d\u043e\u0432\u0430\u044f, \u0436\u0434\u0451\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u043c\u0430\u0441\u0442\u0435\u0440\u0430', '\u2192 confirmed / rejected / counter / cancelled'],
    ['confirmed', '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430 \u043c\u0430\u0441\u0442\u0435\u0440\u043e\u043c', '\u2192 cancelled'],
    ['counter', '\u041c\u0430\u0441\u0442\u0435\u0440 \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0438\u043b \u0434\u0440\u0443\u0433\u043e\u0435 \u0432\u0440\u0435\u043c\u044f', '\u2192 confirmed / cancelled'],
    ['rejected', '\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0430 \u043c\u0430\u0441\u0442\u0435\u0440\u043e\u043c', '\u041a\u043e\u043d\u0435\u0447\u043d\u044b\u0439 \u0441\u0442\u0430\u0442\u0443\u0441'],
    ['cancelled', '\u041e\u0442\u043c\u0435\u043d\u0435\u043d\u0430 \u043a\u043b\u0438\u0435\u043d\u0442\u043e\u043c/\u0430\u0434\u043c\u0438\u043d\u043e\u043c', '\u041a\u043e\u043d\u0435\u0447\u043d\u044b\u0439 \u0441\u0442\u0430\u0442\u0443\u0441'],
]
story.append(make_table(status_h, status_r, col_widths=[40*mm, 80*mm, W - 120*mm], mono_cols={0}))

story.append(Spacer(1, 6*mm))
story.append(heading('\u0423\u0441\u043b\u0443\u0433\u0438 \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e', 2))
svc_h = ['ID', 'Emoji', '\u0414\u043b\u0438\u0442. (\u043c\u0438\u043d)', '\u0426\u0435\u043d\u0430']
svc_r = [
    ['classic', '\u0001f485', '60', '80'],
    ['gel', '\u0001f48e', '90', '140'],
    ['pedi', '\u0001f9b6', '90', '120'],
    ['ext', '\u2728', '120', '250'],
    ['design', '\u0001f3a8', '30', '50'],
    ['combo', '\u0001f451', '150', '220'],
]
story.append(make_table(svc_h, svc_r, col_widths=[45*mm, 30*mm, 50*mm, W - 125*mm], mono_cols={0}))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 8: AI
# ════════════════════════════════════════════════════════════
story.append(heading('AI-\u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u044f (Workers AI)'))
story.append(Spacer(1, 3*mm))

story.append(heading('\u0426\u0435\u043f\u043e\u0447\u043a\u0430 \u043c\u043e\u0434\u0435\u043b\u0435\u0439 (fallback)', 2))
models_h = ['\u041f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442', '\u041c\u043e\u0434\u0435\u043b\u044c', '\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435']
models_r = [
    ['1 (\u043e\u0441\u043d\u043e\u0432\u043d\u0430\u044f)', '@cf/openai/gpt-oss-120b', '\u041e\u0441\u043d\u043e\u0432\u043d\u0430\u044f \u043c\u043e\u0434\u0435\u043b\u044c, \u043d\u0430\u0438\u043b\u0443\u0447\u0448\u0435\u0435 \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u043e'],
    ['2 (\u0437\u0430\u043f\u0430\u0441\u043d\u0430\u044f)', '@cf/meta/llama-4-scout-17b', '\u0411\u044b\u0441\u0442\u0440\u0430\u044f \u043c\u043e\u0434\u0435\u043b\u044c Meta'],
    ['3 (\u0440\u0435\u0437\u0435\u0440\u0432)', '@cf/meta/llama-3.1-8b-instruct', '\u041b\u0451\u0433\u043a\u0430\u044f \u043c\u043e\u0434\u0435\u043b\u044c, \u043c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u0430\u044f \u043b\u0430\u0442\u0435\u043d\u0442\u043d\u043e\u0441\u0442\u044c'],
]
story.append(make_table(models_h, models_r, col_widths=[45*mm, 80*mm, W - 125*mm], mono_cols={1}))
story.append(Spacer(1, 5*mm))

story.append(heading('\u041a\u0430\u043a \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 AI', 2))
ai_flow = [
    ['1', '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u043f\u0438\u0448\u0435\u0442 \u0442\u0435\u043a\u0441\u0442', '\u0422\u0435\u043a\u0441\u0442\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0432 Telegram'],
    ['2', 'Regex-\u043f\u0430\u0442\u0442\u0435\u0440\u043d\u044b', '50+ regex \u043f\u0440\u043e\u0432\u0435\u0440\u044f\u044e\u0442 \u043d\u0430\u043c\u0435\u0440\u0435\u043d\u0438\u0435 (RU, UA, EN, PL)'],
    ['3', 'AI \u0430\u043d\u0430\u043b\u0438\u0437', '\u0415\u0441\u043b\u0438 regex \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u043b \u2192 Workers AI \u0441 \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u043e\u043c \u0441\u0430\u043b\u043e\u043d\u0430'],
    ['4', '\u0422\u0435\u0433\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439', 'AI \u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0442\u0435\u0433\u0438: [BOOK:classic], [MY_APTS]...'],
    ['5', '\u0418\u0441\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435', 'executeAIAction() \u043f\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0442\u0435\u0433\u0438 \u0432 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u0431\u043e\u0442\u0430'],
]
story.append(make_table(['\u2116', '\u0428\u0430\u0433', '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435'], ai_flow, col_widths=[12*mm, 55*mm, W - 67*mm]))
story.append(Spacer(1, 5*mm))

story.append(heading('\u041e\u0441\u043d\u043e\u0432\u043d\u044b\u0435 AI-\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f', 2))
actions_h = ['\u0422\u0435\u0433', '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435']
actions_r = [
    ['[MY_APTS]', '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u0438 \u043a\u043b\u0438\u0435\u043d\u0442\u0430'],
    ['[BOOK:svcId:date:time]', '\u041d\u0430\u0447\u0430\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u044c \u043d\u0430 \u0443\u0441\u043b\u0443\u0433\u0443'],
    ['[PRICES]', '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043f\u0440\u0430\u0439\u0441-\u043b\u0438\u0441\u0442'],
    ['[CONTACTS]', '\u041a\u043e\u043d\u0442\u0430\u043a\u0442\u044b \u0441\u0430\u043b\u043e\u043d\u0430 (Instagram, \u0442\u0435\u043b\u0435\u0444\u043e\u043d)'],
    ['[CANCEL_ALL]', '\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c \u0432\u0441\u0435 \u0437\u0430\u043f\u0438\u0441\u0438 \u043a\u043b\u0438\u0435\u043d\u0442\u0430'],
    ['[CONSULT]', '\u0417\u0430\u043f\u0440\u043e\u0441\u0438\u0442\u044c \u043a\u043e\u043d\u0441\u0443\u043b\u044c\u0442\u0430\u043d\u0442\u0430'],
    ['[ADM_PANEL]', '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0430\u0434\u043c\u0438\u043d-\u043f\u0430\u043d\u0435\u043b\u044c'],
    ['[MST_CALENDAR]', '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044f \u043c\u0430\u0441\u0442\u0435\u0440\u0430'],
    ['[SYSADM_PANEL]', '\u041f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0435\u043d\u043d\u044b\u0439 \u0430\u0434\u043c\u0438\u043d'],
    ['[LANG:xx]', '\u0421\u043c\u0435\u043d\u0438\u0442\u044c \u044f\u0437\u044b\u043a \u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430'],
]
story.append(make_table(actions_h, actions_r, col_widths=[70*mm, W - 70*mm], mono_cols={0}))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 9: Google Calendar
# ════════════════════════════════════════════════════════════
story.append(heading('Google Calendar \u0438\u043d\u0442\u0435\u0433\u0440\u0430\u0446\u0438\u044f'))
story.append(Spacer(1, 3*mm))

# Two modes side by side
gcal_data = [
    [Paragraph('<b>Service Account</b><br/><br/>\u041c\u0430\u0441\u0442\u0435\u0440 \u0434\u0430\u0451\u0442 Calendar ID<br/>\u0411\u043e\u0442 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442 \u0441\u0435\u0440\u0432\u0438\u0441\u043d\u044b\u0439 \u0430\u043a\u043a\u0430\u0443\u043d\u0442<br/><br/>\u041f\u0440\u043e\u0441\u0442\u0430\u044f \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0430<br/>\u041d\u0443\u0436\u0435\u043d \u0434\u043e\u0441\u0442\u0443\u043f \u043a \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044e', s('gc1', fontSize=10, textColor=C_PRIMARY)),
     Paragraph('<b>OAuth2</b><br/><br/>\u041c\u0430\u0441\u0442\u0435\u0440 \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0443\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 Google<br/>\u0411\u043e\u0442 \u0445\u0440\u0430\u043d\u0438\u0442 \u0437\u0430\u0448\u0438\u0444\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0439 refresh token<br/><br/>\u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u044b\u0439 \u0440\u0435\u0436\u0438\u043c<br/>AES-GCM \u0448\u0438\u0444\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0442\u043e\u043a\u0435\u043d\u043e\u0432 \u0432 D1', s('gc2', fontSize=10, textColor=C_PRIMARY))]
]
gcal_tbl = Table(gcal_data, colWidths=[W*0.5, W*0.5])
gcal_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (0,0), HexColor('#FFF7ED')),
    ('BACKGROUND', (1,0), (1,0), HexColor('#EFF6FF')),
    ('TOPPADDING', (0,0), (-1,-1), 12),
    ('BOTTOMPADDING', (0,0), (-1,-1), 12),
    ('LEFTPADDING', (0,0), (-1,-1), 12),
    ('GRID', (0,0), (-1,-1), 1, C_LIGHT),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
]))
story.append(gcal_tbl)
story.append(Spacer(1, 5*mm))

story.append(heading('\u0414\u0432\u0443\u0441\u0442\u043e\u0440\u043e\u043d\u043d\u044f\u044f \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u044f', 2))
sync_h = ['\u041d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435', '\u0422\u0440\u0438\u0433\u0433\u0435\u0440', '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435']
sync_r = [
    ['\u0418\u0441\u0445\u043e\u0434\u044f\u0449\u0430\u044f \u2192', '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0438\u0441\u0438', '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 Google Calendar event'],
    ['\u0418\u0441\u0445\u043e\u0434\u044f\u0449\u0430\u044f \u2192', '\u0418\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0435 \u0437\u0430\u043f\u0438\u0441\u0438', '\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 / \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435 event'],
    ['\u2190 \u0412\u0445\u043e\u0434\u044f\u0449\u0430\u044f', 'Cron (*/15 \u043c\u0438\u043d)', '\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 busy-\u0431\u043b\u043e\u043a\u043e\u0432 \u2192 \u0438\u0441\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u0438\u0437 \u0441\u043b\u043e\u0442\u043e\u0432'],
    ['\u2190 \u0412\u0445\u043e\u0434\u044f\u0449\u0430\u044f', '\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 watch', '\u0410\u0432\u0442\u043e-\u043f\u0440\u043e\u0434\u043b\u0435\u043d\u0438\u0435 \u043a\u0430\u0436\u0434\u044b\u0435 ~2.5 \u0434\u043d\u044f'],
]
story.append(make_table(sync_h, sync_r, col_widths=[50*mm, 60*mm, W - 110*mm]))
story.append(Spacer(1, 5*mm))

story.append(heading('OAuth2 Flow', 2))
oauth_steps = [
    ['1', '\u041c\u0430\u0441\u0442\u0435\u0440 \u043d\u0430\u0436\u0438\u043c\u0430\u0435\u0442 "\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c Google Calendar"'],
    ['2', '\u0420\u0435\u0434\u0438\u0440\u0435\u043a\u0442 \u043d\u0430 Google OAuth consent screen'],
    ['3', 'Callback \u2192 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435 refresh token (\u0437\u0430\u0448\u0438\u0444\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0433\u043e \u0432 D1)'],
    ['4', '\u0412\u044b\u0431\u043e\u0440 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044f \u0438\u0437 \u0441\u043f\u0438\u0441\u043a\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445'],
    ['5', '\u0414\u0432\u0443\u0441\u0442\u043e\u0440\u043e\u043d\u043d\u044f\u044f \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u044f \u0430\u043a\u0442\u0438\u0432\u043d\u0430'],
]
story.append(make_table(['\u2116', '\u0428\u0430\u0433'], oauth_steps, col_widths=[12*mm, W - 12*mm]))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 10: Storage
# ════════════════════════════════════════════════════════════
story.append(heading('\u0425\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0435 \u0434\u0430\u043d\u043d\u044b\u0445'))
story.append(Spacer(1, 3*mm))

story.append(heading('KV Namespace \u2014 \u0431\u044b\u0441\u0442\u0440\u044b\u0439 \u043a\u0435\u0448 \u0438 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435', 2))
kv_h = ['\u041a\u043b\u044e\u0447', 'TTL', '\u0414\u0430\u043d\u043d\u044b\u0435']
kv_r = [
    ['t:{id}:state:{chatId}', '2\u0447', '\u0428\u0430\u0433 \u0434\u0438\u0430\u043b\u043e\u0433\u0430 (\u043c\u0430\u0448\u0438\u043d\u0430 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0439)'],
    ['t:{id}:chat:{chatId}', '1\u0447', '\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0447\u0430\u0442\u0430 (8 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439 \u0434\u043b\u044f AI)'],
    ['t:{id}:rl:{chatId}', '60\u0441', 'Rate limit \u0441\u0447\u0451\u0442\u0447\u0438\u043a'],
    ['t:{id}:lang:{chatId}', '\u221e', '\u042f\u0437\u044b\u043a \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f (ru/ua/en/pl)'],
    ['t:{id}:master:{chatId}', '\u221e', '\u041f\u0440\u043e\u0444\u0438\u043b\u044c \u043c\u0430\u0441\u0442\u0435\u0440\u0430 (JSON)'],
    ['t:{id}:ap:{aptId}', '\u221e', '\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442 \u0437\u0430\u043f\u0438\u0441\u0438 (JSON)'],
    ['t:{id}:all:YYYY-MM', '\u221e', '\u0421\u043f\u0438\u0441\u043e\u043a aptId \u0437\u0430 \u043c\u0435\u0441\u044f\u0446'],
    ['t:{id}:d:YYYY-MM-DD', '\u221e', '\u0421\u043f\u0438\u0441\u043e\u043a aptId \u0437\u0430 \u0434\u0435\u043d\u044c'],
    ['t:{id}:u:{chatId}', '\u221e', '\u041f\u0440\u043e\u0444\u0438\u043b\u044c \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f (JSON)'],
    ['t:{id}:blocked:{chatId}', '\u221e', '\u041c\u0430\u0440\u043a\u0435\u0440 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0433\u043e'],
]
story.append(make_table(kv_h, kv_r, col_widths=[65*mm, 20*mm, W - 85*mm], mono_cols={0}))
story.append(Spacer(1, 5*mm))

story.append(heading('D1 Database \u2014 \u0440\u0435\u043b\u044f\u0446\u0438\u043e\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435', 2))
d1_h = ['\u0422\u0430\u0431\u043b\u0438\u0446\u0430', '\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435', '\u041a\u043b\u044e\u0447\u0435\u0432\u044b\u0435 \u043f\u043e\u043b\u044f']
d1_r = [
    ['tenants', '\u0421\u0430\u043b\u043e\u043d\u044b', 'id, name, plan, billingStatus, stripeCustomerId'],
    ['bots', '\u0420\u0435\u0435\u0441\u0442\u0440 \u0431\u043e\u0442\u043e\u0432', 'bot_id, tenant_id, bot_token (encrypted), active'],
    ['platform_roles', '\u0413\u043b\u043e\u0431\u0430\u043b\u044c\u043d\u044b\u0435 \u0440\u043e\u043b\u0438', 'chat_id, role'],
    ['tenant_roles', '\u0422\u0435\u043d\u0430\u043d\u0442\u043d\u044b\u0435 \u0440\u043e\u043b\u0438', 'tenant_id, chat_id, role'],
    ['appointments', '\u0417\u0430\u043f\u0438\u0441\u0438', 'id, tenant_id, chat_id, svc_id, date, time, status'],
    ['masters', '\u041c\u0430\u0441\u0442\u0435\u0440\u0430', 'tenant_id, chat_id, name, services, work_hours'],
    ['services', '\u0423\u0441\u043b\u0443\u0433\u0438', 'tenant_id, service_id, name, price, duration'],
    ['google_integrations', 'Google Calendar', 'id, tenant_id, calendar_id, refresh_token_enc'],
    ['google_busy_blocks', '\u0417\u0430\u043d\u044f\u0442\u044b\u0435 \u0431\u043b\u043e\u043a\u0438', 'integration_id, event_id, start_ts, end_ts'],
    ['local_tickets', '\u0422\u0438\u043a\u0435\u0442\u044b \u0432 \u0441\u0430\u043b\u043e\u043d\u0435', 'tenant_id, client_cid, master_cid, open'],
]
story.append(make_table(d1_h, d1_r, col_widths=[55*mm, 55*mm, W - 110*mm], mono_cols={0, 2}))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 11: i18n
# ════════════════════════════════════════════════════════════
story.append(heading('\u0418\u043d\u0442\u0435\u0440\u043d\u0430\u0446\u0438\u043e\u043d\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f (i18n)'))
story.append(Spacer(1, 3*mm))

# Languages
lang_data = [
    [Paragraph('<b>\u0420\u0443\u0441\u0441\u043a\u0438\u0439</b><br/>ru', s('ln', fontSize=12, alignment=TA_CENTER, textColor=C_WHITE)),
     Paragraph('<b>\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430</b><br/>ua', s('ln2', fontSize=12, alignment=TA_CENTER, textColor=C_WHITE)),
     Paragraph('<b>English</b><br/>en', s('ln3', fontSize=12, alignment=TA_CENTER, textColor=C_WHITE)),
     Paragraph('<b>Polski</b><br/>pl', s('ln4', fontSize=12, alignment=TA_CENTER, textColor=C_WHITE))]
]
lang_tbl = Table(lang_data, colWidths=[W*0.25]*4)
lang_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (0,0), C_RED),
    ('BACKGROUND', (1,0), (1,0), C_ACCENT),
    ('BACKGROUND', (2,0), (2,0), C_GREEN),
    ('BACKGROUND', (3,0), (3,0), C_ACCENT2),
    ('TOPPADDING', (0,0), (-1,-1), 12),
    ('BOTTOMPADDING', (0,0), (-1,-1), 12),
    ('GRID', (0,0), (-1,-1), 2, C_WHITE),
]))
story.append(lang_tbl)
story.append(Spacer(1, 5*mm))

story.append(heading('12 \u043c\u043e\u0434\u0443\u043b\u0435\u0439 \u043d\u0430 \u043a\u0430\u0436\u0434\u044b\u0439 \u044f\u0437\u044b\u043a', 2))
i18n_h = ['\u041c\u043e\u0434\u0443\u043b\u044c', '\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435']
i18n_r = [
    ['admin.js', '\u0421\u0442\u0440\u043e\u043a\u0438 \u0430\u0434\u043c\u0438\u043d-\u043f\u0430\u043d\u0435\u043b\u0438'],
    ['billing.js', '\u0421\u0442\u0440\u043e\u043a\u0438 \u0431\u0438\u043b\u043b\u0438\u043d\u0433\u0430 \u0438 \u043e\u043f\u043b\u0430\u0442\u044b'],
    ['booking.js', '\u041f\u0440\u043e\u0446\u0435\u0441\u0441 \u0437\u0430\u043f\u0438\u0441\u0438'],
    ['gcal.js', 'Google Calendar \u0441\u0442\u0440\u043e\u043a\u0438'],
    ['general.js', '\u041e\u0431\u0449\u0438\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f'],
    ['master.js', '\u0421\u0442\u0440\u043e\u043a\u0438 \u0434\u043b\u044f \u043c\u0430\u0441\u0442\u0435\u0440\u043e\u0432'],
    ['menu.js', '\u041c\u0435\u0442\u043a\u0438 \u043c\u0435\u043d\u044e'],
    ['meta.js', '\u041c\u0435\u0442\u0430: \u0434\u043d\u0438 \u043d\u0435\u0434\u0435\u043b\u0438, \u043c\u0435\u0441\u044f\u0446\u044b'],
    ['screens.js', '\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0438 \u044d\u043a\u0440\u0430\u043d\u043e\u0432'],
    ['services.js', '\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u044f \u0443\u0441\u043b\u0443\u0433'],
    ['support.js', '\u0422\u0438\u043a\u0435\u0442\u044b \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0438'],
    ['sysadmin.js', '\u041f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0435\u043d\u043d\u044b\u0439 \u0430\u0434\u043c\u0438\u043d'],
]
story.append(make_table(i18n_h, i18n_r, col_widths=[50*mm, W - 50*mm], mono_cols={0}))
story.append(Spacer(1, 5*mm))

story.append(heading('\u041c\u0435\u0445\u0430\u043d\u0438\u0437\u043c', 2))
mech_data = [
    [Paragraph('<b>t(lang, key)</b> \u2192 \u043f\u043e\u0438\u0441\u043a \u0432 \u043c\u043e\u0434\u0443\u043b\u0435 \u044f\u0437\u044b\u043a\u0430 \u2192 fallback \u043d\u0430 \u0440\u0443\u0441\u0441\u043a\u0438\u0439<br/><br/>'
               '<b>detectLang(text)</b> \u2192 \u0430\u0432\u0442\u043e\u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0438\u0435 \u043f\u043e \u043f\u0435\u0440\u0432\u043e\u043c\u0443 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044e<br/><br/>'
               '<b>fill(template, vars)</b> \u2192 \u043f\u043e\u0434\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430 \u043f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0445 \u0432 \u0448\u0430\u0431\u043b\u043e\u043d\u044b',
               s('mc', fontSize=10, textColor=C_PRIMARY))]
]
mech_tbl = Table(mech_data, colWidths=[W])
mech_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), C_LIGHTER),
    ('TOPPADDING', (0,0), (-1,-1), 12),
    ('BOTTOMPADDING', (0,0), (-1,-1), 12),
    ('LEFTPADDING', (0,0), (-1,-1), 15),
    ('BOX', (0,0), (-1,-1), 1, C_LIGHT),
]))
story.append(mech_tbl)
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 12: Testing & Deploy
# ════════════════════════════════════════════════════════════
story.append(heading('\u0422\u0435\u0441\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0438 \u0434\u0435\u043f\u043b\u043e\u0439'))
story.append(Spacer(1, 3*mm))

story.append(heading('\u0422\u0435\u0441\u0442\u044b (Vitest 4.x, 40+ \u0444\u0430\u0439\u043b\u043e\u0432)', 2))
test_h = ['\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u044f', '\u0424\u0430\u0439\u043b\u044b', '\u0427\u0442\u043e \u0442\u0435\u0441\u0442\u0438\u0440\u0443\u0435\u0442']
test_r = [
    ['\u0417\u0430\u043f\u0438\u0441\u0438', 'appointments-flow, calendar-sync', '\u0412\u0435\u0441\u044c \u0436\u0438\u0437\u043d\u0435\u043d\u043d\u044b\u0439 \u0446\u0438\u043a\u043b \u0437\u0430\u043f\u0438\u0441\u0438'],
    ['\u041a\u043d\u043e\u043f\u043a\u0438', 'button-logic, all-roles-callbacks', '150+ callback \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a\u043e\u0432'],
    ['AI', 'ai-callbacks, ai-tenant-context', '\u041f\u0430\u0440\u0441\u0438\u043d\u0433 AI \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439'],
    ['\u0411\u0438\u043b\u043b\u0438\u043d\u0433', 'billing-features, lifecycle, webhooks', 'Stripe, \u043f\u043b\u0430\u043d\u044b, \u0444\u0438\u0447\u0438'],
    ['\u0420\u043e\u043b\u0438', 'routing-all-roles, sysadmin-protection', '\u0414\u043e\u0441\u0442\u0443\u043f \u043f\u043e \u0440\u043e\u043b\u044f\u043c'],
    ['i18n', 'i18n-integrity', '\u0412\u0441\u0435 \u044f\u0437\u044b\u043a\u0438 \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442 \u0432\u0441\u0435 \u043a\u043b\u044e\u0447\u0438'],
    ['\u0422\u0435\u043d\u0430\u043d\u0442\u044b', 'tenant-resolver, tenant', '\u041c\u0443\u043b\u044c\u0442\u0438\u0442\u0435\u043d\u0430\u043d\u0442\u043d\u043e\u0441\u0442\u044c'],
    ['\u0411\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c', 'security, worker-no-hardcoded-tokens', '\u0428\u0438\u0444\u0440\u043e\u0432\u0430\u043d\u0438\u0435, \u0442\u043e\u043a\u0435\u043d\u044b'],
    ['\u041f\u0430\u0442\u0442\u0435\u0440\u043d\u044b', 'patterns, patterns-extended', 'Regex \u0434\u043b\u044f \u043d\u0430\u043c\u0435\u0440\u0435\u043d\u0438\u0439'],
]
story.append(make_table(test_h, test_r, col_widths=[45*mm, 75*mm, W - 120*mm], mono_cols={1}))
story.append(Spacer(1, 5*mm))

story.append(heading('CI/CD Pipeline', 2))
deploy_data = [
    [Paragraph('<b>git push origin main</b>', s('d1', fontSize=11, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('\u2192', s('da', fontSize=16, alignment=TA_CENTER, textColor=C_GRAY)),
     Paragraph('<b>GitHub Actions</b><br/>npm test', s('d2', fontSize=11, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('\u2192', s('da2', fontSize=16, alignment=TA_CENTER, textColor=C_GRAY)),
     Paragraph('<b>Wrangler Deploy</b><br/>+ D1 \u043c\u0438\u0433\u0440\u0430\u0446\u0438\u0438', s('d3', fontSize=11, textColor=C_WHITE, alignment=TA_CENTER)),
     Paragraph('\u2192', s('da3', fontSize=16, alignment=TA_CENTER, textColor=C_GRAY)),
     Paragraph('<b>Cloudflare Worker</b><br/>Production', s('d4', fontSize=11, textColor=C_WHITE, alignment=TA_CENTER))]
]
deploy_tbl = Table(deploy_data, colWidths=[W*0.17, W*0.04, W*0.2, W*0.04, W*0.22, W*0.04, W*0.2])
deploy_tbl.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (0,0), C_PRIMARY),
    ('BACKGROUND', (2,0), (2,0), C_ACCENT),
    ('BACKGROUND', (4,0), (4,0), C_ACCENT2),
    ('BACKGROUND', (6,0), (6,0), C_GREEN),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
]))
story.append(deploy_tbl)
story.append(Spacer(1, 5*mm))

story.append(heading('Cron (\u043a\u0430\u0436\u0434\u044b\u0435 15 \u043c\u0438\u043d\u0443\u0442)', 2))
cron_h = ['\u0424\u0430\u0437\u0430', '\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435']
cron_r = [
    ['Phase 1', '\u041d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f \u043e \u0437\u0430\u043f\u0438\u0441\u044f\u0445 (\u0437\u0430 24\u0447 \u0438 \u0437\u0430 2\u0447)'],
    ['Phase 2', 'Retry \u0441\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u0438 Google Calendar (\u0435\u0441\u043b\u0438 \u043d\u0435\u0442 event_id)'],
    ['Phase 3', '\u041e\u0447\u0438\u0441\u0442\u043a\u0430 \u043e\u0442\u043c\u0435\u043d\u0451\u043d\u043d\u044b\u0445 \u0437\u0430\u043f\u0438\u0441\u0435\u0439 (\u0441\u0442\u0430\u0440\u0448\u0435 48\u0447)'],
]
story.append(make_table(cron_h, cron_r, col_widths=[40*mm, W - 40*mm]))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 13: Routes
# ════════════════════════════════════════════════════════════
story.append(heading('\u041c\u0430\u0440\u0448\u0440\u0443\u0442\u0438\u0437\u0430\u0446\u0438\u044f \u0437\u0430\u043f\u0440\u043e\u0441\u043e\u0432 (worker.js)'))
story.append(Spacer(1, 3*mm))

routes_h = ['\u041c\u0435\u0442\u043e\u0434', '\u041f\u0443\u0442\u044c', '\u041e\u0431\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a']
routes_r = [
    ['POST', '/webhook/:botId', 'Telegram webhook (\u043c\u0443\u043b\u044c\u0442\u0438\u0431\u043e\u0442)'],
    ['POST', '/stripe/webhook', 'Stripe \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0438, \u043e\u043f\u043b\u0430\u0442\u044b'],
    ['GET', '/stripe/success', '\u0423\u0441\u043f\u0435\u0448\u043d\u0430\u044f \u043e\u043f\u043b\u0430\u0442\u0430 (redirect)'],
    ['GET', '/admin/migrate', '\u041c\u0438\u0433\u0440\u0430\u0446\u0438\u044f legacy \u2192 multi-tenant'],
    ['GET', '/admin/seed', '\u0414\u0435\u043c\u043e-\u0434\u0430\u043d\u043d\u044b\u0435 \u0434\u043b\u044f \u0442\u0435\u0441\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f'],
    ['GET', '/setup', '\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f Telegram webhook'],
    ['GET', '/remove-webhook', '\u0423\u0434\u0430\u043b\u0435\u043d\u0438\u0435 webhook'],
    ['GET', '/admin', 'HTML \u0430\u0434\u043c\u0438\u043d-\u043f\u0430\u043d\u0435\u043b\u044c (Basic Auth)'],
    ['GET', '/admin/billing', '\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0431\u0438\u043b\u043b\u0438\u043d\u0433\u0430'],
    ['GET', '/calendar/:aptId.ics', '\u0421\u043a\u0430\u0447\u0430\u0442\u044c ICS \u0444\u0430\u0439\u043b'],
    ['GET', '/google/callback', 'Google OAuth2 callback'],
    ['GET', '/google/select', '\u0412\u044b\u0431\u043e\u0440 \u043a\u0430\u043b\u0435\u043d\u0434\u0430\u0440\u044f Google'],
    ['Scheduled', '*/15 * * * *', 'handleCron(): \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f, \u0441\u0438\u043d\u0445, \u043e\u0447\u0438\u0441\u0442\u043a\u0430'],
]
story.append(make_table(routes_h, routes_r, col_widths=[30*mm, 60*mm, W - 90*mm], mono_cols={0, 1}))
story.append(Spacer(1, 6*mm))

story.append(heading('\u041e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f (message.js)', 2))
msg_flow = [
    ['1', '\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u0442 \u0442\u0435\u043a\u0441\u0442 \u0432 Telegram'],
    ['2', 'Telegram webhook \u2192 POST /webhook/{botId}'],
    ['3', 'worker.js \u2192 getCtx() \u2192 resolve tenant'],
    ['4', 'onMsg(ctx, message) \u2192 \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430'],
    ['5', 'Pattern detection: regex (50+) \u2192 \u0435\u0441\u043b\u0438 \u043d\u0435\u0442 \u2192 AI'],
    ['6', 'AI \u0432\u043e\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0442\u0435\u0433\u0438: [MY_APTS], [BOOK:...]'],
    ['7', 'executeAIAction() \u2192 \u0432\u044b\u0437\u043e\u0432 \u0441\u0435\u0440\u0432\u0438\u0441\u043e\u0432'],
    ['8', '\u041e\u0442\u0432\u0435\u0442 \u0447\u0435\u0440\u0435\u0437 Telegram API + \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435 \u0438\u0441\u0442\u043e\u0440\u0438\u0438'],
]
story.append(make_table(['\u2116', '\u0428\u0430\u0433'], msg_flow, col_widths=[12*mm, W - 12*mm]))
story.append(PageBreak())

# ════════════════════════════════════════════════════════════
# PAGE 14: Secrets
# ════════════════════════════════════════════════════════════
story.append(heading('\u0421\u0435\u043a\u0440\u0435\u0442\u044b \u0438 \u043a\u043e\u043d\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044f'))
story.append(Spacer(1, 3*mm))

story.append(heading('Secrets (wrangler secret put)', 2))
secrets_h = ['\u041f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u0430\u044f', '\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435']
secrets_r = [
    ['BOT_TOKEN', 'Telegram bot token'],
    ['ADMIN_KEY', 'HTTP Basic Auth \u043f\u0430\u0440\u043e\u043b\u044c'],
    ['WEBHOOK_SECRET', 'Telegram webhook secret'],
    ['STRIPE_SECRET_KEY', 'Stripe API \u043a\u043b\u044e\u0447'],
    ['STRIPE_WEBHOOK_SECRET', 'Stripe webhook \u043f\u043e\u0434\u043f\u0438\u0441\u044c (HMAC)'],
    ['STRIPE_PRICE_*_MONTHLY', 'Price ID \u0434\u043b\u044f \u043f\u043b\u0430\u043d\u043e\u0432 START/PRO/STUDIO'],
    ['CLOUDFLARE_ACCOUNT_ID', 'Workers AI REST API'],
    ['WORKERS_AI_API_TOKEN', 'Workers AI \u0442\u043e\u043a\u0435\u043d'],
    ['GOOGLE_SERVICE_ACCOUNT_KEY', 'Google Calendar (base64 JSON)'],
    ['GOOGLE_OAUTH_CLIENT_ID', 'Google OAuth2 Client ID'],
    ['GOOGLE_OAUTH_CLIENT_SECRET', 'Google OAuth2 Client Secret'],
    ['GOOGLE_TOKEN_ENCRYPTION_KEY', '\u0428\u0438\u0444\u0440\u043e\u0432\u0430\u043d\u0438\u0435 refresh token (AES-GCM)'],
    ['BOT_ENCRYPTION_KEY', '\u0428\u0438\u0444\u0440\u043e\u0432\u0430\u043d\u0438\u0435 bot token \u0432 KV'],
]
story.append(make_table(secrets_h, secrets_r, col_widths=[75*mm, W - 75*mm], mono_cols={0}))
story.append(Spacer(1, 5*mm))

story.append(heading('Environment Variables (wrangler.toml)', 2))
env_h = ['\u041f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u0430\u044f', '\u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0438\u0435']
env_r = [
    ['APP_BASE_URL', '\u0411\u0430\u0437\u043e\u0432\u044b\u0439 URL \u0434\u043b\u044f callbacks'],
    ['LANDING_URL', '\u041b\u0435\u043d\u0434\u0438\u043d\u0433 (Cloudflare Pages)'],
    ['ADMIN_APP_URL', '\u0410\u0434\u043c\u0438\u043d\u043a\u0430 (Cloudflare Pages)'],
    ['ADMIN_CHAT_ID', 'Telegram ID \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0435\u043d\u043d\u043e\u0433\u043e \u0430\u0434\u043c\u0438\u043d\u0430'],
]
story.append(make_table(env_h, env_r, col_widths=[60*mm, W - 60*mm], mono_cols={0}))
story.append(Spacer(1, 5*mm))

story.append(heading('Cloudflare Bindings (wrangler.toml)', 2))
bind_h = ['\u0422\u0438\u043f', '\u0418\u043c\u044f', 'ID']
bind_r = [
    ['KV Namespace', 'MANICBOT', '62a7d16805e742918a82184e879537cc'],
    ['D1 Database', 'DB (manicbot-db)', '2c9bfdad-3dc0-4290-b26d-bcada6c02bfb'],
    ['Workers AI', 'AI', 'Built-in binding'],
]
story.append(make_table(bind_h, bind_r, col_widths=[45*mm, 55*mm, W - 100*mm], mono_cols={1, 2}))

# ── Build PDF ──
doc.build(story, onFirstPage=page_footer, onLaterPages=page_footer)
print(f'PDF saved: {OUT}')
