export const runtime = "edge";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { ChatClient } from "./ChatClient";
import { buildSeo, SITE_NAME } from "~/lib/seo";

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
      title: `Чат — ${SITE_NAME}`,
      robots: { index: false, follow: false },
    };
  }
  return buildSeo({
    title: `Чат с ${profile.displayName ?? profile.name}`,
    description: `Запишитесь в ${profile.displayName ?? profile.name} через онлайн-чат. Отвечаем мгновенно.`,
    path: `/salon/${slug}/chat`,
    image: profile.logo ?? undefined,
    imageAlt: profile.displayName ?? profile.name,
    // Chat is a conversational interface — no need to index
    // (keeps Googlebot from repeatedly opening new sessions)
  });
}

export default async function SalonChatPage({ params }: Props) {
  const { slug } = await params;
  const ctx = await createTRPCContext({ headers: new Headers() });
  const caller = createCaller(ctx);
  const profile = await caller.publicSalon.getProfile({ slug }).catch(() => null);
  if (!profile) notFound();

  // Extract the tiny branding subset we actually need for first paint.
  // The ChatClient then calls POST /chat/init itself for the live session.
  const initialSalon = {
    slug,
    name: profile.displayName ?? profile.name,
    legalName: profile.name,
    logo: profile.logo ?? null,
    coverPhoto: profile.coverPhoto ?? null,
    brandPalette: (profile as { brandPalette?: { primary?: string } }).brandPalette ?? null,
    description: profile.description ?? null,
    city: profile.city ?? null,
  };

  return <ChatClient slug={slug} initialSalon={initialSalon} />;
}
