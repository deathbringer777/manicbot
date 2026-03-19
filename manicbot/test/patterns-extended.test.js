import { describe, it, expect } from 'vitest';
import { parseQuickBookingPhrase, isWantHumanMessage, isMyAppointmentsMessage, getContextAction, isConfirmAllRequestsMessage, isAdminCancelAllMessage, hasHeavyProfanity } from '../src/patterns.js';

describe('parseQuickBookingPhrase — negation handling', () => {
  it('rejects "не запиши" (negation)', () => {
    expect(parseQuickBookingPhrase('не запиши меня завтра на 14')).toBeNull();
  });

  it('rejects "не забронируй" (negation)', () => {
    expect(parseQuickBookingPhrase('не забронируй завтра в 12')).toBeNull();
  });

  it('accepts "запиши" without negation', () => {
    const result = parseQuickBookingPhrase('запиши маникюр завтра на 14');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('classic');
  });

  it('parses gel service', () => {
    const result = parseQuickBookingPhrase('запиши гель-лак завтра в 12');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('gel');
  });

  it('parses pedicure service', () => {
    const result = parseQuickBookingPhrase('запиши педикюр завтра в 10');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('pedi');
  });

  it('defaults to classic when no service specified', () => {
    const result = parseQuickBookingPhrase('запиши завтра на 14');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('classic');
  });

  it('parses "послезавтра"', () => {
    const result = parseQuickBookingPhrase('запиши послезавтра на 10');
    expect(result).not.toBeNull();
    expect(result.dateHint).not.toBeNull();
  });

  it('returns null for short text', () => {
    expect(parseQuickBookingPhrase('привет')).toBeNull();
    expect(parseQuickBookingPhrase('')).toBeNull();
    expect(parseQuickBookingPhrase(null)).toBeNull();
  });

  it('returns null when no booking keyword', () => {
    expect(parseQuickBookingPhrase('маникюр завтра в 12')).toBeNull();
  });

  it('handles "book" in English', () => {
    const result = parseQuickBookingPhrase('book manicure tomorrow at 14');
    expect(result).not.toBeNull();
  });
});

describe('isWantHumanMessage — all languages', () => {
  it('detects Russian requests', () => {
    expect(isWantHumanMessage('хочу живого консультанта')).toBe(true);
    expect(isWantHumanMessage('подключите живого оператора')).toBe(true);
    expect(isWantHumanMessage('поговорить с человеком')).toBe(true);
  });

  it('detects Ukrainian requests', () => {
    expect(isWantHumanMessage('хочу живого консультанта')).toBe(true);
    expect(isWantHumanMessage('підключи мене до людини')).toBe(true);
  });

  it('detects English requests', () => {
    expect(isWantHumanMessage('I want a real person')).toBe(true);
    expect(isWantHumanMessage('connect me to a human')).toBe(true);
    expect(isWantHumanMessage('human please')).toBe(true);
  });

  it('detects Polish requests', () => {
    expect(isWantHumanMessage('chcę człowieka')).toBe(true);
    expect(isWantHumanMessage('połącz mnie z konsultantem')).toBe(true);
  });

  it('returns false for normal messages', () => {
    expect(isWantHumanMessage('привет')).toBe(false);
    expect(isWantHumanMessage('запиши на маникюр')).toBe(false);
    expect(isWantHumanMessage(null)).toBe(false);
    expect(isWantHumanMessage('')).toBe(false);
  });
});

describe('isMyAppointmentsMessage', () => {
  it('detects Russian', () => {
    expect(isMyAppointmentsMessage('мои записи')).toBe(true);
    expect(isMyAppointmentsMessage('покажи записи')).toBe(true);
    expect(isMyAppointmentsMessage('когда я записан')).toBe(true);
  });

  it('detects English', () => {
    expect(isMyAppointmentsMessage('my appointments')).toBe(true);
    expect(isMyAppointmentsMessage('my bookings')).toBe(true);
  });

  it('detects Polish', () => {
    expect(isMyAppointmentsMessage('moje wizyty')).toBe(true);
  });

  it('returns false for unrelated', () => {
    expect(isMyAppointmentsMessage('привет')).toBe(false);
    expect(isMyAppointmentsMessage(null)).toBe(false);
  });
});

describe('getContextAction', () => {
  it('detects main menu', () => {
    expect(getContextAction('главное меню')).toBe('main');
    expect(getContextAction('меню')).toBe('main');
    expect(getContextAction('menu')).toBe('main');
    expect(getContextAction('back')).toBe('main');
  });

  it('detects prices', () => {
    expect(getContextAction('прайс')).toBe('prices');
    expect(getContextAction('prices')).toBe('prices');
    expect(getContextAction('cennik')).toBe('prices');
  });

  it('detects catalog', () => {
    expect(getContextAction('каталог')).toBe('catalog');
    expect(getContextAction('portfolio')).toBe('catalog');
  });

  it('detects contacts', () => {
    expect(getContextAction('контакты')).toBe('contacts');
    expect(getContextAction('instagram')).toBe('contacts');
  });

  it('returns null for unrecognized', () => {
    expect(getContextAction('привет')).toBeNull();
    expect(getContextAction(null)).toBeNull();
    expect(getContextAction('a')).toBeNull();
  });
});

describe('isConfirmAllRequestsMessage', () => {
  it('detects Russian confirm all', () => {
    expect(isConfirmAllRequestsMessage('подтверди все заявки')).toBe(true);
    expect(isConfirmAllRequestsMessage('подтвердите все заявки')).toBe(true);
  });

  it('detects English confirm all', () => {
    expect(isConfirmAllRequestsMessage('confirm all requests')).toBe(true);
    expect(isConfirmAllRequestsMessage('confirm all bookings')).toBe(true);
  });

  it('returns false for unrelated', () => {
    expect(isConfirmAllRequestsMessage('привет')).toBe(false);
    expect(isConfirmAllRequestsMessage(null)).toBe(false);
  });
});

describe('isAdminCancelAllMessage', () => {
  it('detects Russian cancel all', () => {
    expect(isAdminCancelAllMessage('отмените все брони всех клиентов')).toBe(true);
    expect(isAdminCancelAllMessage('отмени все записи')).toBe(true);
  });

  it('detects English cancel all', () => {
    expect(isAdminCancelAllMessage('cancel all bookings')).toBe(true);
    expect(isAdminCancelAllMessage('cancel all appointments')).toBe(true);
  });

  it('returns false for unrelated', () => {
    expect(isAdminCancelAllMessage('привет')).toBe(false);
    expect(isAdminCancelAllMessage('отмени')).toBe(false); // too short
  });
});

describe('hasHeavyProfanity', () => {
  it('returns false for clean text', () => {
    expect(hasHeavyProfanity('привет, как дела?')).toBeFalsy();
    expect(hasHeavyProfanity(null)).toBeFalsy();
    expect(hasHeavyProfanity('')).toBeFalsy();
  });

  it('requires at least 2 profanity matches', () => {
    expect(hasHeavyProfanity('одно плохое слово бля в предложении')).toBe(false);
  });
});
