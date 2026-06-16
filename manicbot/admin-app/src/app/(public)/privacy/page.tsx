export const runtime = "edge";

import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import { PrivacyClient } from "./PrivacyClient";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
    title: "Polityka prywatności",
    description:
      "Polityka prywatności ManicBot: jakie dane przetwarzamy i w jakim celu, role administratora i podmiotu przetwarzającego, odbiorcy danych, okres przechowywania oraz prawa użytkownika zgodnie z RODO.",
    path: "/privacy",
    noIndex: false,
    locale: langToOgLocale(lang),
  });
}

export default function PrivacyPage() {
  return <PrivacyClient />;
}
