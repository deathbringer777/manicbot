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
      {/* Blocking script: apply .dark before first paint based on stored preference (avoids flash).
          Default is dark. Removed on toggle via WebShell which syncs document.documentElement. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('manicbot_web_theme')==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}" }} />
      </head>
      <body className="antialiased min-h-screen selection:bg-brand-500/30">
        <AuthProvider>
          <TRPCReactProvider>
            <LangProvider>{children}</LangProvider>
          </TRPCReactProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
