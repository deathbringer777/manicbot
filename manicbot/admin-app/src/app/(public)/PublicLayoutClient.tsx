"use client";

import { usePathname } from "next/navigation";
import { PublicThemeProvider } from "~/components/public/ThemeProvider";
import { PublicHeader } from "~/components/public/PublicHeader";
import { PublicFooter } from "~/components/public/PublicFooter";
import { LangProvider } from "~/components/LangContext";

export function PublicLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The salon chat page doubles as a TikTok / Instagram bio embed target,
  // so on mobile we drop the entire public chrome (header + pt-16 offset +
  // footer) to give the chat the full viewport. Without this the chat
  // overflows by 64px and the Composer is pushed below the visible area
  // when the soft keyboard opens. Desktop visitors keep the full chrome.
  const isChatRoute = /\/salon\/[^/]+\/chat$/.test(pathname);

  if (isChatRoute) {
    return (
      <PublicThemeProvider>
        <LangProvider>
          <div className="bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-50 md:min-h-screen md:transition-colors">
            <div className="hidden md:block">
              <PublicHeader />
            </div>
            <main className="md:pt-16">{children}</main>
            <div className="hidden md:block">
              <PublicFooter />
            </div>
          </div>
        </LangProvider>
      </PublicThemeProvider>
    );
  }

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
