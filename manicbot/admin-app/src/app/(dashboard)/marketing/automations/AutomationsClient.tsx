"use client";

import { MarketingShell, StubCard } from "../MarketingShell";
import { Workflow } from "lucide-react";

const PLANNED_TRIGGERS = [
  { key: "welcome",        label: "Welcome-серия",        desc: "Новая регистрация → 3 письма за 7 дней" },
  { key: "inactive_30d",   label: "Re-engagement 30 дней", desc: "Не заходил 30 дней → возврат-оффер" },
  { key: "birthday",       label: "День рождения",         desc: "За 3 дня → купон на скидку" },
  { key: "booking_confirm",label: "После бронирования",    desc: "Напоминание за 24ч + follow-up через 48ч" },
  { key: "abandoned_cart", label: "Брошенная запись",      desc: "Начал выбор, не завершил → через 2ч" },
];

export default function AutomationsClient() {
  return (
    <MarketingShell title="Marketing • Automations" subtitle="Триггерные сценарии — Phase 2">
      <StubCard
        title="Готовые сценарии"
        description="Шаблоны триггерных автоматизаций. Фактический движок (cron + worker) — в Phase 2."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
          {PLANNED_TRIGGERS.map((t) => (
            <div key={t.key} className="rounded-lg bg-slate-950/40 border border-slate-800 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Workflow className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-slate-100">{t.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{t.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </StubCard>
    </MarketingShell>
  );
}
