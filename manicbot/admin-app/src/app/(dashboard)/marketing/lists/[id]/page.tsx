/**
 * List detail — Brevo-style member view for a manual segment.
 *
 * Tenant scope only. Sysadmin previewing a tenant still gets the page via
 * `useMarketingScope`. The router enforces tenant ownership; the client
 * just shows / hides actions.
 */

import ListDetailClient from "./ListDetailClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ListDetailClient id={id} />;
}
