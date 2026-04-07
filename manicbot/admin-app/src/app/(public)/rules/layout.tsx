import type { Metadata } from "next";
import { buildSeo } from "~/lib/seo";

export const metadata: Metadata = buildSeo({
  title: "Правила пользования",
  description:
    "Правила пользования платформой ManicBot: условия регистрации, ответственность пользователей, правила публикации отзывов и обработки данных.",
  path: "/rules",
  noIndex: false,
});

export default function RulesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
