import type { Metadata } from "next";
import "~/styles/globals.css";
import { PublicLayoutClient } from "./PublicLayoutClient";
import { JsonLd } from "~/components/public/JsonLd";
import {
  SITE_URL,
  SITE_NAME,
  organizationJsonLd,
  websiteJsonLd,
} from "~/lib/seo";

// Force dynamic rendering so the per-request CSP nonce set by middleware.ts is
// stamped onto Next.js's streaming RSC inline scripts. Without this, the page
// is statically prerendered (`x-nextjs-prerender: 1`) and the inline scripts
// have no nonce — strict CSP then blocks them and the page renders blank.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — онлайн-запись в nail-салоны`,
    template: `%s — ${SITE_NAME}`,
  },
  description:
    "Каталог nail-салонов. Найдите салон рядом, выберите мастера и запишитесь онлайн через Telegram за минуту. Более 1000 салонов, отзывы, фото работ.",
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — онлайн-запись в nail-салоны`,
    description:
      "Каталог nail-салонов. Найдите салон рядом, выберите мастера и запишитесь онлайн через Telegram за минуту.",
    locale: "ru_RU",
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
