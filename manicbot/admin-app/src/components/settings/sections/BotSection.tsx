"use client";

import { useState } from "react";
import {
  Bot, CheckCircle, ExternalLink, Unplug, Loader2,
  Instagram, MessageCircle,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";
import { BotFatherGuide } from "~/components/settings/BotFatherGuide";
import { MetaGuide } from "~/components/settings/MetaGuide";

// ─── i18n ────────────────────────────────────────────────────────────────────

const T: Record<Lang, {
  tabs: { telegram: string; instagram: string; whatsapp: string };
  tg: {
    connected: string; notConnected: string; tokenLabel: string; tokenPlaceholder: string;
    connect: string; connecting: string; disconnect: string; disconnectConfirm: string;
    disconnectCancel: string; openBot: string; status: string; active: string;
  };
  ig: {
    connected: string; notConnected: string; tokenLabel: string; tokenPlaceholder: string;
    pageIdLabel: string; pageIdPlaceholder: string; igAccountLabel: string; igAccountPlaceholder: string;
    businessIdLabel: string; businessIdPlaceholder: string;
    connect: string; connecting: string; disconnect: string; disconnectConfirm: string;
    disconnectCancel: string; status: string; active: string; optional: string;
  };
  wa: {
    connected: string; notConnected: string; webhookUrl: string; verifyToken: string;
    copyBtn: string; copied: string; disconnect: string; disconnectConfirm: string; disconnectCancel: string;
    status: string; active: string; notConfigured: string;
    setupNote: string;
  };
  disconnectErr: string;
}> = {
  ru: {
    tabs: { telegram: "Telegram", instagram: "Instagram", whatsapp: "WhatsApp" },
    tg: {
      connected: "Бот подключён", notConnected: "Бот не подключён",
      tokenLabel: "Токен бота", tokenPlaceholder: "Вставьте токен из BotFather",
      connect: "Подключить бот", connecting: "Подключаем...",
      disconnect: "Отключить бот", disconnectConfirm: "Вы уверены? Бот перестанет принимать сообщения.",
      disconnectCancel: "Отмена", openBot: "Открыть бот", status: "Статус", active: "Активен",
    },
    ig: {
      connected: "Instagram подключён", notConnected: "Instagram не подключён",
      tokenLabel: "Page Access Token", tokenPlaceholder: "EAAxxxxxxxx...",
      pageIdLabel: "Facebook Page ID", pageIdPlaceholder: "123456789012345",
      igAccountLabel: "Instagram Account ID", igAccountPlaceholder: "17841437...",
      businessIdLabel: "Instagram Business ID", businessIdPlaceholder: "25881183...",
      connect: "Подключить Instagram", connecting: "Подключаем...",
      disconnect: "Отключить Instagram", disconnectConfirm: "Отключить Instagram-канал?",
      disconnectCancel: "Отмена", status: "Статус", active: "Активен", optional: "(необязательно)",
    },
    wa: {
      connected: "WhatsApp подключён", notConnected: "WhatsApp не подключён",
      webhookUrl: "Webhook URL", verifyToken: "Verify Token",
      copyBtn: "Копировать", copied: "Скопировано",
      disconnect: "Отключить WhatsApp", disconnectConfirm: "Отключить WhatsApp-канал?",
      disconnectCancel: "Отмена", status: "Статус", active: "Активен",
      notConfigured: "Webhook данные недоступны — проверьте WORKER_PUBLIC_URL и META_VERIFY_TOKEN_WA",
      setupNote: "После настройки вебхука в Meta Business Manager обратитесь в поддержку для активации канала.",
    },
    disconnectErr: "Ошибка отключения",
  },
  ua: {
    tabs: { telegram: "Telegram", instagram: "Instagram", whatsapp: "WhatsApp" },
    tg: {
      connected: "Бот підключений", notConnected: "Бот не підключений",
      tokenLabel: "Токен бота", tokenPlaceholder: "Вставте токен з BotFather",
      connect: "Підключити бот", connecting: "Підключаємо...",
      disconnect: "Відключити бот", disconnectConfirm: "Ви впевнені? Бот перестане приймати повідомлення.",
      disconnectCancel: "Скасувати", openBot: "Відкрити бот", status: "Статус", active: "Активний",
    },
    ig: {
      connected: "Instagram підключений", notConnected: "Instagram не підключений",
      tokenLabel: "Page Access Token", tokenPlaceholder: "EAAxxxxxxxx...",
      pageIdLabel: "Facebook Page ID", pageIdPlaceholder: "123456789012345",
      igAccountLabel: "Instagram Account ID", igAccountPlaceholder: "17841437...",
      businessIdLabel: "Instagram Business ID", businessIdPlaceholder: "25881183...",
      connect: "Підключити Instagram", connecting: "Підключаємо...",
      disconnect: "Відключити Instagram", disconnectConfirm: "Відключити Instagram-канал?",
      disconnectCancel: "Скасувати", status: "Статус", active: "Активний", optional: "(необов'язково)",
    },
    wa: {
      connected: "WhatsApp підключений", notConnected: "WhatsApp не підключений",
      webhookUrl: "Webhook URL", verifyToken: "Verify Token",
      copyBtn: "Копіювати", copied: "Скопійовано",
      disconnect: "Відключити WhatsApp", disconnectConfirm: "Відключити WhatsApp-канал?",
      disconnectCancel: "Скасувати", status: "Статус", active: "Активний",
      notConfigured: "Дані вебхуку недоступні — перевірте WORKER_PUBLIC_URL та META_VERIFY_TOKEN_WA",
      setupNote: "Після налаштування вебхуку в Meta Business Manager зверніться до підтримки для активації каналу.",
    },
    disconnectErr: "Помилка відключення",
  },
  en: {
    tabs: { telegram: "Telegram", instagram: "Instagram", whatsapp: "WhatsApp" },
    tg: {
      connected: "Bot connected", notConnected: "Bot not connected",
      tokenLabel: "Bot token", tokenPlaceholder: "Paste token from BotFather",
      connect: "Connect bot", connecting: "Connecting...",
      disconnect: "Disconnect bot", disconnectConfirm: "Are you sure? The bot will stop receiving messages.",
      disconnectCancel: "Cancel", openBot: "Open bot", status: "Status", active: "Active",
    },
    ig: {
      connected: "Instagram connected", notConnected: "Instagram not connected",
      tokenLabel: "Page Access Token", tokenPlaceholder: "EAAxxxxxxxx...",
      pageIdLabel: "Facebook Page ID", pageIdPlaceholder: "123456789012345",
      igAccountLabel: "Instagram Account ID", igAccountPlaceholder: "17841437...",
      businessIdLabel: "Instagram Business ID", businessIdPlaceholder: "25881183...",
      connect: "Connect Instagram", connecting: "Connecting...",
      disconnect: "Disconnect Instagram", disconnectConfirm: "Disconnect Instagram channel?",
      disconnectCancel: "Cancel", status: "Status", active: "Active", optional: "(optional)",
    },
    wa: {
      connected: "WhatsApp connected", notConnected: "WhatsApp not connected",
      webhookUrl: "Webhook URL", verifyToken: "Verify Token",
      copyBtn: "Copy", copied: "Copied",
      disconnect: "Disconnect WhatsApp", disconnectConfirm: "Disconnect WhatsApp channel?",
      disconnectCancel: "Cancel", status: "Status", active: "Active",
      notConfigured: "Webhook info unavailable — check WORKER_PUBLIC_URL and META_VERIFY_TOKEN_WA",
      setupNote: "After configuring the webhook in Meta Business Manager, contact support to activate the channel.",
    },
    disconnectErr: "Disconnect error",
  },
  pl: {
    tabs: { telegram: "Telegram", instagram: "Instagram", whatsapp: "WhatsApp" },
    tg: {
      connected: "Bot podłączony", notConnected: "Bot nie jest podłączony",
      tokenLabel: "Token bota", tokenPlaceholder: "Wklej token z BotFather",
      connect: "Podłącz bota", connecting: "Podłączanie...",
      disconnect: "Odłącz bota", disconnectConfirm: "Czy na pewno? Bot przestanie odbierać wiadomości.",
      disconnectCancel: "Anuluj", openBot: "Otwórz bota", status: "Status", active: "Aktywny",
    },
    ig: {
      connected: "Instagram podłączony", notConnected: "Instagram nie jest podłączony",
      tokenLabel: "Page Access Token", tokenPlaceholder: "EAAxxxxxxxx...",
      pageIdLabel: "Facebook Page ID", pageIdPlaceholder: "123456789012345",
      igAccountLabel: "Instagram Account ID", igAccountPlaceholder: "17841437...",
      businessIdLabel: "Instagram Business ID", businessIdPlaceholder: "25881183...",
      connect: "Podłącz Instagram", connecting: "Podłączanie...",
      disconnect: "Odłącz Instagram", disconnectConfirm: "Odłączyć kanał Instagram?",
      disconnectCancel: "Anuluj", status: "Status", active: "Aktywny", optional: "(opcjonalnie)",
    },
    wa: {
      connected: "WhatsApp podłączony", notConnected: "WhatsApp nie jest podłączony",
      webhookUrl: "Webhook URL", verifyToken: "Verify Token",
      copyBtn: "Kopiuj", copied: "Skopiowano",
      disconnect: "Odłącz WhatsApp", disconnectConfirm: "Odłączyć kanał WhatsApp?",
      disconnectCancel: "Anuluj", status: "Status", active: "Aktywny",
      notConfigured: "Dane webhook niedostępne — sprawdź WORKER_PUBLIC_URL i META_VERIFY_TOKEN_WA",
      setupNote: "Po skonfigurowaniu webhooka w Meta Business Manager skontaktuj się z pomocą techniczną.",
    },
    disconnectErr: "Błąd odłączania",
  },
};

// ─── Shared sub-components ────────────────────────────────────────────────────

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(value); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 text-[10px] px-2 py-1 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors"
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

function ConnectedBadge({ label, onDisconnect, confirmMsg, cancelLabel, disconnectLabel, isPending }: {
  label: string; onDisconnect: () => void; confirmMsg: string; cancelLabel: string;
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
            <button
              onClick={onDisconnect}
              disabled={isPending}
              className="flex-1 py-2 rounded-lg bg-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/25 transition-colors disabled:opacity-50"
            >
              {disconnectLabel}
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirm(true)}
          className="flex items-center justify-center gap-2 w-full rounded-xl border border-red-500/20 px-4 py-2.5 text-xs font-medium text-red-400 hover:bg-red-500/5 transition-colors"
        >
          <Unplug className="h-3.5 w-3.5" />
          {disconnectLabel}
        </button>
      )}
    </div>
  );
}

