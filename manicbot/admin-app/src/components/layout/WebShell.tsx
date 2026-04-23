"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Settings,
  LogOut, Menu, X, Zap, ChevronLeft, ChevronRight, ChevronDown,
  Sun, Moon, Compass, Building2,
  type LucideIcon,
} from "lucide-react";
import { PinnedNavSection } from "~/components/layout/PinnedNavSection";
import { useCollapsedGroups } from "~/lib/plugins/collapsedGroups";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { LangDropdown } from "~/components/public/LangDropdown";
import { DashboardOnboarding } from "~/components/onboarding/DashboardOnboarding";
import type { NavItem, NavGroup } from "~/lib/nav/useNavItems";
import { TOUR_REPLAY_EVENT } from "~/lib/onboarding/constants";
import { useNavItems, tNav, getRoleInfo } from "~/lib/nav/useNavItems";
import { MasterSwitcherInline } from "~/components/layout/Shell";

/** When true, inner <Shell> renders only children (no double sidebar). */
export const WebShellContext = createContext(false);
export const useInWebShell = () => useContext(WebShellContext);

// Navigation config, labels, and role info are now in ~/lib/nav/*.
// useNavItems() hook handles filtering by role, personalTenant, hiddenTabs.

function getPageTitle(pathname: string, flat: NavItem[], lang: string): string {
  if (pathname.startsWith("/settings")) return tNav("Settings", lang);
  const exact = flat.find(n => n.href === pathname);
  if (exact) return exact.label;
  const match = flat.find(n => n.href !== "/" && pathname.startsWith(n.href));
  return match?.label ?? tNav("Dashboard", lang);
}

