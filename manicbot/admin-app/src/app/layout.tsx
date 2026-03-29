import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { LangProvider } from "~/components/LangContext";

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
    <html lang="ru" className={`${geist.variable}`}>
      <body className="bg-slate-950 text-slate-50 antialiased min-h-screen selection:bg-brand-500/30">
        <TRPCReactProvider>
          <LangProvider>{children}</LangProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
