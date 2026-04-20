import { render, type RenderOptions } from "@testing-library/react";
import { LangContext } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";

export function renderWithLang(
  ui: React.ReactElement,
  lang: Lang = "ru",
  opts?: RenderOptions,
) {
  return render(
    <LangContext.Provider value={{ lang, setLang: () => {} }}>
      {ui}
    </LangContext.Provider>,
    opts,
  );
}

export function setDarkMode(enabled: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", enabled);
}
