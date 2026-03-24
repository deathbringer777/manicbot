import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";

import { TRPCReactProvider } from "~/trpc/react";
import { TelegramGate } from "~/components/TelegramGate";

export const metadata: Metadata = {
  title: "God Mode — ManicBot Admin",
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
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className="bg-slate-950 text-slate-50 antialiased min-h-screen selection:bg-brand-500/30">
        <TRPCReactProvider>
          <TelegramGate>{children}</TelegramGate>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
