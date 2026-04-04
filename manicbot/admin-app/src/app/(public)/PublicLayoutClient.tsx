"use client";

import { PublicThemeProvider } from "~/components/public/ThemeProvider";
import { PublicHeader } from "~/components/public/PublicHeader";
import { PublicFooter } from "~/components/public/PublicFooter";
import { LangProvider } from "~/components/LangContext";

export function PublicLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <PublicThemeProvider>
      <LangProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900 antialiased transition-colors dark:bg-slate-950 dark:text-slate-50 animate-fade-in">
          <PublicHeader />
          <main className="pt-16">{children}</main>
          <PublicFooter />
        </div>
      </LangProvider>
    </PublicThemeProvider>
  );
}
