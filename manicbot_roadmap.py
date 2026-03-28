#!/usr/bin/env python3
"""
ManicBot Development Roadmap — PDF Generator
Professional roadmap document with status tables, weekly plans, priority matrix.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os

# ── Colors ──────────────────────────────────────────────────────────────────
NAVY = HexColor('#1a2744')
BLUE = HexColor('#2563eb')
BLUE_LIGHT = HexColor('#dbeafe')
BLUE_MED = HexColor('#93c5fd')
SLATE = HexColor('#334155')
SLATE_LIGHT = HexColor('#f1f5f9')
GRAY = HexColor('#64748b')
GREEN = HexColor('#16a34a')
GREEN_BG = HexColor('#f0fdf4')
YELLOW = HexColor('#d97706')
YELLOW_BG = HexColor('#fefce8')
RED = HexColor('#dc2626')
RED_BG = HexColor('#fef2f2')
WHITE = white

OUTPUT_PATH = '/Users/vdovin/Desktop/44444444/ManicBot_Roadmap_2026.pdf'

# ── Styles ──────────────────────────────────────────────────────────────────
def get_styles():
    s = {}
    s['title'] = ParagraphStyle('Title', fontName='Helvetica-Bold', fontSize=22, textColor=NAVY, spaceAfter=4, alignment=TA_LEFT)
    s['subtitle'] = ParagraphStyle('Subtitle', fontName='Helvetica', fontSize=13, textColor=GRAY, spaceAfter=16, alignment=TA_LEFT)
    s['h1'] = ParagraphStyle('H1', fontName='Helvetica-Bold', fontSize=16, textColor=NAVY, spaceBefore=18, spaceAfter=8)
    s['h2'] = ParagraphStyle('H2', fontName='Helvetica-Bold', fontSize=13, textColor=BLUE, spaceBefore=14, spaceAfter=6)
    s['h3'] = ParagraphStyle('H3', fontName='Helvetica-Bold', fontSize=11, textColor=SLATE, spaceBefore=10, spaceAfter=4)
    s['body'] = ParagraphStyle('Body', fontName='Helvetica', fontSize=9.5, textColor=SLATE, spaceAfter=4, leading=13)
    s['body_small'] = ParagraphStyle('BodySmall', fontName='Helvetica', fontSize=8.5, textColor=GRAY, spaceAfter=2, leading=11)
    s['cell'] = ParagraphStyle('Cell', fontName='Helvetica', fontSize=8.5, textColor=SLATE, leading=11)
    s['cell_bold'] = ParagraphStyle('CellBold', fontName='Helvetica-Bold', fontSize=8.5, textColor=SLATE, leading=11)
    s['cell_green'] = ParagraphStyle('CellGreen', fontName='Helvetica-Bold', fontSize=8.5, textColor=GREEN, leading=11)
    s['cell_yellow'] = ParagraphStyle('CellYellow', fontName='Helvetica-Bold', fontSize=8.5, textColor=YELLOW, leading=11)
    s['cell_red'] = ParagraphStyle('CellRed', fontName='Helvetica-Bold', fontSize=8.5, textColor=RED, leading=11)
    s['footer'] = ParagraphStyle('Footer', fontName='Helvetica', fontSize=7.5, textColor=GRAY, alignment=TA_CENTER)
    s['checkbox'] = ParagraphStyle('Checkbox', fontName='Helvetica', fontSize=9, textColor=SLATE, spaceAfter=2, leading=13, leftIndent=12)
    s['metric'] = ParagraphStyle('Metric', fontName='Helvetica-Bold', fontSize=28, textColor=BLUE, alignment=TA_CENTER)
    s['metric_label'] = ParagraphStyle('MetricLabel', fontName='Helvetica', fontSize=9, textColor=GRAY, alignment=TA_CENTER)
    return s

S = get_styles()

# ── Helper: styled table ───────────────────────────────────────────────────
def make_table(data, col_widths=None, header=True):
    """Create a professional styled table."""
    t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8.5),
        ('TEXTCOLOR', (0, 1), (-1, -1), SLATE),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
        ('LINEBELOW', (0, 0), (-1, 0), 1.5, BLUE),
    ]
    # Alternate row colors
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), SLATE_LIGHT))
    t.setStyle(TableStyle(style_cmds))
    return t

def P(text, style_key='cell'):
    return Paragraph(text, S[style_key])

def checkbox(text):
    return Paragraph(f"<font color='#93c5fd'>\u25a1</font>  {text}", S['checkbox'])

def hr():
    return HRFlowable(width='100%', thickness=0.5, color=HexColor('#e2e8f0'), spaceAfter=8, spaceBefore=4)

# ── Page template ──────────────────────────────────────────────────────────
def on_page(canvas, doc):
    canvas.saveState()
    # Top accent bar
    canvas.setFillColor(NAVY)
    canvas.rect(0, A4[1] - 8*mm, A4[0], 8*mm, fill=1, stroke=0)
    canvas.setFillColor(BLUE)
    canvas.rect(0, A4[1] - 10*mm, A4[0], 2*mm, fill=1, stroke=0)
    # Footer
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(GRAY)
    canvas.drawCentredString(A4[0]/2, 12*mm, f"ManicBot Development Roadmap  |  March-April 2026  |  Page {doc.page}")
    canvas.restoreState()

def on_first_page(canvas, doc):
    canvas.saveState()
    # Full navy header block
    canvas.setFillColor(NAVY)
    canvas.rect(0, A4[1] - 55*mm, A4[0], 55*mm, fill=1, stroke=0)
    # Blue accent stripe
    canvas.setFillColor(BLUE)
    canvas.rect(0, A4[1] - 57*mm, A4[0], 2*mm, fill=1, stroke=0)
    # Title text
    canvas.setFillColor(WHITE)
    canvas.setFont('Helvetica-Bold', 26)
    canvas.drawString(25*mm, A4[1] - 25*mm, 'ManicBot')
    canvas.setFont('Helvetica', 14)
    canvas.drawString(25*mm, A4[1] - 35*mm, 'Development Roadmap  /  Plan razrabotki')
    canvas.setFillColor(BLUE_MED)
    canvas.setFont('Helvetica', 11)
    canvas.drawString(25*mm, A4[1] - 45*mm, 'March - April 2026  |  v2.0 Multi-Channel Release')
    # Footer
    canvas.setFillColor(GRAY)
    canvas.setFont('Helvetica', 7.5)
    canvas.drawCentredString(A4[0]/2, 12*mm, f"ManicBot Development Roadmap  |  March-April 2026  |  Page {doc.page}")
    canvas.restoreState()

# ── Build document ─────────────────────────────────────────────────────────
def build():
    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=A4,
        topMargin=62*mm,  # first page has big header
        bottomMargin=20*mm,
        leftMargin=20*mm,
        rightMargin=20*mm,
    )

    story = []
    W = A4[0] - 40*mm  # usable width

    # ════════════════════════════════════════════════════════════════════════
    # PAGE 1: STATUS SUMMARY + METRICS
    # ════════════════════════════════════════════════════════════════════════

    # Key metrics row
    metrics_data = [
        [P('766', 'metric'), P('45', 'metric'), P('14K', 'metric'), P('4', 'metric')],
        [P('Tests Passing', 'metric_label'), P('Test Files', 'metric_label'), P('Lines of Code', 'metric_label'), P('Languages', 'metric_label')],
    ]
    mt = Table(metrics_data, colWidths=[W/4]*4)
    mt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BLUE_LIGHT),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 1), (-1, 1), 10),
        ('BOX', (0, 0), (-1, -1), 1, BLUE),
        ('ROUNDEDCORNERS', [6, 6, 6, 6]),
    ]))
    story.append(mt)
    story.append(Spacer(1, 12))

    # Section 1: Current Status
    story.append(Paragraph('1. Tekushchee sostoyanie / Current Status', S['h1']))
    story.append(hr())

    status_data = [
        ['Component', 'Status', '%', 'Notes'],
        [P('Telegram Booking Core'), P('Production', 'cell_green'), '100%', P('Multi-tenant, roles, appointments')],
        [P('Stripe Billing'), P('Production', 'cell_green'), '95%', P('Subscriptions, webhooks, grace period')],
        [P('AI Chat (Workers AI)'), P('Production', 'cell_green'), '90%', P('3-model fallback, action tags')],
        [P('Google Calendar'), P('Production', 'cell_green'), '95%', P('OAuth, sync, watch renewal')],
        [P('Support Tickets'), P('Production', 'cell_green'), '100%', P('Platform + tenant-local tickets')],
        [P('i18n (RU/UA/EN/PL)'), P('Production', 'cell_green'), '100%', P('350+ keys, 4 languages')],
        [P('WhatsApp Channel'), P('Partial', 'cell_yellow'), '80%', P('Adapter done, needs E2E testing')],
        [P('Instagram Channel'), P('Partial', 'cell_yellow'), '75%', P('Adapter done, needs E2E testing')],
        [P('Admin-App (Next.js)'), P('Partial', 'cell_yellow'), '85%', P('Dashboards done, channels UI missing')],
        [P('Multi-Channel UX'), P('Scaffolded', 'cell_red'), '60%', P('Schema ready, UI not built')],
        [P('E2E Tests'), P('Minimal', 'cell_red'), '20%', P('No Playwright/Cypress tests yet')],
    ]
    story.append(make_table(status_data, col_widths=[W*0.28, W*0.15, W*0.08, W*0.49]))
    story.append(Spacer(1, 10))

    # Architecture summary
    story.append(Paragraph('Arkhitektura / Architecture', S['h2']))
    arch_data = [
        ['Layer', 'Technology', 'Details'],
        ['Runtime', 'Cloudflare Workers', P('Edge compute, <30ms cold start, 30s timeout')],
        ['Database', 'Cloudflare D1 (SQLite)', P('Multi-tenant, 15+ tables, proper indexes')],
        ['Cache / State', 'Cloudflare KV', P('User state, locks, encrypted tokens (TTL-based)')],
        ['Admin App', 'Next.js 15 + tRPC 11', P('19 routers, Drizzle ORM, Tailwind CSS 4')],
        ['AI', 'Cloudflare Workers AI', P('Llama 4 Scout -> Llama 3.1 8B fallback chain')],
        ['Payments', 'Stripe API (fetch-based)', P('No SDK, webhooks with HMAC verification')],
        ['Channels', 'Custom Adapter Layer', P('Telegram + WhatsApp + Instagram adapters')],
    ]
    story.append(make_table(arch_data, col_widths=[W*0.18, W*0.28, W*0.54]))

    story.append(PageBreak())

    # Reset top margin for subsequent pages
    doc.topMargin = 18*mm

    # ════════════════════════════════════════════════════════════════════════
    # PAGE 2: WEEK 1
    # ════════════════════════════════════════════════════════════════════════

    story.append(Paragraph('2. Nedelya 1 (28 marta - 3 aprelya)', S['h1']))
    story.append(Paragraph('Multi-Channel Finalization', S['subtitle']))
    story.append(hr())

    story.append(Paragraph('Den 1-2: End-to-End Channel Testing', S['h2']))
    story.append(checkbox('Apply migration 0002_multi_channel.sql to production D1'))
    story.append(checkbox('Register Meta App in Business Manager (one app for WA + IG)'))
    story.append(checkbox('Configure META_APP_SECRET, META_VERIFY_TOKEN_WA, META_VERIFY_TOKEN_IG secrets'))
    story.append(checkbox('Test WhatsApp inbound: text, buttons (reply + list), contacts, images'))
    story.append(checkbox('Test Instagram inbound: text, quick_reply, postback, image attachments'))
    story.append(checkbox('Verify 24h message window tracking (message_windows table)'))
    story.append(checkbox('Fix normalization bugs found during real traffic testing'))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Den 3-4: Channel Configuration UI (Admin-App)', S['h2']))
    story.append(checkbox('Add "Channels" tab to SalonDashboard.tsx'))
    story.append(checkbox('WhatsApp config form: phone_number_id, access token, verify token'))
    story.append(checkbox('Instagram config form: page_id, access token'))
    story.append(checkbox('Token encryption on save (reuse encryptAndStoreToken from token-manager.js)'))
    story.append(checkbox('Channel enable/disable toggle with active flag'))
    story.append(checkbox('Display channel connection status + last message timestamp'))
    story.append(checkbox('Meta Embedded Signup widget integration (OAuth flow for salons)'))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Den 5: Conversations UI', S['h2']))
    story.append(checkbox('Build /conversations page in admin-app'))
    story.append(checkbox('List conversations across all channels (Telegram, WA, IG) - unified view'))
    story.append(checkbox('Filter by channel type, status (open/closed), date range'))
    story.append(checkbox('View full conversation message history with channel badges'))
    story.append(checkbox('Wire up tRPC conversations router (already implemented server-side)'))

    story.append(Spacer(1, 10))

    # Deliverables table
    w1_del = [
        ['Deliverable', 'Priority', 'Depends On'],
        ['Migration applied to prod', P('CRITICAL', 'cell_red'), 'wrangler d1 migrations apply'],
        ['WA/IG inbound tested E2E', P('CRITICAL', 'cell_red'), 'Meta App registration'],
        ['Channel config UI', P('HIGH', 'cell_yellow'), 'Migration + tRPC channels router'],
        ['Conversations page', P('HIGH', 'cell_yellow'), 'tRPC conversations router (done)'],
    ]
    story.append(Paragraph('Deliverables / Rezultaty nedeli', S['h3']))
    story.append(make_table(w1_del, col_widths=[W*0.45, W*0.2, W*0.35]))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # PAGE 3: WEEK 2
    # ════════════════════════════════════════════════════════════════════════

    story.append(Paragraph('3. Nedelya 2 (4 - 10 aprelya)', S['h1']))
    story.append(Paragraph('Security & Quality Hardening', S['subtitle']))
    story.append(hr())

    story.append(Paragraph('Den 1-2: Security Hardening', S['h2']))
    story.append(checkbox('Hard rate limiting: reject requests after quota exceed (HTTP 429)'))
    story.append(checkbox('Request size validation in worker.js (reject >1MB payloads)'))
    story.append(checkbox('WhatsApp template quota: hard enforcement (block send at monthly cap)'))
    story.append(checkbox('Input sanitization audit: all user-facing inputs validated'))
    story.append(checkbox('Admin-app: add request signing for sensitive mutations'))
    story.append(checkbox('Audit all token storage: verify encryption at rest, no plaintext in logs'))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Den 3-4: Test Coverage Expansion', S['h2']))
    story.append(checkbox('Install Playwright for E2E testing'))
    story.append(checkbox('E2E: Booking flow (service -> date -> time -> master -> confirm)'))
    story.append(checkbox('E2E: Admin panel navigation + appointment management'))
    story.append(checkbox('E2E: Support ticket lifecycle (create -> claim -> reply -> close)'))
    story.append(checkbox('E2E: Language switching across all 4 languages'))
    story.append(checkbox('Integration tests: WhatsApp inbound -> normalize -> handleInbound -> response'))
    story.append(checkbox('Integration tests: Instagram inbound pipeline'))
    story.append(checkbox('Target: 800+ total tests'))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Den 5: Google Calendar Edge Cases', S['h2']))
    story.append(checkbox('DST transition handling (Warsaw timezone)'))
    story.append(checkbox('Watch renewal retry logic (exponential backoff on failure)'))
    story.append(checkbox('Configurable sync horizon per tenant (default 90 days)'))
    story.append(checkbox('Error recovery for partial sync failures (transaction rollback)'))

    story.append(Spacer(1, 14))

    # ════════════════════════════════════════════════════════════════════════
    # WEEK 3
    # ════════════════════════════════════════════════════════════════════════

    story.append(Paragraph('4. Nedelya 3 (11 - 17 aprelya)', S['h1']))
    story.append(Paragraph('Admin-App Polish & Analytics', S['subtitle']))
    story.append(hr())

    story.append(Paragraph('Den 1-2: Analytics Dashboard', S['h2']))
    story.append(checkbox('New /analytics page with Recharts visualizations'))
    story.append(checkbox('Monthly revenue line chart (Stripe data)'))
    story.append(checkbox('Daily bookings bar chart + booking heatmap (hour x day)'))
    story.append(checkbox('Top services ranking, busiest hours, conversion rates'))
    story.append(checkbox('Channel distribution pie chart (Telegram vs WA vs IG)'))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Den 3-4: Detail Pages', S['h2']))
    story.append(checkbox('Master Performance Dashboard: earnings, schedule, client count'))
    story.append(checkbox('Client detail page: booking history across channels'))
    story.append(checkbox('Communication log: unified message history per client'))
    story.append(checkbox('Webhook event log viewer (debug incoming webhooks, replay failed)'))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Den 5: UX Polish', S['h2']))
    story.append(checkbox('Mobile responsiveness audit (all admin-app pages)'))
    story.append(checkbox('Dark/light theme toggle (persist in localStorage)'))
    story.append(checkbox('Notification badges: new tickets, pending appointments'))
    story.append(checkbox('Real-time updates via polling (15s interval for dashboards)'))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # PAGE 4: WEEK 4 + MONTHLY PLAN
    # ════════════════════════════════════════════════════════════════════════

    story.append(Paragraph('5. Nedelya 4 (18 - 24 aprelya)', S['h1']))
    story.append(Paragraph('Production Hardening & Launch Prep', S['subtitle']))
    story.append(hr())

    story.append(Paragraph('Den 1-2: Performance', S['h2']))
    story.append(checkbox('Caching layer: tenant config cached in KV with 5-min TTL'))
    story.append(checkbox('Pagination for all list endpoints (appointments, users, conversations)'))
    story.append(checkbox('Database query audit: EXPLAIN on slow queries, add missing indexes'))
    story.append(checkbox('Batch D1 operations where possible (dbBatch for multi-insert)'))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Den 3-4: Observability', S['h2']))
    story.append(checkbox('Structured logging: JSON format with correlation IDs per request'))
    story.append(checkbox('Health check endpoint: GET /health (DB + KV connectivity)'))
    story.append(checkbox('Cloudflare Workers analytics dashboard setup'))
    story.append(checkbox('Error alerting: Telegram notification to ADMIN_CHAT_ID on 5xx errors'))
    story.append(Spacer(1, 6))

    story.append(Paragraph('Den 5: Pre-Launch', S['h2']))
    story.append(checkbox('Final security audit: OWASP checklist for API'))
    story.append(checkbox('Load testing: simulate 100 concurrent tenants, 1000 bookings'))
    story.append(checkbox('Documentation: API reference, deployment guide, architecture diagram'))
    story.append(checkbox('Rollback plan documented'))

    story.append(Spacer(1, 16))

    # ── Monthly Plan (May) ──
    story.append(Paragraph('6. Mesyachnyj plan - May 2026', S['h1']))
    story.append(Paragraph('Growth Features', S['subtitle']))
    story.append(hr())

    may_data = [
        ['Week', 'Focus Area', 'Key Deliverables'],
        ['Week 1\n(May 1-7)', 'AI Enhancement', P('Streaming responses (SSE) + conversation memory via vector embeddings (Vectorize)')],
        ['Week 2\n(May 8-14)', 'New Channels', P('SMS adapter (Twilio) + email notification system (Resend/SES)')],
        ['Week 3\n(May 15-21)', 'Advanced Billing', P('Usage-based pricing tiers, proration on plan changes, dunning email automation')],
        ['Week 4\n(May 22-28)', 'Platform API', P('Public REST API for third-party integrations + outbound webhook delivery system')],
    ]
    story.append(make_table(may_data, col_widths=[W*0.15, W*0.2, W*0.65]))

    story.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # PAGE 5: PRIORITY MATRIX + SUCCESS METRICS
    # ════════════════════════════════════════════════════════════════════════

    story.append(Paragraph('7. Prioritety / Priority Matrix', S['h1']))
    story.append(hr())

    # Critical
    crit_data = [
        [P('<font color="#ffffff">CRITICAL - Nedelya 1</font>', 'cell_bold')],
        [P('Apply 0002_multi_channel.sql migration to production D1')],
        [P('Test WhatsApp + Instagram inbound E2E with real accounts')],
        [P('Build Channel Configuration UI in SalonDashboard')],
        [P('Build Conversations UI page')],
    ]
    ct = Table(crit_data, colWidths=[W])
    ct.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), RED),
        ('BACKGROUND', (0, 1), (-1, -1), RED_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('BOX', (0, 0), (-1, -1), 1, RED),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, HexColor('#fecaca')),
    ]))
    story.append(ct)
    story.append(Spacer(1, 10))

    # Important
    imp_data = [
        [P('<font color="#ffffff">IMPORTANT - Nedeli 2-3</font>', 'cell_bold')],
        [P('Hard rate limiting enforcement (HTTP 429)')],
        [P('E2E test suite (Playwright) - target 800+ tests')],
        [P('WhatsApp template quota hard cap')],
        [P('Analytics dashboard with Recharts')],
        [P('Master Performance + Client detail pages')],
        [P('Google Calendar DST + watch renewal fixes')],
    ]
    it = Table(imp_data, colWidths=[W])
    it.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), YELLOW),
        ('BACKGROUND', (0, 1), (-1, -1), YELLOW_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('BOX', (0, 0), (-1, -1), 1, YELLOW),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, HexColor('#fef08a')),
    ]))
    story.append(it)
    story.append(Spacer(1, 10))

    # Nice to have
    nice_data = [
        [P('<font color="#ffffff">NICE TO HAVE - Nedelya 4+</font>', 'cell_bold')],
        [P('AI streaming responses (SSE)')],
        [P('SMS channel adapter (Twilio)')],
        [P('Advanced analytics + reporting')],
        [P('Public API + webhook delivery')],
        [P('Performance caching layer')],
    ]
    nt = Table(nice_data, colWidths=[W])
    nt.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), GREEN),
        ('BACKGROUND', (0, 1), (-1, -1), GREEN_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('BOX', (0, 0), (-1, -1), 1, GREEN),
        ('LINEBELOW', (0, 0), (-1, -2), 0.5, HexColor('#bbf7d0')),
    ]))
    story.append(nt)

    story.append(Spacer(1, 20))

    # ── Success Metrics ──
    story.append(Paragraph('8. Metriki uspekha / Success Metrics', S['h1']))
    story.append(hr())

    metrics_table_data = [
        ['Metric', 'Current', 'Target (April 30)', 'Status'],
        ['Total tests', '766', '800+', P('On track', 'cell_green')],
        ['Critical security findings', '0', '0', P('Achieved', 'cell_green')],
        ['WhatsApp channel', 'Scaffolded', 'Live in production', P('In progress', 'cell_yellow')],
        ['Instagram channel', 'Scaffolded', 'Live in production', P('In progress', 'cell_yellow')],
        ['Conversations UI', 'Not built', 'Complete', P('Not started', 'cell_red')],
        ['E2E test suite', 'None', 'Core flows covered', P('Not started', 'cell_red')],
        ['p95 response time', '~500ms', '<2s under load', P('Needs testing', 'cell_yellow')],
        ['Uptime SLA', '99%+', '99.9%', P('On track', 'cell_green')],
    ]
    story.append(make_table(metrics_table_data, col_widths=[W*0.28, W*0.18, W*0.3, W*0.24]))

    story.append(Spacer(1, 20))

    # Tech stack summary
    story.append(Paragraph('Tech Stack', S['h2']))
    stack_text = (
        '<b>Worker:</b> Cloudflare Workers + D1 + KV + Workers AI  |  '
        '<b>Admin:</b> Next.js 15 + tRPC 11 + Drizzle + Tailwind 4  |  '
        '<b>Payments:</b> Stripe  |  '
        '<b>Channels:</b> Telegram + WhatsApp Cloud API + Instagram Messaging API  |  '
        '<b>Calendar:</b> Google Calendar API (OAuth 2.0)  |  '
        '<b>Tests:</b> Vitest  |  '
        '<b>Deploy:</b> wrangler deploy + GitHub Actions'
    )
    story.append(Paragraph(stack_text, S['body_small']))

    # Build
    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_page)
    print(f'PDF saved: {OUTPUT_PATH}')

if __name__ == '__main__':
    build()
