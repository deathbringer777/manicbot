import type { Metadata } from "next";
import "~/styles/globals.css";
import { PublicLayoutClient } from "./PublicLayoutClient";

export const metadata: Metadata = {
  title: "ManicBot — Найдите свой салон",
  description: "Каталог nail-салонов. Онлайн-запись через Telegram.",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicLayoutClient>{children}</PublicLayoutClient>;
}
