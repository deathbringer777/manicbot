import {
  Home, Users, Settings, CreditCard, Activity,
  Building2, CalendarDays, UserCog, MessageSquare,
  ScrollText, CalendarCheck, UserRound, Wallet, LayoutGrid,
  HeadphonesIcon, Scissors, Star, BarChart3, Globe, ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "~/server/api/routers/auth";

// ─── Types ──────────────────────────────────────────────────────

export interface NavItemDef {
  /** Stable identifier, e.g. "salon.appointments", "god.billing" */
  id: string;
  /** URL path (will migrate from ?tab= to /my-salon/... later) */
  href: string;
  icon: LucideIcon;
  /** Key into NAV_LABELS for i18n */
  labelKey: string;
  /** Which roles see this item */
  roles: AppRole[];
  /** Group key for God mode grouping (ignored for other roles) */
  group?: string;
  /** Only show when master is on a personal tenant */
  requiresPersonalTenant?: boolean;
  /** Can be hidden via useDashboardPrefs (salon tabs) */
  hideable?: boolean;
}

export interface NavGroupDef {
  id: string;
  labelKey: string;
}

// ─── Groups (God mode only — other roles get one unnamed group) ─

export const NAV_GROUPS: NavGroupDef[] = [
  { id: "overview", labelKey: "Overview" },
  { id: "management", labelKey: "Management" },
  { id: "platform", labelKey: "Platform" },
];

// ─── Items ──────────────────────────────────────────────────────

export const NAV_ITEMS: NavItemDef[] = [
  // ── God Mode ──
  { id: "god.dashboard",     href: "/dashboard",          icon: Home,            labelKey: "Dashboard",        roles: ["system_admin"], group: "overview" },
  { id: "god.tenants",       href: "/tenants",            icon: Building2,       labelKey: "Tenants",          roles: ["system_admin"], group: "management" },
  { id: "god.users",         href: "/users",              icon: Users,           labelKey: "Users",            roles: ["system_admin"], group: "management" },
  { id: "god.appointments",  href: "/appointments",       icon: CalendarDays,    labelKey: "Appointments",     roles: ["system_admin"], group: "management" },
  { id: "god.conversations", href: "/conversations",      icon: MessageSquare,   labelKey: "Inbox",            roles: ["system_admin"], group: "management" },
  { id: "god.roleRequests",  href: "/role-requests",      icon: ArrowLeftRight,  labelKey: "Role Requests",    roles: ["system_admin"], group: "management" },
  { id: "god.agents",        href: "/agents",             icon: UserCog,         labelKey: "Agents",           roles: ["system_admin"], group: "management" },
  { id: "god.support",       href: "/platform-support",   icon: HeadphonesIcon,  labelKey: "Platform tickets", roles: ["system_admin"], group: "platform" },
  { id: "god.billing",       href: "/billing",            icon: CreditCard,      labelKey: "Billing",          roles: ["system_admin"], group: "platform" },
  { id: "god.events",        href: "/events",             icon: ScrollText,      labelKey: "Events",           roles: ["system_admin"], group: "platform" },
  { id: "god.system",        href: "/system",             icon: Activity,        labelKey: "System",           roles: ["system_admin"], group: "platform" },

  // ── Salon (tenant_owner) — ?tab= hrefs handled by SalonDashboard monolith ──
  { id: "salon.overview",      href: "/dashboard",                    icon: LayoutGrid,    labelKey: "Dashboard",     roles: ["tenant_owner"] },
  { id: "salon.appointments",  href: "/dashboard?tab=appointments",   icon: CalendarDays,  labelKey: "Appointments",  roles: ["tenant_owner"], hideable: true },
  { id: "salon.services",      href: "/dashboard?tab=services",       icon: Scissors,      labelKey: "Services",      roles: ["tenant_owner"], hideable: true },
  { id: "salon.masters",       href: "/dashboard?tab=masters",        icon: UserRound,     labelKey: "Masters",       roles: ["tenant_owner"], hideable: true },
  { id: "salon.clients",       href: "/dashboard?tab=clients",        icon: Users,         labelKey: "Clients",       roles: ["tenant_owner"], hideable: true },
  { id: "salon.billing",       href: "/dashboard?tab=billing",        icon: Wallet,        labelKey: "Billing",       roles: ["tenant_owner"], hideable: true },
  { id: "salon.channels",      href: "/dashboard?tab=channels",       icon: MessageSquare, labelKey: "Channels",      roles: ["tenant_owner"], hideable: true },
  { id: "salon.analytics",     href: "/dashboard?tab=analytics",      icon: BarChart3,     labelKey: "Analytics",     roles: ["tenant_owner"], hideable: true },
  { id: "salon.reviews",       href: "/dashboard?tab=reviews",        icon: Star,          labelKey: "Reviews",       roles: ["tenant_owner"], hideable: true },
  { id: "salon.publicProfile", href: "/dashboard?tab=public_profile", icon: Globe,         labelKey: "PublicProfile", roles: ["tenant_owner"], hideable: true },

  // ── Master — ?tab= hrefs handled by MasterDashboard monolith ──
  { id: "master.today",    href: "/dashboard",                  icon: Home,          labelKey: "Today",    roles: ["master"] },
  { id: "master.schedule", href: "/dashboard?tab=schedule",     icon: CalendarCheck, labelKey: "Schedule", roles: ["master"] },
  { id: "master.clients",  href: "/dashboard?tab=clients",      icon: Users,         labelKey: "Clients",  roles: ["master"] },
  { id: "master.earnings", href: "/dashboard?tab=earnings",     icon: Wallet,        labelKey: "Earnings", roles: ["master"] },
  { id: "master.reviews",  href: "/dashboard?tab=reviews",      icon: Star,          labelKey: "Reviews",  roles: ["master"] },
  { id: "master.services", href: "/dashboard?tab=services",     icon: Scissors,      labelKey: "Services", roles: ["master"], requiresPersonalTenant: true },
  { id: "master.profile",  href: "/dashboard?tab=profile",      icon: UserRound,     labelKey: "Profile",  roles: ["master"] },

  // ── Support ──
  { id: "support.tickets", href: "/dashboard", icon: HeadphonesIcon, labelKey: "Tickets", roles: ["support", "technical_support"] },
];

/** Settings item — always appended in sidebar footer, separate from nav groups. */
export const SETTINGS_ITEM: NavItemDef = {
  id: "common.settings",
  href: "/settings",
  icon: Settings,
  labelKey: "Settings",
  roles: ["system_admin", "tenant_owner", "master", "support", "technical_support"],
};

// ─── Helpers ────────────────────────────────────────────────────

export function getRoleInfo(role: string | null, lang: string, tNav: (key: string, lang: string) => string): { title: string; subtitle: string; badge?: string } {
  switch (role) {
    case "system_admin": return { title: "ManicBot", subtitle: tNav("Admin Panel", lang), badge: tNav("God Mode", lang) };
    case "tenant_owner": return { title: tNav("My Salon", lang), subtitle: tNav("Dashboard", lang) };
    case "master": return { title: tNav("My Schedule", lang), subtitle: tNav("Master", lang) };
    case "support": return { title: tNav("Support", lang), subtitle: tNav("Agent Hub", lang) };
    case "technical_support": return { title: tNav("Tech Support", lang), subtitle: tNav("Agent Hub", lang) };
    default: return { title: "ManicBot", subtitle: tNav("Dashboard", lang) };
  }
}
