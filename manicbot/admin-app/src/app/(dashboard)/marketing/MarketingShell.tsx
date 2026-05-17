"use client";

/**
 * MarketingShell — sub-nav for the customer-facing Marketing module.
 *
 * The `Providers` tab used to live here as an admin-only entry. It was
 * moved to `/system/providers` (system_admin only) because:
 *
 *   - email/SMS vendor plumbing (Brevo, Resend, Twilio) is platform
 *     infrastructure, not a tenant feature;
 *   - Marketing is the salon-owner surface — every tab here must be
 *     useful to the salon owner;
 *   - sysadmin operating the provider toggle / health-check belongs in
 *     `/system/*` alongside other platform-level dashboards.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shell } from "~/components/layout/Shell";
import {
  Megaphone, Users, Mail, MessageSquare, Workflow, FileText, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, type TranslationKey } from "~/lib/i18n";
import { tNav } from "~/lib/nav/navLabels";
import { useMarketingScope } from "./useMarketingScope";

type SubNavItem = { href: string; icon: LucideIcon; labelKey: TranslationKey };

const SUB_NAV: Array<SubNavItem> = [
  { href: "/marketing",              icon: Megaphone,     labelKey: "marketing.nav.overview" },
  { href: "/marketing/contacts",     icon: Users,         labelKey: "marketing.nav.contacts" },
  { href: "/marketing/campaigns",    icon: Mail,          labelKey: "marketing.nav.campaigns" },
  { href: "/marketing/sms",          icon: MessageSquare, labelKey: "marketing.nav.sms" },
  { href: "/marketing/automations",  icon: Workflow,      labelKey: "marketing.nav.automations" },
  { href: "/marketing/templates",    icon: FileText,      labelKey: "marketing.nav.templates" },
];

export function MarketingShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const { lang } = useLang();
  // `mode: "admin"` means a sysadmin is on /marketing WITHOUT a tenant
  // preview — i.e. they're seeing cross-tenant data on the salon-owner URL.
  // PR 1 of the marketing roadmap added /system/marketing as the proper home
  // for that view; we point them there with a banner instead of silently
  // serving the data.
  const scope = useMarketingScope();
  const showSysadminBanner = scope.mode === "admin";
  const resolvedTitle = title ?? tNav("Marketing", lang);
  const resolvedSubtitle = subtitle ?? `${t("marketing.nav.contacts", lang)} · ${t("marketing.nav.campaigns", lang)} · ${t("marketing.nav.automations", lang)}`;

  return (
    <Shell title={resolvedTitle} subtitle={resolvedSubtitle}>
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-3 mb-5 overflow-x-auto">
        {SUB_NAV.map(({ href, icon: Icon, labelKey }) => {
          const label = t(labelKey, lang);
          const active =
            href === "/marketing" ? pathname === "/marketing" : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap
                ${active
                  ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/50 border border-transparent"
                }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>
      {showSysadminBanner && (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-bold text-amber-700 dark:text-amber-300">
              Это салон-сторона маркетинга
            </div>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Платформенный CRM, кросс-тенантные кампании и воронка лидов — в Центре маркетинга.
            </p>
          </div>
          <Link
            href="/system/marketing"
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300 sm:self-auto"
          >
            Открыть Центр маркетинга <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
      {children}
    </Shell>
  );
}

function ComingSoonBadge() {
  const { lang } = useLang();
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30">
      {t("marketing.comingSoon", lang)}
    </span>
  );
}

export function StubCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <ComingSoonBadge />
      </div>
      {description && <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{description}</p>}
      {children}
    </div>
  );
}
