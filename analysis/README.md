# ManicBot — Technical Audit / Технический аудит

> Дата: 4 апреля 2026 | Аудитор: Claude Code (Opus 4.6)

---

## Документы

### Презентация (слайды + диаграммы SVG)
- [presentation/index.html](presentation/index.html) — полноэкранная презентация по аудиту (навигация: ← →, клик по краям экрана).
- Просмотр с локального сервера: из корня репозитория выполните `npx serve analysis` и откройте `/presentation/` (корень сервера — папка `analysis/`, иначе относительные пути к `../visualization/` не сработают).

### Основной отчёт
- [AUDIT_REPORT.md](AUDIT_REPORT.md) — Полный технический аудит (~10,000 слов)

### Диаграммы (7 штук: исходник `.mmd` + экспорт `.svg`)

| # | Диаграмма | Mermaid | SVG |
|---|-----------|---------|-----|
| 1 | Архитектура системы | [.mmd](visualization/01-system-architecture.mmd) | [.svg](visualization/01-system-architecture.svg) |
| 2 | Data Flow: бронирование | [.mmd](visualization/02-data-flow.mmd) | [.svg](visualization/02-data-flow.svg) |
| 3 | Auth Flow (двойная авторизация) | [.mmd](visualization/03-auth-flow.mmd) | [.svg](visualization/03-auth-flow.svg) |
| 4 | Booking Flow (жизненный цикл) | [.mmd](visualization/04-booking-flow.mmd) | [.svg](visualization/04-booking-flow.svg) |
| 5 | Multi-Channel (TG/WA/IG) | [.mmd](visualization/05-multi-channel-flow.mmd) | [.svg](visualization/05-multi-channel-flow.svg) |
| 6 | Billing Lifecycle (Stripe) | [.mmd](visualization/06-billing-lifecycle.mmd) | [.svg](visualization/06-billing-lifecycle.svg) |
| 7 | State Machine (25+ состояний) | [.mmd](visualization/07-state-machine.mmd) | [.svg](visualization/07-state-machine.svg) |

При необходимости PNG сгенерируйте локально ([Mermaid CLI](https://github.com/mermaid-js/mermaid-cli)):

```bash
cd analysis/visualization
npx -y @mermaid-js/mermaid-cli@latest -i 01-system-architecture.mmd -o 01-system-architecture.png
```

### Fix Proposals (5 штук)

| # | Severity | Проблема | Документ |
|---|----------|----------|----------|
| 1 | CRITICAL | Race condition при бронировании | [Fix #01](fixes/01-booking-race-condition.md) |
| 2 | HIGH | Google Calendar sync без backoff | [Fix #02](fixes/02-google-calendar-backoff.md) |
| 3 | HIGH | AI prompt injection | [Fix #03](fixes/03-ai-prompt-sanitization.md) |
| 4 | HIGH | Нет rate limiting на auth | [Fix #04](fixes/04-rate-limit-auth.md) |
| 5 | HIGH | Plaintext token fallback | [Fix #05](fixes/05-encryption-enforcement.md) |

### Данные

| Файл | Содержимое |
|------|------------|
| [metrics.json](summary/metrics.json) | LOC, файлы, тесты, зависимости |
| [dependency-audit.json](summary/dependency-audit.json) | Проблемы зависимостей |

---

## Структура

```
analysis/
├── AUDIT_REPORT.md              # Основной отчёт
├── README.md                    # Этот файл
├── presentation/
│   └── index.html               # Слайды аудита (SVG + резюме)
├── visualization/               # 7 диаграмм × (.mmd + .svg) = 14 файлов
│   ├── 01-system-architecture.{mmd,svg}
│   ├── 02-data-flow.{mmd,svg}
│   ├── 03-auth-flow.{mmd,svg}
│   ├── 04-booking-flow.{mmd,svg}
│   ├── 05-multi-channel-flow.{mmd,svg}
│   ├── 06-billing-lifecycle.{mmd,svg}
│   └── 07-state-machine.{mmd,svg}
├── fixes/                       # 5 fix proposals с кодом
│   ├── 01-booking-race-condition.md
│   ├── 02-google-calendar-backoff.md
│   ├── 03-ai-prompt-sanitization.md
│   ├── 04-rate-limit-auth.md
│   └── 05-encryption-enforcement.md
└── summary/                     # Метрики в JSON
    ├── metrics.json
    └── dependency-audit.json
```

**Всего файлов:** 24 (без опциональных `.png`)
