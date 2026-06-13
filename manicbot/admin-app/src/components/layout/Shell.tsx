"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NotificationBell } from "./NotificationBell";
import { BrandTile } from "./BrandTile";
import {
  Home, Users, Settings, CreditCard, Activity,
  Building2, CalendarDays, UserCog,
  Globe, MessageSquare,
  Radio, ArrowLeftRight, Megaphone,
  Maximize2, Minimize2, Sun, Moon,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { api } from "~/trpc/react";
import { useDashboardPrefs } from "~/lib/useDashboardPrefs";
import { t, LANGS } from "~/lib/i18n";
import { tNav } from "~/lib/nav/navLabels";
import { useInWebShell } from "~/components/layout/WebShell";

export interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
}

/**
 * God Mode nav fallback used when a consumer of <Shell> doesn't pass `navItems`
 * (e.g. legacy Telegram Mini App routes). The proper WebShell sidebar comes
 * from `useNavItems()` — see PinnedNavSection. Keep labels via `tNav` so
 * fallback rendering still localizes correctly.
 */
function buildGodModeNavItems(lang: string): NavItem[] {
  return [
    { href: "/", icon: Home, label: tNav("Dashboard", lang) },
    { href: "/users", icon: Users, label: tNav("Users", lang) },
    { href: "/tenants", icon: Building2, label: tNav("Tenants", lang) },
    { href: "/appointments", icon: CalendarDays, label: tNav("Appointments", lang) },
    { href: "/messages", icon: MessageSquare, label: tNav("Inbox", lang) },
    { href: "/agents", icon: UserCog, label: tNav("Agents", lang) },
    { href: "/?tab=role-requests", icon: ArrowLeftRight, label: tNav("Role Requests", lang) },
    { href: "/channels", icon: Radio, label: tNav("Channels", lang) },
    { href: "/marketing", icon: Megaphone, label: tNav("Marketing", lang) },
    { href: "/billing", icon: CreditCard, label: tNav("Billing", lang) },
    { href: "/system", icon: Activity, label: tNav("System", lang) },
    { href: "/settings", icon: Settings, label: tNav("Settings", lang) },
  ];
}

function getAdminInfo() {
  return { name: "God Mode", username: "creator" };
}

