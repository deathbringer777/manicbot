import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAIActions, parseAIResponse, buildAISystemPrompt } from '../src/ai.js';

// ── parseAIResponse ────────────────────────────────────────────────────────
describe('parseAIResponse', () => {
  it('handles null/undefined', () => {
    expect(parseAIResponse(null)).toBeNull();
    expect(parseAIResponse(undefined)).toBeNull();
  });
  it('handles plain string', () => {
    expect(parseAIResponse('hello')).toBe('hello');
    expect(parseAIResponse('  hello  ')).toBe('hello');
    expect(parseAIResponse('')).toBeNull();
  });
  it('handles object with .response', () => {
    expect(parseAIResponse({ response: 'world' })).toBe('world');
  });
  it('handles object with nested result.response', () => {
    expect(parseAIResponse({ result: { response: 'nested' } })).toBe('nested');
  });
  it('handles OpenAI-style choices array', () => {
    expect(parseAIResponse({ choices: [{ message: { content: 'choice' } }] })).toBe('choice');
  });
  it('handles .output', () => {
    expect(parseAIResponse({ output: 'out' })).toBe('out');
  });
});

// ── parseAIActions ─────────────────────────────────────────────────────────
describe('parseAIActions', () => {
  it('returns empty arrays for null input', () => {
    const r = parseAIActions(null);
    expect(r.actions).toHaveLength(0);
    expect(r.text).toBe('');
  });

  it('extracts single tag', () => {
    const r = parseAIActions('Please [MY_APTS] check');
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].tag).toBe('MY_APTS');
    expect(r.actions[0].param).toBe('');
    expect(r.text).toBe('Please  check');
  });

  it('extracts tag with param', () => {
    const r = parseAIActions('Book now [BOOK:classic:2026-03-25:14:00]');
    expect(r.actions[0].tag).toBe('BOOK');
    expect(r.actions[0].param).toBe('classic:2026-03-25:14:00');
  });

  it('extracts multiple tags', () => {
    const r = parseAIActions('See [PRICES] and [CATALOG]');
    expect(r.actions).toHaveLength(2);
    expect(r.actions.map(a => a.tag)).toEqual(['PRICES', 'CATALOG']);
  });

  it('uppercases tag names', () => {
    const r = parseAIActions('[my_apts]');
    expect(r.actions[0].tag).toBe('MY_APTS');
  });

  it('extracts CONSULT tag', () => {
    const r = parseAIActions('Sorry to hear that [CONSULT]');
    expect(r.actions[0].tag).toBe('CONSULT');
  });

  it('extracts new action tags', () => {
    const tags = ['REVIEWS', 'ABOUT', 'ADM_CLIENTS', 'ADM_ALL_APTS', 'ADM_SVC_LIST', 'BILLING', 'MST_CALENDAR'];
    for (const tag of tags) {
      const r = parseAIActions(`[${tag}]`);
      expect(r.actions[0].tag).toBe(tag);
    }
  });

  it('handles BOOK with correction service', () => {
    const r = parseAIActions('[BOOK:correction:2026-03-25:10:00]');
    expect(r.actions[0].tag).toBe('BOOK');
    expect(r.actions[0].param).toContain('correction');
  });

  it('removes all tags from text', () => {
    const r = parseAIActions('[MY_APTS][PRICES]');
    expect(r.text.trim()).toBe('');
  });

  it('collapses multiple blank lines to double newline', () => {
    const r = parseAIActions('line1\n\n\n\nline2');
    expect(r.text).toBe('line1\n\nline2');
  });
});

