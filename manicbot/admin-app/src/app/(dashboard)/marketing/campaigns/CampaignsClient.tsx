"use client";

import { MarketingShell, StubCard } from "../MarketingShell";
import { api } from "~/trpc/react";
import { Mail } from "lucide-react";

export default function CampaignsClient() {
  const listQ = (api as any).marketing.campaignsList.useQuery({ channel: "email" });

  return (
    <MarketingShell title="Marketing • Campaigns" subtitle="Broadcast email campaigns to contacts and leads">
      <StubCard
        title="Email Campaigns"
        description="Create, schedule, and track email campaigns sent to your contact segments via Brevo or Resend. Sending launches in Phase 2."
      >
        {listQ.isLoading ? (
          <div className="text-xs text-slate-500 py-4 text-center">Loading…</div>
        ) : listQ.data?.length ? (
          <ul className="space-y-1.5 mt-2">
            {listQ.data.map((c: any) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg bg-slate-950/40 border border-slate-800 px-3 py-2 text-xs">
                <div>
                  <div className="font-semibold text-slate-100">{c.name}</div>
                  <div className="text-[10px] text-slate-500">provider: {c.provider ?? "—"} • {c.segmentId ?? "no segment"}</div>
                </div>
                <span className="text-[10px] uppercase font-bold text-slate-400">{c.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <div className="text-sm text-slate-400 font-medium mb-1">No campaigns yet</div>
            <div className="text-xs text-slate-500">Campaign creation and sending launches in Phase 2</div>
          </div>
        )}
      </StubCard>
    </MarketingShell>
  );
}
