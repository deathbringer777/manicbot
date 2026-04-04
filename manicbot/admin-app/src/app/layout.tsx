import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { LangProvider } from "~/components/LangContext";
import { AuthProvider } from "~/components/AuthProvider";

export const metadata: Metadata = {
  title: "ManicBot — Dashboard",
  description: "ManicBot Platform Administration Panel",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${geist.variable}`} suppressHydrationWarning>
      {/* Blocking script: add .dark class before first paint so dark:* Tailwind classes apply by default.
          PublicThemeProvider removes .dark for auth pages when user switches to light theme. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('dark')" }} />
      </head>
      <body className="bg-slate-950 text-slate-50 antialiased min-h-screen selection:bg-brand-500/30">
        <AuthProvider>
          <TRPCReactProvider>
            <LangProvider>{children}</LangProvider>
          </TRPCReactProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
