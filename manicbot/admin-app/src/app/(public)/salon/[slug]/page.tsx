import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { SalonProfileClient } from "./SalonProfileClient";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const profile = await caller.publicSalon.getProfile({ slug }).catch(() => null);
  if (!profile) return { title: "Салон не найден — ManicBot" };
  return {
    title: `${profile.name} — ManicBot`,
    description: profile.description ?? `Онлайн-запись в ${profile.name}. Запишитесь через Telegram!`,
    openGraph: {
      title: profile.name,
      description: profile.description ?? undefined,
      images: profile.photos[0] ? [{ url: profile.photos[0] }] : [],
    },
  };
}

export default async function SalonProfilePage({ params }: Props) {
  const { slug } = await params;
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const profile = await caller.publicSalon.getProfile({ slug }).catch(() => null);
  if (!profile) notFound();
  return <SalonProfileClient profile={profile} />;
}