function CollapsibleNavGroup({
  group,
  collapsed,
  isActive,
  onItemClick,
}: {
  group: NavGroup;
  collapsed: boolean;
  isActive: (item: NavItem) => boolean;
  onItemClick?: () => void;
}) {
  const { isCollapsed, toggle } = useCollapsedGroups();
  const groupCollapsed = isCollapsed(group.id);
  const hasHeader = !!group.label;
  return (
    <div data-testid="nav-group" data-group-id={group.id} data-collapsed={groupCollapsed ? "1" : "0"}>
      {hasHeader && !collapsed && (
        <button
          type="button"
          onClick={() => toggle(group.id)}
          data-testid="nav-group-toggle"
          className="w-full flex items-center justify-between px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#9ca3af] dark:text-slate-600 hover:text-[#6b7280] dark:hover:text-slate-400 transition-colors"
          aria-expanded={!groupCollapsed}
          aria-controls={`nav-group-${group.id}`}
        >
          <span>{group.label}</span>
          <ChevronDown
            size={11}
            className={`transition-transform ${groupCollapsed ? "-rotate-90" : ""}`}
          />
        </button>
      )}
      {!groupCollapsed && (
        <div id={`nav-group-${group.id}`} className="space-y-0.5">
          {group.items.map((item) => (
            <NavLink
              key={item.href + item.label}
              item={item}
              active={isActive(item)}
              collapsed={collapsed}
              onClick={onItemClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NavLink({ item, active, collapsed, onClick, dataTour, showBadge }: {
  item: NavItem;
  active: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  /** Product tour anchor (e.g. settings link). */
  dataTour?: string;
  /** Show a red dot badge (e.g. for unverified email). */
  showBadge?: boolean;
}) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      data-tour={dataTour}
      className={`group flex items-center gap-2.5 px-3 py-2 transition-all duration-150 relative rounded-lg ${
        active
          ? "bg-accent-500/10 dark:bg-accent-500/15 text-accent-700 dark:text-accent-400 font-semibold border-l-[3px] border-accent-500 dark:border-accent-400"
          : "text-[#6b7280] dark:text-slate-400 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-slate-200 border-l-[3px] border-transparent"
      } ${collapsed ? "justify-center px-0 border-l-0" : ""}`}
      title={collapsed ? item.label : undefined}
    >
      <span className="relative shrink-0">
        <item.icon className={`h-[17px] w-[17px] transition-colors ${
          active
            ? "text-accent-600 dark:text-accent-400"
            : "text-[#9ca3af] dark:text-slate-500 group-hover:text-[#374151] dark:group-hover:text-slate-300"
        }`} />
        {showBadge && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-900" />
        )}
      </span>
      {!collapsed && <span className="text-[13px] leading-none">{item.label}</span>}
    </Link>
  );
}

export function WebShell({ children, userEmail }: { children: React.ReactNode; userEmail?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role, previewRole, createdAt, emailVerified, isPersonalTenant, tenantName } = useRole();
  const { lang, setLang } = useLang();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  // Light/dark theme — default light
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("manicbot_web_theme");
    return stored === "dark";
  });
  // Sync with document.documentElement so CSS variables (:root:not(.dark)) respond to theme toggle
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);
  const toggleTheme = () => {
    setIsDark(v => {
      const next = !v;
      localStorage.setItem("manicbot_web_theme", next ? "dark" : "light");
      return next;
    });
  };

  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const { groups: navGroups, flat: flatNav, settings: settingsItem } = useNavItems();
  const roleInfo = getRoleInfo(effectiveRole, lang, tNav);
  const pageTitle = getPageTitle(pathname, flatNav, lang);

  const handleLogout = async () => {
    setShowLogoutDialog(false);
    await signOut({ redirect: false });
    window.location.replace("/login");
  };

  const isActive = (item: NavItem) => {
    const qIdx = item.href.indexOf("?");
    if (qIdx !== -1) {
      const itemParams = new URLSearchParams(item.href.slice(qIdx));
      const itemTab = itemParams.get("tab");
      return itemTab ? itemTab === searchParams.get("tab") : false;
    }
    if (item.href === "/dashboard" || item.href === "/") {
      return (pathname === "/dashboard" || pathname === "/") && !searchParams.get("tab");
    }
    return pathname.startsWith(item.href);
  };

  // Mobile nav: max 5
  const mobileNav = flatNav.length <= 5
    ? flatNav
    : [...flatNav.slice(0, 4), flatNav.find(n => n.href.includes("settings")) ?? flatNav[flatNav.length - 1]!];

  // Tour button: show for first 2 days after registration for non-admin roles
  const showTourButton = (() => {
    if (effectiveRole === "system_admin") return false;
    if (!createdAt) return false;
    const twoDays = 2 * 24 * 3600;
    return (Math.floor(Date.now() / 1000) - createdAt) < twoDays;
  })();

  // User avatar initial

  return (
    <WebShellContext.Provider value={true}>
      <div className={`${isDark ? "dark" : ""} flex h-screen w-full overflow-hidden bg-[#fafaf7] dark:bg-slate-900`}>

        {/* ═══ Desktop Sidebar ═══ */}
        <aside
          data-tour="web-sidebar"
          className={`hidden lg:flex flex-col border-r border-[#e5e7eb] dark:border-white/[0.06] bg-[#fafaf7] dark:bg-slate-900/70 transition-all duration-300 ease-out shrink-0 ${
            collapsed ? "w-[72px]" : "w-64"
          }`}
        >
          {/* Logo — clickable */}
          <div className={`relative flex items-center gap-3 h-[60px] border-b border-[#e5e7eb] dark:border-white/[0.06] ${collapsed ? "px-4 justify-center" : "px-4"}`}>
            <Link href="/dashboard" className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a1a2e] dark:bg-white shrink-0">
                <Zap className="h-4 w-4 text-white dark:text-[#1a1a2e]" />
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <h1 className="text-[13px] font-bold text-[#1a1a2e] dark:text-white tracking-tight truncate">{roleInfo.title}</h1>
                  <p className="text-[10px] text-[#9ca3af] dark:text-slate-500 truncate">{roleInfo.subtitle}</p>
                </div>
              )}
            </Link>
            {!collapsed ? (
              <button onClick={() => setCollapsed(true)} className="p-1 rounded-md text-[#9ca3af] dark:text-slate-600 hover:text-[#6b7280] dark:hover:text-slate-400 transition-colors shrink-0">
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <button onClick={() => setCollapsed(false)} className="absolute -right-3 top-4 z-10 h-6 w-6 rounded-full bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-white/10 flex items-center justify-center text-[#9ca3af] dark:text-slate-500 hover:text-[#6b7280] dark:hover:text-slate-300 transition-colors shadow-sm">
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Nav groups */}
          <nav className="flex-1 px-2.5 py-4 space-y-5 overflow-y-auto scrollbar-none">
            <PinnedNavSection collapsed={collapsed} showEmpty />
            {navGroups.map((group) => (
              <CollapsibleNavGroup
                key={group.id}
                group={group}
                collapsed={collapsed}
                isActive={isActive}
              />
            ))}
          </nav>

          {/* Bottom: Master switcher (owner only) + Settings */}
          <div className="border-t border-[#e5e7eb] dark:border-white/[0.06] p-2.5 space-y-1">
            {!collapsed && <MasterSwitcherInline />}
            <NavLink
              item={settingsItem}
              active={pathname.startsWith("/settings")}
              collapsed={collapsed}
              dataTour="web-settings"
              showBadge={!emailVerified}
            />
          </div>
        </aside>

        {/* ═══ Mobile Drawer ═══ */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            <aside className="relative w-72 max-w-[85vw] bg-[#fafaf7] dark:bg-slate-900/98 border-r border-[#e5e7eb] dark:border-white/[0.06] flex flex-col">
              {/* Header — clickable logo */}
              <div className="flex items-center justify-between h-[60px] px-4 border-b border-[#e5e7eb] dark:border-white/[0.06]">
                <Link href="/dashboard" onClick={() => setSidebarOpen(false)} className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a1a2e] dark:bg-white shrink-0">
                    <Zap className="h-4 w-4 text-white dark:text-[#1a1a2e]" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-[13px] font-bold text-[#1a1a2e] dark:text-white truncate">{roleInfo.title}</h1>
                    <p className="text-[10px] text-[#9ca3af] dark:text-slate-500 truncate">{roleInfo.subtitle}</p>
                  </div>
                </Link>
                <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg hover:bg-[#f3f4f6] dark:hover:bg-white/5 text-[#6b7280] dark:text-slate-400 shrink-0">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Nav groups */}
              <nav className="flex-1 px-2.5 py-4 space-y-5 overflow-y-auto scrollbar-none">
                <PinnedNavSection />
                {navGroups.map((group) => (
                  <CollapsibleNavGroup
                    key={group.id}
                    group={group}
                    collapsed={false}
                    isActive={isActive}
                    onItemClick={() => setSidebarOpen(false)}
                  />
                ))}
              </nav>

              {/* Mobile drawer bottom: settings only — logout in header */}
              <div className="border-t border-[#e5e7eb] dark:border-white/[0.06] p-2.5">
                <NavLink
                  item={settingsItem}
                  active={pathname.startsWith("/settings")}
                  onClick={() => setSidebarOpen(false)}
                  dataTour="web-settings"
                  showBadge={!emailVerified}
                />
              </div>
            </aside>
          </div>
        )}

        {/* ═══ Main area ═══ */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <header
            data-tour="web-header"
            className="h-[60px] flex items-center gap-3 px-4 lg:px-6 border-b border-[#e5e7eb] dark:border-white/[0.06] bg-white dark:bg-slate-900/80 shrink-0 z-30"
          >
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-[#f3f4f6] dark:hover:bg-white/5 text-[#6b7280] dark:text-slate-400"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* Mobile logo + title */}
            <div className="lg:hidden flex items-center gap-2 min-w-0 flex-1">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1a1a2e] dark:bg-white shrink-0">
                <Zap className="h-3.5 w-3.5 text-white dark:text-[#1a1a2e]" />
              </div>
              <span className="text-[13px] font-bold text-[#1a1a2e] dark:text-white truncate">{pageTitle}</span>
            </div>
            {/* Desktop: page title */}
            <div className="hidden lg:block flex-1">
              <h2 className="text-[13px] font-semibold text-[#1a1a2e] dark:text-white">{pageTitle}</h2>
            </div>

            {/* Right: salon badge + theme toggle + user pill */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Salon name badge for masters */}
              {role === "master" && tenantName && (
                <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium max-w-[180px]">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tenantName}</span>
                </div>
              )}
              {/* Tour replay button (first 2 days) */}
              {showTourButton && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT))}
                  className="relative h-8 w-8 flex items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 hover:text-violet-300 transition-colors"
                  title={lang === "ru" ? "Тур по интерфейсу" : lang === "ua" ? "Тур по інтерфейсу" : lang === "pl" ? "Przewodnik" : "Interface tour"}
                >
                  <Compass className="h-4 w-4" />
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                </button>
              )}

              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#e5e7eb] dark:border-white/10 bg-white dark:bg-white/[0.04] text-[#6b7280] dark:text-slate-400 hover:text-[#1a1a2e] dark:hover:text-white hover:bg-[#f3f4f6] dark:hover:bg-white/8 transition-colors"
                title={isDark ? "Light mode" : "Dark mode"}
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              {/* Language selector */}
              <LangDropdown lang={lang} setLang={setLang} />

              {/* Logout button */}
              <button
                onClick={() => setShowLogoutDialog(true)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#e5e7eb] dark:border-white/10 bg-white dark:bg-white/[0.04] text-[#6b7280] dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all text-[12px] font-medium"
                title={tNav("Logout", lang)}
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:block">{tNav("Logout", lang)}</span>
              </button>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto relative h-0">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-brand-500/[0.05] blur-[120px]" />
              <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-purple-500/[0.05] blur-[120px]" />
            </div>
            <div className="min-h-full flex flex-col">
              <div data-tour="web-content" className="relative z-10 p-4 lg:p-6 pb-8 lg:pb-6 mx-auto max-w-7xl w-full flex-1">
                {children}
              </div>
            </div>
          </main>

          {/* ═══ Mobile Bottom Nav ═══ */}
          <nav
            data-tour="web-mobile-nav"
            className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900/95 border-t border-[#e5e7eb] dark:border-white/[0.06]"
          >
            <div className="flex items-center justify-around px-1 py-1.5">
              {mobileNav.map((item) => {
                const active = isActive(item);
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    data-tour={item.href === "/settings" ? "web-settings" : undefined}
                    className={`flex flex-col items-center justify-center py-1 flex-1 transition-colors ${
                      active ? "text-accent-600 dark:text-accent-400" : "text-[#9ca3af] dark:text-slate-600"
                    }`}
                  >
                    <div className={`p-1.5 rounded-lg transition-all ${active ? "bg-accent-500/15 scale-105" : ""}`}>
                      <item.icon className="h-5 w-5" />
                    </div>
                    <span className={`text-[9px] font-medium mt-0.5 ${active ? "text-accent-600 dark:text-accent-400" : "text-[#9ca3af] dark:text-slate-700"}`}>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>

        {/* ═══ Logout confirmation dialog ═══ */}
        {showLogoutDialog && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowLogoutDialog(false); }}
          >
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-[#e5e7eb] dark:border-white/10 p-6 shadow-xl max-w-sm w-full mx-4">
              <h3 className="text-[15px] font-bold text-[#1a1a2e] dark:text-white mb-1">
                {tNav("LogoutConfirmTitle", lang)}
              </h3>
              <p className="text-[13px] text-[#6b7280] dark:text-slate-400 mb-5">
                {tNav("LogoutConfirmDesc", lang)}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLogoutDialog(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[#e5e7eb] dark:border-white/10 text-[13px] font-medium text-[#374151] dark:text-slate-300 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.05] transition-colors"
                >
                  {tNav("Cancel", lang)}
                </button>
                <button
                  onClick={handleLogout}
                  className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 active:bg-red-700 text-white text-[13px] font-semibold transition-colors"
                >
                  {tNav("Logout", lang)}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <DashboardOnboarding />
    </WebShellContext.Provider>
  );
}
