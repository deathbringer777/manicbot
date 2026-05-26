"use client";

import { useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";

// 0074: sentinel value for the "Random master" option in the Select.
// Keeping it as a stable string lets the existing controlled-Select
// signature (string in / string out) stay untouched.
const RANDOM_MASTER_VALUE = "random";
// 2026-05-26: sentinel for the "no master / unassigned" option. Owners
// can book a slot without a master (empty roster, assign later). The
// router accepts `masterId: undefined` and DayView surfaces the row in
// its synthetic Unassigned column.
const UNASSIGNED_MASTER_VALUE = "unassigned";

interface Props {
  tenantId: string;
  defaultMasterId?: number | null;
  /** Calendar overhaul (2026-05-16): drag-to-create on the grid pre-fills
   *  the date/time so the user lands in the dialog with the slot already
   *  picked. Optional — falls back to "" (no prefill) when not provided. */
  defaultDate?: string;
  defaultTime?: string;
  onClose: () => void;
  onCreated?: (appointmentId: string) => void;
}

const FIELD_BASE =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";

const LABEL =
  "mb-1 block text-xs font-medium text-slate-600 dark:text-white/70";

const localeMap: Record<Lang, string> = { ru: "ru-RU", ua: "uk-UA", en: "en-GB", pl: "pl-PL" };

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseISODate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y!, (m! - 1), d!);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatDateForUser(s: string, lang: Lang): string {
  const dt = parseISODate(s);
  if (!dt) return "";
  return new Intl.DateTimeFormat(localeMap[lang], { day: "2-digit", month: "2-digit", year: "numeric" }).format(dt);
}

/**
 * Manual booking modal used on dashboard Overview / Appointments / Clients tabs.
 * Owner role: can pick any master. Master role: locked to their own chat_id.
 */
