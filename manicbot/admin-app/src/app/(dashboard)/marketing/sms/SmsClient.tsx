"use client";

import { MarketingShell, StubCard } from "../MarketingShell";
import { api } from "~/trpc/react";
import { MessageSquare, Zap } from "lucide-react";

export default function SmsClient() {
  const providersQ = (api as any).marketing.providersList.useQuery();
  const brevo = providersQ.data?.find((p: any) => p.name === "brevo");

  return (
    <MarketingShell title="Marketing • SMS" subtitle="SMS broadcast campaigns — Max plan add-on">
      <StubCard
        title="SMS Campaigns"
        description="Send targeted SMS messages to your contacts via Brevo Transactional SMS. Available on the Max plan."
      >
        <div className="space-y-3 mt-2">
          <div className="flex items-center gap-2 text-xs">
            <Zap className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
            <span className="text-slate-700 dark:text-slate-300">Brevo SMS:</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              brevo?.configured?.sms
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                : "bg-slate-200 dark:bg-slate-700/40 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700"
            }`}>
              {brevo?.configured?.sms ? "configured" : "not configured"}
            </span>
          </div>

          {!brevo?.configured?.sms && (
            <div className="text-[11px] text-slate-500 leading-relaxed">
              To enable, set <code className="text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-950 px-1 rounded">BREVO_API_KEY</code> and{" "}
              <code className="text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-950 px-1 rounded">BREVO_SMS_SENDER</code> in Cloudflare Pages environment variables.
            </div>
          )}

          <div className="text-center py-6 text-slate-500">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-sm text-slate-700 dark:text-slate-400 font-medium mb-1">SMS sending coming in Phase 2</div>
            <div className="text-xs text-slate-500">Requires Max plan + Brevo SMS configured</div>
          </div>
        </div>
      </StubCard>
    </MarketingShell>
  );
}
