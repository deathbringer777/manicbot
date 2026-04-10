"use client";

import { useState } from "react";
import {
  Loader2, Bot, CheckCircle, ExternalLink, Unplug,
  Instagram, MessageCircle, Globe, Copy, Check,
  Eye, EyeOff, Download, QrCode,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "~/trpc/react";
import { SectionHeader } from "./SalonShared";
import { BotFatherGuide } from "~/components/settings/BotFatherGuide";
import { MetaGuide } from "~/components/settings/MetaGuide";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="shrink-0 text-[10px] px-2 py-1 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors"
    >
      {copied ? "Скопировано" : "Копировать"}
    </button>
  );
}

function ConnectedBadge({
  label, onDisconnect, confirmMsg, disconnectLabel, isPending,
}: {
  label: string; onDisconnect: () => void; confirmMsg: string;
  disconnectLabel: string; isPending: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
        <span className="text-xs font-medium text-emerald-400">{label}</span>
      </div>
      {confirm ? (
        <div className="rounded-xl border border-red-500/20 p-3 space-y-2">
          <p className="text-xs text-red-400">{confirmMsg}</p>
          <div className="flex gap-2">
            <button onClick={onDisconnect} disabled={isPending}
              className="flex-1 py-2 rounded-lg bg-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/25 transition-colors disabled:opacity-50">
              {disconnectLabel}
            </button>
            <button onClick={() => setConfirm(false)}
              className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors">
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)}
          className="flex items-center justify-center gap-2 w-full rounded-xl border border-red-500/20 px-4 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/5 transition-colors">
          <Unplug className="h-3.5 w-3.5" />
          {disconnectLabel}
        </button>
      )}
    </div>
  );
}

function downloadQrPng(svgEl: SVGSVGElement | null, filename: string) {
  if (!svgEl) return;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 512, 512);
    ctx.drawImage(img, 0, 0, 512, 512);
    URL.revokeObjectURL(svgUrl);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };
  img.src = svgUrl;
}

// ─── Telegram ────────────────────────────────────────────────────────────────

