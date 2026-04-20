"use client";

/**
 * Ticket Templates plugin runtime — canned responses library with one-click copy.
 */

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { PluginRuntimeProps } from "../runtimePanels";

type Lang = "ru" | "ua" | "en" | "pl";

interface Template {
  id: string;
  name: Record<Lang, string>;
  body: Record<Lang, string>;
}

const TEMPLATES: Template[] = [
  {
    id: "onboarding",
    name: { ru: "Приветствие", ua: "Привітання", en: "Onboarding", pl: "Powitanie" },
    body: {
      ru: "Здравствуйте, {{name}}! Спасибо, что выбрали ManicBot. Если будут вопросы по настройке — пишите!",
      ua: "Вітаю, {{name}}! Дякуємо, що обрали ManicBot. Якщо будуть питання з налаштування — пишіть!",
      en: "Hi {{name}}! Thanks for choosing ManicBot. If you have any setup questions, just reply.",
      pl: "Cześć {{name}}! Dziękujemy za wybór ManicBot. W razie pytań o konfigurację — napisz.",
    },
  },
  {
    id: "billing",
    name: { ru: "Биллинг", ua: "Білінг", en: "Billing", pl: "Rozliczenia" },
    body: {
      ru: "Я вижу оплату в Stripe, активировал подписку. Статус в личном кабинете обновится в течение 5 минут.",
      ua: "Бачу оплату в Stripe, активував підписку. Статус в особистому кабінеті оновиться протягом 5 хв.",
      en: "I see your Stripe payment — subscription is now active. The dashboard status will refresh within 5 minutes.",
      pl: "Widzę płatność w Stripe, subskrypcja została aktywowana. Status w panelu odświeży się w ciągu 5 minut.",
    },
  },
  {
    id: "bug-report",
    name: { ru: "Баг-репорт", ua: "Баг-репорт", en: "Bug report", pl: "Zgłoszenie błędu" },
    body: {
      ru: "Чтобы я мог быстрее разобраться: какой браузер? какой именно шаг (скриншот) ломается? время последнего случая?",
      ua: "Щоб швидше розібратися: який браузер? який саме крок (скрін) ламається? час останнього випадку?",
      en: "To debug faster: which browser? which exact step (screenshot) fails? timestamp of the last occurrence?",
      pl: "Aby szybciej zdiagnozować: jaka przeglądarka? który dokładny krok (screenshot) się psuje? czas ostatniego wystąpienia?",
    },
  },
  {
    id: "closed-resolved",
    name: { ru: "Закрытие тикета", ua: "Закриття тикета", en: "Close (resolved)", pl: "Zamknięcie (rozwiązane)" },
    body: {
      ru: "Рад, что всё заработало! Закрываю тикет. Если снова столкнётесь — открывайте новый, ответим.",
      ua: "Радий, що все запрацювало! Закриваю тикет. Якщо знову зіткнетеся — створюйте новий.",
      en: "Glad that's sorted! Closing the ticket. If it happens again, please open a fresh one.",
      pl: "Cieszę się, że działa! Zamykam zgłoszenie. Jeśli się powtórzy — proszę założyć nowe.",
    },
  },
  {
    id: "escalation",
    name: { ru: "Эскалация", ua: "Ескалація", en: "Escalation", pl: "Eskalacja" },
    body: {
      ru: "Передаю вопрос в технический саппорт — они напишут в течение 30 минут. Тикет остаётся в работе.",
      ua: "Передаю питання в технічний саппорт — вони напишуть упродовж 30 хв. Тикет у роботі.",
      en: "I'm escalating to technical support — they'll reply within 30 minutes. Ticket stays open.",
      pl: "Eskaluję do wsparcia technicznego — odezwą się w ciągu 30 minut. Zgłoszenie pozostaje otwarte.",
    },
  },
];

export default function TicketTemplatesRuntime({ installationId }: PluginRuntimeProps) {
  const { lang } = useLang();
  const pluginLang: Lang = (["ru", "ua", "en", "pl"] as const).includes(lang as Lang) ? (lang as Lang) : "ru";
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div data-testid="ticket-templates-runtime" data-installation-id={installationId} className="space-y-2">
      {TEMPLATES.map((tpl) => (
        <article
          key={tpl.id}
          data-testid="ticket-template"
          data-template-id={tpl.id}
          className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 p-3 sm:p-4"
        >
          <header className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {tpl.name[pluginLang]}
            </h3>
            <button
              type="button"
              data-testid="ticket-template-copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(tpl.body[pluginLang]);
                  setCopied(tpl.id);
                  setTimeout(() => setCopied((c) => (c === tpl.id ? null : c)), 1500);
                } catch { /* noop */ }
              }}
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors ${
                copied === tpl.id
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10"
              }`}
            >
              {copied === tpl.id ? <Check size={11} /> : <Copy size={11} />}
              {copied === tpl.id ? "✓" : "Copy"}
            </button>
          </header>
          <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
            {tpl.body[pluginLang]}
          </p>
        </article>
      ))}
    </div>
  );
}
