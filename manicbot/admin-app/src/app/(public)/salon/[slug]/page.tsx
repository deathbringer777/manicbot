export const runtime = "edge";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { SalonProfileClient } from "./SalonProfileClient";
import { JsonLd } from "~/components/public/JsonLd";
import {
  buildSeo,
  beautySalonJsonLd,
  breadcrumbJsonLd,
  SITE_NAME,
} from "~/lib/seo";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const profile = await caller.publicSalon.getProfile({ slug }).catch(() => null);
  if (!profile) {
    return {
      title: `Салон не найден — ${SITE_NAME}`,
      robots: { index: false, follow: false },
    };
  }
  const cityPart = profile.city ? ` (${profile.city})` : "";
  const description =
    profile.description ??
    `Онлайн-запись в ${profile.name}${cityPart}. Маникюр, педикюр, nail-арт. Запишитесь через Telegram за минуту.`;
  return buildSeo({
    title: `${profile.name}${cityPart}`,
    description,
    path: `/salon/${slug}`,
    image: profile.photos?.[0] ?? undefined,
    imageAlt: profile.name,
    keywords: [
      profile.name,
      profile.city ?? "nail салон",
      "маникюр",
      "педикюр",
      "онлайн-запись",
      "салон красоты",
    ],
  });
}

export default async function SalonProfilePage({ params }: Props) {
  const { slug } = await params;
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const profile = await caller.publicSalon.getProfile({ slug }).catch(() => null);
  if (!profile) notFound();
  return (
    <>
      <JsonLd
        data={[
          beautySalonJsonLd({
            name: profile.name,
            slug: profile.slug ?? slug,
            description: profile.description,
            image: profile.photos?.[0] ?? null,
            city: profile.city,
            address: profile.address,
            phone: profile.phone,
            lat: profile.lat,
            lng: profile.lng,
            rating: profile.rating,
          }),
          breadcrumbJsonLd([
            { name: "Главная", path: "/" },
            { name: "Поиск", path: "/search" },
            { name: profile.name, path: `/salon/${slug}` },
          ]),
        ]}
      />
      <SalonProfileClient profile={profile} />
    </>
  );
}
