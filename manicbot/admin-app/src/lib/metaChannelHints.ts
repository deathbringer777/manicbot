/**
 * Pure helpers for Meta webhook URLs / verify tokens shown in Salon Channels tab.
 * Kept separate from env import so tests stay simple.
 */
export function buildMetaChannelHints(opts: {
  workerPublicUrl?: string | null;
  waVerify?: string | null;
  igVerify?: string | null;
}) {
  const raw = (opts.workerPublicUrl ?? "").trim().replace(/\/$/, "") || "https://manicbot.com";
  return {
    waWebhookUrl: `${raw}/webhook/wa`,
    igWebhookUrl: `${raw}/webhook/ig`,
    waVerifyToken: opts.waVerify?.trim() || null,
    igVerifyToken: opts.igVerify?.trim() || null,
  };
}
