import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ManicBot — Блог",
  description: "Советы по автоматизации салона, тренды nail-индустрии и обновления ManicBot.",
};

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
