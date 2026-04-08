"use client";

import { usePathname } from "next/navigation";
import { PublicThemeProvider } from "~/components/public/ThemeProvider";
import { PublicHeader } from "~/components/public/PublicHeader";
import { PublicFooter } from "~/components/public/PublicFooter";
import { LangProvider } from "~/components/LangContext";

export function PublicLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The salon chat page doubles as a TikTok / Instagram bio embed target,
  // so on mobile we drop the footer entirely to give the chat the full
  // viewport. Desktop visitors browsing manicbot.com still see the footer.
  const isChatRoute = /\/salon\/[^/]+\/chat$/.test(pathname);
  return (
    <PublicThemeProvider>
      <LangProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900 antialiased transition-colors dark:bg-slate-950 dark:text-slate-50 animate-fade-in">
          <PublicHeader />
          <main className="pt-16">{children}</main>
          {isChatRoute ? (
            <div className="hidden md:block">
              <PublicFooter />
            </div>
          ) : (
            <PublicFooter />
          )}
        </div>
      </LangProvider>
    </PublicThemeProvider>
  );
}
