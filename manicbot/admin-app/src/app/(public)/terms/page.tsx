export const runtime = "edge";

import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import { TermsClient } from "./TermsClient";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
    title: "Regulamin",
    description:
      "Regulamin korzystania z platformy ManicBot: definicje, rola operatora, subskrypcja i płatności, własność intelektualna, ograniczenie odpowiedzialności oraz zawieszenie konta.",
    path: "/terms",
    noIndex: false,
    locale: langToOgLocale(lang),
  });
}

export default function TermsPage() {
  return <TermsClient />;
}
