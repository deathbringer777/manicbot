"use client";

import { useState, useMemo, useEffect, useRef, type FormEvent } from "react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";

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
  const [masterId, setMasterId] = useState<number | null>(defaultMasterId ?? null);
  const [serviceId, setServiceId] = useState<string>("");
  const [date, setDate] = useState<string>(defaultDate ?? "");
  const [time, setTime] = useState<string>(defaultTime ?? "");
  const [clientChatId, setClientChatId] = useState<string>("");
  const [clientName, setClientName] = useState<string>("");
  const [clientPhone, setClientPhone] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const masters = api.salon.getMasters.useQuery({ tenantId });
  const services = api.salon.getServices.useQuery({ tenantId });
  const clients = api.salon.getClients.useQuery({ tenantId });

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
  const newClientValid =
    useExistingClient || (clientName.trim().length > 0 && clientPhone.trim().length >= 6);
  const formValid =
    masterId !== null && serviceId !== "" && date !== "" && time !== "" && newClientValid;
  const submitDisabled = !formValid || create.isPending;

  const hasMasters = !masters.isLoading && (masters.data?.length ?? 0) > 0;
  const hasServices = !services.isLoading && (services.data?.length ?? 0) > 0;
  const mastersEmpty = !masters.isLoading && (masters.data?.length ?? 0) === 0;
  const servicesEmpty = !services.isLoading && (services.data?.length ?? 0) === 0;

  const hasStartedFilling =
    useExistingClient ||
    clientName.length > 0 ||
    clientPhone.length > 0 ||
    masterId !== null ||
    serviceId !== "" ||
    date !== "" ||
    time !== "" ||
    note.length > 0;

  const issues: string[] = [];
  if (masterId === null && hasMasters) issues.push(t("appointments.manual.issues.master", lang));
  if (serviceId === "" && hasServices) issues.push(t("appointments.manual.issues.service", lang));
  if (date === "") issues.push(t("appointments.manual.issues.date", lang));
  if (time === "") issues.push(t("appointments.manual.issues.time", lang));
  if (!useExistingClient) {
    if (clientName.trim().length === 0) issues.push(t("appointments.manual.issues.clientName", lang));
    if (clientPhone.trim().length < 6) issues.push(t("appointments.manual.issues.clientPhone", lang));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (submitDisabled) return;
    create.mutate({
      tenantId,
      masterId: masterId!,
      serviceId,
      date,
      time,
      clientChatId: useExistingClient ? Number(clientChatId) : undefined,
      clientName: useExistingClient ? undefined : clientName.trim(),
      clientPhone: useExistingClient ? undefined : clientPhone.trim(),
      note: note.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900/95"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh" }}
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
            <select
              className={FIELD_BASE}
              value={clientChatId}
              onChange={(e) => setClientChatId(e.target.value)}
            >
              <option value="">{t("appointments.manual.newClient", lang)}</option>
              {clientOptions.map((c) => (
                <option key={c.chatId} value={c.chatId}>
                  {c.name || t("appointments.manual.noName", lang)} {c.phone ? `· ${c.phone}` : ""}
                </option>
              ))}
            </select>
          </div>

          {!clientChatId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                placeholder={t("appointments.manual.clientNamePh", lang)}
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className={FIELD_BASE}
              />
              <input
                type="tel"
                placeholder="+48 ..."
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className={FIELD_BASE}
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("appointments.manual.master", lang)}</label>
              <select
                className={FIELD_BASE}
                value={masterId ?? ""}
                onChange={(e) => setMasterId(Number(e.target.value) || null)}
                disabled={defaultMasterId != null || mastersEmpty}
              >
                <option value="">{t("appointments.manual.pickPlaceholder", lang)}</option>
                {(masters.data ?? []).map((m) => (
                  <option key={m.chatId} value={m.chatId}>
                    {m.name || `#${m.chatId}`}
                  </option>
                ))}
              </select>
              {mastersEmpty && (
                <p
                  data-testid="manual-booking-need-masters"
                  className="mt-1 text-[11px] text-amber-600 dark:text-amber-400"
                >
                  {t("appointments.manual.needMasters", lang)}
                </p>
              )}
            </div>
            <div>
              <label className={LABEL}>{t("appointments.manual.service", lang)}</label>
              <select
                className={FIELD_BASE}
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                disabled={servicesEmpty}
              >
                <option value="">{t("appointments.manual.pickPlaceholder", lang)}</option>
                {(services.data ?? []).map((s) => {
                  const label = typeof s.names === "string"
                    ? (() => { try { const j = JSON.parse(s.names as string); return j.ru || j.en || s.svcId; } catch { return s.svcId; } })()
                    : s.svcId;
                  return (
                    <option key={s.svcId} value={s.svcId}>
                      {label} · {s.duration} min · {s.price}
                    </option>
                  );
                })}
              </select>
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

          {hasStartedFilling && submitDisabled && !create.isPending && issues.length > 0 && (
            <div
              data-testid="manual-booking-issues"
              className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
            >
              <p className="mb-0.5 font-semibold">{t("appointments.manual.fixToContinue", lang)}</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {issues.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            </div>
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

// ─── Date popover ──────────────────────────────────────────────────────────────

function DatePopover({ value, onChange, lang }: { value: string; onChange: (v: string) => void; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const initial = parseISODate(value) ?? today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={wrapperRef} className="relative">
      <button
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
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-slate-900">
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
      )}
    </div>
  );
}

// ─── Time popover ──────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function TimePopover({ value, onChange, lang }: { value: string; onChange: (v: string) => void; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hourCol = useRef<HTMLDivElement>(null);
  const minCol = useRef<HTMLDivElement>(null);

  const [hh, mm] = value && /^\d{2}:\d{2}$/.test(value) ? value.split(":").map(Number) : [null, null];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={wrapperRef} className="relative">
      <button
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
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-slate-900">
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
      )}
    </div>
  );
}
