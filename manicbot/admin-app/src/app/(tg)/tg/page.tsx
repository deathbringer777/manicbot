"use client";

export const runtime = "edge";

import { TelegramGate } from "~/components/TelegramGate";
import DashboardClient from "~/app/(dashboard)/DashboardClient";

export default function TelegramMiniApp() {
  return (
    <TelegramGate>
      <DashboardClient />
    </TelegramGate>
  );
}
