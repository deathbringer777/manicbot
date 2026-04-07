import type { Metadata } from "next";
import { buildSeo } from "~/lib/seo";

export const metadata: Metadata = buildSeo({
  title: "Блог",
  description:
    "Советы по автоматизации nail-салона: как увеличить удержание клиентов, уменьшить no-shows, настроить Telegram-бота для записи, тренды маникюра 2026 и обновления ManicBot.",
  path: "/blog",
  keywords: [
    "блог nail салон",
    "автоматизация салона красоты",
    "онлайн-запись",
    "Telegram бот для салона",
    "маникюр тренды",
  ],
});

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
