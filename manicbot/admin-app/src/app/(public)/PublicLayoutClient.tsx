"use client";

import { PublicThemeProvider } from "~/components/public/ThemeProvider";
import { PublicHeader } from "~/components/public/PublicHeader";
import { PublicFooter } from "~/components/public/PublicFooter";

export function PublicLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <PublicThemeProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900 antialiased transition-colors dark:bg-slate-950 dark:text-slate-50">
        <PublicHeader />
        <main className="pt-16">{children}</main>
        <PublicFooter />
      </div>
    </PublicThemeProvider>
  );
}
