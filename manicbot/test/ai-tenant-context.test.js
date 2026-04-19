import { describe, it, expect } from 'vitest';
import { buildAISystemPrompt, parseAIActions, AI_ACTION_RE } from '../src/ai.js';

describe('buildAISystemPrompt — tenant-aware', () => {
  it('uses default salon info when no tenantCtx', () => {
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-19');
    expect(prompt).toContain('ManicBot');
    expect(prompt).toContain('Marszałkowska');
  });

  it('uses tenant salon name when provided', () => {
    const ctx = { salonName: 'Crystal Nails', address: 'ul. Nowy Świat 15' };
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-19', ctx);
    expect(prompt).toContain('Crystal Nails');
    expect(prompt).toContain('Nowy Świat');
    expect(prompt).not.toContain('ManicBot 💅');
  });

  it('includes tenant services in prompt', () => {
    const ctx = {
      salonName: 'Test Salon',
      services: [
        { id: 'classic', name: 'Классический маникюр' },
        { id: 'pedi', name: 'Педикюр' },
      ],
    };
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-19', ctx);
    expect(prompt).toContain('classic (Классический маникюр)');
    expect(prompt).toContain('pedi (Педикюр)');
  });

  it('includes tenant masters in prompt', () => {
    const ctx = {
      salonName: 'Test Salon',
      masters: [
        { name: 'Кирилл', chatId: 111 },
        { name: 'Виктория', chatId: 222 },
      ],
    };
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-19', ctx);
    expect(prompt).toContain('МАСТЕРА САЛОНА');
    expect(prompt).toContain('Кирилл');
    expect(prompt).toContain('Виктория');
  });

  it('does not include masters section when no masters', () => {
    const ctx = { salonName: 'Test Salon', masters: null };
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-19', ctx);
    expect(prompt).not.toContain('МАСТЕРА САЛОНА');
  });

  it('includes tenant phone and hours', () => {
    const ctx = {
      salonName: 'Velvet Touch',
      phone: '+48 22 200 20 02',
      hoursStr: '10:00 — 21:00',
    };
    const prompt = buildAISystemPrompt('client', 'русском', '2026-03-19', ctx);
    expect(prompt).toContain('+48 22 200 20 02');
    expect(prompt).toContain('10:00 — 21:00');
  });

  it('admin prompt includes admin-specific actions', () => {
    const prompt = buildAISystemPrompt('tenant_owner', 'русском', '2026-03-19');
    expect(prompt).toContain('ADM_PANEL');
    expect(prompt).toContain('ADM_TODAY');
  });

  it('master prompt includes master-specific actions', () => {
    const prompt = buildAISystemPrompt('master', 'русском', '2026-03-19');
    expect(prompt).toContain('MST_PANEL');
    expect(prompt).toContain('MST_TODAY');
  });

  it('system_admin prompt includes platform actions', () => {
    const prompt = buildAISystemPrompt('system_admin', 'русском', '2026-03-19');
    expect(prompt).toContain('SYSADM_PANEL');
    expect(prompt).toContain('TENANT_LIST');
  });
});

describe('parseAIActions', () => {
  it('extracts simple tag', () => {
    const { text, actions } = parseAIActions('Вот ваши записи [MY_APTS]');
    expect(actions).toEqual([{ tag: 'MY_APTS', param: '' }]);
    expect(text).toBe('Вот ваши записи');
  });

  it('extracts tag with params', () => {
    const { text, actions } = parseAIActions('Записываю вас [BOOK:classic:2026-03-20:14:00]');
    expect(actions).toEqual([{ tag: 'BOOK', param: 'classic:2026-03-20:14:00' }]);
  });

  it('extracts multiple tags', () => {
    const { actions } = parseAIActions('[MY_APTS] и [PRICES]');
    expect(actions.length).toBe(2);
    expect(actions[0].tag).toBe('MY_APTS');
    expect(actions[1].tag).toBe('PRICES');
  });

  it('returns empty actions for no tags', () => {
    const { text, actions } = parseAIActions('Привет! Как дела?');
    expect(actions).toEqual([]);
    expect(text).toBe('Привет! Как дела?');
  });

  it('handles null input', () => {
    const { text, actions } = parseAIActions(null);
    expect(text).toBe('');
    expect(actions).toEqual([]);
  });

  it('handles CONSULT tag', () => {
    const { actions } = parseAIActions('Понимаю, вас беспокоит качество. [CONSULT]');
    expect(actions).toEqual([{ tag: 'CONSULT', param: '' }]);
  });

  it('handles CANCEL_ALL tag', () => {
    const { actions } = parseAIActions('[CANCEL_ALL]');
    expect(actions).toEqual([{ tag: 'CANCEL_ALL', param: '' }]);
  });

  it('handles ADM_PANEL tag for admin', () => {
    const { actions } = parseAIActions('[ADM_PANEL]');
    expect(actions).toEqual([{ tag: 'ADM_PANEL', param: '' }]);
  });
});

describe('AI_ACTION_RE regex', () => {
  it('matches simple tags', () => {
    expect('[MY_APTS]'.match(AI_ACTION_RE)).toBeTruthy();
  });

  it('matches tags with params', () => {
    const match = '[BOOK:classic:tomorrow:14:00]'.match(AI_ACTION_RE);
    expect(match).toBeTruthy();
  });

  it('does not match malformed tags', () => {
    expect('[my_apts'.match(AI_ACTION_RE)).toBeNull();
    expect('MY_APTS]'.match(AI_ACTION_RE)).toBeNull();
  });
});
