/**
 * Tests for preset-generator.js prompt + post-processing.
 *
 * The Claude runner is INJECTED, so these never spawn the real CLI or touch the
 * network. Importing the module must not trigger main() (the direct-exec guard).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, generateOne } from './preset-generator.js';

const OCC = { name_en: 'Summer Start', occasion_key: 'summer_start', type: 'commercial' };
const FACTS = { product: 'ManicBot is an AI administrator for beauty salons.', brand: 'Warm, professional voice.' };

test('buildPrompt instructs paragraph structure with a literal \\n\\n token', () => {
  const p = buildPrompt(OCC, 'en', FACTS);
  assert.match(p, /paragraph/i);
  assert.match(p, /\\n\\n/); // the literal escape sequence the model should emit
  // existing guardrails still present
  assert.match(p, /PRODUCT\.md/);
  assert.match(p, /\{salon_name\}/);
});

test('generateOne returns structured copy from an injected runner', () => {
  const runClaude = () => '{"center":"Hi {salon_name}!\\n\\nSummer is here.\\n\\nBook now 👉"}';
  const res = generateOne(OCC, 'en', FACTS, { runClaude });
  assert.equal(res.ok, true);
  assert.match(res.center, /\n\n/);
  assert.ok(res.center.includes('Book now 👉'));
  assert.ok(res.center.includes('{salon_name}'));
});

test('generateOne reflows a single-paragraph model response (fallback guarantees structure)', () => {
  const runClaude = () => '{"center":"Hi there! Summer is here at last. Book your slot 👉"}';
  const res = generateOne(OCC, 'en', FACTS, { runClaude });
  assert.equal(res.ok, true);
  assert.match(res.center, /\n\n/); // even though the model emitted one block
});

test('generateOne reports failure on non-JSON output (no throw, no CLI)', () => {
  const res = generateOne(OCC, 'en', FACTS, { runClaude: () => 'sorry, I cannot do that' });
  assert.equal(res.ok, false);
});

test('generateOne surfaces a runner error as a soft failure', () => {
  const res = generateOne(OCC, 'en', FACTS, {
    runClaude: () => { throw new Error('claude exploded'); },
  });
  assert.equal(res.ok, false);
});
