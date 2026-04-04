"use client";

import type { ReactNode } from "react";
import { ArrowLeft, CalendarDays, MessageCircleMore, Search, Sparkles } from "lucide-react";
import Link from "next/link";

type AuthShellProps = {
  badge: string;
  title: string;
  description: string;
  panelTitle: string;
  panelDescription: string;
  children: ReactNode;
  footer: ReactNode;
};

type Feature = {
  icon: typeof MessageCircleMore;
  title: string;
  text: string;
};

const features: Feature[] = [
  {
    icon: MessageCircleMore,
    title: "Все каналы в одном месте",
    text: "Telegram, Instagram и WhatsApp собираются в единый поток общения с клиентами.",
  },
  {
    icon: CalendarDays,
    title: "Календарь и запись без хаоса",
    text: "Записи, напоминания и смены команды синхронизируются в одном кабинете.",
  },
  {
    icon: Search,
    title: "Публичный профиль салона",
    text: "Лендинг, каталог и поиск уже ведут клиента к записи без лишних шагов.",
  },
];

export const authFieldClassName =
  "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition focus:border-cyan-400/40 focus:bg-white/[0.06] focus:ring-4 focus:ring-cyan-400/10";

export const authFieldWithLeadingIconClassName = `${authFieldClassName} pl-11`;

export const authFieldWithIconsClassName = `${authFieldWithLeadingIconClassName} pr-11`;

export const authPrimaryButtonClassName =
  "w-full rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#06b6d4_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_-18px_rgba(34,211,238,0.55)] transition duration-200 hover:scale-[1.01] hover:shadow-[0_24px_55px_-18px_rgba(124,58,237,0.72)] disabled:cursor-not-allowed disabled:opacity-60";

export const authSecondaryButtonClassName =
  "flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60";

export function AuthShell({
  badge,
  title,
  description,
  panelTitle,
  panelDescription,
  children,
  footer,
}: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050816] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(232,121,160,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_24%),radial-gradient(circle_at_50%_120%,rgba(124,58,237,0.22),transparent_38%),linear-gradient(180deg,#080b1a_0%,#050816_52%,#090f1f_100%)]" />
        <div className="absolute -left-16 top-20 h-48 w-48 rounded-full bg-fuchsia-500/20 blur-3xl sm:h-72 sm:w-72" />
        <div className="absolute right-[-3rem] top-[-2rem] h-56 w-56 rounded-full bg-cyan-400/15 blur-3xl sm:h-80 sm:w-80" />
        <div className="absolute bottom-[-4rem] left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl sm:h-96 sm:w-96" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-7xl grid-rows-[auto_auto_auto] px-4 pb-6 pt-4 sm:px-6 sm:pb-8 sm:pt-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(400px,460px)] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:px-8 lg:pb-10">
        <div className="flex items-center justify-between gap-3 lg:col-span-2">
          <a
            href="https://manicbot.com"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-white/88 backdrop-blur-xl transition hover:border-white/20 hover:bg-white/[0.08]"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span>На лендинг</span>
          </a>

          <Link
            href="/search"
            className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/10 px-3.5 py-2 text-sm font-medium text-cyan-100/90 transition hover:border-cyan-300/30 hover:bg-cyan-400/15"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Каталог салонов</span>
            <span className="sm:hidden">Каталог</span>
          </Link>
        </div>

        <div className="order-2 pt-6 lg:order-none lg:pr-6 lg:pt-14">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/80 backdrop-blur-xl">
              <Sparkles className="h-3.5 w-3.5 text-brand-300" />
              {badge}
            </div>

            <div className="mt-5 flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c3aed,#06b6d4)] text-base font-bold text-white shadow-[0_18px_40px_-18px_rgba(124,58,237,0.7)]">
                M
              </div>
              <div>
                <p className="text-lg font-semibold tracking-tight text-white sm:text-xl">ManicBot</p>
                <p className="text-sm text-slate-300/70">Платформа записи для салонов и мастеров</p>
              </div>
            </div>

            <h1 className="mt-6 max-w-2xl text-[2rem] font-semibold leading-[1.05] tracking-tight text-white sm:text-4xl lg:text-[3.25rem] lg:leading-[1.05]">
              {title}
            </h1>

            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300/78 sm:text-base">
              {description}
            </p>
          </div>

          <div className="mt-8 hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {features.map(({ icon: Icon, title: featureTitle, text }) => (
              <div
                key={featureTitle}
                className="rounded-[22px] border border-white/10 bg-white/[0.05] p-4 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.7)] backdrop-blur-xl"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-cyan-200">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-3 text-sm font-semibold text-white">{featureTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300/72">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="order-1 mt-6 flex items-start justify-center pb-2 lg:order-none lg:mt-0 lg:items-center lg:justify-end lg:pt-10">
          <div className="w-full max-w-lg rounded-[30px] border border-white/10 bg-slate-950/55 p-4 shadow-[0_30px_100px_-40px_rgba(8,145,178,0.55)] backdrop-blur-2xl sm:p-6 lg:p-7">
            <div className="mb-6 flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,#7c3aed,#06b6d4)] text-white shadow-[0_18px_40px_-22px_rgba(124,58,237,0.9)]">
                <Sparkles className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200/70">
                  ManicBot Dashboard
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
                  {panelTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-300/72">
                  {panelDescription}
                </p>
              </div>
            </div>

            {children}

            <div className="mt-5 border-t border-white/10 pt-4 text-sm text-slate-300/70">
              {footer}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
