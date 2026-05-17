/**
 * Regression — /plugins must be proxied to admin-app.
 */

import { describe, it, expect } from 'vitest';
import { isAdminAppPath } from '../src/http/adminAppProxy.js';

describe('isAdminAppPath — /plugins', () => {
  it('forwards /plugins to admin-app', () => {
    expect(isAdminAppPath('/plugins')).toBe(true);
  });

  it('forwards /plugins/sms-reminders to admin-app', () => {
    expect(isAdminAppPath('/plugins/sms-reminders')).toBe(true);
  });

  it('forwards /plugins/sms-reminders/anything', () => {
    expect(isAdminAppPath('/plugins/sms-reminders/settings')).toBe(true);
  });

  it('does not collide with unrelated paths', () => {
    expect(isAdminAppPath('/plug')).toBe(false);
    expect(isAdminAppPath('/plugins-other')).toBe(false);
  });

  it('forwards /plugin/:slug (singular runtime-open route) to admin-app', () => {
    expect(isAdminAppPath('/plugin/task-board')).toBe(true);
    expect(isAdminAppPath('/plugin/no-show-shield')).toBe(true);
  });

  it('does not collide with unrelated singular paths', () => {
    expect(isAdminAppPath('/plugin-store')).toBe(false);
  });
});