function TelegramTab({ tenantId }: { tenantId: string }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const botStatus = api.salon.getBotStatus.useQuery({ tenantId });
  const connectMut = api.salon.connectBot.useMutation({
    onSuccess: () => { setToken(""); setError(null); utils.salon.getBotStatus.invalidate({ tenantId }); },
    onError: (err) => setError(err.message),
  });
  const disconnectMut = api.salon.disconnectBot.useMutation({
    onSuccess: () => utils.salon.getBotStatus.invalidate({ tenantId }),
  });

  if (botStatus.isLoading) return <div className="glass-card rounded-2xl p-5 h-32 animate-pulse" />;

  const bot = botStatus.data;

  if (bot) {
    return (
      <div className="space-y-4">
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
              <Bot className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">@{bot.botUsername ?? bot.botId}</h3>
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <p className="text-[11px] text-slate-500">Бот подключён</p>
            </div>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/[0.06]">
            <span className="text-xs text-slate-500">Статус</span>
            <span className="text-xs font-semibold text-emerald-500">Активен</span>
          </div>
          {bot.botUsername && (
            <a href={`https://t.me/${bot.botUsername}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-500/40 transition-colors">
              Открыть бот <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <ConnectedBadge
            label="Бот подключён"
            onDisconnect={() => disconnectMut.mutate({ tenantId })}
            confirmMsg="Вы уверены? Бот перестанет принимать сообщения."
            disconnectLabel="Отключить бот"
            isPending={disconnectMut.isPending}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BotFatherGuide />
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-brand-500/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-brand-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Бот не подключён</h3>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setError(null); if (token.trim()) connectMut.mutate({ tenantId, token: token.trim() }); }} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">Токен бота</label>
            <input type="text" value={token} onChange={(e) => { setToken(e.target.value); setError(null); }}
              placeholder="Вставьте токен из BotFather"
              className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white font-mono"
              required />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={connectMut.isPending || !token.trim()}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70">
            {connectMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Подключаем...</> : <><Bot className="h-4 w-4" /> Подключить бот</>}
          </button>
        </form>
      </section>
    </div>
  );
}

// ─── Instagram ───────────────────────────────────────────────────────────────

function InstagramTab({ tenantId }: { tenantId: string }) {
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("");
  const [igAccountId, setIgAccountId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const channels = api.salon.getChannels.useQuery({ tenantId });
  const igChannel = channels.data?.find((c) => c.channelType === "instagram");

  const connectMut = api.salon.connectInstagram.useMutation({
    onSuccess: () => { setToken(""); setPageId(""); setIgAccountId(""); setBusinessId(""); setError(null); void channels.refetch(); },
    onError: (err) => setError(err.message),
  });
  const disconnectMut = api.salon.disconnectChannel.useMutation({
    onSuccess: () => void channels.refetch(),
    onError: (err) => setError(err.message),
  });

  if (channels.isLoading) return <div className="glass-card rounded-2xl p-5 h-32 animate-pulse" />;

  if (igChannel) {
    let cfg: Record<string, string> = {};
    try { cfg = igChannel.config ? JSON.parse(igChannel.config) : {}; } catch { /* */ }
    return (
      <div className="space-y-4">
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-pink-500/15 flex items-center justify-center">
              <Instagram className="h-5 w-5 text-pink-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{cfg.page_id ? `Page ${cfg.page_id}` : "Instagram"}</h3>
              <p className="text-[11px] text-slate-500">Instagram подключён</p>
            </div>
          </div>
          <ConnectedBadge
            label="Instagram подключён"
            onDisconnect={() => disconnectMut.mutate({ tenantId, channelType: "instagram" })}
            confirmMsg="Отключить Instagram-канал?"
            disconnectLabel="Отключить Instagram"
            isPending={disconnectMut.isPending}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </section>
      </div>
    );
  }

  const fields = [
    { label: "Page Access Token", value: token, onChange: setToken, placeholder: "EAAxxxxxxxx...", required: true },
    { label: "Facebook Page ID", value: pageId, onChange: setPageId, placeholder: "123456789012345", required: true },
    { label: "Instagram Account ID (необязательно)", value: igAccountId, onChange: setIgAccountId, placeholder: "17841437...", required: false },
    { label: "Instagram Business ID (необязательно)", value: businessId, onChange: setBusinessId, placeholder: "25881183...", required: false },
  ] as const;

  return (
    <div className="space-y-4">
      <MetaGuide channel="instagram" />
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-pink-500/10 flex items-center justify-center">
            <Instagram className="h-5 w-5 text-pink-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Instagram не подключён</h3>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); setError(null); connectMut.mutate({ tenantId, token: token.trim(), pageId: pageId.trim(), igAccountId: igAccountId.trim() || undefined, instagramBusinessId: businessId.trim() || undefined }); }}
          className="space-y-3"
        >
          {fields.map((f) => (
            <div key={f.label}>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{f.label}</label>
              <input type="text" value={f.value} onChange={(e) => f.onChange(e.target.value)}
                placeholder={f.placeholder} required={f.required}
                className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-pink-500/60 text-slate-900 dark:text-white font-mono" />
            </div>
          ))}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={connectMut.isPending || !token.trim() || !pageId.trim()}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-pink-500/20 disabled:opacity-70">
            {connectMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Подключаем...</> : <><Instagram className="h-4 w-4" /> Подключить Instagram</>}
          </button>
        </form>
      </section>
    </div>
  );
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

function WhatsAppTab({ tenantId }: { tenantId: string }) {
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const channels = api.salon.getChannels.useQuery({ tenantId });
  const hints = api.salon.getMetaChannelHints.useQuery({ tenantId });
  const waChannel = channels.data?.find((c) => c.channelType === "whatsapp");

  const disconnectMut = api.salon.disconnectChannel.useMutation({
    onSuccess: () => { void channels.refetch(); void utils.salon.getChannels.invalidate({ tenantId }); },
    onError: (err) => setError(err.message),
  });

  if (channels.isLoading) return <div className="glass-card rounded-2xl p-5 h-32 animate-pulse" />;

  return (
    <div className="space-y-4">
      <MetaGuide channel="whatsapp" />

      <section className="glass-card rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Webhook</h3>
        {hints.data ? (
          <>
            <div className="space-y-2">
              {[
                { label: "Webhook URL", value: hints.data.waWebhookUrl },
                { label: "Verify Token", value: hints.data.waVerifyToken },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</p>
                  <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/40 rounded-xl px-3 py-2">
                    <code className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate">{value ?? "—"}</code>
                    {value && <CopyBtn value={value} />}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-white/[0.06] px-3 py-2.5">
              После настройки вебхука в Meta Business Manager обратитесь в поддержку для активации канала.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-amber-400">Webhook данные недоступны — проверьте настройки сервера</p>
        )}
      </section>

      {waChannel && (
        <section className="glass-card rounded-2xl p-5 space-y-3">
          <ConnectedBadge
            label="WhatsApp подключён"
            onDisconnect={() => disconnectMut.mutate({ tenantId, channelType: "whatsapp" })}
            confirmMsg="Отключить WhatsApp-канал?"
            disconnectLabel="Отключить WhatsApp"
            isPending={disconnectMut.isPending}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </section>
      )}
    </div>
  );
}

// ─── Web Profile ─────────────────────────────────────────────────────────────

function WebProfileTab({ slug, publicActive }: { slug?: string | null; publicActive?: boolean }) {
  const publicUrl = slug ? `https://manicbot.com/salon/${slug}` : null;

  if (!slug) {
    return (
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-sky-500/15 flex items-center justify-center">
            <Globe className="h-5 w-5 text-sky-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Веб-профиль не настроен</h3>
            <p className="text-[11px] text-slate-500">Настройте адрес профиля во вкладке «Профиль»</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status */}
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-2xl flex items-center justify-center ${publicActive ? "bg-emerald-500/15" : "bg-slate-500/15"}`}>
            <Globe className={`h-5 w-5 ${publicActive ? "text-emerald-400" : "text-slate-400"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Веб-профиль</h3>
            <p className={`text-[11px] ${publicActive ? "text-emerald-400" : "text-slate-500"}`}>
              {publicActive ? "Опубликован" : "Скрыт из каталога"}
            </p>
          </div>
          {publicActive && (
            <a href={publicUrl!} target="_blank" rel="noopener noreferrer"
              className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
              Открыть <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* URL */}
        <div>
          <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">Адрес профиля</p>
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/40 rounded-xl px-3 py-2">
            <code className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate">{publicUrl}</code>
            <CopyBtn value={publicUrl!} />
          </div>
        </div>
      </section>

      {/* QR Code */}
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">QR-код</h3>
        </div>
        <p className="text-[11px] text-slate-500">Распечатайте QR-код и разместите в салоне — клиенты смогут быстро перейти к записи.</p>
        <div className="flex flex-col items-center gap-3">
          <div className="bg-white p-4 rounded-2xl" data-qr-wrapper="web-profile">
            <QRCodeSVG value={publicUrl!} size={200} level="M" />
          </div>
          <button
            type="button"
            onClick={() => {
              const wrapper = document.querySelector('[data-qr-wrapper="web-profile"]');
              const svg = wrapper?.querySelector("svg") as SVGSVGElement | null;
              downloadQrPng(svg, `qr-${slug}.png`);
            }}
            className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors font-medium"
          >
            <Download className="h-3.5 w-3.5" />
            Скачать PNG
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

type ChannelTab = "telegram" | "instagram" | "whatsapp" | "web";

const TABS: { key: ChannelTab; label: string; icon: React.ElementType }[] = [
  { key: "telegram", label: "Telegram", icon: Bot },
  { key: "instagram", label: "Instagram", icon: Instagram },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "web", label: "Веб-профиль", icon: Globe },
];

export function SalonChannelsTab({
  tenantId,
  slug,
  publicActive,
}: {
  tenantId: string;
  slug?: string | null;
  publicActive?: boolean;
}) {
  const [active, setActive] = useState<ChannelTab>("telegram");

  return (
    <div className="space-y-5">
      <SectionHeader title="Каналы" />

      {/* Sub-tab bar */}
      <div className="flex gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/60 overflow-x-auto scrollbar-none">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
                isActive
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {active === "telegram" && <TelegramTab tenantId={tenantId} />}
      {active === "instagram" && <InstagramTab tenantId={tenantId} />}
      {active === "whatsapp" && <WhatsAppTab tenantId={tenantId} />}
      {active === "web" && <WebProfileTab slug={slug} publicActive={publicActive} />}
    </div>
  );
}
