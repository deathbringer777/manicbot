"use client";

import { useState, useEffect, useRef } from "react";
import {
  Loader2, Bot, CheckCircle, ExternalLink, Unplug,
  Instagram, MessageCircle, Globe,
  Download, QrCode, Sparkles, Power,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { SectionHeader, Btn } from "./SalonShared";
import { AssetUploadField } from "./AssetUploadField";
import { IGHealthCard } from "./IGHealthCard";
import { InstagramConnect } from "./InstagramConnect";
import { IGSendTestDialog } from "./IGSendTestDialog";
import { SalonMasterPairingTable } from "./SalonMasterPairingTable";
import { SalonOwnerPairingCard } from "./SalonOwnerPairingCard";
import { BotFatherGuide } from "~/components/settings/BotFatherGuide";
import { MetaGuide } from "~/components/settings/MetaGuide";
import { Send, Pause, Play, Trash2 } from "lucide-react";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function CopyBtn({ value }: { value: string }) {
  const { lang } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="shrink-0 text-[10px] px-2 py-1 rounded-lg bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors"
    >
      {copied ? t("channels.copied", lang) : t("channels.copy", lang)}
    </button>
  );
}

function ConnectedBadge({
  label, onDisconnect, confirmMsg, disconnectLabel, isPending,
}: {
  label: string; onDisconnect: () => void; confirmMsg: string;
  disconnectLabel: string; isPending: boolean;
}) {
  const { lang } = useLang();
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
              {t("common.cancel", lang)}
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
  const { lang } = useLang();
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
              <p className="text-[11px] text-slate-500">{t("channels.botConnected", lang)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-white/[0.06]">
            <span className="text-xs text-slate-500">{t("channels.status", lang)}</span>
            <span className="text-xs font-semibold text-emerald-500">{t("channels.active", lang)}</span>
          </div>
          {bot.botUsername && (
            <a href={`https://t.me/${bot.botUsername}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-500/40 transition-colors">
              {t("channels.openBot", lang)} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <ConnectedBadge
            label={t("channels.botConnected", lang)}
            onDisconnect={() => disconnectMut.mutate({ tenantId })}
            confirmMsg={t("channels.disconnectBotConfirm", lang)}
            disconnectLabel={t("channels.disconnectBot", lang)}
            isPending={disconnectMut.isPending}
          />
        </section>
        {/* 0082 — owner Telegram pairing.  Owner mints a deep-link
            that, on /start own_<token>, binds web_users.telegram_chat_id
            and inserts a tenant_roles row so the bot recognizes them
            as tenant_owner. Symmetric to the master pairing below. */}
        <SalonOwnerPairingCard tenantId={tenantId} />
        {/* 0072 — per-master Telegram pairing table.  Salon owner mints
            single-use deep-links for each master, or types a chat_id
            manually. Synthetic web-created masters need this to receive
            bot notifications + open master-mode in TG. */}
        <SalonMasterPairingTable tenantId={tenantId} />
      </div>
    );
  }

  // Connect form on top, "how to" guide collapsed at the bottom.
  return (
    <div className="space-y-4">
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-brand-500/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-brand-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("channels.botNotConnected", lang)}</h3>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setError(null); if (token.trim()) connectMut.mutate({ tenantId, token: token.trim() }); }} className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">{t("channels.botToken", lang)}</label>
            <input type="text" value={token} onChange={(e) => { setToken(e.target.value); setError(null); }}
              placeholder={t("channels.botTokenPlaceholder", lang)}
              className="w-full bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-4 py-3 text-sm outline-none focus:border-brand-500/60 text-slate-900 dark:text-white font-mono"
              required />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={connectMut.isPending || !token.trim()}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 active:bg-brand-500 text-white px-4 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg shadow-brand-500/20 disabled:opacity-70">
            {connectMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("channels.connecting", lang)}</> : <><Bot className="h-4 w-4" /> {t("channels.connectBot", lang)}</>}
          </button>
        </form>
      </section>
      <BotFatherGuide />
    </div>
  );
}

// ─── Instagram ───────────────────────────────────────────────────────────────

function InstagramTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const [error, setError] = useState<string | null>(null);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const channels = api.salon.getChannels.useQuery({ tenantId });
  const igChannel = channels.data?.find((c) => c.channelType === "instagram");

  const disconnectMut = api.salon.disconnectChannel.useMutation({
    onSuccess: () => void channels.refetch(),
    onError: (err) => setError(err.message),
  });
  const reactivateMut = api.salon.reactivateChannel.useMutation({
    onSuccess: () => void channels.refetch(),
    onError: (err) => setError(err.message),
  });

  if (channels.isLoading) return <div className="glass-card rounded-2xl p-5 h-32 animate-pulse" />;

  if (igChannel) {
    let cfg: Record<string, string> = {};
    try { cfg = igChannel.config ? JSON.parse(igChannel.config) : {}; } catch { /* */ }
    const isPaused = igChannel.active === 0;
    const channelTitle = cfg.ig_username
      ? `@${cfg.ig_username}`
      : cfg.page_id
      ? `Page ${cfg.page_id}`
      : "Instagram";

    return (
      <div className="space-y-4">
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-2xl flex items-center justify-center ${isPaused ? "bg-slate-500/15" : "bg-pink-500/15"}`}>
              <Instagram className={`h-5 w-5 ${isPaused ? "text-slate-400" : "text-pink-400"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">{channelTitle}</h3>
              <p className="text-[11px] text-slate-500">
                {isPaused ? t("channels.ig.paused", lang) : t("channels.igConnected", lang)}
              </p>
            </div>
            {isPaused && (
              <span className="shrink-0 text-[10px] font-medium rounded-full px-2 py-0.5 bg-slate-500/15 text-slate-400 uppercase">
                {t("channels.ig.paused", lang)}
              </span>
            )}
          </div>

          {/* Action grid — test send is only useful when the channel is live */}
          {!isPaused && (
            <button
              type="button"
              data-testid="ig-test-send-btn"
              onClick={() => setShowTestDialog(true)}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-pink-500/40 hover:bg-pink-500/5 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              {t("channels.ig.test.button", lang)}
            </button>
          )}

          <PauseRemoveActions
            tenantId={tenantId}
            isPaused={isPaused}
            isPending={disconnectMut.isPending || reactivateMut.isPending}
            onPause={() => disconnectMut.mutate({ tenantId, channelType: "instagram", mode: "soft" })}
            onResume={() => reactivateMut.mutate({ tenantId, channelType: "instagram" })}
            onRemove={() => disconnectMut.mutate({ tenantId, channelType: "instagram", mode: "hard" })}
          />

          {error && <p className="text-xs text-red-400">{error}</p>}
        </section>
        <IGHealthCard
          tenantId={tenantId}
          onRequestReauth={() => disconnectMut.mutate({ tenantId, channelType: "instagram", mode: "hard" })}
        />
        {showTestDialog && (
          <IGSendTestDialog tenantId={tenantId} onClose={() => setShowTestDialog(false)} />
        )}
      </div>
    );
  }

  // Not connected — OAuth-first surface with manual paste as escape hatch.
  return <InstagramConnect tenantId={tenantId} onConnected={() => { void channels.refetch(); }} />;
}

/**
 * Two-action footer for the connected IG card: Pause (soft, keeps token)
 * vs Remove (hard delete). Resume replaces Pause when channel is already
 * paused.
 */
function PauseRemoveActions({
  tenantId: _tenantId,
  isPaused, isPending, onPause, onResume, onRemove,
}: {
  tenantId: string;
  isPaused: boolean;
  isPending: boolean;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
}) {
  const { lang } = useLang();
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (confirmRemove) {
    return (
      <div className="rounded-xl border border-red-500/20 p-3 space-y-2">
        <p className="text-xs text-red-400">{t("channels.ig.removeConfirm", lang)}</p>
        <div className="flex gap-2">
          <button onClick={onRemove} disabled={isPending}
            data-testid="ig-confirm-remove-btn"
            className="flex-1 py-2 rounded-lg bg-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/25 transition-colors disabled:opacity-50">
            {t("channels.ig.removeAction", lang)}
          </button>
          <button onClick={() => setConfirmRemove(false)}
            className="flex-1 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors">
            {t("common.cancel", lang)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {isPaused ? (
        <button
          type="button"
          data-testid="ig-resume-btn"
          onClick={onResume}
          disabled={isPending}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
        >
          <Play className="h-3 w-3" /> {t("channels.ig.resumeAction", lang)}
        </button>
      ) : (
        <button
          type="button"
          data-testid="ig-pause-btn"
          onClick={onPause}
          disabled={isPending}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-amber-500/20 text-amber-400 text-xs font-medium hover:bg-amber-500/10 transition-colors disabled:opacity-50"
          title={t("channels.ig.pauseConfirm", lang)}
        >
          <Pause className="h-3 w-3" /> {t("channels.ig.pauseAction", lang)}
        </button>
      )}
      <button
        type="button"
        data-testid="ig-remove-btn"
        onClick={() => setConfirmRemove(true)}
        disabled={isPending}
        className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/10 transition-colors disabled:opacity-50"
      >
        <Trash2 className="h-3 w-3" /> {t("channels.ig.removeAction", lang)}
      </button>
    </div>
  );
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

function WhatsAppTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const channels = api.salon.getChannels.useQuery({ tenantId });
  const hints = api.salon.getMetaChannelHints.useQuery({ tenantId });
  const waChannel = channels.data?.find((c) => c.channelType === "whatsapp");
  // Activation derived purely from the existence of a WA channel row in D1 —
  // support flips this when Meta acknowledges the verify-token handshake.
  const activated = !!waChannel;

  const disconnectMut = api.salon.disconnectChannel.useMutation({
    onSuccess: () => { void channels.refetch(); void utils.salon.getChannels.invalidate({ tenantId }); },
    onError: (err) => setError(err.message),
  });

  if (channels.isLoading) return <div className="glass-card rounded-2xl p-5 h-32 animate-pulse" />;

  return (
    <div className="space-y-4">
      {/* Status pill (read-only, derived from getChannels) */}
      <div
        data-testid="wa-status-pill"
        className={`rounded-xl px-3 py-2.5 text-[11px] font-medium border flex items-start gap-2 ${
          activated
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            : "bg-amber-500/10 border-amber-500/20 text-amber-400"
        }`}
      >
        {activated
          ? <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
          : <MessageCircle className="h-3.5 w-3.5 shrink-0 mt-px" />}
        <span>{activated ? t("channels.waStatusActivated", lang) : t("channels.waStatusPending", lang)}</span>
      </div>

      {/* Webhook URL + Verify token (always at the top so it's the first thing
          the user sees when entering Meta Business Manager). */}
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
              {t("channels.metaContactSupport", lang)}
            </p>
          </>
        ) : (
          <p className="text-[11px] text-amber-400">{t("channels.webhookUnavailable", lang)}</p>
        )}
      </section>

      {waChannel && (
        <section className="glass-card rounded-2xl p-5 space-y-3">
          <ConnectedBadge
            label={t("channels.waConnected", lang)}
            onDisconnect={() => disconnectMut.mutate({ tenantId, channelType: "whatsapp" })}
            confirmMsg={t("channels.waDisconnectConfirm", lang)}
            disconnectLabel={t("channels.disconnectWa", lang)}
            isPending={disconnectMut.isPending}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </section>
      )}

      {/* "How to connect" guide always at the bottom, collapsed by default. */}
      <MetaGuide channel="whatsapp" />
    </div>
  );
}

// ─── Web Chat ────────────────────────────────────────────────────────────────

/**
 * WebChatTab — self-sufficient chat configuration surface.
 *
 * Before 0090 this tab was a read-only surface that pushed the owner to
 * the Public Profile tab to set a slug and toggle `publicActive`. Now
 * the tab carries an inline Setup card (slug + display name + logo +
 * chat on/off toggle) and the chat URL works whenever `chat_enabled = 1`
 * regardless of catalog visibility (see migration 0090 +
 * `publicSalon.getProfileForChat`).
 *
 * The Setup fields are NOT duplicated state — `slug`, `displayName`,
 * `logo`, `logoR2Key` are the same `tenants` columns the Public Profile
 * editor writes. Both tabs read from `salon.getSalonProfile` and write
 * through `salon.updateSalonProfile`.
 */
function WebChatTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const profile = api.salon.getSalonProfile.useQuery({ tenantId });
  const data = profile.data as
    | { slug?: string | null; displayName?: string | null; logo?: string | null; logoR2Key?: string | null; chatEnabled?: number }
    | undefined;

  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [slugError, setSlugError] = useState("");
  const [editingSlug, setEditingSlug] = useState(false);
  const [editingName, setEditingName] = useState(false);

  // Hydrate local form state from the server payload on first load /
  // refetch. We only overwrite the inputs when the user is NOT actively
  // editing them, so an in-flight save doesn't blow away typed text.
  useState(() => {
    // initialiser only — useEffect below handles updates
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffectOnDataChange(data, (next) => {
    if (!editingSlug) setSlug(next.slug ?? "");
    if (!editingName) setDisplayName(next.displayName ?? "");
  });

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      void utils.salon.getSalonProfile.invalidate({ tenantId });
    },
  });
  const slugCheck = api.salon.checkSlugAvailable.useQuery(
    { slug, tenantId },
    { enabled: editingSlug && slug.length > 0 && !slugError, staleTime: 5000 },
  );

  function validateSlug(v: string) {
    if (v && !/^[a-z0-9-]+$/.test(v)) {
      setSlugError(t("salon.publicProfile.slugError", lang));
      return false;
    }
    setSlugError("");
    return true;
  }

  function saveSlug() {
    if (!validateSlug(slug)) return;
    if (slugCheck.data?.available === false) return;
    update.mutate({ tenantId, slug: slug || undefined });
    setEditingSlug(false);
  }

  function saveDisplayName() {
    update.mutate({ tenantId, displayName: displayName.trim() || "" });
    setEditingName(false);
  }

  function toggleChat() {
    if (!data) return;
    const nextVal = (data.chatEnabled ?? 1) === 1 ? 0 : 1;
    update.mutate({ tenantId, chatEnabled: nextVal });
  }

  if (profile.isLoading) {
    return (
      <section className="glass-card rounded-2xl p-8 text-center">
        <Loader2 className="h-5 w-5 animate-spin text-brand-400 mx-auto" />
      </section>
    );
  }

  const chatEnabled = (data?.chatEnabled ?? 1) === 1;
  const slugSaved = data?.slug ?? null;
  const chatUrl = slugSaved ? `https://manicbot.com/salon/${slugSaved}/chat` : null;

  return (
    <div className="space-y-4">
      {/* Status pill at the top — chat on/off, NOT catalog publication. */}
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-2xl flex items-center justify-center ${chatEnabled ? "bg-emerald-500/15" : "bg-slate-500/15"}`}>
            <Sparkles className={`h-5 w-5 ${chatEnabled ? "text-emerald-400" : "text-slate-400"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("channels.webChat.title", lang)}</h3>
            <p className={`text-[11px] ${chatEnabled ? "text-emerald-400" : "text-slate-500"}`}>
              {chatEnabled ? t("channels.webChat.state.chatOn", lang) : t("channels.webChat.state.chatOff", lang)}
            </p>
          </div>
          {chatUrl && (
            <a href={chatUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
              {t("channels.open", lang)} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("channels.webChat.hint", lang)}</p>
      </section>

      {/* Inline Setup — slug + display name + logo + chat on/off. */}
      <section className="glass-card rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("channels.webChat.setup.title", lang)}</h3>

        {/* Slug */}
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("channels.webChat.setup.slugLabel", lang)}</label>
          <div className="flex items-center gap-2">
            <input
              value={slug}
              onChange={(e) => { const v = e.target.value.toLowerCase(); setSlug(v); validateSlug(v); }}
              onFocus={() => setEditingSlug(true)}
              onBlur={() => setEditingSlug(false)}
              placeholder="my-salon"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            {slug && !slugError && (
              <span className={`shrink-0 text-xs font-medium ${slugCheck.data?.available === false ? "text-red-400" : slugCheck.data?.available ? "text-emerald-400" : "text-slate-500"}`}>
                {slugCheck.isLoading ? "…" : slugCheck.data?.available === false ? `❌ ${t("salon.publicProfile.taken", lang)}` : slugCheck.data?.available ? "✅" : ""}
              </span>
            )}
            <Btn
              onClick={saveSlug}
              disabled={
                update.isPending ||
                !!slugError ||
                slug === (slugSaved ?? "") ||
                slugCheck.data?.available === false
              }
              className="px-3 py-2 text-xs"
            >
              {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("common.save", lang)}
            </Btn>
          </div>
          {slugError && <p className="text-xs text-red-400 mt-1">{slugError}</p>}
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">{t("channels.webChat.setup.slugHelp", lang)}</p>
        </div>

        {/* Display name */}
        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{t("channels.webChat.setup.displayNameLabel", lang)}</label>
          <div className="flex items-center gap-2">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onFocus={() => setEditingName(true)}
              onBlur={() => setEditingName(false)}
              placeholder={t("channels.webChat.setup.displayNameLabel", lang)}
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-400"
              maxLength={120}
            />
            <Btn
              onClick={saveDisplayName}
              disabled={update.isPending || displayName === (data?.displayName ?? "")}
              className="px-3 py-2 text-xs"
            >
              {update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("common.save", lang)}
            </Btn>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">{t("channels.webChat.setup.displayNameHelp", lang)}</p>
        </div>

        {/* Logo */}
        <AssetUploadField
          label={t("channels.webChat.setup.logoLabel", lang)}
          hint={t("channels.webChat.setup.logoHelp", lang)}
          tenantId={tenantId}
          kind="logo"
          value={data?.logo ?? ""}
          onChange={(v) => {
            update.mutate({
              tenantId,
              logo: v.url || "",
              logoR2Key: v.key || "",
            });
          }}
        />

        {/* Chat on/off — pill toggle, brand-styled */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200/50 dark:border-slate-700/40">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-900 dark:text-white">{t("channels.webChat.setup.chatOnLabel", lang)}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t("channels.webChat.setup.chatOnHelp", lang)}</p>
          </div>
          <button
            type="button"
            onClick={toggleChat}
            disabled={update.isPending}
            aria-pressed={chatEnabled}
            aria-label={chatEnabled ? t("channels.webChat.state.chatOn", lang) : t("channels.webChat.state.chatOff", lang)}
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${chatEnabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"} disabled:opacity-50`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${chatEnabled ? "translate-x-5" : ""}`}
            />
          </button>
        </div>
      </section>

      {/* Chat URL — visible whenever a slug is set, regardless of chat on/off. */}
      {chatUrl && (
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <div>
            <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mb-1">{t("channels.webChat.chatUrl", lang)}</p>
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/40 rounded-xl px-3 py-2">
              <code className="flex-1 text-[11px] text-slate-700 dark:text-slate-300 truncate">{chatUrl}</code>
              <CopyBtn value={chatUrl} />
            </div>
            {!chatEnabled && (
              <p className="mt-2 text-[11px] text-amber-500">
                <Power className="inline h-3 w-3 mr-1" />
                {t("channels.webChat.state.urlHiddenHint", lang)}
              </p>
            )}
          </div>
        </section>
      )}

      {/* QR Code — same gate as URL. */}
      {chatUrl && (
        <section className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("channels.qrCode", lang)}</h3>
          </div>
          <p className="text-[11px] text-slate-500">{t("channels.webChat.qrHint", lang)}</p>
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-4 rounded-2xl" data-qr-wrapper="web-chat">
              <QRCodeSVG value={chatUrl} size={200} level="M" />
            </div>
            <button
              type="button"
              onClick={() => {
                const wrapper = document.querySelector('[data-qr-wrapper="web-chat"]');
                const svg = wrapper?.querySelector("svg") as SVGSVGElement | null;
                downloadQrPng(svg, `qr-chat-${slugSaved}.png`);
              }}
              className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors font-medium"
            >
              <Download className="h-3.5 w-3.5" />
              {t("channels.downloadPng", lang)}
            </button>
          </div>
        </section>
      )}

      {/* Live preview — gates on chatEnabled (NOT publicActive). 0090. */}
      {chatUrl && (
        <section className="glass-card rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("channels.webChat.preview", lang)}</h3>
          </div>
          <p className="text-[11px] text-slate-500">{t("channels.webChat.previewHint", lang)}</p>
          {chatEnabled ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-900/50">
              <iframe
                data-testid="web-chat-preview"
                src={chatUrl}
                title={t("channels.webChat.preview", lang)}
                loading="lazy"
                className="w-full h-[480px] sm:h-[560px] border-0"
              />
            </div>
          ) : (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-3 text-[11px] text-amber-400">
              {t("channels.webChat.state.previewPausedHint", lang)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Tiny helper to mirror the "hydrate form state from server" pattern
 * used in PublicProfileEditor without re-implementing the same
 * `useEffect` dance every time. The callback fires whenever the data
 * reference changes (including `undefined → object` on first load).
 */
function useEffectOnDataChange<T>(data: T | undefined, cb: (next: T) => void) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const ref = useRef<T | undefined>(undefined);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (data === undefined) return;
    if (ref.current === data) return;
    ref.current = data;
    cb(data);
  }, [data, cb]);
}

// ─── Main Component ──────────────────────────────────────────────────────────

type ChannelTab = "telegram" | "instagram" | "whatsapp" | "web";

function buildChannelTabs(lang: Lang): { key: ChannelTab; label: string; icon: React.ElementType }[] {
  return [
    { key: "telegram", label: "Telegram", icon: Bot },
    { key: "instagram", label: "Instagram", icon: Instagram },
    { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
    { key: "web", label: t("channels.tabWeb", lang), icon: Globe },
  ];
}

export function SalonChannelsTab({
  tenantId,
}: {
  tenantId: string;
}) {
  const { lang } = useLang();
  const [active, setActive] = useState<ChannelTab>("telegram");
  const TABS = buildChannelTabs(lang);

  return (
    <div className="space-y-5">
      <SectionHeader title={t("salon.tabs.channels", lang)} />

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
      {active === "web" && <WebChatTab tenantId={tenantId} />}
    </div>
  );
}
