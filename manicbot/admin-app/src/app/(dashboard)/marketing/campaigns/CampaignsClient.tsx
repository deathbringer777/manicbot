"use client";

import { MarketingShell, StubCard } from "../MarketingShell";
import { api } from "~/trpc/react";
import { Mail } from "lucide-react";

export default function CampaignsClient() {
  const listQ = (api as any).marketing.campaignsList.useQuery({ channel: "email" });

  return (
    <MarketingShell title="Marketing • Campaigns" subtitle="Email-рассылки клиентам и лидам">
      <StubCard
        title="Email кампании"
        description="API готов: создание, расписание, удаление. Отправка (fan-out через Brevo/Resend) — Phase 2."
      >
        {listQ.isLoading ? (
          <div className="text-xs text-slate-500">Загрузка…</div>
        ) : listQ.data?.length ? (
          <ul className="space-y-1.5">
            {listQ.data.map((c: any) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg bg-slate-950/40 border border-slate-800 px-3 py-2 text-xs">
                <div>
                  <div className="font-semibold text-slate-100">{c.name}</div>
                  <div className="text-[10px] text-slate-500">провайдер: {c.provider ?? "—"} • {c.segmentId ?? "без сегмента"}</div>
                </div>
                <span className="text-[10px] uppercase font-bold text-slate-400">{c.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-xs">Кампаний пока нет</div>
          </div>
        )}
      </StubCard>
    </MarketingShell>
  );
}
