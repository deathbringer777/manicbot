import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
  createElement,
} from "react";
import { en, type Translations } from "./en";
import { ru } from "./ru";
import { ua } from "./ua";
import { pl } from "./pl";

export type Locale = "en" | "ru" | "ua" | "pl";

export const locales: Record<Locale, Translations> = { en, ru, ua, pl };

/** RU first — совпадает с языком по умолчанию */
export const localeOrder: Locale[] = ["ru", "en", "ua", "pl"];

interface LanguageContextValue {
  locale: Locale;
  t: Translations;
  setLocale: (l: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: "ru",
  t: ru,
  setLocale: () => undefined,
});

const STORAGE_KEY = "manicbot-locale";

function getSavedLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in locales) return saved as Locale;
  } catch {
    // SSR or blocked storage
  }
  return "ru";
}

function readLocaleFromUrl(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q && q in locales) return q as Locale;
  } catch {
    // ignore
  }
  return null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readLocaleFromUrl() ?? getSavedLocale());

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("lang") !== locale) {
        u.searchParams.set("lang", locale);
        window.history.replaceState({}, "", u.toString());
      }
    } catch {
      // ignore
    }
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("lang", l);
      window.history.replaceState({}, "", u.toString());
    } catch {
      // ignore
    }
  }, []);

  return createElement(
    LanguageContext.Provider,
    { value: { locale, t: locales[locale], setLocale } },
    children
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
