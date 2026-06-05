/**
 * Marketing module sub-navigation — the tab strip under /marketing.
 *
 * Extracted out of MarketingShell (a "use client" component) so the visibility
 * rule is a pure, unit-testable function. The Automations tab is parked behind
 * MARKETING_AUTOMATIONS_ENABLED (see ~/lib/featureFlags); getMarketingTabs is
 * the single place that decides which tabs render.
 */

import {
  Megaphone, Users, Mail, MessageSquare, Workflow, FileText,
  type LucideIcon,
} from "lucide-react";
import type { TranslationKey } from "~/lib/i18n";

export type MarketingSubNavItem = { href: string; icon: LucideIcon; labelKey: TranslationKey };

/** Canonical, full list of marketing sub-tabs (order = display order). */
export const MARKETING_SUB_NAV: ReadonlyArray<MarketingSubNavItem> = [
  { href: "/marketing",              icon: Megaphone,     labelKey: "marketing.nav.overview" },
  { href: "/marketing/contacts",     icon: Users,         labelKey: "marketing.nav.contacts" },
  { href: "/marketing/campaigns",    icon: Mail,          labelKey: "marketing.nav.campaigns" },
  { href: "/marketing/sms",          icon: MessageSquare, labelKey: "marketing.nav.sms" },
  { href: "/marketing/automations",  icon: Workflow,      labelKey: "marketing.nav.automations" },
  { href: "/marketing/templates",    icon: FileText,      labelKey: "marketing.nav.templates" },
];

/**
 * Resolve the tabs to render. When the Automations cron engine is unbuilt the
 * tab is dropped so we don't surface a half-working surface to salon owners.
 */
export function getMarketingTabs(automationsEnabled: boolean): MarketingSubNavItem[] {
  return MARKETING_SUB_NAV.filter(
    (item) => automationsEnabled || item.href !== "/marketing/automations",
  );
}
