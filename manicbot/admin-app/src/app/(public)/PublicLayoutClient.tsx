"use client";

import { usePathname } from "next/navigation";
import { PublicThemeProvider } from "~/components/public/ThemeProvider";
import { PublicHeader } from "~/components/public/PublicHeader";
import { PublicFooter } from "~/components/public/PublicFooter";
import { LangProvider } from "~/components/LangContext";

export function PublicLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The salon chat page doubles as a TikTok / Instagram bio embed target,
  // so we drop the entire site chrome (PublicHeader + PublicFooter + pt-16
  // offset) on both mobile AND desktop. Language + theme controls live
  // inside the chat's own ChatHeader instead, so visitors still have full
  // i18n / theme control without the marketing-site nav stealing real
  // estate from the conversation.
  const isChatRoute = /\/salon\/[^/]+\/chat$/.test(pathname);

  if (isChatRoute) {
    return (
      <PublicThemeProvider>
        <LangProvider>
          <div className="bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-50">
            <main>{children}</main>
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