export function ManualBookingModal({ tenantId, defaultMasterId, defaultDate, defaultTime, onClose, onCreated }: Props) {
  const { lang } = useLang();
  // 0074 — `masterSelectValue` is the raw Select value ("", "random", or
  // a chat-id string). `resolvedMasterId` is the parsed numeric chat id
  // when the value is numeric, NULL otherwise. We keep both because the
  // Random sentinel doesn't fit in `number | null` and we don't want to
  // poison the existing master-id arithmetic with a NaN.
  const [masterSelectValue, setMasterSelectValue] = useState<string>(
    defaultMasterId != null ? String(defaultMasterId) : "",
  );
  const resolvedMasterId = useMemo(() => {
    if (
      !masterSelectValue ||
      masterSelectValue === RANDOM_MASTER_VALUE ||
      masterSelectValue === UNASSIGNED_MASTER_VALUE
    ) return null;
    const n = Number(masterSelectValue);
    return Number.isFinite(n) ? n : null;
  }, [masterSelectValue]);
  const isRandomMaster = masterSelectValue === RANDOM_MASTER_VALUE;
  const isUnassignedMaster = masterSelectValue === UNASSIGNED_MASTER_VALUE;
  const [serviceId, setServiceId] = useState<string>("");
  const [date, setDate] = useState<string>(defaultDate ?? "");
  const [time, setTime] = useState<string>(defaultTime ?? "");
  const [clientChatId, setClientChatId] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [clientPhone, setClientPhone] = useState<string>("");
  // 0062: new-client branch supports any contact channel. Phone is no
  // longer required — name + at-least-one-contact is enough.
  const [clientEmail, setClientEmail] = useState<string>("");
  const [clientTg, setClientTg] = useState<string>("");
  const [clientIg, setClientIg] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const masters = api.salon.getMasters.useQuery({ tenantId });
  const services = api.salon.getServices.useQuery({ tenantId });
  const clients = api.salon.getClients.useQuery({ tenantId });

  // 0074 — favorite-master auto-suggest. Two queries:
  //   1) `favoriteSettings` — per-tenant toggle. We respect the `web`
  //      channel because this modal IS the web surface.
  //   2) `favoriteSuggestion` — manual pin + history-derived favorite
  //      for the currently-selected (existing) client. Skipped while
  //      the form is in "new client" mode because there's no chat id
  //      to look up.
  const favoriteSettings = api.salon.getAutoSuggestFavoriteSettings.useQuery({ tenantId });
  const selectedClientChatIdNum = clientChatId ? Number(clientChatId) : null;
  const favoriteSuggestion = api.clients.getFavoriteMasterSuggestion.useQuery(
    { tenantId, chatId: selectedClientChatIdNum ?? 0 },
    { enabled: selectedClientChatIdNum !== null },
  );

  // Track whether we've auto-applied a favorite for the current client.
  // Resets every time the client changes so the next pick re-fires.
  // Never overrides an explicit user choice — once they touch the
  // master Select the flag stays true and we stop reacting.
  const [favoriteAutoApplied, setFavoriteAutoApplied] = useState(false);

  const favoriteMasterId = useMemo(() => {
    const s = favoriteSuggestion.data;
    if (!s) return null;
    return s.manual?.masterId ?? s.derived?.masterId ?? null;
  }, [favoriteSuggestion.data]);

  // Reset the auto-apply guard on every client change.
  useEffect(() => {
    setFavoriteAutoApplied(false);
  }, [clientChatId]);

  // Apply the favorite when:
  //  - a client is selected (existing chat id)
  //  - the toggle is ON for the web channel
  //  - the suggestion query has returned a favorite
  //  - the user has NOT already touched the master Select for this client
  //  - the modal isn't locked to a default master (drag-to-create on a
  //    master column already pre-fills the master — don't fight it)
  useEffect(() => {
    if (favoriteAutoApplied) return;
    if (defaultMasterId != null) return;
    if (selectedClientChatIdNum === null) return;
    if (!favoriteSettings.data?.web) return;
    if (favoriteMasterId == null) return;
    setMasterSelectValue(String(favoriteMasterId));
    setFavoriteAutoApplied(true);
  }, [favoriteAutoApplied, defaultMasterId, selectedClientChatIdNum, favoriteSettings.data?.web, favoriteMasterId]);

  const create = api.appointments.createManual.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        onCreated?.(res.appointmentId);
        onClose();
      }
    },
    onError: (e) => {
      if (e.message === "slot_conflict") setErr(t("appointments.manual.slotConflict", lang));
      else setErr(e.message || t("appointments.manual.somethingWrong", lang));
    },
  });

  const clientOptions = useMemo(() => {
    const list = Array.isArray(clients.data) ? clients.data : [];
    return list.slice(0, 100);
  }, [clients.data]);

  const useExistingClient = clientChatId !== "";
  // 0062: name + at-least-one-contact. Phone is no longer mandatory —
  // the salon now accepts walk-ins reachable only via Telegram, Instagram
  // or email.
  const hasContact =
    clientPhone.trim().length >= 6 ||
    clientEmail.trim().length > 0 ||
    clientTg.trim().length > 0 ||
    clientIg.trim().length > 0;
  const newClientValid =
    useExistingClient || (clientName.trim().length > 0 && hasContact);
  // 0074 — Random satisfies the master requirement (resolved on submit).
  // 2026-05-26 — Unassigned also satisfies (the booking is created with
  // `master_id = NULL`).
  const masterChosen = resolvedMasterId !== null || isRandomMaster || isUnassignedMaster;
  const formValid =
    masterChosen && serviceId !== "" && date !== "" && time !== "" && newClientValid;
  const submitDisabled = !formValid || create.isPending;

  // mastersEmpty / servicesEmpty drive the inline "you need to add a
  // master/service first" empty-state hints rendered under each dropdown
  // (separate UX from the bottom-of-form `manual-booking-issues` list
  // which was removed 2026-05-16 per user feedback — the disabled submit
  // button is signal enough that something is missing).
  // mastersEmpty no longer disables the Select — the "no master" option
  // is always available so an empty-roster salon can still book.
  const mastersEmpty = !masters.isLoading && (masters.data?.length ?? 0) === 0;
  const servicesEmpty = !services.isLoading && (services.data?.length ?? 0) === 0;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (submitDisabled) return;
    // 0074 — Random master resolution. Pick one client-side from the
    // active, non-vacation roster. Server still does its own conflict
    // check, so a race won't double-book; in the worst case the random
    // master we picked is busy and the user sees the same
    // `slot_conflict` they'd see for any other manual pick.
    let finalMasterId = resolvedMasterId;
    if (isRandomMaster) {
      const candidates = (masters.data ?? []).filter(
        (m) => m.active !== 0 && m.onVacation !== 1 && !m.archivedAt,
      );
      if (candidates.length === 0) {
        setErr(t("appointments.manual.noRandomCandidate", lang));
        return;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
      finalMasterId = pick.chatId;
    }
    // Unassigned booking → omit masterId entirely (router accepts undefined).
    // Random + explicit picks land here with a resolved numeric id.
    if (finalMasterId == null && !isUnassignedMaster) return;
    create.mutate({
      tenantId,
      ...(finalMasterId != null ? { masterId: finalMasterId } : {}),
      serviceId,
      date,
      time,
      clientChatId: useExistingClient ? Number(clientChatId) : undefined,
      clientName: useExistingClient ? undefined : clientName.trim(),
      clientPhone: useExistingClient ? undefined : (clientPhone.trim() || undefined),
      clientEmail: useExistingClient ? undefined : (clientEmail.trim() || undefined),
      clientTgUsername: useExistingClient ? undefined : (clientTg.trim() || undefined),
      clientIgUsername: useExistingClient ? undefined : (clientIg.trim() || undefined),
      note: note.trim() || undefined,
    });
  }

  return (
    <div
      // z-[100] guarantees the modal sits above Shell's sticky header
      // (z-30 desktop, z-40 mobile) and bottom nav (z-50). The dimmer
      // uses slate-950/70 + backdrop-blur-md so the page reads as a
      // single muted background rather than the older "muddy" look from
      // the bg-black/50 overlay leaking through `glass-card` translucency.
      // Mobile bottom-sheet on small viewports; centered card on tablet+.
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        // Solid surface — no `glass-card` here. The globals.css `glass-card`
        // utility uses rgba(248,250,252,0.85) which fights with bg-white
        // and renders the dialog as a translucent grey panel. Modals must
        // read as opaque tiles, not floating glass.
        className="w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {t("appointments.manual.title", lang)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 text-sm">
          <div>
            <label className={LABEL}>{t("appointments.manual.client", lang)}</label>
            <Select
              testIdPrefix="mb-client"
              value={clientChatId}
              onChange={setClientChatId}
              options={[
                { value: "", label: t("appointments.manual.newClient", lang) },
                ...clientOptions.map((c) => ({
                  value: String(c.chatId),
                  label: c.name || t("appointments.manual.noName", lang),
                  sublabel: c.phone || undefined,
                })),
              ]}
            />
          </div>

          {!clientChatId && (
            <div className="space-y-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder={t("appointments.manual.clientNamePh", lang)}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className={FIELD_BASE}
                  data-testid="mb-client-name"
                />
                <input
                  type="tel"
                  placeholder="+48 ..."
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className={FIELD_BASE}
                  data-testid="mb-client-phone"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  type="email"
                  placeholder={t("appointments.manual.emailPh", lang)}
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className={FIELD_BASE}
                  data-testid="mb-client-email"
                />
                <input
                  type="text"
                  placeholder={t("appointments.manual.tgPh", lang)}
                  value={clientTg}
                  onChange={(e) => setClientTg(e.target.value)}
                  className={FIELD_BASE}
                  data-testid="mb-client-tg"
                />
                <input
                  type="text"
                  placeholder={t("appointments.manual.igPh", lang)}
                  value={clientIg}
                  onChange={(e) => setClientIg(e.target.value)}
                  className={FIELD_BASE}
                  data-testid="mb-client-ig"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-white/50">
                {t("appointments.manual.contactAny", lang)}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("appointments.manual.master", lang)}</label>
              <Select
                testIdPrefix="mb-master"
                value={masterSelectValue}
                onChange={(v) => {
                  // Any manual change locks out the favorite auto-apply
                  // for the rest of this session — the user has made a
                  // deliberate choice and we shouldn't fight it.
                  setFavoriteAutoApplied(true);
                  setMasterSelectValue(v);
                }}
                disabled={defaultMasterId != null}
                placeholder={t("appointments.manual.pickPlaceholder", lang)}
                options={[
                  // 2026-05-26 — Unassigned option at the very top so the
                  // empty-roster case is always recoverable. Hidden when
                  // the modal is locked to a specific master (drag-to-
                  // create on a master column already binds the row).
                  ...(defaultMasterId == null
                    ? [{
                        value: UNASSIGNED_MASTER_VALUE,
                        label: t("appointments.manual.masterUnassigned", lang),
                      }]
                    : []),
                  // 0074 — Random option below Unassigned. Hidden when
                  // there's only one master (nothing to randomize) or
                  // when the modal is locked to a specific master.
                  ...(defaultMasterId == null && (masters.data?.length ?? 0) > 1
                    ? [{
                        value: RANDOM_MASTER_VALUE,
                        label: t("appointments.manual.masterRandom", lang),
                      }]
                    : []),
                  ...(masters.data ?? []).map((m) => ({
                    value: String(m.chatId),
                    label: m.name || `#${m.chatId}`,
                    // 0074 — mark the favorite (manual pin OR derived
                    // from history) with the "⭐ любимый" sublabel so
                    // the user knows why we pre-picked them.
                    sublabel: favoriteMasterId === m.chatId
                      ? t("appointments.manual.masterFavorite", lang)
                      : undefined,
                  })),
                ]}
              />
              {mastersEmpty && (
                <p
                  data-testid="manual-booking-need-masters"
                  className="mt-1 text-[11px] text-slate-500 dark:text-slate-400"
                >
                  {t("appointments.manual.needMasters", lang)}
                </p>
              )}
            </div>
            <div>
              <label className={LABEL}>{t("appointments.manual.service", lang)}</label>
              <Select
                testIdPrefix="mb-service"
                value={serviceId}
                onChange={setServiceId}
                disabled={servicesEmpty}
                placeholder={t("appointments.manual.pickPlaceholder", lang)}
                options={(services.data ?? []).map((s) => {
                  const label = typeof s.names === "string"
                    ? (() => { try { const j = JSON.parse(s.names as string); return j.ru || j.en || s.svcId; } catch { return s.svcId; } })()
                    : s.svcId;
                  return {
                    value: s.svcId,
                    label,
                    sublabel: `${s.duration} min · ${s.price}`,
                  };
                })}
              />
              {servicesEmpty && (
                <p
                  data-testid="manual-booking-need-services"
                  className="mt-1 text-[11px] text-amber-600 dark:text-amber-400"
                >
                  {t("appointments.manual.needServices", lang)}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("appointments.manual.date", lang)}</label>
              <DatePopover value={date} onChange={setDate} lang={lang} />
            </div>
            <div>
              <label className={LABEL}>{t("appointments.manual.time", lang)}</label>
              <TimePopover value={time} onChange={setTime} lang={lang} />
            </div>
          </div>

          <div>
            <label className={LABEL}>{t("appointments.manual.note", lang)}</label>
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${FIELD_BASE} resize-y`}
            />
          </div>

          {err && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300">
              {err}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-100 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:hover:bg-white/[0.08]"
            >
              {t("common.cancel", lang)}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className={
                submitDisabled
                  ? "flex-1 rounded-lg bg-slate-200 py-2.5 text-sm font-semibold text-slate-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500"
                  : "flex-1 rounded-lg py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] transition hover:opacity-90"
              }
              style={submitDisabled ? undefined : { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
            >
              {create.isPending ? t("appointments.manual.creating", lang) : t("appointments.manual.create", lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Portal popover helper ────────────────────────────────────────────────────
// 0074 — date/time popovers used to render inside the modal's
// `overflow-y-auto` box. Tall calendars got clipped at the bottom and
// the user had to scroll the modal itself to see them, which broke the
// outside-click contract once the trigger scrolled out of view. We now
// portal the panel into <body> and position it fixed relative to the
// trigger's bounding rect, with an auto-flip to "above the trigger"
// when there isn't enough room below.
type AnchorMetrics = {
  left: number;
  top: number;        // fixed-positioned `top` after flip resolution
  width: number;
  flipped: boolean;   // true when we rendered above instead of below
};

function useAnchorMetrics(
  triggerRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  panelHeightEstimate: number,
): AnchorMetrics | null {
  const [m, setM] = useState<AnchorMetrics | null>(null);
  const compute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const gap = 8;
    const vh = window.innerHeight;
    const wantsAbove = r.bottom + gap + panelHeightEstimate > vh
      && r.top - gap - panelHeightEstimate > 0;
    return {
      left: r.left,
      top: wantsAbove ? Math.max(8, r.top - gap - panelHeightEstimate) : r.bottom + gap,
      width: r.width,
      flipped: wantsAbove,
    };
  }, [triggerRef, panelHeightEstimate]);

  useLayoutEffect(() => {
    if (!open) { setM(null); return; }
    setM(compute());
    const onChange = () => setM(compute());
    window.addEventListener("scroll", onChange, true); // capture so inner-scroll containers trigger too
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [open, compute]);

  return m;
}

// ─── Date popover ──────────────────────────────────────────────────────────────

function DatePopover({ value, onChange, lang }: { value: string; onChange: (v: string) => void; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const initial = parseISODate(value) ?? today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  // Calendar height: 6 rows × 36px + month nav + weekday header + footer
  // + paddings ≈ 360px. Slight over-estimate so the flip-to-above
  // decision errs toward not getting cut off.
  const metrics = useAnchorMetrics(triggerRef, open, 380);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // Outside-click now has to consider TWO trees: the trigger
      // (`wrapperRef`) AND the portaled panel (`panelRef`).
      const insideTrigger = wrapperRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Sync view to value when value changes externally
  useEffect(() => {
    const dt = parseISODate(value);
    if (dt) {
      setViewYear(dt.getFullYear());
      setViewMonth(dt.getMonth());
    }
  }, [value]);

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(localeMap[lang], { month: "long", year: "numeric" })
      .format(new Date(viewYear, viewMonth, 1)),
    [viewYear, viewMonth, lang],
  );

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(localeMap[lang], { weekday: "short" });
    // Monday-first: 2024-01-01 was a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(2024, 0, 1 + i);
      return fmt.format(d).replace(".", "");
    });
  }, [lang]);

  const days = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startDow = (first.getDay() + 6) % 7; // 0 = Mon
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ date: Date; inMonth: boolean }> = [];
    // Leading days from previous month
    for (let i = startDow; i > 0; i--) {
      cells.push({ date: new Date(viewYear, viewMonth, 1 - i), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(viewYear, viewMonth, d), inMonth: true });
    }
    while (cells.length < 42) {
      const last = cells[cells.length - 1]!.date;
      const next = new Date(last);
      next.setDate(last.getDate() + 1);
      cells.push({ date: next, inMonth: next.getMonth() === viewMonth });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const selected = parseISODate(value);
  const display = value ? formatDateForUser(value, lang) : "";

  function pick(d: Date) {
    onChange(toISODate(d));
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y--; }
    else if (m > 11) { m = 0; y++; }
    setViewMonth(m);
    setViewYear(y);
  }

  const panel = open && metrics ? (
    <div
      ref={panelRef}
      // z-[110] beats both the modal backdrop (z-[100]) and any chrome
      // sitting at z-50 (Shell bottom nav). Width pinned to the trigger
      // so the popover lines up with the input it was opened from.
      style={{
        position: "fixed",
        top: metrics.top,
        left: metrics.left,
        width: metrics.width,
        zIndex: 110,
      }}
      className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-slate-900"
    >
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="Previous month"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="text-sm font-semibold capitalize text-slate-900 dark:text-slate-100">{monthLabel}</div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="Next month"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekdayLabels.map((w) => (
          <div key={w} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((cell, i) => {
          const dt = cell.date;
          const isPast = dt < today;
          const isToday = dt.getTime() === today.getTime();
          const isSel = selected && dt.getTime() === new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()).getTime();
          const base = "h-9 rounded-lg text-sm font-medium transition";
          let cls: string;
          if (isSel) {
            cls = `${base} text-white shadow-[0_4px_12px_-2px_rgba(124,58,237,0.45)]`;
          } else if (isPast) {
            cls = `${base} text-slate-300 cursor-not-allowed dark:text-white/20`;
          } else if (!cell.inMonth) {
            cls = `${base} text-slate-300 hover:bg-slate-100 dark:text-white/20 dark:hover:bg-white/5`;
          } else if (isToday) {
            cls = `${base} text-slate-900 ring-1 ring-brand-500 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10`;
          } else {
            cls = `${base} text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10`;
          }
          return (
            <button
              key={i}
              type="button"
              disabled={isPast}
              onClick={() => !isPast && pick(dt)}
              className={cls}
              style={isSel ? { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" } : undefined}
            >
              {dt.getDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 dark:border-white/10">
        <button
          type="button"
          onClick={() => { onChange(""); setOpen(false); }}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-white/60 dark:hover:text-white"
        >
          {t("appointments.manual.clear", lang)}
        </button>
        <button
          type="button"
          onClick={() => pick(today)}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-violet-400 dark:hover:text-violet-300"
        >
          {t("appointments.manual.today", lang)}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${FIELD_BASE} flex items-center justify-between text-left`}
      >
        <span className={display ? "" : "text-slate-400 dark:text-white/30"}>
          {display || t("appointments.manual.datePh", lang)}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60 shrink-0 ml-2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>
      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </div>
  );
}

