"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "manicbot-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => undefined,
  toggleTheme: () => undefined,
});

function readStoredTheme(): Theme {
  try {
    // URL param takes priority (passed by landing when clicking "Войти")
    const urlParam = new URLSearchParams(window.location.search).get("theme");
    if (urlParam === "light" || urlParam === "dark") return urlParam;
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === "light" || s === "dark") return s;
  } catch {
    /* ignore */
  }
  return "dark";
}

function applyDomTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
}

export function PublicThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useLayoutEffect(() => {
    const initial = readStoredTheme();
    setThemeState(initial);
    applyDomTheme(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyDomTheme(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function usePublicTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
