"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { type Lang } from "~/lib/i18n";

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const LangContext = createContext<LangContextValue>({
  lang: "pl",
  setLang: () => {},
});

export function useLang() {
  return useContext(LangContext);
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("pl");

  useEffect(() => {
    try {
      // URL param from landing takes priority (e.g. /login?lang=pl)
      const urlLang = new URLSearchParams(window.location.search).get("lang") as Lang | null;
      if (urlLang && (["ru", "ua", "en", "pl"] as string[]).includes(urlLang)) {
        setLangState(urlLang);
        localStorage.setItem("manicbot_lang", urlLang);
        return;
      }
      const stored = localStorage.getItem("manicbot_lang") as Lang | null;
      if (stored && ["ru", "ua", "en", "pl"].includes(stored)) {
        setLangState(stored);
      } else {
        // Auto-detect from Telegram user language
        const tg = (window as any).Telegram?.WebApp;
        const tgLang = tg?.initDataUnsafe?.user?.language_code as string | undefined;
        if (tgLang === "uk") setLangState("ua");
        else if (tgLang === "pl") setLangState("pl");
        else if (tgLang && !["ru", "uk"].includes(tgLang)) setLangState("en");
      }
    } catch {}
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("manicbot_lang", l); } catch {}
  };

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}
