"use client";

import { useState } from "react";
import Link from "next/link";
import {
  User, CreditCard, Palette, HelpCircle, ArrowLeft,
  Settings, Wrench,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

export interface SettingsSection {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
}

const SECTION_LABELS: Record<string, Record<Lang, { label: string; desc: string }>> = {
  account: {
    ru: { label: "Аккаунт", desc: "Email, пароль, профиль" },
    ua: { label: "Акаунт", desc: "Email, пароль, профіль" },
    en: { label: "Account", desc: "Email, password, profile" },
    pl: { label: "Konto", desc: "Email, hasło, profil" },
  },
  billing: {
    ru: { label: "Биллинг", desc: "Тариф, подписка, оплата" },
    ua: { label: "Білінг", desc: "Тариф, підписка, оплата" },
    en: { label: "Billing", desc: "Plan, subscription, payment" },
    pl: { label: "Płatności", desc: "Plan, subskrypcja, płatność" },
  },
  appearance: {
    ru: { label: "Вид", desc: "Настройки дашборда" },
    ua: { label: "Вигляд", desc: "Налаштування дашборду" },
    en: { label: "Appearance", desc: "Dashboard display" },
    pl: { label: "Wygląd", desc: "Ustawienia panelu" },
  },
  help: {
    ru: { label: "Помощь", desc: "Тур, поддержка" },
    ua: { label: "Допомога", desc: "Тур, підтримка" },
    en: { label: "Help", desc: "Tour, support" },
    pl: { label: "Pomoc", desc: "Przewodnik, wsparcie" },
  },
  platform: {
    ru: { label: "Платформа", desc: "Настройки платформы" },
    ua: { label: "Платформа", desc: "Налаштування платформи" },
    en: { label: "Platform", desc: "Platform settings" },
    pl: { label: "Platforma", desc: "Ustawienia platformy" },
  },
};

const BACK_LABELS: Record<Lang, string> = {
  ru: "Назад в дашборд",
  ua: "Назад до дашборду",
  en: "Back to dashboard",
  pl: "Wróć do panelu",
};

const SETTINGS_TITLE: Record<Lang, string> = {
  ru: "Настройки",
  ua: "Налаштування",
  en: "Settings",
  pl: "Ustawienia",
};

const SECTION_ICONS: Record<string, LucideIcon> = {
  account: User,
  billing: CreditCard,
  appearance: Palette,
  help: HelpCircle,
  platform: Wrench,
};

function getSections(role: string | null, lang: Lang, isPersonalTenant?: boolean): SettingsSection[] {
  const sections: string[] = [];

  if (role === "tenant_owner") {
    // Billing only for salon owners
    sections.push("account", "billing", "appearance", "help");
  } else if (role === "master") {
    sections.push("account", "appearance", "help");
  } else if (role === "support" || role === "technical_support") {
    sections.push("account", "appearance", "help");
  } else if (role === "system_admin") {
    // system_admin: no billing — God Mode, all features are free
    sections.push("account", "appearance", "help", "platform");
  } else {
    sections.push("account", "appearance", "help");
  }

  return sections.map((id) => ({
    id,
    icon: SECTION_ICONS[id] ?? Settings,
    label: SECTION_LABELS[id]?.[lang]?.label ?? id,
    description: SECTION_LABELS[id]?.[lang]?.desc ?? "",
  }));
}

interface SettingsShellProps {
  activeSection: string;
  onSectionChange: (id: string) => void;
  children: React.ReactNode;
}

export function SettingsShell({ activeSection, onSectionChange, children }: SettingsShellProps) {
  const { role, previewRole, isPersonalTenant } = useRole();
  const { lang } = useLang();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const sections = getSections(effectiveRole, lang, isPersonalTenant);

  const activeSectionData = sections.find((s) => s.id === activeSection);

  return (
    <div className="min-h-full">
      {/* Back to dashboard + title */}
      <div className="mb-4 lg:mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {BACK_LABELS[lang]}
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {SETTINGS_TITLE[lang]}
        </h1>
      </div>

      {/* ── Mobile: horizontal tab bar at the top ── */}
      <div className="lg:hidden">
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 scrollbar-hide">
          {sections.map((s) => {
            const Icon = s.icon;
            const active = s.id === activeSection;
            return (
              <button
                key={s.id}
                onClick={() => onSectionChange(s.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? "bg-brand-500 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/[0.10]"
                }`}
              >
                <Icon className="h-3 w-3 shrink-0" />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Active section content */}
        <div className="mt-2">
          {activeSectionData && (
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
              {activeSectionData.label}
            </h2>
          )}
          {children}
        </div>
      </div>

      {/* ── Desktop: sidebar + content ── */}
      <div className="hidden lg:flex gap-6">
        <nav className="w-56 shrink-0">
          <div className="space-y-0.5">
            {sections.map((s) => {
              const Icon = s.icon;
              const active = s.id === activeSection;
              return (
                <button
                  key={s.id}
                  onClick={() => onSectionChange(s.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                    active
                      ? "bg-brand-500/10 text-brand-500 dark:text-brand-400"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04] hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">{s.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
