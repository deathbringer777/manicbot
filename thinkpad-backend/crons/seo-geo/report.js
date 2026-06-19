'use strict';
/**
 * report.js — assemble the big markdown report + CSV + Telegram digest.
 *
 * Pure builders (testable, no I/O); writeReport() does the fs writes into
 * reports/seo-geo/ (which is gitignored — keyword strategy stays on the server,
 * the repo is public).
 */
const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('../../lib/tg');

function csvField(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv(keywords) {
  const header = ['keyword', 'lang', 'audience', 'intent', 'cluster', 'priority', 'score', 'sources', 'seed'];
  const lines = [header.join(',')];
  for (const k of keywords || []) {
    lines.push([
      k.keyword, k.lang, k.audience || '', k.intent || k.cluster || '', k.cluster || '',
      k.priority || '', k.score ?? '', (k.sources || []).join('|'), k.seed || '',
    ].map(csvField).join(','));
  }
  return lines.join('\n') + '\n';
}

function countBy(keywords, field) {
  const m = {};
  for (const k of keywords || []) { const v = k[field] || '?'; m[v] = (m[v] || 0) + 1; }
  return m;
}

/** Humanize a machine slug if Claude returned one (e.g. "b2b-pl-system" → "b2b · pl · system"). */
function prettyClusterName(name) {
  const s = String(name || '').trim();
  return /^[a-z0-9]+(-[a-z0-9]+)+$/.test(s) ? s.replace(/-/g, ' · ') : s;
}

function buildMarkdown({ date, keywords = [], gsc = {}, analysis, trendsCount = 0, failures = [], deltas } = {}) {
  const byAud = countBy(keywords, 'audience');
  const byPrio = countBy(keywords, 'priority');
  const L = [];
  L.push('# Manicbot — SEO + GEO keyword research');
  L.push(`\n**Дата:** ${date} · **Авто-прогон (ThinkPad cron)** · ключей: **${keywords.length}** (B2C ${byAud.B2C || 0} / B2B ${byAud.B2B || 0})`);
  if (deltas) L.push(`**Δ к прошлой неделе:** +${deltas.added} новых · ${deltas.removed} ушло (было ${deltas.prevTotal}).`);
  if (failures.length) L.push(`> ⚠️ Коллекторы деградировали: ${failures.join(', ')} — отчёт построен из остального.`);
  L.push(`> Источники: Google Autocomplete (живой) · GSC ${gsc.configured ? '✓' : '— off (нет service-account)'} · Trends ${trendsCount} related · SERP/PAA.`);
  L.push('> Язык: стратегия/комментарии — по-русски; готовый для сайта контент (title/meta/FAQ/llms.txt) — на польском (или языке кластера). ⚠️ Цифры в GEO-фактах сгенерированы AI — проверь перед публикацией.');

  L.push('\n## 1. Сводка приоритетов');
  L.push(`High: **${byPrio.High || 0}** · Med: **${byPrio.Med || 0}** · Low: **${byPrio.Low || 0}**`);

  L.push('\n## 2. Топ-приоритет (приоритет = перцентиль ранга: топ-25% = High; точность вырастет с подключением GSC)');
  const ranked = keywords.slice(0, 40); // keywords arrive already sorted desc by score
  if (ranked.length) for (const k of ranked) L.push(`- \`${k.keyword}\` — ${k.lang}/${k.audience || '?'}/${k.cluster || '?'} · ${k.priority} (${k.score})`);
  else L.push('_нет ключей_');

  L.push('\n## 3. GSC truth-layer (striking distance, поз. 5–20)');
  if (gsc.configured && (gsc.striking || []).length) {
    for (const r of gsc.striking.slice(0, 30)) L.push(`- \`${r.keyword}\` — поз ${r.position.toFixed(1)}, ${r.impressions} показов, CTR ${(r.ctr * 100).toFixed(1)}%`);
  } else L.push('_GSC не настроен (нет GSC_SERVICE_ACCOUNT_JSON) — слой заполнится, как только появится service-account._');

  L.push('\n## 4. Кластеры (аудитория × намерение)');
  const clusters = (analysis && analysis.clusters) || [];
  if (clusters.length) {
    for (const c of clusters.slice(0, 24)) {
      L.push(`\n### ${prettyClusterName(c.name)}${c.audience ? ` · ${c.audience}` : ''}${c.intent ? ` · ${c.intent}` : ''}`);
      if (c.target_page) L.push(`**Целевая:** \`${c.target_page}\``);
      if (c.suggested_title) L.push(`**Title:** ${c.suggested_title}`);
      if (c.suggested_meta) L.push(`**Meta:** ${c.suggested_meta}`);
      if ((c.keywords || []).length) L.push((c.keywords || []).slice(0, 25).map((x) => `\`${x}\``).join(' · '));
    }
  } else L.push('_Claude-анализ недоступен — кластеры эвристические (см. CSV)._');

  L.push('\n## 5. GEO / AEO (оптимизация под нейросети)');
  const geo = analysis && analysis.geo;
  if (geo) {
    if (geo.citable_facts && geo.citable_facts.length) { L.push('**Citable facts (для LLM-цитирования):**'); for (const f of geo.citable_facts) L.push(`- ${f}`); }
    if (geo.faq && geo.faq.length) { L.push('\n**Q&A под реальные промпты (→ FAQPage schema):**'); for (const qa of geo.faq.slice(0, 20)) L.push(`- **${qa.q}** ${qa.a}`); }
    if (geo.schema_recommendations && geo.schema_recommendations.length) { L.push('\n**Schema:**'); for (const s of geo.schema_recommendations) L.push(`- ${s}`); }
    if (geo.llms_txt_additions && geo.llms_txt_additions.length) { L.push('\n**Добавить в llms.txt:**'); for (const s of geo.llms_txt_additions) L.push(`- ${s}`); }
  } else L.push('_GEO-рекомендации формирует Claude — в этом прогоне недоступен._');

  if (analysis && analysis.quick_wins && analysis.quick_wins.length) { L.push('\n## 6. Действия (quick wins)'); for (const q of analysis.quick_wins) L.push(`- [ ] ${q}`); }
  if (analysis && analysis.new_pages && analysis.new_pages.length) { L.push('\n## 7. Новые страницы'); for (const p of analysis.new_pages) L.push(`- [ ] ${p}`); }

  L.push('\n## Приложение — полный список');
  L.push(`См. CSV рядом (\`keywords-${date}.csv\`) — ${keywords.length} ключей, размечены по аудитории/намерению/кластеру/приоритету.`);
  return L.join('\n') + '\n';
}

function buildDigest({ date, keywords = [], gsc = {}, failures = [], deltas } = {}) {
  const byPrio = countBy(keywords, 'priority');
  const wins = keywords.filter((k) => k.priority === 'High').slice(0, 5).map((k) => escapeHtml(k.keyword)).join(', ');
  const lines = [];
  lines.push(`🔑 <b>SEO/GEO research</b> · ${date}`);
  lines.push(`Ключей: <b>${keywords.length}</b> · High ${byPrio.High || 0} / Med ${byPrio.Med || 0} / Low ${byPrio.Low || 0}`);
  if (deltas) lines.push(`Δ неделя: +${deltas.added} новых`);
  lines.push(`GSC: ${gsc.configured ? '✓' : '— off'}`);
  if (wins) lines.push(`🏆 ${wins}`);
  if (failures.length) lines.push(`⚠️ degraded: ${failures.join(', ')}`);
  return lines.join('\n');
}

function writeReport(ctx, { dir, fsImpl = fs } = {}) {
  fsImpl.mkdirSync(dir, { recursive: true });
  const md = buildMarkdown(ctx);
  const csv = buildCsv(ctx.keywords || []);
  const mdPath = path.join(dir, `seo-geo-${ctx.date}.md`);
  const csvPath = path.join(dir, `keywords-${ctx.date}.csv`);
  fsImpl.writeFileSync(mdPath, md);
  fsImpl.writeFileSync(csvPath, csv);
  try { fsImpl.writeFileSync(path.join(dir, 'latest.md'), md); } catch { /* non-fatal */ }
  return { mdPath, csvPath, mdBytes: Buffer.byteLength(md), csvBytes: Buffer.byteLength(csv) };
}

module.exports = { csvField, buildCsv, buildMarkdown, buildDigest, writeReport };
