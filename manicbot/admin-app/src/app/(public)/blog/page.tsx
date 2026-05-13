import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import { BlogClient } from "./BlogClient";

export const runtime = "edge";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
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
    locale: langToOgLocale(lang),
  });
}

export default function BlogPage() {
  return <BlogClient />;
}
