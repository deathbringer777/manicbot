/**
 * Services CSV import/export — tolerant parser + canonical exporter.
 *
 * Format (own template — see `SERVICES_CSV_TEMPLATE`):
 *
 *   svc_id,name,price,duration,emoji,category,description,active
 *   svc_abc,Маникюр,500,60,💅,Маникюр,Классический маникюр,1
 *
 * Header parsing is case-insensitive and accepts common aliases.
 * `svc_id` is included in exports for round-trip matching on import;
 * it is optional on import — omit it to always create new services.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ParsedServiceRow {
  svcId: string | null;
  name: string | null;
  price: number | null;
  duration: number | null;
  emoji: string | null;
  category: string | null;
  description: string | null;
  active: boolean;
}

export interface ServiceRowError {
  row: number;   // line index from file start (header = 0, first data row = 1)
  reason: string;
}

export interface ServiceParseResult {
  rows: ParsedServiceRow[];
  errors: ServiceRowError[];
}

// ─── Template ─────────────────────────────────────────────────────────────────

export const SERVICES_CSV_TEMPLATE =
  "svc_id,name,price,duration,emoji,category,description,active\n" +
  ",Маникюр,500,60,💅,Маникюр,Классический маникюр,1\n" +
  ",Педикюр,700,90,🦶,Педикюр,,1\n" +
  ",Гель-лак,600,75,💅,Покрытие,Цветной гель-лак,1\n";

// ─── Header aliases ───────────────────────────────────────────────────────────

type Field = keyof ParsedServiceRow;

const HEADER_ALIASES: Record<string, Field> = {
  // svc_id
  svc_id: "svcId", svcid: "svcId", id: "svcId", service_id: "svcId",
  // name
  name: "name", service_name: "name", "service name": "name", title: "name", услуга: "name",
  // price
  price: "price", cost: "price", стоимость: "price", цена: "price", amount: "price",
  // duration
  duration: "duration", time_min: "duration", "time min": "duration", minutes: "duration",
  mins: "duration", длительность: "duration", продолжительность: "duration",
  // emoji
  emoji: "emoji", icon: "emoji",
  // category
  category: "category", cat: "category", group: "category", категория: "category",
  // description
  description: "description", desc: "description", info: "description", notes: "description",
  описание: "description",
  // active
  active: "active", enabled: "active", published: "active", visible: "active", активна: "active",
};

// ─── CSV parser ───────────────────────────────────────────────────────────────

function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cells.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  cells.push(cur);
  return cells;
}

export function parseServicesCsv(csv: string): ServiceParseResult {
  const rows: ParsedServiceRow[] = [];
  const errors: ServiceRowError[] = [];

  const lines = csv.split(/\r?\n/);
  if (lines.length === 0) return { rows, errors };

  // Find header
  const headerLine = lines[0]?.trim();
  if (!headerLine) return { rows, errors };

  const headerCells = splitCsvRow(headerLine).map(h => h.trim().toLowerCase());
  const fieldMap: Array<Field | null> = headerCells.map(h => HEADER_ALIASES[h] ?? null);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const cells = splitCsvRow(line);
    const raw: Partial<Record<Field, string>> = {};
    for (let c = 0; c < fieldMap.length; c++) {
      const field = fieldMap[c];
      if (field) raw[field] = (cells[c] ?? "").trim();
    }

    // Validate name
    if (!raw.name) {
      errors.push({ row: i, reason: "Пустое название услуги" });
      continue;
    }

    // Validate price
    const priceStr = raw.price ?? "";
    const price = priceStr === "" ? null : parseFloat(priceStr);
    if (priceStr !== "" && (isNaN(price!) || price! < 0)) {
      errors.push({ row: i, reason: `Некорректная цена: "${priceStr}"` });
      continue;
    }

    // Validate duration
    const durStr = raw.duration ?? "";
    const duration = durStr === "" ? null : parseInt(durStr, 10);
    if (durStr !== "" && (isNaN(duration!) || duration! <= 0)) {
      errors.push({ row: i, reason: `Некорректная длительность: "${durStr}"` });
      continue;
    }

    const activeStr = raw.active;
    const active = activeStr === undefined || activeStr === "" || activeStr === "1" || activeStr.toLowerCase() === "true";

    rows.push({
      svcId: raw.svcId || null,
      name: raw.name,
      price: price ?? null,
      duration: duration ?? null,
      emoji: raw.emoji || null,
      category: raw.category || null,
      description: raw.description || null,
      active,
    });
  }

  return { rows, errors };
}

// ─── CSV exporter ─────────────────────────────────────────────────────────────

function escapeCsvCell(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Accepts raw DB service rows (names as JSON string). */
export function servicesToCsv(services: Array<{
  svcId: string;
  names: string | null;
  price: number;
  duration: number;
  emoji: string | null;
  category: string | null;
  description: string | null;
  active: number | boolean;
}>): string {
  const header = "svc_id,name,price,duration,emoji,category,description,active";
  const dataRows = services.map(s => {
    let name = s.svcId;
    try {
      const parsed = s.names ? (JSON.parse(s.names) as Record<string, string>) : {};
      name = parsed.ru ?? parsed.en ?? parsed.ua ?? parsed.pl ?? s.svcId;
    } catch { /* fallback to svcId */ }
    const activeVal = s.active === 1 || s.active === true ? "1" : "0";
    return [
      escapeCsvCell(s.svcId),
      escapeCsvCell(name),
      escapeCsvCell(s.price),
      escapeCsvCell(s.duration),
      escapeCsvCell(s.emoji),
      escapeCsvCell(s.category),
      escapeCsvCell(s.description),
      activeVal,
    ].join(",");
  });
  return [header, ...dataRows].join("\n") + "\n";
}
