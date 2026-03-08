import { describe, it, expect } from 'vitest';
import {
  isWantHumanMessage,
  isMyAppointmentsMessage,
  getContextAction,
  isConfirmAllRequestsMessage,
  isAdminCancelAllMessage,
  parseQuickBookingPhrase,
  hasHeavyProfanity,
} from '../src/patterns.js';

describe('isWantHumanMessage', () => {
  it('detects human request in Russian', () => {
    expect(isWantHumanMessage('хочу живого человека')).toBe(true);
    expect(isWantHumanMessage('подключите консультанта')).toBe(true);
    expect(isWantHumanMessage('дайте живого менеджера')).toBe(true);
  });

  it('detects human request in English', () => {
    expect(isWantHumanMessage('I want a real person')).toBe(true);
    expect(isWantHumanMessage('connect me to a human')).toBe(true);
    expect(isWantHumanMessage('human please')).toBe(true);
  });

  it('detects human request in Ukrainian', () => {
    expect(isWantHumanMessage('хочу живого людину')).toBe(true);
    expect(isWantHumanMessage('підключи консультанта')).toBe(true);
  });

  it('detects human request in Polish', () => {
    expect(isWantHumanMessage('chcę prawdziwego człowieka')).toBe(true);
  });

  it('returns false for normal messages', () => {
    expect(isWantHumanMessage('привет')).toBe(false);
    expect(isWantHumanMessage('запишите меня')).toBe(false);
    expect(isWantHumanMessage('')).toBe(false);
    expect(isWantHumanMessage(null)).toBe(false);
  });
});

describe('isMyAppointmentsMessage', () => {
  it('detects appointment queries in Russian', () => {
    expect(isMyAppointmentsMessage('мои записи')).toBe(true);
    expect(isMyAppointmentsMessage('покажи записи')).toBe(true);
    expect(isMyAppointmentsMessage('когда я записан')).toBe(true);
  });

  it('detects in English', () => {
    expect(isMyAppointmentsMessage('my appointments')).toBe(true);
    expect(isMyAppointmentsMessage('my bookings')).toBe(true);
  });

  it('detects in Polish', () => {
    expect(isMyAppointmentsMessage('moje wizyty')).toBe(true);
  });

  it('returns false for unrelated messages', () => {
    expect(isMyAppointmentsMessage('привет')).toBe(false);
    expect(isMyAppointmentsMessage('')).toBe(false);
    expect(isMyAppointmentsMessage(null)).toBe(false);
  });
});

describe('getContextAction', () => {
  it('detects prices', () => {
    expect(getContextAction('прайс')).toBe('prices');
    expect(getContextAction('ціни')).toBe('prices');
    expect(getContextAction('prices')).toBe('prices');
  });

  it('detects catalog', () => {
    expect(getContextAction('каталог')).toBe('catalog');
    expect(getContextAction('portfolio')).toBe('catalog');
  });

  it('detects contacts', () => {
    expect(getContextAction('контакты')).toBe('contacts');
    expect(getContextAction('инстаграм')).toBe('contacts');
  });

  it('returns null for non-matching text', () => {
    expect(getContextAction('hello')).toBeNull();
    expect(getContextAction('')).toBeNull();
    expect(getContextAction(null)).toBeNull();
  });
});

describe('isConfirmAllRequestsMessage', () => {
  it('detects confirm all patterns', () => {
    expect(isConfirmAllRequestsMessage('подтверди все заявки')).toBe(true);
    expect(isConfirmAllRequestsMessage('confirm all requests')).toBe(true);
  });

  it('returns false for non-matching', () => {
    expect(isConfirmAllRequestsMessage('hello')).toBe(false);
    expect(isConfirmAllRequestsMessage(null)).toBe(false);
  });
});

describe('isAdminCancelAllMessage', () => {
  it('detects admin cancel all patterns', () => {
    expect(isAdminCancelAllMessage('отмените все брони')).toBe(true);
    expect(isAdminCancelAllMessage('cancel all bookings')).toBe(true);
  });

  it('returns false for non-matching', () => {
    expect(isAdminCancelAllMessage('hello')).toBe(false);
    expect(isAdminCancelAllMessage(null)).toBe(false);
  });
});

describe('hasHeavyProfanity', () => {
  it('detects heavy profanity (2+ matches)', () => {
    expect(hasHeavyProfanity('бля сука бля')).toBe(true);
  });

  it('returns false for single match', () => {
    expect(hasHeavyProfanity('один бля тут')).toBe(false);
  });

  it('returns falsy for clean text', () => {
    expect(hasHeavyProfanity('привет мир')).toBeFalsy();
    expect(hasHeavyProfanity('')).toBeFalsy();
    expect(hasHeavyProfanity(null)).toBeFalsy();
  });
});

describe('parseQuickBookingPhrase', () => {
  it('returns null for non-booking phrases', () => {
    expect(parseQuickBookingPhrase('привет')).toBeNull();
    expect(parseQuickBookingPhrase('hello world')).toBeNull();
    expect(parseQuickBookingPhrase(null)).toBeNull();
    expect(parseQuickBookingPhrase('')).toBeNull();
  });

  it('parses booking with date hint', () => {
    const result = parseQuickBookingPhrase('запиши меня на маникюр завтра');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('classic');
    expect(result.dateHint).toBeTruthy();
  });

  it('detects service type', () => {
    const result = parseQuickBookingPhrase('запиши на педикюр завтра');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('pedi');
  });
});