// ─── Telegram tab ─────────────────────────────────────────────────────────────

function TelegramTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const l = T[lang].tg;
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
              <p className="text-[11px] text-slate-500">{l.connected}</p>
            </div>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/[0.06]">
            <span className="text-xs text-slate-500">{l.status}</span>
            <span className="text-xs font-semibold text-emerald-500">{l.active}</span>
          </div>
          {bot.botUsername && (
            <a
              href={`https://t.me/${bot.botUsername}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-500/40 transition-colors"
            >
              {l.openBot} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <ConnectedBadge
            label={l.connected}
            onDisconnect={() => disconnectMut.mutate({ tenantId })}
            confirmMsg={l.disconnectConfirm}
            cancelLabel={l.disconnectCancel}
            disconnectLabel={l.disconnect}
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
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{l.notConnected}</h3>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setError(null); if (token.trim()) connectMut.mutate({ tenantId, token: token.trim() }); }} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{l.tokenLabel}</label>
            <input
              type="text"
              value={token}
              onChange={(e) => { setToken(e.target.value); setError(null); }}
              placeholder={l.tokenPlaceholder}
              className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white font-mono"
              required
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={connectMut.isPending || !token.trim()}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70"
          >
            {connectMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> {l.connecting}</> : <><Bot className="h-4 w-4" /> {l.connect}</>}
          </button>
        </form>
      </section>
    </div>
  );
}

// ─── Instagram tab ────────────────────────────────────────────────────────────

function InstagramTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const l = T[lang].ig;
  const [token, setToken] = useState("");
  const [pageId, setPageId] = useState("");
  const [igAccountId, setIgAccountId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();

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
    try { cfg = igChannel.config ? JSON.parse(igChannel.config) : {}; } catch { /* ignore */ }
    return (
      <div className="space-y-4">
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-pink-500/15 flex items-center justify-center">
              <Instagram className="h-5 w-5 text-pink-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{cfg.page_id ? `Page ${cfg.page_id}` : "Instagram"}</h3>
              <p className="text-[11px] text-slate-500">{l.connected}</p>
            </div>
          </div>
          <ConnectedBadge
            label={l.connected}
            onDisconnect={() => disconnectMut.mutate({ tenantId, channelType: "instagram" })}
            confirmMsg={l.disconnectConfirm}
            cancelLabel={l.disconnectCancel}
            disconnectLabel={l.disconnect}
            isPending={disconnectMut.isPending}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MetaGuide channel="instagram" />
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-pink-500/10 flex items-center justify-center">
            <Instagram className="h-5 w-5 text-pink-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{l.notConnected}</h3>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); setError(null); connectMut.mutate({ tenantId, token: token.trim(), pageId: pageId.trim(), igAccountId: igAccountId.trim() || undefined, instagramBusinessId: businessId.trim() || undefined }); }}
          className="space-y-3"
        >
          {([
            { label: l.tokenLabel, value: token, onChange: setToken, placeholder: l.tokenPlaceholder, required: true, mono: true },
            { label: l.pageIdLabel, value: pageId, onChange: setPageId, placeholder: l.pageIdPlaceholder, required: true, mono: true },
            { label: `${l.igAccountLabel} ${l.optional}`, value: igAccountId, onChange: setIgAccountId, placeholder: l.igAccountPlaceholder, required: false, mono: true },
            { label: `${l.businessIdLabel} ${l.optional}`, value: businessId, onChange: setBusinessId, placeholder: l.businessIdPlaceholder, required: false, mono: true },
          ] as const).map((field) => (
            <div key={field.label}>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{field.label}</label>
              <input
                type="text"
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                placeholder={field.placeholder}
                required={field.required}
                className={`w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-pink-500/60 text-slate-900 dark:text-white${field.mono ? " font-mono" : ""}`}
              />
            </div>
          ))}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={connectMut.isPending || !token.trim() || !pageId.trim()}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-pink-500/20 disabled:opacity-70"
          >
            {connectMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> {l.connecting}</> : <><Instagram className="h-4 w-4" /> {l.connect}</>}
          </button>
        </form>
      </section>
    </div>
  );
}

// ─── WhatsApp tab ─────────────────────────────────────────────────────────────

function WhatsAppTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const l = T[lang].wa;
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

      {/* Webhook info box (for pasting into Meta Business Manager) */}
      <section className="glass-card rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Webhook</h3>
        {hints.data ? (
          <>
            <div className="space-y-2">
              {[
                { label: l.webhookUrl, value: hints.data.waWebhookUrl },
                { label: l.verifyToken, value: hints.data.waVerifyToken },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</p>
                  <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/40 rounded-xl px-3 py-2">
                    <code className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate">{value ?? "—"}</code>
                    {value && <CopyButton value={value} label={l.copyBtn} copiedLabel={l.copied} />}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-white/[0.06] px-3 py-2.5">
              {l.setupNote}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-amber-400">{l.notConfigured}</p>
        )}
      </section>

      {/* Status / disconnect if already connected */}
      {waChannel && (
        <section className="glass-card rounded-2xl p-5 space-y-3">
          <ConnectedBadge
            label={l.connected}
            onDisconnect={() => disconnectMut.mutate({ tenantId, channelType: "whatsapp" })}
            confirmMsg={l.disconnectConfirm}
            cancelLabel={l.disconnectCancel}
            disconnectLabel={l.disconnect}
            isPending={disconnectMut.isPending}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </section>
      )}
    </div>
  );
}

// ─── Main BotSection ──────────────────────────────────────────────────────────

type Tab = "telegram" | "instagram" | "whatsapp";

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  telegram: <Bot className="h-4 w-4" />,
  instagram: <Instagram className="h-4 w-4" />,
  whatsapp: <MessageCircle className="h-4 w-4" />,
};

export function BotSection({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const tabs = T[lang].tabs;
  const [active, setActive] = useState<Tab>("telegram");

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-white/[0.06]">
        {(["telegram", "instagram", "whatsapp"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-all ${
              active === tab
                ? "bg-white dark:bg-slate-800 shadow-sm text-slate-900 dark:text-white"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            {TAB_ICONS[tab]}
            <span className="hidden sm:inline">{tabs[tab]}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {active === "telegram" && <TelegramTab tenantId={tenantId} />}
      {active === "instagram" && <InstagramTab tenantId={tenantId} />}
      {active === "whatsapp" && <WhatsAppTab tenantId={tenantId} />}
    </div>
  );
}
