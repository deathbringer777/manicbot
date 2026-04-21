"use client";

/**
 * Booking Reminder plugin runtime.
 *
 * Shows a demo list of today's appointments with a "Copy reminder" button for
 * each. Copies a pre-formatted Telegram reminder message to clipboard.
 *
 * We use demo data here (no new tRPC endpoints) — this is a plugin proof.
 */

import { useState } from "react";
import { Copy, Check, Calendar, Clock } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { PluginRuntimeProps } from "../runtimePanels";

interface DemoAppointment {
  id: string;
  client: string;
  service: string;
  time: string;
}

const DEMO: DemoAppointment[] = [
  { id: "1", client: "Anna K.", service: "Manicure + gel", time: "10:00" },
  { id: "2", client: "Maria S.", service: "Pedicure", time: "12:30" },
  { id: "3", client: "Olena V.", service: "Nail art", time: "15:00" },
];

const REMINDER_TEMPLATE: Record<string, (a: DemoAppointment) => string> = {
  ru: (a) => `Здравствуйте, ${a.client}! Напоминаем о вашей записи сегодня в ${a.time} (${a.service}). Ждём вас! 💅`,
  ua: (a) => `Доброго дня, ${a.client}! Нагадуємо про ваш запис сьогодні о ${a.time} (${a.service}). Чекаємо на вас! 💅`,
  en: (a) => `Hi ${a.client}! Reminder: your appointment is today at ${a.time} (${a.service}). See you soon! 💅`,
  pl: (a) => `Cześć ${a.client}! Przypomnienie: Twoja wizyta jest dziś o ${a.time} (${a.service}). Do zobaczenia! 💅`,
};

const LABELS: Record<string, Record<string, string>> = {
  title: {
    ru: "Сегодняшние записи",
    ua: "Сьогоднішні записи",
    en: "Today's Appointments",
    pl: "Dzisiejsze wizyty",
  },
  copy: {
    ru: "Скопировать",
    ua: "Копіювати",
    en: "Copy",
    pl: "Kopiuj",
  },
  copied: {
    ru: "Скопировано",
    ua: "Скопійовано",
    en: "Copied",
    pl: "Skopiowano",
  },
  demo: {
    ru: "Демо-данные · подключите реальные записи через настройки",
    ua: "Демо-дані · підключіть реальні записи через налаштування",
    en: "Demo data · connect real appointments via settings",
    pl: "Dane demo · połącz prawdziwe wizyty w ustawieniach",
  },
  empty: {
    ru: "Нет записей на сегодня",
    ua: "Немає записів на сьогодні",
    en: "No appointments today",
    pl: "Brak wizyt na dziś",
  },
};

function label(key: string, lang: string): string {
  return LABELS[key]?.[lang] ?? LABELS[key]?.en ?? key;
}

export default function BookingReminderRuntime({ installationId: _installationId }: PluginRuntimeProps) {
  const { lang } = useLang();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = (apt: DemoAppointment) => {
    const tmpl = REMINDER_TEMPLATE[lang] ?? REMINDER_TEMPLATE["en"]!;
    const text = tmpl(apt);
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(apt.id);
      setTimeout(() => setCopiedId((prev) => (prev === apt.id ? null : prev)), 2000);
    });
  };

  return (
    <div data-testid="booking-reminder-runtime" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Calendar size={14} className="text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {label("title", lang)}
        </h2>
      </div>

      {DEMO.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-600 py-4 text-center">
          {label("empty", lang)}
        </p>
      ) : (
        <ul className="space-y-2">
          {DEMO.map((apt) => (
            <li
              key={apt.id}
              data-testid="booking-reminder-item"
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500 shrink-0">
                  <Clock size={12} />
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{apt.time}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{apt.client}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{apt.service}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => copy(apt)}
                data-testid="booking-reminder-copy"
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-colors ${
                  copiedId === apt.id
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                    : "bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
                }`}
              >
                {copiedId === apt.id ? (
                  <><Check size={11} /> {label("copied", lang)}</>
                ) : (
                  <><Copy size={11} /> {label("copy", lang)}</>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-slate-400 dark:text-slate-600 italic">
        {label("demo", lang)}
      </p>
    </div>
  );
}
