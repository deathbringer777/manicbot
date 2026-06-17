export const runtime = "edge";

import CampaignDetailClient from "./CampaignDetailClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CampaignDetailClient id={id} />;
}
