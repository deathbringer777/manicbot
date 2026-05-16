"use client";

/**
 * Inventory Lite runtime — Phase 3 Variant A plugin #3.
 *
 * Stores `items: InventoryItem[]` on plugin_installations.settings_json.
 * No D1 migration, no new tRPC routers — the generic plugins.updateSettings
 * mutation carries the full list each save. ~80-byte rows × 80 items =
 * fits comfortably inside the 8 KB settings cap.
 */

import { useEffect, useMemo, useState } from "react";
import { Boxes, Plus, Trash2, AlertTriangle, Save, Search } from "lucide-react";
import { api } from "~/trpc/react";
import { PluginRuntimeShell } from "~/components/plugins/PluginRuntimeShell";
import type { PluginRuntimeProps } from "../runtimePanels";

interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  threshold: number;
  unit: string;
}

interface InventorySettings {
  items?: InventoryItem[];
}

const MAX_ITEMS = 80;
const DEFAULT_UNIT = "шт";

function freshId(): string {
  return `inv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeItem(it: Partial<InventoryItem>): InventoryItem {
  return {
    id: typeof it.id === "string" && it.id ? it.id : freshId(),
    name: (typeof it.name === "string" ? it.name : "").trim().slice(0, 80),
    quantity: Math.max(0, Math.min(99999, Math.floor(Number(it.quantity) || 0))),
    threshold: Math.max(0, Math.min(99999, Math.floor(Number(it.threshold) || 0))),
    unit: (typeof it.unit === "string" && it.unit.trim() ? it.unit.trim() : DEFAULT_UNIT).slice(0, 12),
  };
}

export default function InventoryLiteRuntime({ installationId, slug }: PluginRuntimeProps) {
  const installedQ = api.plugins.getInstalled.useQuery();
  const updateSettings = api.plugins.updateSettings.useMutation();
  const utils = api.useUtils();

  const myInstall = installedQ.data?.find((x) => x.id === installationId);
  const persistedItems = useMemo<InventoryItem[]>(() => {
    if (!myInstall?.settingsJson) return [];
    try {
      const parsed = JSON.parse(myInstall.settingsJson) as InventorySettings;
      if (!Array.isArray(parsed.items)) return [];
      return parsed.items.map(sanitizeItem).filter((it) => it.name.length > 0);
    } catch {
      return [];
    }
  }, [myInstall?.settingsJson]);

  const [items, setItems] = useState<InventoryItem[]>(persistedItems);
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Hydrate when persisted list updates (after a save round-trip)
  useEffect(() => {
    setItems(persistedItems);
  }, [persistedItems]);

  const addItem = () => {
    if (items.length >= MAX_ITEMS) {
      setFlash({ kind: "err", text: `Лимит ${MAX_ITEMS} позиций — для большего апгрейднись на inventory-pro` });
      return;
    }
    setItems((prev) => [
      ...prev,
      { id: freshId(), name: "", quantity: 0, threshold: 0, unit: DEFAULT_UNIT },
    ]);
  };

  const updateItem = (id: string, patch: Partial<InventoryItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? sanitizeItem({ ...it, ...patch }) : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const onSave = () => {
    // Drop empty-name rows before persisting (UX: user can keep a blank stub
    // while editing, but we don't want to keep it on save).
    const cleaned = items.filter((it) => it.name.length > 0).map(sanitizeItem);
    updateSettings.mutate(
      { installationId, settings: { items: cleaned } },
      {
        onSuccess: () => {
          setFlash({ kind: "ok", text: `Сохранено ${cleaned.length} позиций` });
          setItems(cleaned);
          void utils.plugins.getInstalled.invalidate();
        },
        onError: (e) => setFlash({ kind: "err", text: e.message }),
      },
    );
  };

  const lowStockCount = items.filter((it) => it.name && it.quantity <= it.threshold).length;
  const searched = search.trim().toLowerCase();
  const visible = searched
    ? items.filter((it) => it.name.toLowerCase().includes(searched))
    : items;

  return (
    <PluginRuntimeShell slug={slug} flash={flash}>
      <div className="space-y-4">
        <section className="rounded-2xl bg-white dark:bg-slate-900 p-4 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 mb-3">
            <Boxes className="w-4 h-4 text-orange-500 shrink-0" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex-1">
              Материалы салона
            </h3>
            {lowStockCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-700 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 rounded-full px-2 py-0.5"
                data-testid="inventory-low-count"
              >
                <AlertTriangle className="w-3 h-3" />
                {lowStockCount} мало
              </span>
            )}
            <span className="text-[10px] text-slate-400 tabular-nums shrink-0" data-testid="inventory-total">
              {items.length}/{MAX_ITEMS}
            </span>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию"
                data-testid="inventory-search"
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={addItem}
              data-testid="inventory-add-button"
              className="inline-flex items-center gap-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 text-xs font-medium transition-colors shrink-0"
            >
              <Plus className="w-3 h-3" />
              Добавить
            </button>
          </div>

          {visible.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-6" data-testid="inventory-empty">
              {items.length === 0
                ? "Пока пусто. Нажми «Добавить» и заведи первую позицию."
                : "Ничего не найдено по запросу."}
            </p>
          )}

          <div className="space-y-1.5" data-testid="inventory-list">
            {visible.map((it) => {
              const isLow = it.name && it.quantity <= it.threshold;
              return (
                <div
                  key={it.id}
                  data-testid="inventory-row"
                  data-low={isLow ? "true" : "false"}
                  className={`flex items-center gap-1.5 p-2 rounded-lg border transition-colors ${
                    isLow
                      ? "border-orange-300 bg-orange-50 dark:border-orange-700/40 dark:bg-orange-900/10"
                      : "border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-white/[0.02]"
                  }`}
                >
                  <input
                    type="text"
                    value={it.name}
                    onChange={(e) => updateItem(it.id, { name: e.target.value })}
                    placeholder="Название (например, Гель розовый)"
                    maxLength={80}
                    data-testid="inventory-name"
                    className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <input
                    type="number"
                    value={it.quantity}
                    onChange={(e) => updateItem(it.id, { quantity: parseInt(e.target.value, 10) })}
                    min={0}
                    max={99999}
                    data-testid="inventory-quantity"
                    className="w-16 px-2 py-1 text-sm text-right tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    value={it.unit}
                    onChange={(e) => updateItem(it.id, { unit: e.target.value })}
                    placeholder="шт"
                    maxLength={12}
                    data-testid="inventory-unit"
                    className="w-12 px-1 py-1 text-xs text-center rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <span className="text-[10px] text-slate-400 shrink-0">⚠</span>
                  <input
                    type="number"
                    value={it.threshold}
                    onChange={(e) => updateItem(it.id, { threshold: parseInt(e.target.value, 10) })}
                    min={0}
                    max={99999}
                    data-testid="inventory-threshold"
                    className="w-12 px-1 py-1 text-xs text-right tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    title="Порог тревоги"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    data-testid="inventory-remove"
                    title="Удалить позицию"
                    className="shrink-0 p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onSave}
            disabled={updateSettings.isPending}
            data-testid="inventory-save"
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {updateSettings.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
        </section>
      </div>
    </PluginRuntimeShell>
  );
}
