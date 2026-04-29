"use client";

import { MarketingShell, StubCard } from "../MarketingShell";
import { Workflow, Clock, RefreshCw, Gift, Bell, ShoppingCart } from "lucide-react";

const PLANNED_AUTOMATIONS = [
  { icon: Bell,         label: "Welcome Series",    desc: "Greet new contacts with a 3-email sequence over 7 days" },
  { icon: RefreshCw,    label: "Re-engagement",     desc: "Win back inactive contacts after 30 days" },
  { icon: Gift,         label: "Birthday Offers",   desc: "Send a discount coupon 3 days before their birthday" },
  { icon: Clock,        label: "Booking Reminders", desc: "Reminder 24h before + follow-up 48h after the appointment" },
  { icon: ShoppingCart, label: "Abandoned Booking", desc: "Recover lost bookings 2h after the user dropped off" },
];

export default function AutomationsClient() {
  return (
    <MarketingShell title="Marketing • Automations" subtitle="Trigger-based marketing workflows">
      <StubCard
        title="Automated Workflows"
        description="Set up trigger-based email and SMS sequences that run automatically — welcome series, re-engagement, birthday offers, and more."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
          {PLANNED_AUTOMATIONS.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-lg bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 px-3 py-2.5 opacity-80 dark:opacity-60">
              <div className="flex items-start gap-2">
                <Icon className="h-4 w-4 text-violet-500 dark:text-violet-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-4 text-center">
          Automation engine and cron triggers launch in Phase 2
        </p>
      </StubCard>
    </MarketingShell>
  );
}
