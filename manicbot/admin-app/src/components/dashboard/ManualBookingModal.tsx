"use client";

import { useState, useMemo, type FormEvent } from "react";
import { api } from "~/trpc/react";

interface Props {
  tenantId: string;
  defaultMasterId?: number | null;
  onClose: () => void;
  onCreated?: (appointmentId: string) => void;
}

/**
 * Manual booking modal used on dashboard Overview / Appointments / Clients tabs.
 * Owner role: can pick any master. Master role: locked to their own chat_id.
 *
 * Wires to appointments.createManual tRPC procedure — slot-conflict surfaces
 * as a TRPC CONFLICT error with cause.withAppointmentId.
 */
export function ManualBookingModal({ tenantId, defaultMasterId, onClose, onCreated }: Props) {
  const [masterId, setMasterId] = useState<number | null>(defaultMasterId ?? null);
  const [serviceId, setServiceId] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
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
      if (e.message === "slot_conflict") setErr("Это время уже занято у выбранного мастера.");
      else setErr(e.message || "Что-то пошло не так");
    },
  });

  const clientOptions = useMemo(() => {
    const list = Array.isArray(clients.data) ? clients.data : [];
    return list.slice(0, 100);
  }, [clients.data]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!masterId || !serviceId || !date || !time) {
      setErr("Заполните мастера, услугу, дату и время.");
      return;
    }
    const useExisting = clientChatId && clientChatId !== "";
    if (!useExisting && (!clientName.trim() || clientPhone.trim().length < 6)) {
      setErr("Выберите клиента или укажите имя и телефон нового.");
      return;
    }
    create.mutate({
      tenantId,
      masterId,
      serviceId,
      date,
      time,
      clientChatId: useExisting ? Number(clientChatId) : undefined,
      clientName: useExisting ? undefined : clientName.trim(),
      clientPhone: useExisting ? undefined : clientPhone.trim(),
      note: note.trim() || undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/95 p-5 sm:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh" }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Новая запись</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/5 p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-white/70">Клиент</label>
            <select
              className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none focus:border-violet-400"
              value={clientChatId}
              onChange={(e) => setClientChatId(e.target.value)}
            >
              <option value="">— новый клиент —</option>
              {clientOptions.map((c) => (
                <option key={c.chatId} value={c.chatId}>
                  {c.name || "(без имени)"} {c.phone ? `· ${c.phone}` : ""}
                </option>
              ))}
            </select>
          </div>

          {!clientChatId && (
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="text"
                placeholder="Имя клиента"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none placeholder:text-white/30 focus:border-violet-400"
              />
              <input
                type="tel"
                placeholder="+48 ..."
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none placeholder:text-white/30 focus:border-violet-400"
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Мастер</label>
              <select
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none focus:border-violet-400"
                value={masterId ?? ""}
                onChange={(e) => setMasterId(Number(e.target.value) || null)}
                disabled={defaultMasterId != null}
              >
                <option value="">— выбрать —</option>
                {(masters.data ?? []).map((m) => (
                  <option key={m.chatId} value={m.chatId}>
                    {m.name || `#${m.chatId}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Услуга</label>
              <select
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none focus:border-violet-400"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                <option value="">— выбрать —</option>
                {(services.data ?? []).map((s) => {
                  const label = typeof s.names === "string"
                    ? (() => { try { const j = JSON.parse(s.names as string); return j.ru || j.en || s.svcId; } catch { return s.svcId; } })()
                    : s.svcId;
                  return (
                    <option key={s.svcId} value={s.svcId}>
                      {label} · {s.duration}мин · {s.price}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Дата</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none focus:border-violet-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Время</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none focus:border-violet-400"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-white/70">Комментарий (необяз.)</label>
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white outline-none placeholder:text-white/30 focus:border-violet-400"
            />
          </div>

          {err && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300">
              {err}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/[0.08]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] transition hover:opacity-90 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
            >
              {create.isPending ? "Сохраняем…" : "Создать запись"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
