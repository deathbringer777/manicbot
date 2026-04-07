import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { LangProvider } from "~/components/LangContext";
import { AuthProvider } from "~/components/AuthProvider";
import { SITE_URL, SITE_NAME } from "~/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — онлайн-запись в nail-салоны через Telegram`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    "ManicBot — платформа автоматизации nail-салонов: онлайн-запись через Telegram, WhatsApp и Instagram, напоминания, синхронизация с Google Calendar, AI-ассистент.",
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  keywords: [
    "ManicBot",
    "онлайн-запись",
    "nail-салон",
    "маникюр",
    "педикюр",
    "Telegram бот",
    "салон красоты",
    "автоматизация салона",
    "booking",
    "beauty salon",
  ],
  icons: [
    { rel: "icon", url: "/favicon.ico" },
    { rel: "apple-touch-icon", url: "/manicbot-mark-ui.png" },
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "ru_RU",
    alternateLocale: ["uk_UA", "en_US", "pl_PL"],
  },
  twitter: {
    card: "summary_large_image",
    site: "@manicbot_com",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    // Optional — set NEXT_PUBLIC_GSC_VERIFICATION in Pages env to add a meta tag.
    // The DNS/HTML file verification via GSC is the primary method; this is belt-and-suspenders.
    google: process.env.NEXT_PUBLIC_GSC_VERIFICATION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)",  color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
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
