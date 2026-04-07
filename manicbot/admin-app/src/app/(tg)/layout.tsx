import Script from "next/script";
import type { Metadata } from "next";

export const runtime = "edge";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function TelegramLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      {children}
    </>
  );
}