// ── buildAISystemPrompt ────────────────────────────────────────────────────
describe('buildAISystemPrompt', () => {
  it('returns string for all roles', () => {
    for (const role of ['client', 'admin', 'master', 'system_admin', 'support']) {
      const prompt = buildAISystemPrompt(role, 'English', '2026-03-22');
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(200);
    }
  });

  it('client prompt contains client action tags', () => {
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-22');
    expect(prompt).toContain('[MY_APTS]');
    expect(prompt).toContain('[PRICES]');
    expect(prompt).toContain('[CATALOG]');
    expect(prompt).toContain('[CANCEL_ALL]');
    expect(prompt).toContain('[CONSULT]');
    expect(prompt).toContain('[REVIEWS]');
    expect(prompt).toContain('[ABOUT]');
  });

  it('admin prompt contains admin-specific tags', () => {
    const prompt = buildAISystemPrompt('admin', 'русском', '2026-03-22');
    expect(prompt).toContain('[ADM_PANEL]');
    expect(prompt).toContain('[ADM_TODAY]');
    expect(prompt).toContain('[ADM_TOMORROW]');
    expect(prompt).toContain('[ADM_ALL_APTS]');
    expect(prompt).toContain('[ADM_MASTERS]');
    expect(prompt).toContain('[ADM_CLIENTS]');
    expect(prompt).toContain('[ADM_SVC_LIST]');
    expect(prompt).toContain('[BILLING]');
    expect(prompt).toContain('[REVIEWS]');
    expect(prompt).toContain('[ABOUT]');
  });

  it('master prompt contains master-specific tags', () => {
    const prompt = buildAISystemPrompt('master', 'русском', '2026-03-22');
    expect(prompt).toContain('[MST_PANEL]');
    expect(prompt).toContain('[MST_TODAY]');
    expect(prompt).toContain('[MST_TOMORROW]');
    expect(prompt).toContain('[MST_CALENDAR]');
    expect(prompt).toContain('[REVIEWS]');
    expect(prompt).toContain('[ABOUT]');
  });

  it('system_admin prompt contains sysadmin tags + all admin tags', () => {
    const prompt = buildAISystemPrompt('system_admin', 'русском', '2026-03-22');
    expect(prompt).toContain('[SYSADM_PANEL]');
    expect(prompt).toContain('[TENANT_LIST]');
    expect(prompt).toContain('[SUPPORT_LIST]');
    expect(prompt).toContain('[CREATE_TENANT]');
    expect(prompt).toContain('[BOT_NEW]');
    expect(prompt).toContain('[ADM_ALL_APTS]');
    expect(prompt).toContain('[ADM_CLIENTS]');
    expect(prompt).toContain('[ADM_SVC_LIST]');
    expect(prompt).toContain('[BILLING]');
    expect(prompt).toContain('[REVIEWS]');
    expect(prompt).toContain('[ABOUT]');
  });

  it('client prompt does NOT contain admin-only tags', () => {
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-22');
    expect(prompt).not.toContain('[ADM_PANEL]');
    expect(prompt).not.toContain('[ADM_CLIENTS]');
    expect(prompt).not.toContain('[ADM_SVC_LIST]');
    expect(prompt).not.toContain('[BILLING]');
    expect(prompt).not.toContain('[MST_CALENDAR]');
  });

  it('system_admin prompt allows admitting AI identity', () => {
    const prompt = buildAISystemPrompt('system_admin', 'русском', '2026-03-22');
    // Should NOT contain the identity restriction
    expect(prompt).not.toContain('КРИТИЧНО — ИДЕНТИЧНОСТЬ');
    // Should contain AI assistant reference
    expect(prompt).toContain('ИИ');
  });

  it('includes today date in prompt', () => {
    const prompt = buildAISystemPrompt('client', 'русском', '2026-05-15');
    expect(prompt).toContain('2026-05-15');
  });

  it('appends booking-adjust hint when slot preserved after declining confirmation', () => {
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-22', null, { date: '2026-03-25', time: '13:00' });
    expect(prompt).toContain('КОРРЕКТИРОВКИ');
    expect(prompt).toContain('2026-03-25');
    expect(prompt).toContain('13:00');
  });

  it('includes tenant context when provided', () => {
    const tenantCtx = {
      salonName: 'TestSalon',
      address: 'Test Street 1',
      phone: '+48 000 000 000',
      hoursStr: '10:00 — 20:00',
      services: [{ id: 'gel', name: 'Gel Polish' }],
      masters: [{ name: 'Anna', chatId: '123' }],
    };
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-22', tenantCtx);
    expect(prompt).toContain('TestSalon');
    expect(prompt).toContain('Test Street 1');
    expect(prompt).toContain('Gel Polish');
    expect(prompt).toContain('Anna');
  });
});

// ── pageActions completeness ───────────────────────────────────────────────
describe('message.js pageActions', () => {
  it('contains all required action tags (verified via source)', async () => {
    // We test the actual source file contains the right pageActions
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/handlers/message.js'),
      'utf-8'
    );
    const requiredTags = [
      'MY_APTS', 'PRICES', 'CATALOG', 'CONTACTS', 'REVIEWS', 'ABOUT', 'MAIN', 'BOOK', 'CANCEL_ALL',
      'ADM_PANEL', 'ADM_TODAY', 'ADM_TOMORROW', 'ADM_ALL_APTS', 'ADM_MASTERS', 'ADM_CLIENTS',
      'ADM_SVC_LIST', 'BILLING', 'MST_PANEL', 'MST_TODAY', 'MST_TOMORROW', 'MST_CALENDAR',
      'SYSADM_PANEL', 'TENANT_LIST', 'SUPPORT_LIST', 'CREATE_TENANT', 'BOT_NEW',
    ];
    for (const tag of requiredTags) {
      expect(src, `pageActions should contain ${tag}`).toContain(`'${tag}'`);
    }
  });
});
