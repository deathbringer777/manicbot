"use client";

import { useState } from "react";
import {
  Loader2, Save, Trash2, Eye, EyeOff, Wifi, WifiOff,
  Copy, Check, ExternalLink, MessageCircle,
} from "lucide-react";
import { api } from "~/trpc/react";
import { SectionHeader, Input } from "./SalonShared";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="ml-2 text-slate-400 hover:text-brand-400 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function ChannelCard({
  icon, title, subtitle, connected, onToggle, children,
}: {
  icon: React.ReactNode; title: string; subtitle: string;
  connected: boolean; onToggle?: () => void;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(!connected);
  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm">{title}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Wifi className="h-3.5 w-3.5" /> Connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <WifiOff className="h-3.5 w-3.5" /> Not connected
            </span>
          )}
          {onToggle && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 rounded-lg px-2 py-1 transition-colors"
            >
              {expanded ? "Hide" : connected ? "Edit" : "Connect"}
            </button>
          )}
        </div>
      </div>
      {expanded && children && <div className="border-t border-white/5 pt-3">{children}</div>}
    </div>
  );
}

export function SalonChannelsTab({ tenantId }: { tenantId: string }) {
  const utils = api.useUtils();
  const channels = api.channels.list.useQuery({ tenantId });
  const hints = api.salon.getMetaChannelHints.useQuery({ tenantId });
  const upsert = api.channels.upsert.useMutation({
    onSuccess: () => { void utils.channels.list.invalidate(); },
  });
  const remove = api.channels.delete.useMutation({
    onSuccess: () => { void utils.channels.list.invalidate(); },
  });

  const waConfig = channels.data?.find(c => c.channelType === "whatsapp");
  const igConfig = channels.data?.find(c => c.channelType === "instagram");

  const [waPhoneId, setWaPhoneId] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waWabaId, setWaWabaId] = useState("");
  const [igPageId, setIgPageId] = useState("");
  const [igToken, setIgToken] = useState("");
  const [showWaToken, setShowWaToken] = useState(false);
  const [showIgToken, setShowIgToken] = useState(false);

  const waWebhookUrl = hints.data?.waWebhookUrl ?? "https://manicbot.com/webhook/wa";
  const igWebhookUrl = hints.data?.igWebhookUrl ?? "https://manicbot.com/webhook/ig";
  const waVerifyDisplay = hints.data?.waVerifyToken;
  const igVerifyDisplay = hints.data?.igVerifyToken;

  if (channels.isLoading) return <Loader2 className="animate-spin text-brand-400 mx-auto" />;

  const handleWaSave = () => {
    if (!waPhoneId.trim() || !waToken.trim()) return;
    const config = JSON.stringify({ phone_number_id: waPhoneId.trim(), waba_id: waWabaId.trim(), access_token: waToken.trim() });
    upsert.mutate({ tenantId, channelType: "whatsapp", config, active: true });
    setWaPhoneId(""); setWaToken(""); setWaWabaId("");
  };

  const handleIgSave = () => {
    if (!igPageId.trim() || !igToken.trim()) return;
    const config = JSON.stringify({ page_id: igPageId.trim(), access_token: igToken.trim() });
    upsert.mutate({ tenantId, channelType: "instagram", config, active: true });
    setIgPageId(""); setIgToken("");
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="Channels" />

      {/* Telegram — always connected */}
      <ChannelCard
        icon={<MessageCircle className="h-5 w-5" />}
        title="Telegram"
        subtitle="Primary booking channel"
        connected={true}
      />

      {/* WhatsApp */}
      <ChannelCard
        icon={<span className="text-base font-bold">WA</span>}
        title="WhatsApp"
        subtitle="WhatsApp Cloud API"
        connected={!!waConfig?.active}
        onToggle={() => {}}
      >
        {waConfig ? (
          <div className="space-y-3">
            <div className="text-xs text-slate-400 space-y-1">
              {(() => {
                const cfg = waConfig.config ? (() => { try { return JSON.parse(waConfig.config); } catch { return {}; } })() : {};
                return (
                  <>
                    <div className="flex items-center"><span className="text-slate-500 w-32">Phone Number ID:</span><span className="text-white font-mono">{cfg.phone_number_id ?? "—"}</span></div>
                    {cfg.waba_id && <div className="flex items-center"><span className="text-slate-500 w-32">WABA ID:</span><span className="text-white font-mono">{cfg.waba_id}</span></div>}
                    <div className="flex items-center"><span className="text-slate-500 w-32">Token:</span><span className="text-slate-400">••••••••</span></div>
                  </>
                );
              })()}
            </div>
            <div className="flex gap-2">
              <button onClick={() => remove.mutate({ tenantId, id: waConfig.id })}
                className="text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg px-3 py-1.5 transition-colors flex items-center gap-1">
                <Trash2 className="h-3 w-3" /> Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Enter your WhatsApp Cloud API credentials from Meta Developer Dashboard.</p>
            <div className="space-y-2">
              <input value={waPhoneId} onChange={e => setWaPhoneId(e.target.value)} placeholder="Phone Number ID"
                className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
              <input value={waWabaId} onChange={e => setWaWabaId(e.target.value)} placeholder="WABA ID (optional)"
                className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
              <div className="relative">
                <input type={showWaToken ? "text" : "password"} value={waToken} onChange={e => setWaToken(e.target.value)} placeholder="Access Token"
                  className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
                <button onClick={() => setShowWaToken(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showWaToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <button onClick={handleWaSave} disabled={!waPhoneId || !waToken || upsert.isPending}
              className="w-full text-xs bg-brand-500/20 hover:bg-brand-500/30 text-brand-400 border border-brand-500/30 rounded-xl py-2 font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
              {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save & Connect
            </button>
          </div>
        )}
        <div className="mt-3 p-2.5 bg-black/20 rounded-xl">
          <p className="text-[10px] text-slate-500 mb-1">Webhook URL (paste in Meta Dashboard)</p>
          <div className="flex items-center">
            <code className="text-[10px] text-slate-300 font-mono flex-1 truncate">{waWebhookUrl}</code>
            <CopyButton text={waWebhookUrl} />
            <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="ml-1 text-slate-500 hover:text-brand-400">
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="flex items-center mt-1 gap-1 flex-wrap">
            <p className="text-[10px] text-slate-500 flex-1 min-w-[80px]">Verify Token:</p>
            {waVerifyDisplay ? (
              <>
                <code className="text-[10px] text-slate-300 font-mono break-all">{waVerifyDisplay}</code>
                <CopyButton text={waVerifyDisplay} />
              </>
            ) : (
              <span className="text-[10px] text-amber-400/90">Set META_VERIFY_TOKEN_WA on Pages (= Worker secret)</span>
            )}
          </div>
        </div>
      </ChannelCard>

      {/* Instagram */}
      <ChannelCard
        icon={<span className="text-base font-bold">IG</span>}
        title="Instagram"
        subtitle="Instagram Messaging API"
        connected={!!igConfig?.active}
        onToggle={() => {}}
      >
        {igConfig ? (
          <div className="space-y-3">
            <div className="text-xs text-slate-400 space-y-1">
              {(() => {
                const cfg = igConfig.config ? (() => { try { return JSON.parse(igConfig.config); } catch { return {}; } })() : {};
                return (
                  <>
                    <div className="flex items-center"><span className="text-slate-500 w-24">Page ID:</span><span className="text-white font-mono">{cfg.page_id ?? "—"}</span></div>
                    <div className="flex items-center"><span className="text-slate-500 w-24">Token:</span><span className="text-slate-400">••••••••</span></div>
                  </>
                );
              })()}
            </div>
            <button onClick={() => remove.mutate({ tenantId, id: igConfig.id })}
              className="text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg px-3 py-1.5 transition-colors flex items-center gap-1">
              <Trash2 className="h-3 w-3" /> Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Enter your Instagram Messaging API credentials.</p>
            <div className="space-y-2">
              <input value={igPageId} onChange={e => setIgPageId(e.target.value)} placeholder="Instagram Page ID"
                className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
              <div className="relative">
                <input type={showIgToken ? "text" : "password"} value={igToken} onChange={e => setIgToken(e.target.value)} placeholder="Page Access Token"
                  className="w-full text-xs bg-white/5 border border-white/10 text-white rounded-xl px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder-slate-600" />
                <button onClick={() => setShowIgToken(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showIgToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <button onClick={handleIgSave} disabled={!igPageId || !igToken || upsert.isPending}
              className="w-full text-xs bg-brand-500/20 hover:bg-brand-500/30 text-brand-400 border border-brand-500/30 rounded-xl py-2 font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
              {upsert.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save & Connect
            </button>
          </div>
        )}
        <div className="mt-3 p-2.5 bg-black/20 rounded-xl">
          <p className="text-[10px] text-slate-500 mb-1">Webhook URL (paste in Meta Dashboard)</p>
          <div className="flex items-center">
            <code className="text-[10px] text-slate-300 font-mono flex-1 truncate">{igWebhookUrl}</code>
            <CopyButton text={igWebhookUrl} />
          </div>
          <div className="flex items-center mt-1 gap-1 flex-wrap">
            <p className="text-[10px] text-slate-500 flex-1 min-w-[80px]">Verify Token:</p>
            {igVerifyDisplay ? (
              <>
                <code className="text-[10px] text-slate-300 font-mono break-all">{igVerifyDisplay}</code>
                <CopyButton text={igVerifyDisplay} />
              </>
            ) : (
              <span className="text-[10px] text-amber-400/90">Set META_VERIFY_TOKEN_IG on Pages (= Worker secret)</span>
            )}
          </div>
        </div>
      </ChannelCard>
    </div>
  );
}
