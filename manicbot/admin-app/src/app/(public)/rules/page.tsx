export const runtime = "edge";

import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import { RulesClient } from "./RulesClient";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
    title: "Zasady korzystania",
    description:
      "Zasady korzystania z platformy ManicBot: warunki rejestracji, odpowiedzialność użytkowników, zasady publikacji opinii i przetwarzania danych.",
    path: "/rules",
    noIndex: false,
    locale: langToOgLocale(lang),
  });
}

export default function RulesPage() {
  return <RulesClient />;
}
