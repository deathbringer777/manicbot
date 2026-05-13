import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import { HelpCenterClient } from "./HelpCenterClient";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
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
    locale: langToOgLocale(lang),
  });
}

export default function HelpPage() {
  return <HelpCenterClient />;
}
