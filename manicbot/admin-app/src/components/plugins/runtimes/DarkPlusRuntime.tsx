"use client";

/**
 * Dark+ plugin runtime — extended theme picker (OLED / Midnight / Dracula).
 */

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { PluginRuntimeShell } from "../PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

type Theme = "default" | "oled" | "midnight" | "dracula";

const THEME_STORAGE = "manicbot_dark_plus_theme";

const THEMES: { id: Theme; name: Record<string, string>; description: Record<string, string>; preview: string[] }[] = [
  {
    id: "default",
    name: { ru: "Стандартная", ua: "Стандартна", en: "Default", pl: "Domyślny" },
    description: { ru: "Базовая палитра ManicBot.", ua: "Базова палітра ManicBot.", en: "Base ManicBot palette.", pl: "Bazowa paleta ManicBot." },
    preview: ["#0f172a", "#1e293b", "#8b5cf6"],
  },
  {
    id: "oled",
    name: { ru: "OLED Black", ua: "OLED Black", en: "OLED Black", pl: "OLED Black" },
    description: { ru: "Чисто-чёрный фон. Экономит батарею на OLED.", ua: "Чисто-чорний фон. Економить батарею на OLED.", en: "Pure black background. Saves OLED battery.", pl: "Czysta czerń. Oszczędza baterię OLED." },
    preview: ["#000000", "#0a0a0a", "#7c3aed"],
  },
  {
    id: "midnight",
    name: { ru: "Midnight Blue", ua: "Midnight Blue", en: "Midnight Blue", pl: "Midnight Blue" },
    description: { ru: "Глубокий синий, снижает нагрузку на глаза.", ua: "Глибокий синій, менше навантаження на очі.", en: "Deep blue, easier on the eyes.", pl: "Głęboki niebieski, mniej męczy oczy." },
    preview: ["#0c1220", "#182041", "#4f46e5"],
  },
  {
    id: "dracula",
    name: { ru: "Dracula", ua: "Dracula", en: "Dracula", pl: "Dracula" },
    description: { ru: "Классика Dracula — мягкий тёмно-фиолетовый.", ua: "Класика Dracula — м'який темно-фіолетовий.", en: "Dracula classic — soft dark purple.", pl: "Klasyka Dracula — miękki ciemny fiolet." },
    preview: ["#282a36", "#44475a", "#bd93f9"],
  },
];

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  // Always enforce .dark root (Dark+ is a dark-mode palette set).
  document.documentElement.classList.add("dark");
  document.documentElement.setAttribute("data-theme-plus", theme);
  try { localStorage.setItem(THEME_STORAGE, theme); } catch { /* noop */ }
}

export default function DarkPlusRuntime({ installationId, slug }: PluginRuntimeProps) {
  const { lang } = useLang();
  const [active, setActive] = useState<Theme>("default");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(THEME_STORAGE) as Theme | null;
      if (raw && THEMES.find((t) => t.id === raw)) setActive(raw);
    } catch { /* noop */ }
  }, []);

  return (
    <PluginRuntimeShell slug={slug} bare>
    <div data-testid="dark-plus-runtime" data-installation-id={installationId} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {THEMES.map((th) => {
        const isActive = th.id === active;
        return (
          <button
            key={th.id}
            type="button"
            data-testid={`dark-plus-theme-${th.id}`}
            data-active={isActive ? "1" : "0"}
            onClick={() => {
              setActive(th.id);
              applyTheme(th.id);
            }}
            className={`text-left rounded-xl border p-4 transition-all ${
              isActive
                ? "border-brand-500/60 bg-brand-500/5"
                : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/40 hover:border-brand-500/40"
            }`}
          >
            <header className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {th.name[lang] ?? th.name.ru}
              </h3>
              {isActive && <Check size={14} className="text-brand-500" />}
            </header>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mb-3">
              {th.description[lang] ?? th.description.ru}
            </p>
            <div className="flex gap-1">
              {th.preview.map((c) => (
                <span
                  key={c}
                  style={{ backgroundColor: c }}
                  className="inline-block h-6 flex-1 rounded-md border border-white/10"
                />
              ))}
            </div>
          </button>
        );
      })}
    </div>
    </PluginRuntimeShell>
  );
}
