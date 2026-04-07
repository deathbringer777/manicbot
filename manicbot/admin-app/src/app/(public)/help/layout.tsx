import type { Metadata } from "next";
import { buildSeo } from "~/lib/seo";

export const metadata: Metadata = buildSeo({
  title: "Справочный центр",
  description:
    "Инструкции по работе с ManicBot: как создать запись, управлять услугами и мастерами, настроить каналы WhatsApp и Instagram, подключить Google Calendar и получить поддержку.",
  path: "/help",
  keywords: [
    "ManicBot помощь",
    "как записаться в салон",
    "инструкция салон красоты",
    "поддержка",
    "FAQ ManicBot",
  ],
});

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
