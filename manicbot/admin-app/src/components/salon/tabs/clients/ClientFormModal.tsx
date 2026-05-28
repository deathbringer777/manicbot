"use client";

/**
 * ClientFormModal — create or edit a single client.
 *
 * 4-channel contact (phone / email / Telegram / Instagram), name required
 * + at-least-one-contact, tags (free-text CSV), notes, DOB. Submits via
 * `api.clients.create` or `api.clients.update` — the router handles the
 * marketing-directory sync transparently.
 */

import { useState, useEffect, useMemo, type FormEvent } from "react";
import { X, ListChecks, Plus, Check, Star } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { Select } from "~/components/ui/Select";

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
  /** 0074: manual favorite-master pin. NULL → derived from history. */
  favoriteMasterId?: number | null;
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
  // 0074 — empty string = no pin (cleared). Numeric string = master chatId.
  const [favoriteMaster, setFavoriteMaster] = useState<string>(
    initial?.favoriteMasterId != null ? String(initial.favoriteMasterId) : "",
  );
  const [err, setErr] = useState<string | null>(null);

  // Master roster for the favorite-master Select. Filters out archived
  // rows (no point letting the user pin a master who no longer exists).
  const mastersQ = api.salon.getMasters.useQuery({ tenantId });
  const masterOptions = useMemo(() => {
    const list = (mastersQ.data ?? []) as Array<{
      chatId: number; name: string | null; archivedAt?: number | null;
    }>;
    return list
      .filter((m) => !m.archivedAt)
      .map((m) => ({ value: String(m.chatId), label: m.name || `#${m.chatId}` }));
  }, [mastersQ.data]);

  // ── Marketing lists (Brevo-style manual segments) ────────────────────────
  // The form lets the user toggle which lists this client belongs to. On
  // Save we diff (initial ↔ picked) and call `clients.setListMemberships`
  // after the main upsert finishes. `creatingList` opens an inline mini-form
  // so the user can spin up a new list without leaving the modal.
  const [pickedLists, setPickedLists] = useState<Set<string>>(new Set());
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");

  const allListsQ = api.marketingTenant.segmentsList.useQuery(
    { tenantId },
    { enabled: !!tenantId },
  );
  const manualLists = useMemo(
    () => ((allListsQ.data ?? []) as any[]).filter((s) => s.kind === "manual"),
    [allListsQ.data],
  );
  const currentMembersQ = api.clients.getListMemberships.useQuery(
    { tenantId, chatId: initial?.chatId ?? 0 },
    { enabled: isEdit && !!initial?.chatId },
  );
  // Seed `pickedLists` once we know the existing memberships (edit mode).
  // Skip if the user already touched the chips — don't clobber their work
  // if the query re-fetches.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!isEdit) return;
    if (seeded) return;
    if (currentMembersQ.data?.segmentIds) {
      setPickedLists(new Set(currentMembersQ.data.segmentIds));
      setSeeded(true);
    }
  }, [isEdit, seeded, currentMembersQ.data?.segmentIds]);

  const utils = api.useUtils();

  function invalidateLists() {
    void utils.marketingTenant.segmentsList.invalidate({ tenantId });
    if (isEdit && initial?.chatId) {
      void utils.clients.getListMemberships.invalidate({ tenantId, chatId: initial.chatId });
    }
  }

  const setMembershipsM = api.clients.setListMemberships.useMutation();
  const createListM = api.marketingTenant.segmentCreate.useMutation({
    onSuccess: (r) => {
      void utils.marketingTenant.segmentsList.invalidate({ tenantId });
      setPickedLists((prev) => {
        const next = new Set(prev);
        next.add(r.id);
        return next;
      });
      setCreatingList(false);
      setNewListName("");
    },
    onError: (e) => setErr(e.message),
  });

  async function commitMemberships(chatId: number) {
    const initialIds = isEdit ? new Set(currentMembersQ.data?.segmentIds ?? []) : new Set<string>();
    const same =
      initialIds.size === pickedLists.size &&
      Array.from(pickedLists).every((id) => initialIds.has(id));
    if (same) return;
    try {
      await setMembershipsM.mutateAsync({
        tenantId,
        chatId,
        segmentIds: Array.from(pickedLists),
      });
    } catch (e: any) {
      // Surface the error but don't block the modal close — the client
      // itself was already saved. We bubble up to the toast layer if any.
      // eslint-disable-next-line no-console
      console.warn("[ClientFormModal] setListMemberships failed", e);
    }
    invalidateLists();
  }

  const create = api.clients.create.useMutation({
    onSuccess: async (r) => {
      void utils.clients.list.invalidate({ tenantId });
      void utils.clients.getFavoriteMasterSuggestion.invalidate({ tenantId, chatId: r.chatId });
      await commitMemberships(r.chatId);
      onSaved(r.chatId);
      onClose();
    },
    onError: (e) => setErr(e.message || t("appointments.manual.somethingWrong", lang)),
  });

  const update = api.clients.update.useMutation({
    onSuccess: async () => {
      void utils.clients.list.invalidate({ tenantId });
      void utils.clients.get.invalidate({ tenantId, chatId: initial!.chatId });
      void utils.clients.getFavoriteMasterSuggestion.invalidate({ tenantId, chatId: initial!.chatId });
      await commitMemberships(initial!.chatId);
      onSaved(initial!.chatId);
      onClose();
    },
    onError: (e) => setErr(e.message || t("appointments.manual.somethingWrong", lang)),
  });

  function toggleList(id: string) {
    setPickedLists((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitNewList(e: FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    createListM.mutate({
      tenantId,
      name: newListName.trim(),
      kind: "manual",
      filterJson: "{}",
    });
  }

  const hasContact = !!(phone.trim() || email.trim() || tg.trim() || ig.trim());
  const valid = name.trim().length > 0 && hasContact;
  const pending = create.isPending || update.isPending;

  // Edit-mode dirty detection — drives the submit button label. We treat
  // null/undefined `initial` values as `""` so a field that came back from
  // the DB as null and is still empty doesn't read as a change.
  // Memberships are only checked once `seeded` flips true (the membership
  // query resolves async — before that, `pickedLists` is the empty default,
  // not the real baseline).
  const norm = (v: string | null | undefined) => (v ?? "").trim();
  const initialFav =
    initial?.favoriteMasterId != null ? String(initial.favoriteMasterId) : "";
  const fieldsDirty =
    name.trim() !== norm(initial?.name) ||
    phone.trim() !== norm(initial?.phone) ||
    email.trim() !== norm(initial?.email) ||
    tg.trim() !== norm(initial?.tgUsername) ||
    ig.trim() !== norm(initial?.igUsername) ||
    tags.trim() !== norm(initial?.tags) ||
    notes.trim() !== norm(initial?.notes) ||
    dob.trim() !== norm(initial?.dob) ||
    favoriteMaster !== initialFav;
  const initialListIds = new Set(currentMembersQ.data?.segmentIds ?? []);
  const listsDirty =
    seeded &&
    (pickedLists.size !== initialListIds.size ||
      Array.from(pickedLists).some((id) => !initialListIds.has(id)));
  const isDirty = isEdit && (fieldsDirty || listsDirty);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!valid) {
      setErr(t("clients.form.contactRequired", lang));
      return;
    }
    const favoriteMasterId = favoriteMaster ? Number(favoriteMaster) : null;
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
          favoriteMasterId,
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
        favoriteMasterId,
      });
    }
  }

  return (
    <div
      // Mobile: full-width bottom-sheet (items-end). Tablet+: centered card.
      // z-[100] beats Shell's sticky header (z-30/40) + bottom nav (z-50).
      // slate-950/70 overlay + backdrop-blur-md = clean unified backdrop
      // instead of muddy bg-black/50 leaking through translucent cards.
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        // Solid card — no `glass-card` (its rgba(248,250,252,0.85) overrides
        // bg-white and renders as translucent grey).
        className="w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
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

          {/* 0074 — Favorite master pin. The select is hidden when the
              salon has no masters yet (no one to pick) and rendered as a
              single full-width row otherwise. The auto-suggested value
              from booking history is shown beneath when no manual pin is
              set, so the owner can see "what the bot would have picked"
              before deciding to lock it. */}
          {masterOptions.length > 0 && (
            <div>
              <label className={`${LABEL} flex items-center gap-1.5`}>
                <Star className="h-3.5 w-3.5 text-amber-500" />
                {t("clients.form.favoriteMaster", lang)}
              </label>
              <Select
                testIdPrefix="cf-favorite-master"
                value={favoriteMaster}
                onChange={setFavoriteMaster}
                placeholder={t("clients.form.favoriteMaster.none", lang)}
                options={[
                  { value: "", label: t("clients.form.favoriteMaster.none", lang) },
                  ...masterOptions,
                ]}
              />
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                {t("clients.form.favoriteMaster.hint", lang)}
              </p>
            </div>
          )}

          {/* Marketing lists — Brevo-style manual segments.
              Hidden until tenant has at least one list OR user clicks
              "Create list" — keeps the form short for tenants who haven't
              touched the marketing module yet. */}
          {(manualLists.length > 0 || creatingList) && (
            <div>
              <label className={`${LABEL} flex items-center gap-1.5`}>
                <ListChecks className="h-3.5 w-3.5 text-violet-500" />
                {t("clients.form.lists", lang)}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {manualLists.map((l: any) => {
                  const picked = pickedLists.has(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggleList(l.id)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        picked
                          ? "border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-200"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                      }`}
                    >
                      {picked && <Check className="h-3 w-3" />}
                      {l.name}
                    </button>
                  );
                })}
                {!creatingList ? (
                  <button
                    type="button"
                    onClick={() => setCreatingList(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:border-violet-300 hover:text-violet-600 dark:border-white/10 dark:hover:border-violet-400/40 dark:hover:text-violet-300"
                  >
                    <Plus className="h-3 w-3" />
                    {t("clients.form.lists.new", lang)}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      autoFocus
                      placeholder={t("clients.form.lists.newPlaceholder", lang)}
                      maxLength={120}
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitNewList(e as any);
                        if (e.key === "Escape") {
                          setCreatingList(false);
                          setNewListName("");
                        }
                      }}
                      className="rounded-full border border-violet-300 bg-white px-2.5 py-1 text-[11px] text-slate-900 outline-none focus:border-violet-500 dark:border-violet-400/40 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={submitNewList as any}
                      disabled={!newListName.trim() || createListM.isPending}
                      className="rounded-full bg-violet-600 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
                    >
                      {createListM.isPending ? "…" : t("common.add", lang)}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingList(false); setNewListName(""); }}
                      className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                      aria-label="Cancel"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </div>
              {manualLists.length === 0 && !creatingList && (
                <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                  {t("clients.form.lists.empty", lang)}
                </p>
              )}
            </div>
          )}
          {/* If the tenant truly has no lists yet AND the user hasn't started
              the inline create flow, show a single CTA so they discover the
              feature without the section taking up form space. */}
          {manualLists.length === 0 && !creatingList && (
            <div>
              <label className={`${LABEL} flex items-center gap-1.5`}>
                <ListChecks className="h-3.5 w-3.5 text-violet-500" />
                {t("clients.form.lists", lang)}
              </label>
              <button
                type="button"
                onClick={() => setCreatingList(true)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:border-violet-300 hover:text-violet-600 dark:border-white/10 dark:hover:border-violet-400/40 dark:hover:text-violet-300"
              >
                <Plus className="h-3 w-3" />
                {t("clients.form.lists.new", lang)}
              </button>
            </div>
          )}

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

          {/* Sticky submit row on mobile (44px touch targets) so it stays
              visible while the user fills the tall form. Falls back to a
              normal in-flow row on tablet+. */}
          <div className="sticky bottom-0 -mx-4 -mb-4 flex gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:mb-0 sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-2 dark:border-white/5 dark:bg-slate-900/95 sm:dark:bg-transparent">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-100 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:hover:bg-white/[0.08] sm:py-2.5"
            >
              {t("common.cancel", lang)}
            </button>
            <button
              type="submit"
              disabled={!valid || pending}
              data-testid="cf-submit"
              className={
                !valid || pending
                  ? "flex-1 cursor-not-allowed rounded-lg bg-slate-200 py-3 text-sm font-semibold text-slate-400 dark:bg-slate-700 dark:text-slate-500 sm:py-2.5"
                  : "flex-1 rounded-lg py-3 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)] transition hover:opacity-90 sm:py-2.5"
              }
              style={!valid || pending ? undefined : { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
            >
              {pending
                ? t("clients.form.saving", lang)
                : isEdit
                  ? isDirty
                    ? t("common.save", lang)
                    : t("clients.action.edit", lang)
                  : t("clients.action.add", lang)}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
