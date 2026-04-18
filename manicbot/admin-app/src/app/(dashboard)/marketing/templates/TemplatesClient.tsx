"use client";

import { MarketingShell, StubCard } from "../MarketingShell";
import { api } from "~/trpc/react";
import { FileText } from "lucide-react";

export default function TemplatesClient() {
  const listQ = (api as any).marketing.templatesList.useQuery({});

  return (
    <MarketingShell title="Marketing • Templates" subtitle="Шаблоны писем и SMS с переменными">
      <StubCard
        title="Шаблоны"
        description="HTML для email (как в server/email/templates.ts) + plain-text для SMS. Переменные в формате {{name}}, {{salon}}."
      >
        {listQ.isLoading ? (
          <div className="text-xs text-slate-500">Загрузка…</div>
        ) : listQ.data?.length ? (
          <ul className="space-y-1.5 mt-2">
            {listQ.data.map((t: any) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-slate-950/40 border border-slate-800 px-3 py-2 text-xs">
                <div>
                  <div className="font-semibold text-slate-100">{t.name}</div>
                  <div className="text-[10px] text-slate-500">{t.channel} • {t.locale ?? "multi"}</div>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">{t.id}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-xs">Шаблонов пока нет</div>
          </div>
        )}
      </StubCard>
    </MarketingShell>
  );
}
