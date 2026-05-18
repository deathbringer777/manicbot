/**
 * services/notificationPrefs.js — Worker-side mirror of the admin-app
 * lib/notifications/prefs.ts module. Defaults + parse + shouldDeliver
 * must stay in lockstep with the TS version so admin-app and Worker
 * writers reach the same decision for the same blob.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREFS,
  NOTIFICATION_CATEGORIES,
  categoryForKind,
  parsePrefs,
  shouldDeliver,
} from '../src/services/notificationPrefs.js';

describe('Worker notificationPrefs.js mirror', () => {
  it('exposes the same category list as the admin-app module', () => {
    expect(NOTIFICATION_CATEGORIES).toEqual([
      'appointment',
      'support',
      'birthday',
      'platform',
      'master',
      'reminder',
      'messenger',
      'billing',
      'marketing',
    ]);
  });

  it('DEFAULT_PREFS shape matches the admin-app defaults', () => {
    expect(DEFAULT_PREFS.categories.appointment).toEqual({ inapp: true, push: true });
    expect(DEFAULT_PREFS.categories.marketing).toEqual({ inapp: true, push: false });
    expect(DEFAULT_PREFS.categories.birthday).toEqual({ inapp: true, push: false });
  });

  it('categoryForKind handles the documented prefixes', () => {
    expect(categoryForKind('appointment.created')).toBe('appointment');
    expect(categoryForKind('thread.message.new')).toBe('messenger');
    expect(categoryForKind('totally.unknown')).toBeNull();
    expect(categoryForKind(null)).toBeNull();
    expect(categoryForKind('')).toBeNull();
  });

  it('parsePrefs handles malformed input gracefully', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{}')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('[]')).toEqual(DEFAULT_PREFS);
  });

  it('parsePrefs merges partial blobs with defaults', () => {
    const blob = JSON.stringify({
      categories: { marketing: { inapp: false, push: false } },
    });
    const prefs = parsePrefs(blob);
    expect(prefs.categories.marketing).toEqual({ inapp: false, push: false });
    expect(prefs.categories.appointment).toEqual(DEFAULT_PREFS.categories.appointment);
  });

  it('shouldDeliver respects per-channel opt-outs', () => {
    const prefs = parsePrefs(JSON.stringify({
      categories: { support: { inapp: false, push: false } },
    }));
    expect(shouldDeliver('support.reply', prefs, 'inapp')).toBe(false);
    expect(shouldDeliver('support.reply', prefs, 'push')).toBe(false);
    // Other categories unaffected.
    expect(shouldDeliver('appointment.created', prefs, 'inapp')).toBe(true);
  });

  it('shouldDeliver always returns true for unknown kinds', () => {
    expect(shouldDeliver('unknown.event', DEFAULT_PREFS, 'inapp')).toBe(true);
    expect(shouldDeliver('unknown.event', DEFAULT_PREFS, 'push')).toBe(true);
  });
});
