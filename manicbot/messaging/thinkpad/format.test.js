/**
 * Tests for lib/format.js — newline-preserving body normalization and the
 * legacy single-paragraph reflow used by the preset-generator and
 * reflow-templates scripts. Pure functions; no CLI / network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBody, reflowToParagraphs } from './lib/format.js';

test('normalizeBody preserves a single newline', () => {
  assert.equal(normalizeBody('line1\nline2'), 'line1\nline2');
});

test('normalizeBody preserves a paragraph break', () => {
  assert.equal(normalizeBody('a\n\nb'), 'a\n\nb');
});

test('normalizeBody collapses 3+ newlines to exactly 2', () => {
  assert.equal(normalizeBody('a\n\n\n\nb'), 'a\n\nb');
});

test('normalizeBody trims trailing horizontal whitespace per line', () => {
  assert.equal(normalizeBody('a   \nb\t\nc  '), 'a\nb\nc');
});

test('normalizeBody normalizes CRLF / lone CR to \\n', () => {
  assert.equal(normalizeBody('a\r\nb\rc'), 'a\nb\nc');
});

test('normalizeBody returns "" for non-string', () => {
  assert.equal(normalizeBody(null), '');
  assert.equal(normalizeBody(undefined), '');
});

test('reflowToParagraphs turns a single-paragraph 3-sentence body into paragraphs', () => {
  const out = reflowToParagraphs('Greeting! Value here. CTA now 👉');
  assert.match(out, /\n\n/);
  assert.ok(out.includes('CTA now 👉'));
});

test('reflowToParagraphs is idempotent on already-paragraphed input', () => {
  const already = 'Greeting!\n\nValue here.\n\nCTA now 👉';
  assert.equal(reflowToParagraphs(already), already);
});

test('reflowToParagraphs preserves emoji and {salon_name} token', () => {
  const out = reflowToParagraphs('Hi {salon_name}! Summer is here 🌞. Book now 👉');
  assert.ok(out.includes('{salon_name}'));
  assert.ok(out.includes('🌞'));
  assert.ok(out.includes('👉'));
  assert.match(out, /\n\n/);
});

test('reflowToParagraphs leaves a single sentence (no punctuation) unsplit', () => {
  const out = reflowToParagraphs('Just one line with no terminal punctuation');
  assert.ok(!out.includes('\n\n'));
});
