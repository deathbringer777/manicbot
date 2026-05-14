/**
 * Claude API caption generator for the @manicbot_com IG autopilot.
 *
 * Used for weeks 1-3 of the launch (per the 3-week roadmap). After
 * that, the planned switch is to Workers AI gpt-oss-120b via env.AI
 * to eliminate the third-party API dependency. The shape of this
 * function stays the same so the cron phase doesn't need to know
 * which backend is wired up.
 *
 * Inputs from the content_plan row:
 *   - theme:       'inspiration' | 'product' | 'social_proof'
 *   - topic:       free-form Polish topic line
 *   - key_message: short Polish hook fragment (optional)
 *
 * Brand voice (system prompt) is loaded once from
 * manicbot/docs/marketing/BRAND_VOICE.md and passed in. The pipeline
 * reads the file at build time / cron startup so we don't fetch on
 * every call.
 *
 * Output is parsed structured JSON:
 *   { headline_pl, caption_pl, hashtags, image_prompt_visual }
 *
 * `image_prompt_visual` slots into the master image prompt's
 * {VISUAL_DESCRIPTION} placeholder (see BRAND_VOICE.md §6).
 */

import { log } from '../utils/logger.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'; // cheap, fast, sufficient for captions
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * @param {{ ANTHROPIC_API_KEY?: string }} env
 * @param {{
 *   brandVoice: string,         // BRAND_VOICE.md content (or its caption-prompt section)
 *   slot: { theme: string, topic: string, key_message?: string },
 *   model?: string,
 *   maxTokens?: number,
 *   fetchImpl?: typeof fetch,   // for tests
 * }} input
 * @returns {Promise<{ headline_pl: string, caption_pl: string, hashtags: string[], image_prompt_visual: string }>}
 */
export async function generateCaption(env, {
  brandVoice,
  slot,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  fetchImpl,
}) {
  if (!env?.ANTHROPIC_API_KEY) {
    throw new Error('captionGen: ANTHROPIC_API_KEY missing — set via wrangler secret put');
  }
  if (!brandVoice || typeof brandVoice !== 'string') {
    throw new Error('captionGen: brandVoice must be non-empty string');
  }
  if (!slot?.theme || !slot?.topic) {
    throw new Error('captionGen: slot.theme and slot.topic required');
  }
  if (!['inspiration', 'product', 'social_proof'].includes(slot.theme)) {
    throw new Error(`captionGen: unknown theme "${slot.theme}"`);
  }

  const doFetch = fetchImpl ?? fetch;

  const systemPrompt = buildSystemPrompt(brandVoice);
  const userMessage = buildUserMessage(slot);

  const body = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await doFetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    log.error('marketing.captionGen', err instanceof Error ? err : new Error(String(err)), {
      stage: 'fetch',
      model,
      theme: slot.theme,
    });
    throw new Error(`captionGen: fetch failed: ${err?.message ?? 'unknown'}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await safeText(response);
    log.error('marketing.captionGen', new Error(`Anthropic ${response.status}`), {
      stage: 'http',
      status: response.status,
      model,
      bodyPreview: errText.slice(0, 300),
    });
    throw new Error(`captionGen: Anthropic returned ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const textContent = extractText(data);
  if (!textContent) {
    log.error('marketing.captionGen', new Error('empty content'), {
      stage: 'parse',
      contentBlocks: data?.content?.length ?? 0,
    });
    throw new Error('captionGen: Anthropic returned empty content');
  }

  const parsed = parseJsonOutput(textContent);
  validateOutput(parsed);

  log.info('marketing.captionGen', {
    stage: 'ok',
    theme: slot.theme,
    headlineLen: parsed.headline_pl.length,
    captionLen: parsed.caption_pl.length,
    hashtagCount: parsed.hashtags.length,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  });

  return parsed;
}

export function buildSystemPrompt(brandVoice) {
  return `${brandVoice}

---

WAŻNE — FORMAT WYJŚCIA:

Odpowiedz JEDNYM blokiem JSON, bez żadnych komentarzy ani markdown. Klucze:

{
  "headline_pl": "4-6 słów po polsku, hook do obrazu",
  "caption_pl": "Pełny opis posta po polsku z hookiem, wartością i CTA. 2-4 emoji łącznie. Bez hashtagów w tym polu.",
  "hashtags": ["#ManicBot", "#paznokciewarszawa", "..."],
  "image_prompt_visual": "Po angielsku, krótki opis elementów wizualnych do wstawienia w master image prompt (slot {VISUAL_DESCRIPTION})."
}

Wymagania:
- headline_pl: 4-6 słów, BEZ KROPKI na końcu, BEZ emoji
- caption_pl: 80-280 słów, struktura: hook → wartość → soft CTA → "manicbot.com" lub "link w bio"
- hashtags: 10-15 tagów, każdy zaczyna się od "#", po polsku, mix brandowych i generycznych
- image_prompt_visual: 1-2 zdania po angielsku, max 30 słów, opisuje konkretny element ilustracji`;
}

export function buildUserMessage(slot) {
  const themeLabel = {
    inspiration: 'Inspiracja / porada biznesowa (slot 09:00)',
    product: 'Funkcja produktu / porównanie z konkurencją (slot 13:00)',
    social_proof: 'Dowód społeczny / CTA (slot 19:00)',
  }[slot.theme];

  const lines = [
    `Slot: ${themeLabel}`,
    `Temat: ${slot.topic}`,
  ];
  if (slot.key_message) lines.push(`Główna myśl: ${slot.key_message}`);
  lines.push('', 'Wygeneruj post zgodnie z formatem JSON.');

  return lines.join('\n');
}

export function extractText(anthropicResponse) {
  const blocks = anthropicResponse?.content;
  if (!Array.isArray(blocks)) return null;
  const textBlock = blocks.find((b) => b.type === 'text' && typeof b.text === 'string');
  return textBlock?.text ?? null;
}

export function parseJsonOutput(text) {
  // Tolerate fenced ```json blocks if the model leaks markdown.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to locate the first {...} block.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error(`captionGen: failed to parse JSON: ${cleaned.slice(0, 120)}`);
  }
}

export function validateOutput(out) {
  if (!out || typeof out !== 'object') {
    throw new Error('captionGen: output is not an object');
  }
  const required = ['headline_pl', 'caption_pl', 'hashtags', 'image_prompt_visual'];
  for (const k of required) {
    if (!(k in out)) throw new Error(`captionGen: missing field "${k}"`);
  }
  if (typeof out.headline_pl !== 'string' || out.headline_pl.length < 3) {
    throw new Error('captionGen: headline_pl too short');
  }
  if (typeof out.caption_pl !== 'string' || out.caption_pl.length < 40) {
    throw new Error('captionGen: caption_pl too short');
  }
  if (!Array.isArray(out.hashtags) || out.hashtags.length < 8 || out.hashtags.length > 30) {
    throw new Error(`captionGen: hashtags count out of range (got ${out.hashtags?.length})`);
  }
  for (const h of out.hashtags) {
    if (typeof h !== 'string' || !h.startsWith('#')) {
      throw new Error(`captionGen: invalid hashtag "${h}"`);
    }
  }
  if (typeof out.image_prompt_visual !== 'string' || out.image_prompt_visual.length < 5) {
    throw new Error('captionGen: image_prompt_visual too short');
  }
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
