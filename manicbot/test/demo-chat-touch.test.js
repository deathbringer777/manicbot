/**
 * Touch/mobile polish guards for the embedded chat widget. Pattern, not
 * pixel — pins the source so the iOS focus-zoom + tap-target fixes can't
 * silently regress. The widget ships as an inlined string (DEMO_CHAT_SRC),
 * so we assert against that string exactly like demo-chat-button-wrap.test.js.
 */
import { describe, it, expect } from 'vitest';
import { DEMO_CHAT_SRC } from '../src/embed/demoChat.js';

describe('demoChat — touch / mobile polish', () => {
  it('lifts the composer input to 16px on touch so iOS does not auto-zoom on focus', () => {
    expect(DEMO_CHAT_SRC).toContain('@media (hover:none){.mb-composer input{font-size:16px}');
  });

  it('enlarges the send button to a 44px tap target on touch', () => {
    expect(DEMO_CHAT_SRC).toContain('.mb-composer button{width:44px;height:44px}');
  });

  it('keeps the compact 11.5px / 32px look as the desktop default (touch is an override)', () => {
    // Base rules stay small; the 16px / 44px only live inside @media (hover:none).
    expect(DEMO_CHAT_SRC).toContain('font-size:11.5px');
    expect(DEMO_CHAT_SRC).toContain('width:32px;height:32px');
  });

  it('sets touch-action:manipulation to drop the ~300ms tap delay on controls', () => {
    expect(DEMO_CHAT_SRC).toContain('touch-action:manipulation');
  });
});
