import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ManicBot — Справочный центр",
  description: "Инструкции по записям, услугам, поддержке и каналам ManicBot.",
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
