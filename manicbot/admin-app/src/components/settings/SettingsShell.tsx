"use client";

import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import {
  User, CreditCard, Palette, HelpCircle, ArrowLeft,
  Settings, Wrench, Store, Globe, Users, MessageSquare,
  UserRound, ChevronLeft, ChevronRight, Gift, Bell, Star,
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
    ru: { label: "Аккаунт",          desc: "Email, пароль, профиль" },
    ua: { label: "Акаунт",           desc: "Email, пароль, профіль" },
    en: { label: "Account",          desc: "Email, password, profile" },
    pl: { label: "Konto",            desc: "Email, hasło, profil" },
  },
  salon: {
    ru: { label: "Мой салон",        desc: "Имя, логотип, часы работы" },
    ua: { label: "Мій салон",        desc: "Імʼя, логотип, години роботи" },
    en: { label: "My salon",         desc: "Name, logo, business hours" },
    pl: { label: "Mój salon",        desc: "Nazwa, logo, godziny pracy" },
  },
  public: {
    ru: { label: "Публичный профиль", desc: "Slug, описание, фото" },
    ua: { label: "Публічний профіль", desc: "Slug, опис, фото" },
    en: { label: "Public profile",    desc: "Slug, description, photos" },
    pl: { label: "Profil publiczny",  desc: "Slug, opis, zdjęcia" },
  },
  reviews: {
    ru: { label: "Отзывы",            desc: "Рейтинг и отзывы клиентов" },
    ua: { label: "Відгуки",           desc: "Рейтинг та відгуки клієнтів" },
    en: { label: "Reviews",           desc: "Ratings and client reviews" },
    pl: { label: "Opinie",            desc: "Oceny i opinie klientów" },
  },
  team: {
    ru: { label: "Команда",          desc: "Мастера, менеджеры, передача прав" },
    ua: { label: "Команда",          desc: "Майстри, менеджери, передача прав" },
    en: { label: "Team",             desc: "Masters, managers, ownership transfer" },
    pl: { label: "Zespół",           desc: "Mistrzowie, menedżerowie, przekazanie" },
  },
  channels: {
    ru: { label: "Каналы",           desc: "Telegram, WhatsApp, Instagram" },
    ua: { label: "Канали",           desc: "Telegram, WhatsApp, Instagram" },
    en: { label: "Channels",         desc: "Telegram, WhatsApp, Instagram" },
    pl: { label: "Kanały",           desc: "Telegram, WhatsApp, Instagram" },
  },
  billing: {
    ru: { label: "Биллинг",          desc: "Тариф, подписка, оплата" },
    ua: { label: "Білінг",           desc: "Тариф, підписка, оплата" },
    en: { label: "Billing",          desc: "Plan, subscription, payment" },
    pl: { label: "Płatności",        desc: "Plan, subskrypcja, płatność" },
  },
  appearance: {
    ru: { label: "Вид",              desc: "Боковая панель, виджеты" },
    ua: { label: "Вигляд",           desc: "Бічна панель, віджети" },
    en: { label: "Appearance",       desc: "Sidebar, widgets" },
    pl: { label: "Wygląd",           desc: "Pasek boczny, widżety" },
  },
  help: {
    ru: { label: "Помощь",           desc: "Тур, поддержка" },
    ua: { label: "Допомога",         desc: "Тур, підтримка" },
    en: { label: "Help",             desc: "Tour, support" },
    pl: { label: "Pomoc",            desc: "Przewodnik, wsparcie" },
  },
  profile: {
    ru: { label: "Профиль",          desc: "Имя, фото, портфолио" },
    ua: { label: "Профіль",          desc: "Імʼя, фото, портфоліо" },
    en: { label: "Profile",          desc: "Name, photo, portfolio" },
    pl: { label: "Profil",           desc: "Imię, zdjęcie, portfolio" },
  },
  platform: {
    ru: { label: "Платформа",        desc: "Настройки платформы" },
    ua: { label: "Платформа",        desc: "Налаштування платформи" },
    en: { label: "Platform",         desc: "Platform settings" },
    pl: { label: "Platforma",        desc: "Ustawienia platformy" },
  },
  referrals: {
    ru: { label: "Реферальная программа", desc: "Пригласить друга, скидки" },
    ua: { label: "Реферальна програма", desc: "Запросити друга, знижки" },
    en: { label: "Refer a friend", desc: "Share, earn free months" },
    pl: { label: "Poleć znajomemu", desc: "Udostępnij, zarabiaj wolne miesiące" },
  },
  notifications: {
    ru: { label: "Уведомления",       desc: "Пуш, категории, тишина" },
    ua: { label: "Сповіщення",        desc: "Пуш, категорії, тиша" },
    en: { label: "Notifications",     desc: "Push, categories, quiet" },
    pl: { label: "Powiadomienia",     desc: "Push, kategorie, cisza" },
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
  account:       User,
  salon:         Store,
  public:        Globe,
  reviews:       Star,
  team:          Users,
  channels:      MessageSquare,
  billing:       CreditCard,
  appearance:    Palette,
  help:          HelpCircle,
  profile:       UserRound,
  platform:      Wrench,
  referrals:     Gift,
  notifications: Bell,
};