// ─── Time popover ──────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function TimePopover({ value, onChange, lang }: { value: string; onChange: (v: string) => void; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hourCol = useRef<HTMLDivElement>(null);
  const minCol = useRef<HTMLDivElement>(null);

  const [hh, mm] = value && /^\d{2}:\d{2}$/.test(value) ? value.split(":").map(Number) : [null, null];

  // Two scroll columns (h-48 each) + footer + padding ≈ 240px.
  const metrics = useAnchorMetrics(triggerRef, open, 250);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const insideTrigger = wrapperRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-scroll selected entries into view when popover opens
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const h = hh ?? 12;
      const m = mm ?? 0;
      hourCol.current?.querySelector<HTMLElement>(`[data-h="${h}"]`)?.scrollIntoView({ block: "center" });
      minCol.current?.querySelector<HTMLElement>(`[data-m="${m}"]`)?.scrollIntoView({ block: "center" });
    });
  }, [open, hh, mm]);

  function setHour(h: number) {
    const m = mm ?? 0;
    onChange(`${pad2(h)}:${pad2(m)}`);
  }
  function setMinute(m: number) {
    const h = hh ?? 12;
    onChange(`${pad2(h)}:${pad2(m)}`);
  }

  function pickNow() {
    const d = new Date();
    const m = Math.round(d.getMinutes() / 5) * 5;
    let h = d.getHours();
    let nm = m;
    if (nm === 60) { nm = 0; h = (h + 1) % 24; }
    onChange(`${pad2(h)}:${pad2(nm)}`);
    setOpen(false);
  }

  const panel = open && metrics ? (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: metrics.top,
        left: metrics.left,
        width: metrics.width,
        zIndex: 110,
      }}
      className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-slate-900"
    >
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">
            {t("appointments.manual.time", lang).slice(0, 1).toUpperCase() || "H"}
          </div>
          <div ref={hourCol} className="max-h-48 overflow-y-auto scrollbar-none rounded-lg bg-slate-50 dark:bg-white/[0.03]">
            {HOURS.map((h) => {
              const sel = hh === h;
              return (
                <button
                  key={h}
                  type="button"
                  data-h={h}
                  onClick={() => setHour(h)}
                  className={
                    sel
                      ? "block w-full px-3 py-1.5 text-sm font-semibold text-white"
                      : "block w-full px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                  }
                  style={sel ? { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" } : undefined}
                >
                  {pad2(h)}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">M</div>
          <div ref={minCol} className="max-h-48 overflow-y-auto scrollbar-none rounded-lg bg-slate-50 dark:bg-white/[0.03]">
            {MINUTES.map((m) => {
              const sel = mm === m;
              return (
                <button
                  key={m}
                  type="button"
                  data-m={m}
                  onClick={() => setMinute(m)}
                  className={
                    sel
                      ? "block w-full px-3 py-1.5 text-sm font-semibold text-white"
                      : "block w-full px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                  }
                  style={sel ? { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" } : undefined}
                >
                  {pad2(m)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 dark:border-white/10">
        <button
          type="button"
          onClick={() => { onChange(""); setOpen(false); }}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-white/60 dark:hover:text-white"
        >
          {t("appointments.manual.clear", lang)}
        </button>
        <button
          type="button"
          onClick={pickNow}
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-violet-400 dark:hover:text-violet-300"
        >
          {t("appointments.manual.now", lang)}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${FIELD_BASE} flex items-center justify-between text-left`}
      >
        <span className={value ? "" : "text-slate-400 dark:text-white/30"}>
          {value || "--:--"}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60 shrink-0 ml-2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </div>
  );
}
