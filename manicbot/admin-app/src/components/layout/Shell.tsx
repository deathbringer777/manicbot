"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home, Users, Settings, CreditCard, Activity,
  Building2, CalendarDays, Zap, UserCog, ChevronDown,
  X, Scissors, HeadphonesIcon, Globe, MessageSquare,
  Lock, Unlock, Radio, ArrowLeftRight, Megaphone,
  Maximize2, Minimize2, Sun, Moon,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { useDashboardPrefs } from "~/lib/useDashboardPrefs";
import { t, LANGS } from "~/lib/i18n";
import { tNav } from "~/lib/nav/navLabels";
import { api } from "~/trpc/react";
import { useInWebShell } from "~/components/layout/WebShell";
import type { AppRole } from "~/server/api/routers/auth";

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
    { href: "/conversations", icon: MessageSquare, label: tNav("Inbox", lang) },
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

// ─── Role Switcher (inline in header) ────────────────────────────
const ROLE_OPTIONS: { role: AppRole; icon: React.ElementType; color: string; bg: string }[] = [
  { role: "system_admin",  icon: Zap,            color: "text-blue-400",    bg: "bg-blue-500/20" },
  { role: "tenant_owner",  icon: Building2,       color: "text-purple-400",  bg: "bg-purple-500/20" },
  { role: "master",        icon: Scissors,        color: "text-emerald-400", bg: "bg-emerald-500/20" },
  { role: "support",       icon: HeadphonesIcon,  color: "text-amber-400",   bg: "bg-amber-500/20" },
];