/**
 * Ordered section ids for a role. For non-technical roles (tenant_owner,
 * tenant_manager, master) the FIRST id is the landing tab and `account` is
 * demoted to second-to-last (immediately before `help`): its sensitive
 * controls (email / password / role) now live in a rarely-opened "danger
 * zone", so the salon/profile is the natural home instead. Technical roles
 * (support, technical_support, system_admin) keep `account` first.
 */
export function getSettingsSectionIds(role: string | null, isPersonalTenant: boolean): string[] {
  // Eligibility for the Referrals section mirrors assertReferralEligible
  // in the referrals tRPC router: self-registered customer accounts only.
  // Salon-invited masters (master + !isPersonalTenant) are explicitly not
  // shown the section — their referral attempts would 403 server-side.
  const showReferrals =
    role === "tenant_owner" ||
    role === "tenant_manager" ||
    (role === "master" && isPersonalTenant);

  if (role === "tenant_owner" || role === "tenant_manager") {
    const ids = ["salon", "public", "reviews", "team", "channels", "billing", "notifications", "appearance"];
    if (showReferrals) ids.push("referrals");
    ids.push("account", "help");
    return ids;
  }
  if (role === "master") {
    const ids = ["profile", "notifications", "appearance"];
    if (showReferrals) ids.push("referrals");
    ids.push("account", "help");
    return ids;
  }
  if (role === "support" || role === "technical_support") {
    return ["account", "notifications", "appearance", "help"];
  }
  if (role === "system_admin") {
    return ["account", "notifications", "appearance", "help", "platform"];
  }
  return ["account", "notifications", "appearance", "help"];
}

/**
 * The landing / default settings section for a role — the first ordered id.
 * `salon` for owner/manager, `profile` for master, `account` for everyone else.
 */
export function getDefaultSettingsSection(role: string | null, isPersonalTenant = false): string {
  return getSettingsSectionIds(role, isPersonalTenant)[0] ?? "account";
}

function getSections(role: string | null, lang: Lang, isPersonalTenant: boolean): SettingsSection[] {
  return getSettingsSectionIds(role, isPersonalTenant).map((id) => ({
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
  const { role, isPersonalTenant } = useRole();
  const { lang } = useLang();
  const effectiveRole = role;
  const sections = getSections(effectiveRole, lang, isPersonalTenant === true);
  const activeSectionData = sections.find((s) => s.id === activeSection);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [sections.length]);

  // Auto-scroll active tab into view on section change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeBtn = el.querySelector<HTMLButtonElement>(`[data-section-id="${activeSection}"]`);
    if (activeBtn) {
      const elRect = el.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      if (btnRect.left < elRect.left || btnRect.right > elRect.right) {
        activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [activeSection]);

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: "smooth" });
  };

  return (
    <div className="min-h-full">
      <div className="mb-4">
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

      {/* Top-tab strip — same nav across all viewports */}
      <div className="sticky top-0 z-10 -mx-4 px-4 lg:-mx-6 lg:px-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-slate-900/60 border-b border-slate-200/60 dark:border-white/5 mb-5">
        <div className="relative">
          {/* Left scroll button (desktop only) */}
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label="Scroll tabs left"
              className="hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 z-20 h-7 w-7 items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-brand-500"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label="Scroll tabs right"
              className="hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 z-20 h-7 w-7 items-center justify-center rounded-full bg-white dark:bg-slate-800 shadow-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-brand-500"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Fade edges */}
          {canScrollLeft && <div className="pointer-events-none hidden lg:block absolute left-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-r from-white/95 dark:from-slate-900/95 to-transparent" />}
          {canScrollRight && <div className="pointer-events-none hidden lg:block absolute right-0 top-0 bottom-0 w-8 z-10 bg-gradient-to-l from-white/95 dark:from-slate-900/95 to-transparent" />}

          <div
            ref={scrollRef}
            className="flex gap-1.5 overflow-x-auto py-2.5 scrollbar-hide scroll-smooth"
            style={{ scrollbarWidth: "none" }}
          >
            {sections.map((s) => {
              const Icon = s.icon;
              const active = s.id === activeSection;
              return (
                <button
                  key={s.id}
                  data-section-id={s.id}
                  onClick={() => onSectionChange(s.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs lg:text-sm font-semibold whitespace-nowrap shrink-0 transition-all ${
                    active
                      ? "bg-brand-500 text-white shadow-sm ring-1 ring-brand-500/30"
                      : "bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/[0.10]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section title + content — single centered column, ~Linear/Notion width.
          max-w-4xl (896px): wide enough for the Billing plan-comparison 3-col
          grid (~290px per card) and the Notifications categories matrix; tight
          enough that single-card forms read naturally without empty whitespace. */}
      <div className="mx-auto w-full max-w-4xl">
        {activeSectionData && (
          <div className="mb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {activeSectionData.label}
            </h2>
            {activeSectionData.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {activeSectionData.description}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
