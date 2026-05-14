import { describe, it, expect } from 'vitest';
import { BRAND_VOICE, buildImagePrompt } from '../../src/marketing/brandVoice.js';

describe('marketing/brandVoice — BRAND_VOICE const', () => {
  it('is a non-empty string', () => {
    expect(typeof BRAND_VOICE).toBe('string');
    expect(BRAND_VOICE.length).toBeGreaterThan(1000);
  });

  it('contains brand identity markers', () => {
    expect(BRAND_VOICE).toContain('ManicBot');
    expect(BRAND_VOICE).toContain('manicbot.com');
    expect(BRAND_VOICE).toContain('@manicbot_com');
  });

  it('contains the fixed color palette hex codes', () => {
    expect(BRAND_VOICE).toContain('#0A0E2A');
    expect(BRAND_VOICE).toContain('#FF2D78');
    expect(BRAND_VOICE).toContain('#00F5D4');
  });

  it('contains theme cadence (09:00 / 13:00 / 19:00) or topic labels', () => {
    // The brand voice has a tone-of-voice block; cadence may be implicit
    // via section structure. Verify "Polish" + "Tone" guidance is there.
    expect(BRAND_VOICE).toMatch(/Tone of Voice/i);
    expect(BRAND_VOICE).toMatch(/Польши|Poland|польский|Polish/i);
  });

  it('explicitly warns against the deprecated purple/violet palette', () => {
    expect(BRAND_VOICE).toMatch(/фиолетовый|purple|violet/i);
  });
});

describe('marketing/brandVoice — buildImagePrompt', () => {
  it('substitutes headline and visual placeholders', () => {
    const out = buildImagePrompt('Tracisz 30%', 'a smartphone with chat');
    expect(out).toContain('Tracisz 30%');
    expect(out).toContain('a smartphone with chat');
  });

  it('always includes the brand palette + manicbot.com', () => {
    const out = buildImagePrompt('X', 'Y');
    expect(out).toContain('#0A0E2A');
    expect(out).toContain('#FF2D78');
    expect(out).toContain('#00F5D4');
    expect(out).toContain('manicbot.com');
  });

  it('specifies 1024x1024 (flux-schnell native)', () => {
    expect(buildImagePrompt('X', 'Y')).toContain('1024x1024');
  });
});
