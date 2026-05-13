import type { Metadata } from "next";
import "~/styles/globals.css";
import { PublicLayoutClient } from "./PublicLayoutClient";
import { JsonLd } from "~/components/public/JsonLd";
import {
  SITE_URL,
  SITE_NAME,
  organizationJsonLd,
  websiteJsonLd,
  buildLanguageAlternates,
} from "~/lib/seo";

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — rezerwacje online w salonach paznokci`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    "Katalog salonów paznokci. Znajdź salon w pobliżu, wybierz mistrza i zarezerwuj online przez Telegram w minutę. Ponad 1000 salonów, opinie, zdjęcia prac.",
  alternates: {
    canonical: SITE_URL,
    languages: buildLanguageAlternates("/"),
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — rezerwacje online w salonach paznokci`,
    description:
      "Katalog salonów paznokci. Znajdź salon w pobliżu, wybierz mistrza i zarezerwuj online przez Telegram w minutę.",
    locale: "pl_PL",
  },
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
      <PublicLayoutClient>{children}</PublicLayoutClient>
    </>
  );
}
