#!/usr/bin/env python3
"""ManicBot Launch Plan — Professional PDF Presentation Generator"""

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, Color
from reportlab.pdfgen import canvas
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import os, math

W, H = landscape(A4)

# ── Colors ──
BG_DARK    = HexColor("#0f0f1a")
BG_CARD    = HexColor("#1a1a2e")
BG_CARD2   = HexColor("#16213e")
PURPLE     = HexColor("#7c3aed")
PURPLE_L   = HexColor("#a78bfa")
BLUE       = HexColor("#3b82f6")
TEAL       = HexColor("#14b8a6")
TEAL_D     = HexColor("#0d9488")
GREEN      = HexColor("#22c55e")
YELLOW     = HexColor("#eab308")
RED        = HexColor("#ef4444")
RED_L      = HexColor("#f87171")
ORANGE     = HexColor("#f97316")
WHITE      = HexColor("#ffffff")
GRAY       = HexColor("#94a3b8")
GRAY_D     = HexColor("#64748b")
GRAY_DD    = HexColor("#334155")
TEXT_W     = HexColor("#e2e8f0")
TEXT_DIM   = HexColor("#94a3b8")

def alpha(color, a):
    return Color(color.red, color.green, color.blue, a)

class Presentation:
    def __init__(self, filename):
        self.c = canvas.Canvas(filename, pagesize=landscape(A4))
        self.c.setTitle("ManicBot — Launch Plan")
        self.c.setAuthor("ManicBot Team")
        self.slide_num = 0

    # ── Drawing helpers ──

    def _bg(self):
        c = self.c
        c.setFillColor(BG_DARK)
        c.rect(0, 0, W, H, fill=1, stroke=0)
        # subtle gradient strip at top
        for i in range(int(3*mm)):
            t = i / (3*mm)
            col = Color(PURPLE.red*(1-t)+BG_DARK.red*t,
                        PURPLE.green*(1-t)+BG_DARK.green*t,
                        PURPLE.blue*(1-t)+BG_DARK.blue*t, 0.7*(1-t))
            c.setFillColor(col)
            c.rect(0, H - i, W, 1, fill=1, stroke=0)
        # bottom accent
        for i in range(int(2*mm)):
            t = i / (2*mm)
            col = Color(TEAL.red*(1-t)+BG_DARK.red*t,
                        TEAL.green*(1-t)+BG_DARK.green*t,
                        TEAL.blue*(1-t)+BG_DARK.blue*t, 0.4*(1-t))
            c.setFillColor(col)
            c.rect(0, i, W, 1, fill=1, stroke=0)

    def _page_number(self):
        self.slide_num += 1
        c = self.c
        c.setFillColor(GRAY_D)
        c.setFont("Helvetica", 8)
        c.drawRightString(W - 15*mm, 8*mm, f"{self.slide_num} / 12")

    def _new_slide(self):
        if self.slide_num > 0:
            self.c.showPage()
        self._bg()
        self._page_number()

    def _title(self, text, y=None, size=28, color=WHITE):
        if y is None:
            y = H - 28*mm
        c = self.c
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", size)
        c.drawString(30*mm, y, text)
        # underline accent
        tw = c.stringWidth(text, "Helvetica-Bold", size)
        c.setStrokeColor(PURPLE)
        c.setLineWidth(2)
        c.line(30*mm, y - 4, 30*mm + min(tw, 120*mm), y - 4)

    def _subtitle(self, text, y=None, size=14, color=TEXT_DIM):
        if y is None:
            y = H - 36*mm
        self.c.setFillColor(color)
        self.c.setFont("Helvetica", size)
        self.c.drawString(30*mm, y, text)

    def _card(self, x, y, w, h, fill=BG_CARD, radius=4*mm):
        c = self.c
        c.setFillColor(fill)
        c.setStrokeColor(alpha(PURPLE, 0.15))
        c.setLineWidth(0.5)
        c.roundRect(x, y, w, h, radius, fill=1, stroke=1)

    def _text(self, x, y, text, size=10, color=TEXT_W, font="Helvetica", max_width=None):
        c = self.c
        c.setFillColor(color)
        c.setFont(font, size)
        if max_width:
            # simple word wrap
            words = text.split(' ')
            line = ""
            line_y = y
            for word in words:
                test = line + (" " if line else "") + word
                if c.stringWidth(test, font, size) > max_width and line:
                    c.drawString(x, line_y, line)
                    line_y -= size * 1.4
                    line = word
                else:
                    line = test
            if line:
                c.drawString(x, line_y, line)
            return line_y
        else:
            c.drawString(x, y, text)
            return y

    def _bullet(self, x, y, text, size=10, color=TEXT_W, bullet_color=TEAL, max_width=None):
        c = self.c
        c.setFillColor(bullet_color)
        c.circle(x + 2, y + 3, 2, fill=1, stroke=0)
        return self._text(x + 10, y, text, size, color, max_width=max_width)

    def _progress_bar(self, x, y, w, pct, color=TEAL, h=6):
        c = self.c
        c.setFillColor(GRAY_DD)
        c.roundRect(x, y, w, h, h/2, fill=1, stroke=0)
        if pct > 0:
            c.setFillColor(color)
            c.roundRect(x, y, w * pct / 100, h, h/2, fill=1, stroke=0)

    def _badge(self, x, y, text, color=TEAL, text_color=WHITE):
        c = self.c
        tw = c.stringWidth(text, "Helvetica-Bold", 8) + 8
        c.setFillColor(alpha(color, 0.25))
        c.roundRect(x, y - 2, tw, 14, 3, fill=1, stroke=0)
        c.setFillColor(color)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(x + 4, y + 1, text)
        return tw

    # ── SLIDES ──

    def slide_01_title(self):
        self._new_slide()
        c = self.c
        # Large gradient circle (decorative)
        for r in range(80, 0, -1):
            t = r / 80
            col = Color(PURPLE.red, PURPLE.green, PURPLE.blue, 0.03 * t)
            c.setFillColor(col)
            c.circle(W * 0.75, H * 0.5, r * 2, fill=1, stroke=0)

        # Title
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 42)
        c.drawString(30*mm, H - 70*mm, "ManicBot")

        # Gradient line
        for i in range(int(200)):
            t = i / 200
            col = Color(PURPLE.red*(1-t)+TEAL.red*t,
                        PURPLE.green*(1-t)+TEAL.green*t,
                        PURPLE.blue*(1-t)+TEAL.blue*t, 1)
            c.setStrokeColor(col)
            c.setLineWidth(3)
            c.line(30*mm + i * 0.8, H - 76*mm, 30*mm + i * 0.8 + 0.8, H - 76*mm)

        c.setFillColor(PURPLE_L)
        c.setFont("Helvetica", 20)
        c.drawString(30*mm, H - 90*mm, "Plan zapuska produkta")

        c.setFillColor(TEXT_DIM)
        c.setFont("Helvetica", 16)
        c.drawString(30*mm, H - 108*mm, "7-dnevnyj roadmap k gotovomu produktu")

        c.setFillColor(GRAY)
        c.setFont("Helvetica", 12)
        c.drawString(30*mm, H - 125*mm, "Aprel' 2026")

        # Stats bar at bottom
        self._card(25*mm, 18*mm, W - 50*mm, 20*mm, BG_CARD2)
        stats = [
            ("80%", "gotovo", TEAL),
            ("931", "testov", GREEN),
            ("16", "fajlov hardened", PURPLE_L),
            ("7", "uyazvimostej zakryto", RED_L),
            ("0", "bekdorov", GREEN),
        ]
        sx = 35*mm
        for val, label, col in stats:
            c.setFillColor(col)
            c.setFont("Helvetica-Bold", 14)
            c.drawString(sx, 30*mm, val)
            tw = c.stringWidth(val, "Helvetica-Bold", 14)
            c.setFillColor(TEXT_DIM)
            c.setFont("Helvetica", 9)
            c.drawString(sx + tw + 3, 30*mm, label)
            sx += 48*mm

    def slide_02_status(self):
        self._new_slide()
        self._title("Tekushchij status produkta")
        self._subtitle("Obshchaya gotovnost' k zapusku: ~80%")

        items = [
            ("Telegram Bot",       90, GREEN,  "ok"),
            ("Publichnyj poisk",   95, GREEN,  "ok"),
            ("Profili salonov",    95, GREEN,  "ok"),
            ("Stripe billing",     85, GREEN,  "ok"),
            ("Admin Dashboard",    90, GREEN,  "ok"),
            ("Telegram Mini App",  75, YELLOW, "warn"),
            ("Lending + Signup",   70, YELLOW, "warn"),
            ("Dokumentaciya",      65, YELLOW, "warn"),
            ("Onbording",          40, RED,    "err"),
            ("Monitoring",         20, RED,    "err"),
        ]

        col1_x = 30*mm
        col2_x = W/2 + 10*mm
        start_y = H - 55*mm
        row_h = 18*mm

        for i, (name, pct, color, status) in enumerate(items):
            col = col1_x if i < 5 else col2_x
            row = i if i < 5 else i - 5
            y = start_y - row * row_h

            self._card(col - 5*mm, y - 5*mm, (W/2 - 25*mm), 16*mm, BG_CARD)
            self._text(col, y + 4, name, 11, TEXT_W, "Helvetica-Bold")
            self._progress_bar(col, y - 2, 80*mm, pct, color)

            c = self.c
            c.setFillColor(color)
            c.setFont("Helvetica-Bold", 11)
            c.drawRightString(col + (W/2 - 30*mm) - 5*mm, y + 4, f"{pct}%")

            icon = {"ok": "V", "warn": "!", "err": "X"}[status]
            icon_col = {GREEN: GREEN, YELLOW: YELLOW, RED: RED}[color]
            c.setFillColor(alpha(icon_col, 0.2))
            c.circle(col + (W/2 - 30*mm) - 2*mm, y + 6, 5, fill=1, stroke=0)
            c.setFillColor(icon_col)
            c.setFont("Helvetica-Bold", 8)
            c.drawCentredString(col + (W/2 - 30*mm) - 2*mm, y + 3.5, icon)

        # Overall bar at bottom
        self._card(25*mm, 15*mm, W - 50*mm, 18*mm, BG_CARD2)
        self._text(30*mm, 24*mm, "OBSHCHIJ PROGRESS:", 10, GRAY, "Helvetica-Bold")
        self._progress_bar(80*mm, 22*mm, W - 130*mm, 80, PURPLE)
        self.c.setFillColor(PURPLE_L)
        self.c.setFont("Helvetica-Bold", 12)
        self.c.drawRightString(W - 30*mm, 23*mm, "80%")

    def slide_03_security(self):
        self._new_slide()
        self._title("Audit bezopasnosti")
        self._subtitle("Najdeno i ispravleno — 7 uyazvimostej")

        y = H - 58*mm
        findings = [
            ("CRITICAL", "HMAC bypass v Instagram webhook (User-Agent fallback)", RED, "Ispravleno"),
            ("CRITICAL", "Calendar endpoint bez autentifikacii (/calendar/:aptId)", RED, "Ispravleno"),
            ("HIGH", "Telegram initData — 24h okno -> sokrashcheno do 5 min", ORANGE, "Ispravleno"),
            ("HIGH", "Null-check v removeTenantSupportAgent", ORANGE, "Ispravleno"),
            ("HIGH", "parseInt validaciya v callback handlers", ORANGE, "Ispravleno"),
            ("MEDIUM", "Izbytochnoe logirovanie PII v IG webhook", YELLOW, "Ispravleno"),
            ("MEDIUM", "JSON.parse bez try/catch v svcRowToDoc", YELLOW, "Ispravleno"),
        ]

        for sev, desc, color, status in findings:
            self._card(25*mm, y - 4*mm, W - 50*mm, 14*mm, BG_CARD)
            bw = self._badge(30*mm, y, sev, color)
            self._text(30*mm + bw + 8, y, desc, 9, TEXT_W, max_width=W - 100*mm)

            # status badge
            self.c.setFillColor(alpha(GREEN, 0.2))
            self.c.roundRect(W - 60*mm, y - 2, 30*mm, 14, 3, fill=1, stroke=0)
            self.c.setFillColor(GREEN)
            self.c.setFont("Helvetica-Bold", 8)
            self.c.drawCentredString(W - 45*mm, y + 1, status)

            y -= 17*mm

        # Bottom positive findings
        y -= 5*mm
        positives = [
            "Bekdorov ne obnaruzheno",
            "Vse D1 zaprosy parametrizovany (net SQL injection)",
            "Stripe HMAC verifikaciya korrektna",
            "AES-GCM shifrowanie s random IV",
        ]
        for p in positives:
            self.c.setFillColor(GREEN)
            self.c.circle(32*mm, y + 3, 3, fill=1, stroke=0)
            self.c.setFillColor(WHITE)
            self.c.setFont("Helvetica-Bold", 7)
            self.c.drawCentredString(32*mm, y + 1, "V")
            self._text(38*mm, y, p, 9, GREEN)
            y -= 11*mm

    def slide_04_day12(self):
        self._new_slide()
        self._title("Etap 1: Fundament")
        self._badge(30*mm, H - 36*mm, "DEN' 1-2", PURPLE)

        tasks = [
            ("Publichnaya forma registracii", TEAL,
             ["Stranica /signup na lendinge",
              "Polya: nazvanie salona, email, telefon, gorod",
              "Integraciya s provisioning API",
              "Avtomaticheskoe sozdanie trial-akkaunta"]),
            ("Error tracking (Sentry)", BLUE,
             ["Integraciya v Worker + Admin App",
              "Alerty v Telegram dlya kriticheskikh oshibok"]),
            ("Pravovye stranicy", PURPLE_L,
             ["Politika konfidencial'nosti",
              "Usloviya ispol'zovaniya",
              "Ssylki iz futera vsekh stranic"]),
            ("SEO bazis", GREEN,
             ["Dinamicheskij sitemap.xml",
              "robots.txt",
              "JSON-LD schema dlya Local Business"]),
        ]

        col_w = (W - 70*mm) / 2
        for i, (title, color, bullets) in enumerate(tasks):
            col = 0 if i < 2 else 1
            row = i % 2
            x = 30*mm + col * (col_w + 10*mm)
            y_top = H - 52*mm - row * 65*mm
            card_h = 55*mm

            self._card(x - 3*mm, y_top - card_h + 10*mm, col_w, card_h, BG_CARD)

            # colored left border
            self.c.setFillColor(color)
            self.c.rect(x - 3*mm, y_top - card_h + 10*mm, 3, card_h, fill=1, stroke=0)

            self._text(x + 5*mm, y_top, title, 12, color, "Helvetica-Bold")

            by = y_top - 14
            for b in bullets:
                self._bullet(x + 5*mm, by, b, 9, TEXT_DIM, color, max_width=col_w - 20*mm)
                by -= 12

    def slide_05_day34(self):
        self._new_slide()
        self._title("Etap 2: Onbording i Billing")
        self._badge(30*mm, H - 36*mm, "DEN' 3-4", BLUE)

        tasks = [
            ("Master nastrojki salona", TEAL,
             ["5 shagov: Profil' -> Uslugi -> Mastera -> Raspisanie -> Billing",
              "Progress-bar s chekpointami",
              "Avtosokhranenie na kazhdom shage"]),
            ("Email-uvedomleniya", BLUE,
             ["Welcome email pri registracii",
              "Napominanie: Trial zakanchivaetsya cherez 3 dnya",
              "Uvedomlenie: Oplata ne proshla",
              "Podtverzhdenie: Podpiska aktivirovana"]),
            ("Uluchshenie billing UI", PURPLE_L,
             ["Knopka smeny tarifa (Start -> Pro -> Studio)",
              "Knopka otmeny podpiski",
              "Istoriya platezhej (cherez Stripe Portal)"]),
            ("Stranica tarifov (/pricing)", GREEN,
             ["3 kartochki: Start (9E), Pro (29E), Studio (79E)",
              "Sravnitel'naya tablica fich",
              "CTA: Poprobovat' besplatno"]),
        ]

        col_w = (W - 70*mm) / 2
        for i, (title, color, bullets) in enumerate(tasks):
            col = 0 if i < 2 else 1
            row = i % 2
            x = 30*mm + col * (col_w + 10*mm)
            y_top = H - 52*mm - row * 65*mm
            card_h = 55*mm

            self._card(x - 3*mm, y_top - card_h + 10*mm, col_w, card_h, BG_CARD)
            self.c.setFillColor(color)
            self.c.rect(x - 3*mm, y_top - card_h + 10*mm, 3, card_h, fill=1, stroke=0)

            self._text(x + 5*mm, y_top, title, 12, color, "Helvetica-Bold")
            by = y_top - 14
            for b in bullets:
                self._bullet(x + 5*mm, by, b, 9, TEXT_DIM, color, max_width=col_w - 20*mm)
                by -= 12

    def slide_06_day56(self):
        self._new_slide()
        self._title("Etap 3: UX Polish i Dokumentaciya")
        self._badge(30*mm, H - 36*mm, "DEN' 5-6", TEAL)

        tasks = [
            ("Kastomnye stranicy oshibok", TEAL,
             ["404: Stranica ne najdena — s poiskom",
              "500: Chto-to poshlo ne tak — s kontaktami"]),
            ("Telegram Mini App optimizaciya", BLUE,
             ["Safe area padding (notch support)",
              "Haptic feedback na knopkakh",
              "Back button handling",
              "Optimizaciya viewport"]),
            ("Dokumentaciya dlya pol'zovatelej", PURPLE_L,
             ["Getting Started guide (poshagovyj)",
              "FAQ (15-20 voprosov)",
              "API dokumentaciya (dlya integracij)"]),
            ("Uluchshenie publichnykh stranic", GREEN,
             ["Open Graph meta dlya sharinga",
              "Skeleton loaders vmesto spinnerov",
              "Animacii perekhodov mezhdu stranicami"]),
        ]

        col_w = (W - 70*mm) / 2
        for i, (title, color, bullets) in enumerate(tasks):
            col = 0 if i < 2 else 1
            row = i % 2
            x = 30*mm + col * (col_w + 10*mm)
            y_top = H - 52*mm - row * 65*mm
            card_h = 55*mm

            self._card(x - 3*mm, y_top - card_h + 10*mm, col_w, card_h, BG_CARD)
            self.c.setFillColor(color)
            self.c.rect(x - 3*mm, y_top - card_h + 10*mm, 3, card_h, fill=1, stroke=0)

            self._text(x + 5*mm, y_top, title, 12, color, "Helvetica-Bold")
            by = y_top - 14
            for b in bullets:
                self._bullet(x + 5*mm, by, b, 9, TEXT_DIM, color, max_width=col_w - 20*mm)
                by -= 12

    def slide_07_day7(self):
        self._new_slide()
        self._title("Etap 4: Final i Zapusk")
        self._badge(30*mm, H - 36*mm, "DEN' 7", RED_L)

        tasks = [
            ("End-to-End testirovanie", TEAL,
             ["Polnyj cikl: Registraciya -> Nastrojka -> Bronirovanie -> Oplata",
              "Test na 3 kanalakh: Telegram, WhatsApp, Instagram",
              "Test billinga: trial -> active -> grace -> expired"]),
            ("Performance audit", BLUE,
             ["Lighthouse proverka vsekh publichnykh stranic",
              "Target: Performance > 90, A11y > 90",
              "Optimizaciya bundle size"]),
            ("Monitoring i alerty", PURPLE_L,
             ["Uptime monitoring (UptimeRobot)",
              "Cloudflare Analytics",
              "Telegram alerty dlya downtime"]),
        ]

        col_w = (W - 70*mm) / 3
        for i, (title, color, bullets) in enumerate(tasks):
            x = 30*mm + i * (col_w + 5*mm)
            y_top = H - 55*mm
            card_h = 60*mm

            self._card(x - 3*mm, y_top - card_h + 10*mm, col_w, card_h, BG_CARD)
            self.c.setFillColor(color)
            self.c.rect(x - 3*mm, y_top - card_h + 10*mm, 3, card_h, fill=1, stroke=0)

            self._text(x + 5*mm, y_top, title, 11, color, "Helvetica-Bold")
            by = y_top - 15
            for b in bullets:
                by = self._bullet(x + 5*mm, by, b, 8, TEXT_DIM, color, max_width=col_w - 15*mm)
                by -= 5

        # Launch banner
        launch_y = 35*mm
        self._card(25*mm, launch_y - 5*mm, W - 50*mm, 28*mm, BG_CARD2)

        # Rocket icon area
        c = self.c
        c.setFillColor(alpha(TEAL, 0.15))
        c.circle(55*mm, launch_y + 9*mm, 12, fill=1, stroke=0)
        c.setFillColor(TEAL)
        c.setFont("Helvetica-Bold", 16)
        c.drawCentredString(55*mm, launch_y + 5*mm, ">>")

        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(75*mm, launch_y + 10*mm, "ZAPUSK")
        c.setFillColor(TEXT_DIM)
        c.setFont("Helvetica", 10)
        c.drawString(75*mm, launch_y, "Final'nyj deploj Worker + Admin App | Aktivaciya public signup | Anons")

    def slide_08_architecture(self):
        self._new_slide()
        self._title("Arkhitektura ManicBot")

        c = self.c
        # ── Clients column ──
        cx = 50*mm
        cy = H - 60*mm

        # Client box
        self._card(cx - 20*mm, cy - 5*mm, 45*mm, 50*mm, BG_CARD)
        self._text(cx - 15*mm, cy + 35*mm, "KLIENTY", 9, PURPLE_L, "Helvetica-Bold")
        channels = [("Telegram Bot", BLUE), ("WhatsApp", GREEN), ("Instagram", PURPLE_L)]
        for j, (ch, col) in enumerate(channels):
            self._text(cx - 15*mm, cy + 20*mm - j * 14*mm, ch, 9, col)

        # Arrow to Worker
        arrow_x = cx + 28*mm
        c.setStrokeColor(alpha(TEAL, 0.5))
        c.setLineWidth(1.5)
        c.setDash([4, 3])
        c.line(arrow_x, cy + 15*mm, arrow_x + 25*mm, cy + 15*mm)
        c.setDash([])
        # arrowhead
        c.setFillColor(TEAL)
        c.drawString(arrow_x + 22*mm, cy + 13*mm, ">")

        # Worker box
        wx = 115*mm
        self._card(wx - 20*mm, cy - 5*mm, 55*mm, 50*mm, BG_CARD2)
        self._text(wx - 15*mm, cy + 35*mm, "CLOUDFLARE WORKER", 9, TEAL, "Helvetica-Bold")
        worker_items = ["Webhook routing", "AI (3-model fallback)", "Cron (15min)", "Billing lifecycle"]
        for j, item in enumerate(worker_items):
            self._text(wx - 15*mm, cy + 20*mm - j * 11*mm, item, 8, TEXT_DIM)

        # Arrow to Storage
        arrow_x2 = wx + 38*mm
        c.setStrokeColor(alpha(BLUE, 0.5))
        c.setLineWidth(1.5)
        c.setDash([4, 3])
        c.line(arrow_x2, cy + 15*mm, arrow_x2 + 20*mm, cy + 15*mm)
        c.setDash([])
        c.setFillColor(BLUE)
        c.drawString(arrow_x2 + 17*mm, cy + 13*mm, ">")

        # Storage box
        sx = 190*mm
        self._card(sx - 18*mm, cy - 5*mm, 45*mm, 50*mm, BG_CARD)
        self._text(sx - 13*mm, cy + 35*mm, "STORAGE", 9, BLUE, "Helvetica-Bold")
        storage_items = ["D1 Database (25 tabl.)", "KV Storage", "Stripe Billing"]
        for j, item in enumerate(storage_items):
            self._text(sx - 13*mm, cy + 20*mm - j * 12*mm, item, 8, TEXT_DIM)

        # ── Owners row ──
        oy = H - 130*mm
        self._card(cx - 20*mm, oy - 5*mm, 45*mm, 40*mm, BG_CARD)
        self._text(cx - 15*mm, oy + 25*mm, "VLADEL'CY", 9, GREEN, "Helvetica-Bold")
        self._text(cx - 15*mm, oy + 12*mm, "Mini App (TG)", 9, TEXT_DIM)
        self._text(cx - 15*mm, oy, "Web Dashboard", 9, TEXT_DIM)

        c.setStrokeColor(alpha(GREEN, 0.5))
        c.setLineWidth(1.5)
        c.setDash([4, 3])
        c.line(arrow_x, oy + 10*mm, arrow_x + 25*mm, oy + 10*mm)
        c.setDash([])
        c.setFillColor(GREEN)
        c.drawString(arrow_x + 22*mm, oy + 8*mm, ">")

        self._card(wx - 20*mm, oy - 5*mm, 55*mm, 40*mm, BG_CARD2)
        self._text(wx - 15*mm, oy + 25*mm, "NEXT.JS + tRPC", 9, GREEN, "Helvetica-Bold")
        self._text(wx - 15*mm, oy + 12*mm, "Cloudflare Pages", 8, TEXT_DIM)
        self._text(wx - 15*mm, oy, "Drizzle ORM", 8, TEXT_DIM)

        c.setStrokeColor(alpha(GREEN, 0.5))
        c.setLineWidth(1.5)
        c.setDash([4, 3])
        c.line(arrow_x2, oy + 10*mm, arrow_x2 + 20*mm, oy + 10*mm)
        c.setDash([])

        # Integrations
        ix = sx - 18*mm
        self._card(ix, oy - 5*mm, 70*mm, 40*mm, BG_CARD)
        self._text(ix + 5*mm, oy + 25*mm, "INTEGRACII", 9, ORANGE, "Helvetica-Bold")
        integrations = [("Google Calendar", "OAuth + sync"), ("Stripe", "podpiski + webhooks"), ("Meta Business", "WA + IG")]
        for j, (name, desc) in enumerate(integrations):
            self._text(ix + 5*mm, oy + 12*mm - j * 11*mm, f"{name} — {desc}", 8, TEXT_DIM)

        # Bottom stats
        self._card(25*mm, 12*mm, W - 50*mm, 18*mm, BG_CARD2)
        stats_text = "931 test  |  25 tablic D1  |  4 yazyka (RU/UA/EN/PL)  |  3 tarifa  |  6 rolej  |  3 kanala"
        self._text(W/2 - c.stringWidth(stats_text, "Helvetica", 10)/2, 19*mm, stats_text, 10, TEAL)

    def slide_09_metrics(self):
        self._new_slide()
        self._title("Metriki gotovnosti k zapusku")
        self._subtitle("Dinamika uluchshenij: do audita -> posle -> cel'")

        metrics = [
            ("Security score",   "6/10", "9/10", "10/10", 60, 90, 100),
            ("Test coverage",    "70%",  "70%",  "85%",   70, 70, 85),
            ("A11y compliance",  "4/10", "7/10", "9/10",  40, 70, 90),
            ("SEO score",        "5/10", "5/10", "9/10",  50, 50, 90),
            ("Onboarding",       "40%",  "40%",  "95%",   40, 40, 95),
            ("Billing UX",       "85%",  "85%",  "95%",   85, 85, 95),
            ("Dokumentaciya",    "65%",  "65%",  "90%",   65, 65, 90),
            ("Monitoring",       "20%",  "20%",  "80%",   20, 20, 80),
        ]

        y = H - 55*mm
        c = self.c

        # Header
        self._text(30*mm, y + 8*mm, "Metrika", 9, GRAY_D, "Helvetica-Bold")
        self._text(100*mm, y + 8*mm, "Do audita", 9, GRAY_D, "Helvetica-Bold")
        self._text(135*mm, y + 8*mm, "Posle", 9, GRAY_D, "Helvetica-Bold")
        self._text(165*mm, y + 8*mm, "Cel'", 9, GRAY_D, "Helvetica-Bold")
        self._text(190*mm, y + 8*mm, "Progress", 9, GRAY_D, "Helvetica-Bold")

        for name, before, after, target, pb, pa, pt in metrics:
            self._card(25*mm, y - 5*mm, W - 50*mm, 14*mm, BG_CARD)

            self._text(30*mm, y, name, 10, TEXT_W, "Helvetica-Bold")

            col_b = RED if pb < 50 else YELLOW if pb < 70 else GREEN
            col_a = RED if pa < 50 else YELLOW if pa < 70 else GREEN

            self._text(105*mm, y, before, 10, col_b)
            self._text(140*mm, y, after, 10, col_a)
            self._text(170*mm, y, target, 10, TEAL)

            # Mini progress bar
            self._progress_bar(195*mm, y + 1, 50*mm, pa, col_a, 5)
            # Target marker
            marker_x = 195*mm + 50*mm * pt / 100
            c.setStrokeColor(alpha(WHITE, 0.4))
            c.setLineWidth(1)
            c.line(marker_x, y - 2, marker_x, y + 8)

            y -= 17*mm

        # Summary
        self._card(25*mm, 15*mm, W - 50*mm, 22*mm, BG_CARD2)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(35*mm, 24*mm, "Itogo: 80%")
        # Arrow
        c.setFillColor(TEAL)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(85*mm, 24*mm, "-->")
        c.setFillColor(GREEN)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(105*mm, 24*mm, "95% za 7 dnej")

    def slide_10_risks(self):
        self._new_slide()
        self._title("Riski i plan B")
        self._subtitle("Analiz riskov i strategii mitigacii")

        risks = [
            ("Stripe integratsiya pri nagruzke", "Nizkaya", "Vysokij", "Webhook retry + grace period", GREEN, RED),
            ("Meta API izmenit format", "Srednyaya", "Vysokij", "HMAC validation + graceful fallback", YELLOW, RED),
            ("D1 limity pri roste", "Nizkaya", "Srednij", "Monitoring + plan upgrade", GREEN, YELLOW),
            ("Telegram rate limits", "Srednyaya", "Srednij", "Queue + exponential backoff", YELLOW, YELLOW),
            ("GDPR compliance", "Vysokaya", "Vysokij", "Privacy policy + data deletion API", RED, RED),
        ]

        y = H - 60*mm
        # Header
        self._text(30*mm, y + 8*mm, "Risk", 9, GRAY_D, "Helvetica-Bold")
        self._text(120*mm, y + 8*mm, "Veroyatn.", 9, GRAY_D, "Helvetica-Bold")
        self._text(150*mm, y + 8*mm, "Impakt", 9, GRAY_D, "Helvetica-Bold")
        self._text(178*mm, y + 8*mm, "Mitigatsiya", 9, GRAY_D, "Helvetica-Bold")

        for risk, prob, impact, mitigation, prob_col, imp_col in risks:
            self._card(25*mm, y - 5*mm, W - 50*mm, 18*mm, BG_CARD)
            self._text(30*mm, y + 3, risk, 9, TEXT_W, "Helvetica-Bold", max_width=85*mm)
            self._badge(120*mm, y + 2, prob, prob_col)
            self._badge(150*mm, y + 2, impact, imp_col)
            self._text(178*mm, y + 3, mitigation, 8, TEXT_DIM, max_width=70*mm)
            y -= 22*mm

    def slide_11_roadmap_v2(self):
        self._new_slide()
        self._title("Roadmap posle zapuska")
        self._subtitle("Mesyac 2-3: razvitie produkta")

        features = [
            ("Sistema rejtingov i otzyvov", "Klienty mogut ostavlyat' otzyvy posle vizita", TEAL, "M2"),
            ("Karta salonov (Mapbox)", "Vizual'nyj poisk salonov na karte", BLUE, "M2"),
            ("CRM: Email-rassylki klientam", "Avtomaticheskie napominaniya i aktsii", GREEN, "M2"),
            ("PWA dlya vladel'cev salonov", "Nativnyj opyt bez App Store", PURPLE_L, "M2"),
            ("AI-assistent (uluchshennyj)", "Umnoe bronirovanie cherez dialog", ORANGE, "M3"),
            ("Analitika dlya salonov", "Populyarnye uslugi, chasy pik, trendy", TEAL, "M3"),
            ("Instagram Stories bronirovanie", "Pryamoe bronirovanie iz stories", PURPLE_L, "M3"),
            ("Split payments (master + salon)", "Razdelenie platezha mezhdu masteram i salonom", BLUE, "M3"),
        ]

        col_w = (W - 65*mm) / 2
        for i, (title, desc, color, month) in enumerate(features):
            col = 0 if i < 4 else 1
            row = i % 4
            x = 30*mm + col * (col_w + 5*mm)
            y = H - 55*mm - row * 32*mm

            self._card(x - 3*mm, y - 12*mm, col_w, 28*mm, BG_CARD)
            self.c.setFillColor(color)
            self.c.rect(x - 3*mm, y - 12*mm, 3, 28*mm, fill=1, stroke=0)

            self._badge(x + col_w - 25*mm, y + 8, month, GRAY_DD, GRAY)
            self._text(x + 5*mm, y + 7, title, 11, color, "Helvetica-Bold")
            self._text(x + 5*mm, y - 5, desc, 8, TEXT_DIM, max_width=col_w - 15*mm)

    def slide_12_final(self):
        self._new_slide()
        c = self.c

        # Decorative circles
        for r in range(100, 0, -1):
            t = r / 100
            col = Color(TEAL.red, TEAL.green, TEAL.blue, 0.02 * t)
            c.setFillColor(col)
            c.circle(W * 0.5, H * 0.55, r * 2.5, fill=1, stroke=0)

        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 36)
        text = "ManicBot"
        tw = c.stringWidth(text, "Helvetica-Bold", 36)
        c.drawCentredString(W/2, H - 60*mm, text)

        c.setFillColor(TEAL)
        c.setFont("Helvetica-Bold", 20)
        c.drawCentredString(W/2, H - 80*mm, "Gotov k zapusku")

        # Gradient line
        line_w = 150
        for i in range(line_w):
            t = i / line_w
            col = Color(PURPLE.red*(1-t)+TEAL.red*t,
                        PURPLE.green*(1-t)+TEAL.green*t,
                        PURPLE.blue*(1-t)+TEAL.blue*t, 1)
            c.setStrokeColor(col)
            c.setLineWidth(3)
            x = W/2 - line_w*0.4 + i * 0.8
            c.line(x, H - 88*mm, x + 0.8, H - 88*mm)

        c.setFillColor(TEXT_DIM)
        c.setFont("Helvetica", 16)
        c.drawCentredString(W/2, H - 100*mm, "Ot 80% do 100% za 7 dnej")

        # Stats grid
        stats = [
            ("16", "fajlov ispravleno"),
            ("7", "uyazvimostej zakryto"),
            ("0", "bekdorov najdeno"),
            ("931", "test prokhodit"),
            ("25", "tablic D1 synced"),
        ]

        grid_w = 48*mm
        start_x = W/2 - (len(stats) * grid_w) / 2
        stat_y = H - 130*mm

        for i, (val, label) in enumerate(stats):
            sx = start_x + i * grid_w
            self._card(sx, stat_y - 10*mm, 42*mm, 30*mm, BG_CARD)

            c.setFillColor(TEAL)
            c.setFont("Helvetica-Bold", 22)
            c.drawCentredString(sx + 21*mm, stat_y + 8*mm, val)
            c.setFillColor(TEXT_DIM)
            c.setFont("Helvetica", 8)
            c.drawCentredString(sx + 21*mm, stat_y - 3*mm, label)

        # Footer
        c.setFillColor(GRAY_D)
        c.setFont("Helvetica", 10)
        c.drawCentredString(W/2, 18*mm, "Zadeplojeno na manicbot.com | Worker v1d6f2c96")
        c.setFillColor(GRAY_DD)
        c.setFont("Helvetica", 8)
        c.drawCentredString(W/2, 10*mm, "Aprel' 2026")

    def build(self):
        self.slide_01_title()
        self.slide_02_status()
        self.slide_03_security()
        self.slide_04_day12()
        self.slide_05_day34()
        self.slide_06_day56()
        self.slide_07_day7()
        self.slide_08_architecture()
        self.slide_09_metrics()
        self.slide_10_risks()
        self.slide_11_roadmap_v2()
        self.slide_12_final()
        self.c.save()

if __name__ == "__main__":
    output = "/Users/vdovin/Desktop/44444444/ManicBot_Launch_Plan.pdf"
    p = Presentation(output)
    p.build()
    print(f"PDF saved: {output}")
