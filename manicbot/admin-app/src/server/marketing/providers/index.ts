import { brevoProvider } from "./brevo";
import { resendProvider } from "./resend";
import type { MarketingProvider, ProviderName, ChannelType } from "./types";

export const PROVIDERS: Record<ProviderName, MarketingProvider | null> = {
  brevo: brevoProvider,
  resend: resendProvider,
  twilio: null, // reserved for future SMS-only provider
};

export function getProvider(name: ProviderName): MarketingProvider | null {
  return PROVIDERS[name] ?? null;
}

export function listProviders(): MarketingProvider[] {
  return Object.values(PROVIDERS).filter((p): p is MarketingProvider => p !== null);
}

/**
 * Pick the active provider for a given channel.
 * Priority: configured > channel-supporting > first in registry.
 * Returns null if nothing can service the channel.
 */
export function pickProvider(channel: ChannelType): MarketingProvider | null {
  const capable = listProviders().filter((p) => p.channels.includes(channel));
  const configured = capable.find((p) => p.isConfigured(channel));
  return configured ?? capable[0] ?? null;
}

export type { MarketingProvider, ProviderName, ChannelType } from "./types";
