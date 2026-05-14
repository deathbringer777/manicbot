import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Geist } from "next/font/google";

import { Toaster } from "sonner";

import { TRPCReactProvider } from "~/trpc/react";
import { LangProvider } from "~/components/LangContext";
import { AuthProvider } from "~/components/AuthProvider";
import { ConsentProvider } from "~/components/ConsentContext";
import { CookieBanner } from "~/components/CookieBanner";
import { SITE_URL, SITE_NAME } from "~/lib/seo";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — rezerwacje online dla salonów paznokci przez Telegram`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    "ManicBot — platforma automatyzacji salonów paznokci: rezerwacje online przez Telegram, WhatsApp i Instagram, przypomnienia, synchronizacja z Google Calendar, asystent AI.",
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  keywords: [
    "ManicBot",
    "rezerwacje online",
    "salon paznokci",
    "manicure",
    "pedicure",
    "bot Telegram",
    "salon kosmetyczny",
    "automatyzacja salonu",
    "booking",
    "beauty salon",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "pl_PL",
    alternateLocale: ["en_US", "uk_UA", "ru_RU"],
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
    <html lang="pl" className={`${geist.variable}`} suppressHydrationWarning>
      {/* Blocking script: apply .dark before first paint based on stored preference (avoids flash).
          Default is dark. Removed on toggle via WebShell which syncs document.documentElement.

          Inlined via dangerouslySetInnerHTML rather than loaded from /theme-init.js because
          the prior <script src="/theme-init.js"> emitted a request that 404'd at the
          public origin (the static asset isn't reachably served by the worker that fronts
          manicbot.com), causing a CSP-strict MIME error in the console and the script
          silently not running on first paint. The current CSP does not enforce script-src
          (only frame-ancestors), so inline is safe; if/when strict-CSP is added a per-request
          nonce can be threaded through here. */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("manicbot_web_theme")==="dark"){document.documentElement.classList.add("dark")}else{document.documentElement.classList.remove("dark")}}catch(e){document.documentElement.classList.remove("dark")}`,
          }}
        />
      </head>
      <body className="antialiased min-h-screen selection:bg-brand-500/30">
        <AuthProvider>
          <TRPCReactProvider>
            <LangProvider>
              <ConsentProvider>
                {children}
                <CookieBanner />
                <Toaster
                  position="top-right"
                  richColors
                  closeButton
                  theme="system"
                  toastOptions={{ className: "manicbot-toast" }}
                />
              </ConsentProvider>
            </LangProvider>
          </TRPCReactProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
