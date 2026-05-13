import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import { RulesClient } from "./RulesClient";

export const runtime = "edge";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
    title: "Правила пользования",
    description:
      "Правила пользования платформой ManicBot: условия регистрации, ответственность пользователей, правила публикации отзывов и обработки данных.",
    path: "/rules",
    noIndex: false,
    locale: langToOgLocale(lang),
  });
}

export default function RulesPage() {
  return <RulesClient />;
}
