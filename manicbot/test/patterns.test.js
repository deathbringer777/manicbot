/**
 * Pattern matcher tests. Phase 2 cleanup merged patterns.test.js and
 * patterns-extended.test.js into one file — every assertion below was
 * present in at least one of the two pre-merge files, with overlapping
 * happy-path cases deduplicated.
 */

import { describe, it, expect } from 'vitest';
import {
  isWantHumanMessage,
  isMyAppointmentsMessage,
  getContextAction,
  isConfirmAllRequestsMessage,
  isAdminCancelAllMessage,
  parseQuickBookingPhrase,
  hasHeavyProfanity,
  parseServiceMention,
  isBookingConfirmDeclineText,
} from '../src/patterns.js';

const SVC_CTX = { svcIds: new Set(['classic', 'gel', 'pedi', 'ext', 'design', 'combo']) };

describe('isWantHumanMessage', () => {
  it('detects human request in Russian', () => {
    expect(isWantHumanMessage('хочу живого человека')).toBe(true);
    expect(isWantHumanMessage('подключите консультанта')).toBe(true);
    expect(isWantHumanMessage('дайте живого менеджера')).toBe(true);
    expect(isWantHumanMessage('хочу живого консультанта')).toBe(true);
    expect(isWantHumanMessage('подключите живого оператора')).toBe(true);
    expect(isWantHumanMessage('поговорить с человеком')).toBe(true);
  });

  it('detects human request in Ukrainian', () => {
    expect(isWantHumanMessage('хочу живого людину')).toBe(true);
    expect(isWantHumanMessage('підключи консультанта')).toBe(true);
    expect(isWantHumanMessage('підключи мене до людини')).toBe(true);
  });

  it('detects human request in English', () => {
    expect(isWantHumanMessage('I want a real person')).toBe(true);
    expect(isWantHumanMessage('connect me to a human')).toBe(true);
    expect(isWantHumanMessage('human please')).toBe(true);
  });

  it('detects human request in Polish', () => {
    expect(isWantHumanMessage('chcę prawdziwego człowieka')).toBe(true);
    expect(isWantHumanMessage('chcę człowieka')).toBe(true);
    expect(isWantHumanMessage('połącz mnie z konsultantem')).toBe(true);
  });

  it('returns false for normal messages', () => {
    expect(isWantHumanMessage('привет')).toBe(false);
    expect(isWantHumanMessage('запишите меня')).toBe(false);
    expect(isWantHumanMessage('запиши на маникюр')).toBe(false);
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
  it('detects main menu', () => {
    expect(getContextAction('главное меню')).toBe('main');
    expect(getContextAction('меню')).toBe('main');
    expect(getContextAction('menu')).toBe('main');
    expect(getContextAction('back')).toBe('main');
  });

  it('detects prices', () => {
    expect(getContextAction('прайс')).toBe('prices');
    expect(getContextAction('ціни')).toBe('prices');
    expect(getContextAction('prices')).toBe('prices');
    expect(getContextAction('cennik')).toBe('prices');
  });

  it('detects catalog', () => {
    expect(getContextAction('каталог')).toBe('catalog');
    expect(getContextAction('portfolio')).toBe('catalog');
  });

  it('detects contacts', () => {
    expect(getContextAction('контакты')).toBe('contacts');
    expect(getContextAction('инстаграм')).toBe('contacts');
    expect(getContextAction('instagram')).toBe('contacts');
  });

  it('returns null for non-matching text', () => {
    expect(getContextAction('hello')).toBeNull();
    expect(getContextAction('привет')).toBeNull();
    expect(getContextAction('')).toBeNull();
    expect(getContextAction('a')).toBeNull();
    expect(getContextAction(null)).toBeNull();
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

  it('returns false for non-matching', () => {
    expect(isConfirmAllRequestsMessage('hello')).toBe(false);
    expect(isConfirmAllRequestsMessage('привет')).toBe(false);
    expect(isConfirmAllRequestsMessage(null)).toBe(false);
  });
});

describe('isAdminCancelAllMessage', () => {
  it('detects Russian cancel all', () => {
    expect(isAdminCancelAllMessage('отмените все брони')).toBe(true);
    expect(isAdminCancelAllMessage('отмените все брони всех клиентов')).toBe(true);
    expect(isAdminCancelAllMessage('отмени все записи')).toBe(true);
  });

  it('detects English cancel all', () => {
    expect(isAdminCancelAllMessage('cancel all bookings')).toBe(true);
    expect(isAdminCancelAllMessage('cancel all appointments')).toBe(true);
  });

  it('returns false for non-matching', () => {
    expect(isAdminCancelAllMessage('hello')).toBe(false);
    expect(isAdminCancelAllMessage('привет')).toBe(false);
    expect(isAdminCancelAllMessage('отмени')).toBe(false); // too short
    expect(isAdminCancelAllMessage(null)).toBe(false);
  });
});

describe('hasHeavyProfanity', () => {
  it('detects heavy profanity (2+ matches)', () => {
    expect(hasHeavyProfanity('бля сука бля')).toBe(true);
  });

  it('returns false for single match', () => {
    expect(hasHeavyProfanity('один бля тут')).toBe(false);
    expect(hasHeavyProfanity('одно плохое слово бля в предложении')).toBe(false);
  });

  it('returns falsy for clean text', () => {
    expect(hasHeavyProfanity('привет мир')).toBeFalsy();
    expect(hasHeavyProfanity('привет, как дела?')).toBeFalsy();
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

  it('returns null for short text', () => {
    expect(parseQuickBookingPhrase('привет')).toBeNull();
  });

  it('returns null when no booking keyword', () => {
    expect(parseQuickBookingPhrase('маникюр завтра в 12')).toBeNull();
  });

  it('parses booking with date hint', () => {
    const result = parseQuickBookingPhrase('запиши меня на маникюр завтра');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('classic');
    expect(result.dateHint).toBeTruthy();
  });

  it('detects pedicure service', () => {
    const result = parseQuickBookingPhrase('запиши на педикюр завтра');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('pedi');
    const result2 = parseQuickBookingPhrase('запиши педикюр завтра в 10');
    expect(result2.svcId).toBe('pedi');
  });

  it('detects gel service', () => {
    const result = parseQuickBookingPhrase('запиши гель-лак завтра в 12');
    expect(result).not.toBeNull();
    expect(result.svcId).toBe('gel');
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

  it('handles "book" in English', () => {
    const result = parseQuickBookingPhrase('book manicure tomorrow at 14');
    expect(result).not.toBeNull();
  });
});

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
});

describe('parseServiceMention — correction without «запиши»', () => {
  it('detects pedicure (RU)', () => {
    expect(parseServiceMention('на педикюр бля', SVC_CTX)).toBe('pedi');
  });
  it('detects gel', () => {
    expect(parseServiceMention('гель-лак', SVC_CTX)).toBe('gel');
  });
  it('returns null without service', () => {
    expect(parseServiceMention('просто текст', SVC_CTX)).toBeNull();
  });
});

describe('isBookingConfirmDeclineText', () => {
  it('matches short declines', () => {
    expect(isBookingConfirmDeclineText('нет')).toBe(true);
    expect(isBookingConfirmDeclineText('no')).toBe(true);
    expect(isBookingConfirmDeclineText('ні')).toBe(true);
  });
  it('rejects long sentences', () => {
    expect(isBookingConfirmDeclineText('нет я имел в виду другое время завтра')).toBe(false);
  });
});
