/**
 * platformCampaignVars — pure token substitution for personalized platform
 * messages (welcome + announcements). No DB, no clock — substitutes {token}
 * placeholders against a vars map built from the tenant + recipient rows the
 * dispatch already loaded under ctx.tenantId.
 *
 * Contract (locked here): known token → value; unknown token → left VERBATIM
 * (a typo must stay visible, never silently blank); known-but-empty → ''.
 * Doubled braces escape: {{ → {, }} → }. Non-string input → ''.
 */

import { describe, it, expect } from 'vitest';
import { renderTemplateVars, buildCampaignVars } from '../src/services/platformCampaignVars.js';

describe('renderTemplateVars', () => {
  const vars = { salon_name: 'Glow', owner_name: 'Anna Petrova', plan: 'pro' };

  it('substitutes a single known token', () => {
    expect(renderTemplateVars('Привет, {salon_name}!', vars)).toBe('Привет, Glow!');
  });

  it('substitutes multiple distinct tokens', () => {
    expect(renderTemplateVars('{salon_name} · {plan}', vars)).toBe('Glow · pro');
  });

  it('substitutes a repeated token everywhere', () => {
    expect(renderTemplateVars('{salon_name}/{salon_name}', vars)).toBe('Glow/Glow');
  });

  it('substitutes adjacent tokens', () => {
    expect(renderTemplateVars('{salon_name}{plan}', vars)).toBe('Glowpro');
  });

  it('leaves an unknown token verbatim (never silently blanks a typo)', () => {
    expect(renderTemplateVars('Hi {unknown_token}', vars)).toBe('Hi {unknown_token}');
  });

  it('renders a known-but-empty token as an empty string', () => {
    expect(renderTemplateVars('[{owner_name}]', { owner_name: '' })).toBe('[]');
  });

  it('coerces non-string var values to strings', () => {
    expect(renderTemplateVars('{n}', { n: 3 })).toBe('3');
  });

  it('de-escapes doubled braces and does NOT substitute the escaped name', () => {
    expect(renderTemplateVars('{{salon_name}}', vars)).toBe('{salon_name}');
  });

  it('ignores uppercase / unsupported token charsets', () => {
    expect(renderTemplateVars('{Salon} {a-b}', vars)).toBe('{Salon} {a-b}');
  });

  it('returns empty string for non-string text', () => {
    expect(renderTemplateVars(null, vars)).toBe('');
    expect(renderTemplateVars(undefined, vars)).toBe('');
    expect(renderTemplateVars(42, vars)).toBe('');
  });

  it('treats null/invalid vars as an empty map (tokens left verbatim)', () => {
    expect(renderTemplateVars('{salon_name}', null)).toBe('{salon_name}');
    expect(renderTemplateVars('{salon_name}', undefined)).toBe('{salon_name}');
  });

  it('leaves text with no tokens untouched', () => {
    expect(renderTemplateVars('plain text', vars)).toBe('plain text');
  });
});

describe('buildCampaignVars', () => {
  it('maps a full tenant + recipient row', () => {
    const v = buildCampaignVars({ name: 'Glow Studio', plan: 'max' }, { name: 'Anna Petrova' });
    expect(v).toEqual({
      salon_name: 'Glow Studio',
      plan: 'max',
      owner_name: 'Anna Petrova',
      first_name: 'Anna',
    });
  });

  it('defaults a missing plan to "start"', () => {
    expect(buildCampaignVars({ name: 'Glow' }, { name: 'Anna' }).plan).toBe('start');
    expect(buildCampaignVars({ name: 'Glow', plan: null }, { name: 'Anna' }).plan).toBe('start');
  });

  it('yields empty owner/first_name when recipient name is null', () => {
    const v = buildCampaignVars({ name: 'Glow', plan: 'pro' }, { name: null });
    expect(v.owner_name).toBe('');
    expect(v.first_name).toBe('');
  });

  it('takes the first whitespace-delimited word as first_name', () => {
    expect(buildCampaignVars({ name: 'Glow' }, { name: '  Anna   Maria  Petrova ' }).first_name).toBe('Anna');
  });

  it('is null-safe for missing rows', () => {
    const v = buildCampaignVars(null, null);
    expect(v).toEqual({ salon_name: '', plan: 'start', owner_name: '', first_name: '' });
  });
});
