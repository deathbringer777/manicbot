import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ManicBot — Правила пользования",
  description: "Правила пользования платформой ManicBot.",
};

export default function RulesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
