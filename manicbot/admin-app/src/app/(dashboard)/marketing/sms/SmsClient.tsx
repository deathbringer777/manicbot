"use client";

import { MarketingShell, StubCard } from "../MarketingShell";
import { api } from "~/trpc/react";
import { MessageSquare, Zap } from "lucide-react";

export default function SmsClient() {
  const providersQ = (api as any).marketing.providersList.useQuery();
  const brevo = providersQ.data?.find((p: any) => p.name === "brevo");

  return (
    <MarketingShell title="Marketing • SMS" subtitle="SMS-рассылки — доп. фича тарифа Max">
      <StubCard
        title="SMS-кампании"
        description="Отправка SMS через Brevo Transactional SMS API. Доступно только на тарифе Max с отдельной квотой."
      >
        <div className="space-y-3 mt-2">
          <div className="flex items-center gap-2 text-xs">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-slate-300">Brevo SMS:</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              brevo?.configured?.sms
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "bg-slate-700/40 text-slate-400 border border-slate-700"
            }`}>
              {brevo?.configured?.sms ? "configured" : "not configured"}
            </span>
          </div>

          <div className="text-[11px] text-slate-500 leading-relaxed">
            Для активации задайте <code className="text-slate-300 bg-slate-950 px-1 rounded">BREVO_API_KEY</code> и
            {" "}<code className="text-slate-300 bg-slate-950 px-1 rounded">BREVO_SMS_SENDER</code> в Cloudflare Pages env vars.
            Sender — до 11 символов, латиница/цифры.
          </div>

          <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 text-[11px] text-amber-200/80">
            <b>Биллинг-гейт (Phase 3):</b> SMS доступны только тенантам с планом Max.
            Квота помесячная, счётчик в <code className="text-amber-100 bg-amber-950/40 px-1 rounded">tenants.sms_quota_used</code>.
            Отправка блокируется функцией <code className="text-amber-100 bg-amber-950/40 px-1 rounded">canUseSms(tenantId)</code>.
          </div>

          <div className="text-center py-6 text-slate-500">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-xs">SMS-кампании будут доступны после активации провайдера</div>
          </div>
        </div>
      </StubCard>
    </MarketingShell>
  );
}