export function RoleSwitcherInline({ placement = "toolbar" }: { placement?: "toolbar" | "settings" }) {
  const { role, previewRole, setPreviewRole, setPreviewMaster } = useRole();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState<AppRole>(null);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [step, setStep] = useState<"role" | "tenant" | "master">("role");
  const [selectedMasterId, setSelectedMasterId] = useState<number | null>(null);
  const tenants = api.tenants.getAll.useQuery(undefined, {
    enabled: role === "system_admin" && open && (pendingRole === "tenant_owner" || pendingRole === "master"),
  });
  const mastersForPick = api.master.getMastersForOwner.useQuery(
    { tenantId: selectedTenantId },
    { enabled: role === "system_admin" && step === "master" && !!selectedTenantId },
  );

  if (role !== "system_admin") return null;

  const inSettings = placement === "settings";
  const activePreview = previewRole && previewRole !== "system_admin";
  const currentDisplay = activePreview ? previewRole : "system_admin";
  const opt = ROLE_OPTIONS.find(o => o.role === currentDisplay);
  const Icon = opt?.icon ?? Zap;

  const roleLabel: Record<string, string> = {
    system_admin: t("roleSwitch.godMode", lang),
    tenant_owner: t("roleSwitch.salon", lang),
    master: t("roleSwitch.master", lang),
    support: t("roleSwitch.support", lang),
    technical_support: t("roleSwitch.support", lang),
  };

  function handleSelectRole(r: AppRole) {
    setStep("role");
    if (r === "system_admin") { setPreviewRole(null); setPreviewMaster(null); setOpen(false); return; }
    if (r === "support" || r === "technical_support") { setPreviewRole(r); setOpen(false); return; }
    setPendingRole(r); setSelectedTenantId(""); setStep("tenant");
  }

  function confirmTenantPreview() {
    if (!selectedTenantId || !pendingRole) return;
    if (pendingRole === "master") {
      setStep("master");
      setSelectedMasterId(null);
      return;
    }
    setPreviewRole(pendingRole, selectedTenantId);
    setPendingRole(null); setOpen(false); setStep("role");
  }

  function confirmMasterPreview() {
    if (!selectedMasterId) return;
    setPreviewRole("master", selectedTenantId);
    setPreviewMaster(selectedMasterId);
    setPendingRole(null); setOpen(false); setStep("role"); setSelectedMasterId(null);
  }

  function resetPicker() {
    setPendingRole(null); setStep("role"); setSelectedTenantId(""); setSelectedMasterId(null);
  }

  const dropdownContent = (
    <>
      <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {t("roleSwitch.title", lang)}
      </p>
      {step === "master" ? (
        <div className="space-y-2 p-2">
          <p className="text-xs text-slate-400">{t("roleSwitch.pickMaster", lang)}</p>
          {mastersForPick.isLoading ? (
            <div className="h-8 animate-pulse rounded-xl bg-slate-800" />
          ) : !mastersForPick.data?.length ? (
            <p className="text-xs text-slate-500 px-1">{t("masterSwitch.none", lang)}</p>
          ) : (
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {mastersForPick.data.map((m: any) => (
                <button
                  key={m.chatId}
                  onClick={() => setSelectedMasterId(m.chatId)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-all ${
                    selectedMasterId === m.chatId ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-[10px] font-bold text-emerald-400 shrink-0">
                    {(m.name ?? "M").charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 text-xs font-medium truncate">{m.name ?? `#${m.chatId}`}</span>
                  {m.allowDelegation ? (
                    <Unlock className="h-3 w-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Lock className="h-3 w-3 text-slate-600 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => setStep("tenant")}
              className="flex-1 rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:text-white"
            >
              {t("common.back", lang)}
            </button>
            <button
              onClick={confirmMasterPreview}
              disabled={!selectedMasterId}
              className="flex-1 rounded-xl border border-brand-500/30 bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 transition-colors disabled:opacity-30"
            >
              OK
            </button>
          </div>
        </div>
      ) : step === "tenant" ? (
        <div className="space-y-2 p-2">
          <p className="text-xs text-slate-400">{t("roleSwitch.pickTenant", lang)}</p>
          {tenants.isLoading ? (
            <div className="h-8 animate-pulse rounded-xl bg-slate-800" />
          ) : (
            <select
              value={selectedTenantId}
              onChange={e => setSelectedTenantId(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-800 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">—</option>
              {tenants.data?.map((tn: any) => (
                <option key={tn.id} value={tn.id}>{tn.name}</option>
              ))}
            </select>
          )}
          <div className="flex gap-2">
            <button
              onClick={resetPicker}
              className="flex-1 rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:text-white"
            >
              {t("common.back", lang)}
            </button>
            <button
              onClick={confirmTenantPreview}
              disabled={!selectedTenantId}
              className="flex-1 rounded-xl border border-brand-500/30 bg-brand-500/20 px-3 py-1.5 text-xs text-brand-400 transition-colors disabled:opacity-30"
            >
              OK
            </button>
          </div>
        </div>
      ) : (
        ROLE_OPTIONS.map(({ role: r, icon: RIcon, color, bg }) => (
          <button
            key={r}
            onClick={() => handleSelectRole(r)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${
              currentDisplay === r ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${bg}`}>
              <RIcon className={`h-3.5 w-3.5 ${color}`} />
            </div>
            <span className="flex-1 text-xs font-medium">{roleLabel[r ?? ""] ?? r}</span>
            {currentDisplay === r && <div className="h-1.5 w-1.5 rounded-full bg-brand-400" />}
          </button>
        ))
      )}
    </>
  );

  return (
    <div className={`relative ${inSettings ? "w-full overflow-visible" : ""}`}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); resetPicker(); }}
        className={`flex items-center gap-1.5 rounded-xl text-xs font-medium transition-all ${
          inSettings ? "w-full justify-between px-3 py-3" : "px-2.5 py-1.5"
        } ${
          activePreview
            ? "bg-amber-100 border border-amber-300 text-amber-800 dark:bg-amber-500/20 dark:border-amber-500/30 dark:text-amber-300"
            : "bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
        }`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${opt?.color ?? "text-blue-400"}`} />
          <span className={inSettings ? "truncate" : "max-w-[80px] truncate"}>{roleLabel[currentDisplay ?? "system_admin"]}</span>
        </span>
        <ChevronDown className={`h-3 w-3 text-slate-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Preview exit — toolbar: under control; settings: inline */}
      {activePreview && !open && !inSettings && (
        <button
          type="button"
          onClick={() => setPreviewRole(null)}
          className="absolute -bottom-7 left-0 right-0 flex items-center justify-center gap-1 text-[10px] text-amber-400 hover:text-amber-300"
        >
          <X className="h-3 w-3" /> {t("roleSwitch.exit", lang)}
        </button>
      )}
      {activePreview && !open && inSettings && (
        <button
          type="button"
          onClick={() => setPreviewRole(null)}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15"
        >
          <X className="h-3.5 w-3.5" /> {t("roleSwitch.exit", lang)}
        </button>
      )}

      {/* Dropdown */}
      {open && (
        inSettings ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-slate-900 p-2 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.85)]">
            {dropdownContent}
          </div>
        ) : (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl">
              {dropdownContent}
            </div>
          </>
        )
      )}
    </div>
  );
}

// ─── Master Switcher (sidebar — shown when effective role is tenant_owner) ────
export function MasterSwitcherInline() {
  const { role, previewRole, previewTenantId, previewMasterId, setPreviewMaster, tenantId } = useRole();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);

  // Mirror dashboard routing's effective role logic
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const effectiveTenantId = (role === "system_admin" && previewRole) ? previewTenantId : tenantId;

  // Only render when acting as tenant_owner
  if (effectiveRole !== "tenant_owner" || !effectiveTenantId) return null;

  const mastersQuery = api.master.getMastersForOwner.useQuery(
    { tenantId: effectiveTenantId },
    { enabled: open },
  );

  const isViewingMaster = previewMasterId !== null;
  const activeMasterName = isViewingMaster
    ? (mastersQuery.data?.find((m: any) => m.chatId === previewMasterId)?.name ?? `#${previewMasterId}`)
    : null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex w-full items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-all ${
          isViewingMaster
            ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-300"
            : "border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200"
        }`}
      >
        <Scissors className="h-3.5 w-3.5 shrink-0 text-emerald-500 dark:text-emerald-400" />
        <span className="flex-1 text-left truncate">
          {isViewingMaster ? activeMasterName : t("masterSwitch.viewAs", lang)}
        </span>
        {isViewingMaster && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); setPreviewMaster(null); setOpen(false); }}
            onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); setPreviewMaster(null); setOpen(false); } }}
            className="shrink-0 flex h-5 w-5 items-center justify-center rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-600 hover:text-slate-900 cursor-pointer dark:bg-white/10 dark:hover:bg-white/20 dark:text-slate-400 dark:hover:text-white"
          >
            <X className="h-3 w-3" />
          </span>
        )}
        <ChevronDown className={`h-3 w-3 text-slate-400 dark:text-slate-500 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95 dark:shadow-black/60">
            <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">
              {t("masterSwitch.title", lang)}
            </p>
            {mastersQuery.isLoading ? (
              <div className="h-8 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800 mx-1" />
            ) : !mastersQuery.data?.length ? (
              <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-500">{t("masterSwitch.none", lang)}</p>
            ) : (
              mastersQuery.data.map((m: any) => (
                <button
                  key={m.chatId}
                  onClick={() => { setPreviewMaster(m.chatId); setOpen(false); }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${
                    previewMasterId === m.chatId
                      ? "bg-slate-100 text-slate-900 dark:bg-white/10 dark:text-white"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
                  }`}
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-[11px] font-bold text-emerald-700 shrink-0 dark:bg-emerald-500/20 dark:text-emerald-400">
                    {(m.name ?? "M").charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 text-xs font-medium truncate">{m.name ?? `#${m.chatId}`}</span>
                  {m.allowDelegation ? (
                    <Unlock className="h-3 w-3 text-emerald-500 shrink-0 dark:text-emerald-400" />
                  ) : (
                    <Lock className="h-3 w-3 text-slate-400 shrink-0 dark:text-slate-600" />
                  )}
                  {previewMasterId === m.chatId && (
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0 dark:bg-emerald-400" />
                  )}
                </button>
              ))
            )}
            {isViewingMaster && (
              <button
                onClick={() => { setPreviewMaster(null); setOpen(false); }}
                className="mt-1 w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:hover:bg-emerald-500/15"
              >
                <X className="h-3.5 w-3.5" /> {t("masterSwitch.exit", lang)}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Language: icon popover (toolbar) or open grid (settings) ─────
export function LangPickerInline({ placement = "toolbar" }: { placement?: "toolbar" | "settings" }) {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);

  if (placement === "settings") {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {LANGS.map(({ code, flag, label }) => (
          <button
            key={code}
            type="button"
            onClick={() => setLang(code)}
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
                  onClick={() => { setLang(code); setOpen(false); }}
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
  const { role, previewRole } = useRole();
  const { lang } = useLang();
  const { prefs: dashboardPrefs } = useDashboardPrefs();
  const activeNavItems = navItems ?? buildGodModeNavItems(lang);
  const displayTitle = title ?? "ManicBot";
  /** Creator in plain God Mode: language + preview mode live on /settings, not in the chrome (avoids clash with Settings tab). */
  const godPlainChrome = role === "system_admin" && !previewRole;
  const showLangInChrome = !godPlainChrome;
  const showRoleSwitcherInChrome = role === "system_admin" && !!previewRole;

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
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-purple-600 shadow-lg shadow-brand-500/25">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-slate-900 dark:text-white truncate">{displayTitle}</h1>
            <p className="text-[10px] text-slate-500">{subtitle ?? "Admin Panel"}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {activeNavItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const isSettingsHub = item.href === "/settings" && role === "system_admin" && !previewRole;
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
          {showRoleSwitcherInChrome && <RoleSwitcherInline />}
          <MasterSwitcherInline />
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
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 shrink-0">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <h1 className="text-sm font-bold text-slate-900 dark:text-white flex-1 truncate">{displayTitle}</h1>
          {showRoleSwitcherInChrome && <RoleSwitcherInline />}
          <MasterSwitcherInline />
          {showLangInChrome && <LangPickerInline />}
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-y-auto p-4 pb-28 md:p-6 md:pb-6 relative">
          {/* Decorative gradient orbs */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-brand-500/8 blur-[100px]" />
            <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-purple-500/8 blur-[100px]" />
          </div>
          <div className="relative z-10 mx-auto max-w-7xl w-full">{children}</div>
        </main>

        {/* ── Mobile Bottom Nav (fixed, equal-width tabs) ── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl border-t border-slate-200 dark:border-white/5">
          <div className="flex items-center justify-around px-1 py-1 safe-area-pb">
            {mobileNavItems.map((item) => {
              const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const isSettingsHub = item.href === "/settings" && role === "system_admin" && !previewRole;
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
