/**
 * Architecture DB map generator (build-time, private).
 *
 * Parses the canonical D1 schema (`manicbot/src/db/schema.sql`) and emits a
 * TOP-DOWN, domain-grouped Mermaid `flowchart` into
 * `src/server/_generated/erd.generated.ts`, embedded into the admin-app server
 * bundle and served ONLY through the God-Mode `system.getArchitectureDiagram`
 * procedure.
 *
 * Why grouped flowchart (not a flat erDiagram): 103 tables in a flat ER render
 * as an unreadable horizontal strip. Grouping tables into ~12 domains (root on
 * top → domain blocks → tables listed inside, connected by lines + real FK
 * cross-links) gives a readable, top-down architecture mind-map. Domain titles
 * + descriptions are Russian (the user is non-technical); raw table names stay
 * as-is — they are real code identifiers and must match the live DB.
 *
 * Why schema.sql (not Drizzle introspection): it is the deployed source of
 * truth, kept in sync with schema.ts by the `check-schema-tables` CI gate, and
 * needs no TypeScript loader — plain Node, zero extra deps.
 *
 * Run by the CI "Generate architecture ERD" step before the admin-app build.
 * The committed `erd.generated.ts` stays a STUB; the real output is produced
 * ephemerally in CI and never committed. Set ERD_OUT to write elsewhere.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(here, "../../src/db/schema.sql");
const OUT = process.env.ERD_OUT || resolve(here, "../src/server/_generated/erd.generated.ts");

const cleanName = (s) =>
  s.trim().replace(/^["`[]/, "").replace(/["`\]]$/, "").replace(/[^A-Za-z0-9_]/g, "_");

// ── Parse table names + foreign-key relations from schema.sql ──────────────
let sql = readFileSync(SCHEMA, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
const tables = [];
const fks = [];
const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([`"[]?[A-Za-z0-9_]+[`"\]]?)\s*\(/gi;
let m;
while ((m = re.exec(sql))) {
  const name = cleanName(m[1]);
  let depth = 0;
  let end = -1;
  for (let j = re.lastIndex - 1; j < sql.length; j++) {
    const ch = sql[j];
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end === -1) continue;
  const body = sql.slice(re.lastIndex, end);
  tables.push(name);
  const refRe = /references\s+([`"[]?[A-Za-z0-9_]+[`"\]]?)/gi;
  let r;
  while ((r = refRe.exec(body))) {
    const to = cleanName(r[1]);
    if (to && to !== name) fks.push({ from: name, to });
  }
}
tables.sort((a, b) => a.localeCompare(b));

// ── Classify each table into a domain (ordered; first match wins) ──────────
const DOMAINS = [
  { id: "plg", label: "🧩 Плагины",                desc: "маркетплейс расширений",                 fill: "#ede9fe", stroke: "#7c3aed", re: /^plugin/ },
  { id: "mkt", label: "📣 Маркетинг и аналитика",   desc: "кампании, рассылки, клики, события",      fill: "#fce7f3", stroke: "#db2777", re: /^marketing_(campaigns|sends|link_clicks|conversions|segments|segment_members|templates|automations|providers|content_plan|publish_queue)$|^analytics_events$|^ai_usage$|^tracking_links$|^cookie_consent_log$/ },
  { id: "bil", label: "💳 Биллинг и рефералы",      desc: "Stripe, подписки, промокоды, рефералы",   fill: "#fef3c7", stroke: "#d97706", re: /^(stripe_|subscription_|promo_code|referral|referrals|stamp_card)/ },
  { id: "cli", label: "👤 Клиенты и CRM",           desc: "клиенты салонов, контакты, источники",    fill: "#dbeafe", stroke: "#2563eb", re: /^(users$|users_fts$|user_origins$|blocked_users$|human_requests$|marketing_contacts$|marketing_consent_log$|email_subscribers$|newsletter_subscribers$|email_suppressions$)/ },
  { id: "apt", label: "📅 Записи и календарь",       desc: "записи, блоки времени, Google Calendar",  fill: "#dcfce7", stroke: "#16a34a", re: /^(appointments$|appointment_blocks$|google_)/ },
  { id: "mst", label: "💇 Мастера, услуги, отзывы", desc: "мастера, услуги, галерея, отзывы",        fill: "#ccfbf1", stroke: "#0d9488", re: /^(masters$|master_client_blocks$|services$|service_categories$|photo_albums$|album_photos$|reviews$)/ },
  { id: "msg", label: "💬 Каналы и мессенджер",     desc: "Telegram/WA/IG, треды, боты",             fill: "#e0e7ff", stroke: "#4f46e5", re: /^(channel_|conversations$|message_windows$|threads$|thread_members$|thread_messages$|bots$|webhook_dedup$|template_usage$)/ },
  { id: "plt", label: "🏢 Платформа (оператор)",    desc: "рассылки оператора, блог, лиды, тикеты",  fill: "#ffedd5", stroke: "#ea580c", re: /^(platform_|blog_posts$|leads$|holiday_calendar$|industry_configs$|local_tickets$)/ },
  { id: "ten", label: "🔑 Тенанты, доступ, роли",   desc: "салоны, владельцы, права, пары-коды",     fill: "#fee2e2", stroke: "#dc2626", re: /^(tenants$|tenant_roles$|tenant_member_permissions$|tenant_action_requests$|tenant_support_agents$|web_users$|role_change_requests$|ownership_transfer_tokens$|owner_pairing_codes$|master_pairing_codes$|master_invitations$|permission_elevation_codes$|global_otp_codes$|support_agents$)/ },
  { id: "ntf", label: "🔔 Уведомления и пуш",       desc: "колокольчик, web-push",                   fill: "#fef9c3", stroke: "#ca8a04", re: /^(user_notifications$|push_subscriptions$)/ },
  { id: "inf", label: "⚙️ Служебное и инфра",       desc: "бэкапы, лимиты, ошибки, аудит, конфиг",   fill: "#e2e8f0", stroke: "#475569", re: /^(d1_backup_log$|upload_token_used$|rate_limits$|error_log$|error_events$|audit_log$|tenant_config$|tenant_onboarding$|google_prefill_consumed$|platform_settings$|platform_config$)/ },
];
const OTHER = { id: "oth", label: "📦 Прочее", desc: "не вошедшее в домены", fill: "#f1f5f9", stroke: "#94a3b8" };

const domainOf = {};
const grouped = {};
for (const d of [...DOMAINS, OTHER]) grouped[d.id] = [];
for (const t of tables) {
  const d = DOMAINS.find((x) => x.re.test(t)) || OTHER;
  domainOf[t] = d.id;
  grouped[d.id].push(t);
}
const used = [...DOMAINS, OTHER].filter((d) => grouped[d.id].length > 0);

// ── Build the top-down Mermaid flowchart ───────────────────────────────────
const esc = (s) => s.replace(/"/g, "&quot;");
const lines = ["flowchart TD"];
lines.push(`  ROOT["🗄️ ManicBot · база данных D1<br/><b>${tables.length} таблиц · ${used.length} доменов</b>"]:::root`);
for (const d of used) {
  const items = grouped[d.id];
  const label =
    `<b>${esc(d.label)}</b> <i>(${items.length})</i>` +
    `<br/><i>${esc(d.desc)}</i>` +
    `<br/>${items.map(esc).join("<br/>")}`;
  lines.push(`  ${d.id}["${label}"]:::${d.id}`);
  lines.push(`  ROOT --> ${d.id}`);
}
const seen = new Set();
for (const { from, to } of fks) {
  const a = domainOf[from];
  const b = domainOf[to];
  if (!a || !b || a === b) continue;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (seen.has(key)) continue;
  seen.add(key);
  lines.push(`  ${a} -.-> ${b}`);
}
lines.push(`  classDef root fill:#0f172a,stroke:#0ea5e9,stroke-width:2px,color:#f8fafc;`);
for (const d of used) {
  lines.push(`  classDef ${d.id} fill:${d.fill},stroke:${d.stroke},stroke-width:1.5px,color:#0f172a;`);
}
const mermaid = lines.join("\n");

const file = `/* AUTO-GENERATED by scripts/gen-erd.mjs from manicbot/src/db/schema.sql.
   Top-down, domain-grouped DB map (Mermaid flowchart). Do not hand-edit; do not
   commit a generated (non-stub) copy. Served privately via
   system.getArchitectureDiagram (God Mode). */
export const ERD_MERMAID = ${JSON.stringify(mermaid)};

export const ERD_META: {
  generatedAt: string | null;
  tableCount: number;
  domainCount: number;
  source: "stub" | "generated";
} = {
  generatedAt: ${JSON.stringify(new Date().toISOString())},
  tableCount: ${tables.length},
  domainCount: ${used.length},
  source: "generated",
};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, file);
console.log(`gen-erd: ${tables.length} tables, ${used.length} domains, ${seen.size} cross-links -> ${OUT}`);
for (const d of used) console.log(`  ${d.id} ${d.label}: ${grouped[d.id].length}`);
