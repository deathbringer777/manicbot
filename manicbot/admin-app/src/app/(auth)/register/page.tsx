/**
 * /register — server-component wrapper.
 *
 * The actual form is a client component (RegisterPageClient) because it
 * needs hooks (useSession, useTransition, useState, etc.). This shell
 * exists to emit localised OG / Twitter metadata so messenger previews
 * (Telegram, WhatsApp, Slack, iMessage) render the page title +
 * description in the inviter's language — keyed off `?lang=` in the share
 * URL, which ReferralsSection auto-appends.
 *
 * `(auth)/layout.tsx` already declares `robots: noindex,nofollow` for the
 * whole route group — Next.js merges metadata, so we keep it indexable=false
 * for Google while still serving OG/Twitter to messengers (they ignore
 * robots directives).
 */

export const runtime = "edge";

import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import { registerPageCopy, coerceRegisterLang } from "./registerPageCopy";
import RegisterPageClient from "./RegisterPageClient";

interface Props {
  searchParams: Promise<{ lang?: string; ref?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const lang = coerceRegisterLang(sp.lang);
  const copy = registerPageCopy[lang];
  // Normalise the ref shape the same way the client form does; we only use
  // this as a boolean "is a referral landing?" signal — no DB lookup.
  const refCode = sp.ref
    ? sp.ref.replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, 16)
    : "";
  const hasRef = /^[A-Z0-9-]{6,16}$/.test(refCode);

  return buildSeo({
    title: copy.title,
    description: hasRef ? copy.descriptionWithRef : copy.description,
    path: "/register",
    imageAlt: copy.title,
    ogLocale: langToOgLocale(lang),
    keywords: copy.keywords,
  });
}

export default function RegisterPage() {
  return <RegisterPageClient />;
}
