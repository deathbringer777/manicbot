import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import SearchPageClient from "./SearchPageClient";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
    title: "Поиск салонов красоты",
    description:
      "Найдите nail-салон рядом. Поиск по городу, услуге, мастеру. Маникюр, педикюр, наращивание, nail-арт. Онлайн-запись через Telegram.",
    path: "/search",
    keywords: [
      "поиск салонов красоты",
      "nail салон рядом",
      "маникюр рядом",
      "педикюр рядом",
      "записаться онлайн",
      "каталог салонов",
    ],
    locale: langToOgLocale(lang),
  });
}

export default function SearchPage() {
  return <SearchPageClient />;
}
