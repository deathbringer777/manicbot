"use client";

/**
 * ClientFormModal — create or edit a single client.
 *
 * 4-channel contact (phone / email / Telegram / Instagram), name required
 * + at-least-one-contact, tags (free-text CSV), notes, DOB. Submits via
 * `api.clients.create` or `api.clients.update` — the router handles the
 * marketing-directory sync transparently.
 */

import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

const FIELD_BASE =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 [color-scheme:light] dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400 dark:placeholder:text-white/30 dark:[color-scheme:dark]";

const LABEL =
  "mb-1 block text-xs font-medium text-slate-600 dark:text-white/70";

export interface InitialClient {
  chatId: number;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  tgUsername?: string | null;
  igUsername?: string | null;
  tags?: string | null;
  notes?: string | null;
  dob?: string | null;
}

interface Props {
  tenantId: string;
  initial?: InitialClient | null;       // null/undef → create mode
  onClose: () => void;
  onSaved: (chatId: number) => void;
}

export function ClientFormModal({ tenantId, initial, onClose, onSaved }: Props) {
  const { lang } = useLang();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [tg, setTg] = useState(initial?.tgUsername ?? "");
  const [ig, setIg] = useState(initial?.igUsername ?? "");
  const [tags, setTags] = useState(initial?.tags ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [dob, setDob] = useState(initial?.dob ?? "");
  const [err, setErr] = useState<string | null>(null);

  const utils = api.useUtils();

  const create = api.clients.create.useMutation({
    onSuccess: (r) => {
      void utils.clients.list.invalidate({ tenantId });
      onSaved(r.chatId);
      onClose();
    },
    onError: (e) => setErr(e.message || t("appointments.manual.somethingWrong", lang)),
  });

  const update = api.clients.update.useMutation({
    onSuccess: () => {
      void utils.clients.list.invalidate({ tenantId });
      void utils.clients.get.invalidate({ tenantId, chatId: initial!.chatId });
      onSaved(initial!.chatId);
      onClose();
    },
    onError: (e) => setErr(e.message || t("appointments.manual.somethingWrong", lang)),
  });

  const hasContact = !!(phone.trim() || email.trim() || tg.trim() || ig.trim());
  const valid = name.trim().length > 0 && hasContact;
  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!valid) {
      setErr(t("clients.form.contactRequired", lang));
      return;
    }
    if (isEdit) {
      update.mutate({
        tenantId,
        chatId: initial!.chatId,
        patch: {
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          tgUsername: tg.trim() || null,
          igUsername: ig.trim() || null,
          tags: tags.trim() || null,
          notes: notes.trim() || null,
          dob: dob.trim() || null,
        },
      });
    } else {
      create.mutate({
        tenantId,
        name: name.trim(),
        contacts: {
          phone: phone.trim() || null,
          email: email.trim() || null,
          tgUsername: tg.trim() || null,
          igUsername: ig.trim() || null,
        },
        tags: tags.trim() || null,
        notes: notes.trim() || null,
        dob: dob.trim() || null,
      });
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-slate-900/95"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh" }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isEdit ? t("clients.form.title.edit", lang) : t("clients.form.title.create", lang)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 text-sm">
          <div>
            <label className={LABEL}>{t("clients.form.name", lang)} *</label>
            <input
              type="text"
              autoFocus
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={FIELD_BASE}
              data-testid="cf-name"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("clients.form.phone", lang)}</label>
              <input
                type="tel"
                placeholder="+48 …"
                maxLength={64}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={FIELD_BASE}
                data-testid="cf-phone"
              />
            </div>
            <div>
              <label className={LABEL}>{t("clients.form.email", lang)}</label>
              <input
                type="email"
                placeholder="email@example.com"
                maxLength={256}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={FIELD_BASE}
                data-testid="cf-email"
              />
            </div>
            <div>
              <label className={LABEL}>{t("clients.form.telegram", lang)}</label>
              <input
                type="text"
                placeholder="@nickname"
                maxLength={64}
                value={tg}
                onChange={(e) => setTg(e.target.value)}
                className={FIELD_BASE}
                data-testid="cf-tg"
              />
            </div>
            <div>
              <label className={LABEL}>{t("clients.form.instagram", lang)}</label>
              <input
                type="text"
                placeholder="@handle"
                maxLength={64}
                value={ig}
                onChange={(e) => setIg(e.target.value)}
                className={FIELD_BASE}
                data-testid="cf-ig"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL}>{t("clients.form.dob", lang)}</label>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className={FIELD_BASE}
              />
            </div>
            <div>
              <label className={LABEL}>{t("clients.form.tags", lang)}</label>
              <input
                type="text"
                placeholder="vip, returning"
                maxLength={500}
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className={FIELD_BASE}
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>{t("clients.form.notes", lang)}</label>
            <textarea
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
              disabled={!valid || pending}
              data-testid="cf-submit"
              className={
                !valid || pending
                  ? "flex-1 cursor-not-allowed rounded-lg bg-slate-200 py-2.5 text-sm font-semibold text-slate-400 dark:bg-slate-700 dark:text-slate-500"
                  : "flex-1 rounded-lg py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] transition hover:opacity-90"
              }
              style={!valid || pending ? undefined : { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
            >
              {pending
                ? t("clients.form.saving", lang)
                : isEdit
                  ? t("clients.action.edit", lang)
                  : t("clients.action.add", lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