// ─── Language: icon popover (toolbar) or open grid (settings) ─────
export function LangPickerInline({ placement = "toolbar" }: { placement?: "toolbar" | "settings" }) {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const persistLang = api.webUsers.setMyLang.useMutation();
  // The picker drives the client UI (setLang → localStorage) AND persists to
  // web_users.lang so SERVER-rendered content (platform messages, welcome,
  // emails) follows the selection. mutate is fire-and-forget; failures (e.g. a
  // not-yet-authenticated paint) are harmless and don't surface to the UI.
  const changeLang = (code: Parameters<typeof setLang>[0]) => {
    setLang(code);
    persistLang.mutate({ lang: code });
  };

  if (placement === "settings") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {LANGS.map(({ code, flag, label }) => (
          <button
            key={code}
            type="button"
            onClick={() => changeLang(code)}
            className={`flex flex-col items-center gap-1 py-3 rounded-xl border text-xs font-medium transition-all ${
              lang === code
                ? "bg-brand-100 border-brand-300 text-brand-800 dark:bg-brand-500/20 dark:border-brand-500/40 dark:text-brand-300"
                : "bg-slate-100 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10"
            }`}
          >
            <span className="text-2xl leading-none">{flag}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center h-8 w-8 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
        title={t("settings.language", lang)}
      >
        <Globe className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-2 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-2xl shadow-black/60">
            <div className="grid grid-cols-2 gap-1.5 w-[140px]">
              {LANGS.map(({ code, flag, label }) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => { changeLang(code); setOpen(false); }}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium transition-all ${
                    lang === code
                      ? "bg-brand-100 border border-brand-300 text-brand-800 dark:bg-brand-500/20 dark:border-brand-500/40 dark:text-brand-300"
                      : "bg-slate-100 border border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-400 dark:hover:text-white dark:hover:bg-white/10"
                  }`}
                >
                  <span className="text-base">{flag}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Theme + Fullscreen hooks (desktop top bar) ──────────────────
const THEME_STORAGE_KEY = "manicbot_web_theme";

/**
 * Toggle the dashboard theme by flipping `.dark` on <html> and persisting
 * to localStorage. Mirrors the public PublicThemeProvider key so both
 * surfaces stay in sync.
 */
function useDashboardTheme(): { isDark: boolean; toggle: () => void } {
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = () => {
    if (typeof document === "undefined") return;
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setIsDark(next);
  };
  return { isDark, toggle };
}

/**
 * Browser Fullscreen API wrapper. Fullscreen mode is essential for the
 * "salon OS" experience (e.g., dashboard on a reception desk iPad).
 */
function useFullscreen(): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = () => {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      document.documentElement.requestFullscreen().catch(() => undefined);
    }
  };
  return { isFullscreen, toggle };
}

/**
 * Desktop-only top bar: page title + theme toggle + fullscreen toggle.
 * Mobile keeps its own header (the existing one).
 */
function DashboardTopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { isDark, toggle: toggleTheme } = useDashboardTheme();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const { lang } = useLang();

  return (
    <header
      data-testid="dashboard-top-bar"
      className="hidden md:flex items-center gap-3 px-6 py-3 border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-slate-950/60 backdrop-blur-lg sticky top-0 z-30"
    >
      <div className="min-w-0 flex-1">
        <h1 className="text-sm font-semibold text-slate-900 dark:text-white truncate">{title}</h1>
        {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
      </div>

      <NotificationBell />

      <button
        type="button"
        onClick={toggleTheme}
        title={isDark ? t("topbar.lightMode", lang) : t("topbar.darkMode", lang)}
        aria-label={isDark ? t("topbar.lightMode", lang) : t("topbar.darkMode", lang)}
        data-testid="topbar-theme-toggle"
        className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <button
        type="button"
        onClick={toggleFullscreen}
        title={isFullscreen ? t("topbar.exitFullscreen", lang) : t("topbar.enterFullscreen", lang)}
        aria-label={isFullscreen ? t("topbar.exitFullscreen", lang) : t("topbar.enterFullscreen", lang)}
        aria-pressed={isFullscreen}
        data-testid="topbar-fullscreen-toggle"
        className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </header>
  );
}

// ─── Shell Component ─────────────────────────────────────────────
interface ShellProps {
  children: React.ReactNode;
  navItems?: NavItem[];
  title?: string;
  subtitle?: string;
}

export function Shell({ children, navItems, title, subtitle }: ShellProps) {
  // If inside WebShell (web dashboard), render only children — WebShell provides the chrome.
  const inWebShell = useInWebShell();
  if (inWebShell) return <>{children}</>;

  const pathname = usePathname();
  const [admin, setAdmin] = useState({ name: "God Mode", username: "creator" });
  const { role } = useRole();
  const { lang } = useLang();
  const { prefs: dashboardPrefs } = useDashboardPrefs();
  const activeNavItems = navItems ?? buildGodModeNavItems(lang);
  const displayTitle = title ?? "ManicBot";
  /** Creator in plain God Mode: language lives on /settings, not in the chrome (avoids clash with Settings tab). */
  const godPlainChrome = role === "system_admin";
  const showLangInChrome = !godPlainChrome;

  useEffect(() => { setAdmin(getAdminInfo()); }, []);

  // Mobile: keep Settings visible because creator preview/language live
  // there. Honour the user's saved bottom-nav order from Settings →
  // Appearance — falls back to the legacy "first 4 + Settings" slice
  // when no customisation is set, which preserves the previous
  // behavior byte-for-byte for the zero-prefs case.
  const mobileNavItems = (() => {
    const settingsItem =
      activeNavItems.find((item) => item.href === "/settings") ?? activeNavItems[activeNavItems.length - 1];
    if (
      dashboardPrefs.bottomNavLayout === "custom"
      && dashboardPrefs.bottomNavOrder.length > 0
    ) {
      const byHref = new Map(activeNavItems.map((n) => [n.href, n]));
      const chosen: typeof activeNavItems = [];
      const seen = new Set<string>();
      for (const href of dashboardPrefs.bottomNavOrder) {
        if (seen.has(href)) continue;
        const item = byHref.get(href);
        if (!item) continue;
        seen.add(href);
        chosen.push(item);
        if (chosen.length >= 5) break;
      }
      if (settingsItem && !seen.has(settingsItem.href)) {
        if (chosen.length >= 5) chosen.pop();
        chosen.push(settingsItem);
      }
      if (chosen.length > 0) return chosen;
    }
    if (activeNavItems.length <= 5) return activeNavItems;
    const leading = activeNavItems.filter((item) => item.href !== "/settings").slice(0, 4);
    return settingsItem ? [...leading, settingsItem] : activeNavItems.slice(0, 5);
  })();

  return (
    <div className="flex h-screen w-full flex-col md:flex-row bg-[var(--background)] text-[var(--foreground)] overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-60 flex-col border-r border-slate-200 dark:border-white/5 bg-white/90 dark:bg-slate-900/50 p-4 shrink-0">
        {/* Logo + title */}
        <div className="mb-6 px-1 flex items-center gap-3">
          <BrandTile className="h-9 w-9 rounded-xl shadow-lg shadow-brand-500/25" glyphClassName="text-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-slate-900 dark:text-white truncate">{displayTitle}</h1>
            <p className="text-[10px] text-slate-500">{subtitle ?? "Admin Panel"}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {activeNavItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const isSettingsHub = item.href === "/settings" && role === "system_admin";
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-all text-sm ${
                  isActive
                    ? "bg-brand-500/15 text-brand-400 font-medium"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-brand-400" : ""}`} />
                <span>{item.label}</span>
                {isSettingsHub && (
                  <span className="ml-auto rounded-full border border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                    Mode
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="mt-3 border-t border-slate-200 dark:border-white/5 pt-3 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-xs font-bold shrink-0">
              {admin.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-900 dark:text-white truncate">{admin.name}</p>
              <p className="text-[10px] text-slate-500">@{admin.username}</p>
            </div>
            {showLangInChrome && <LangPickerInline />}
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Desktop Top Bar (sticky, with fullscreen + theme toggle) */}
        <DashboardTopBar title={displayTitle} subtitle={subtitle} />

        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-white/5 bg-white/95 dark:bg-slate-950/80 backdrop-blur-lg sticky top-0 z-40">
          <BrandTile className="h-7 w-7 rounded-lg" glyphClassName="text-sm" />
          <h1 className="text-sm font-bold text-slate-900 dark:text-white flex-1 truncate">{displayTitle}</h1>
          {showLangInChrome && <LangPickerInline />}
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto p-4 pb-28 md:p-6 md:pb-6 relative">
          {/* Decorative gradient orbs */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-brand-500/8 blur-[100px]" />
            <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-purple-500/8 blur-[100px]" />
          </div>
          {/*
            No `z-N` on this wrapper. `relative z-10` would create a
            stacking context for `{children}`, trapping modals
            (`fixed inset-0 z-[100]` per the 0062 contract) at the
            wrapper's z-layer. The sticky header at z-30 then paints
            over them — visible as the light strip across the top of
            any open modal. The orb wrapper above is positioned
            `absolute` and this content wrapper appears later in DOM
            order, so the content paints on top naturally without an
            explicit z-index.
          */}
          <div className="relative mx-auto max-w-7xl w-full">{children}</div>
        </main>

        {/* ── Mobile Bottom Nav (fixed, equal-width tabs) ── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border-t border-slate-200 dark:border-white/5">
          <div className="flex items-center justify-around px-1 py-1 safe-area-pb">
            {mobileNavItems.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const isSettingsHub = item.href === "/settings" && role === "system_admin";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center justify-center py-1.5 flex-1 transition-all ${
                    isActive ? "text-brand-400" : "text-slate-500"
                  }`}
                >
                  <div className={`relative p-1 rounded-lg transition-all ${isActive ? "bg-brand-500/20 scale-110" : ""}`}>
                    <item.icon className="h-5 w-5" />
                    {isSettingsHub && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />}
                  </div>
                  <span className={`text-[9px] font-medium mt-0.5 ${isActive ? "text-brand-400" : "text-slate-600"}`}>
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
