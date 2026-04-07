import type { Metadata } from "next";
import { buildSeo } from "~/lib/seo";

export const metadata: Metadata = buildSeo({
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
});

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
