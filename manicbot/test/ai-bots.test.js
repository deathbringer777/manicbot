import { describe, it, expect } from 'vitest';
import { AI_BOTS, isAiBot, robotsAiBots } from '../src/utils/aiBots.js';

describe('aiBots', () => {
  describe('isAiBot', () => {
    it('returns null for human / non-AI user agents', () => {
      expect(isAiBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1')).toBeNull();
      // Classic search crawlers are NOT AI bots (Googlebot powers AI Overviews
      // but is far too noisy to count as an AI-search signal).
      expect(isAiBot('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBeNull();
      expect(isAiBot('Bingbot/2.0 (+http://www.bing.com/bingbot.htm)')).toBeNull();
      expect(isAiBot('')).toBeNull();
      expect(isAiBot(null)).toBeNull();
      expect(isAiBot(undefined)).toBeNull();
    });

    it('matches training crawlers', () => {
      expect(isAiBot('GPTBot/1.2 (+https://openai.com/gptbot)')).toBe('GPTBot');
      expect(isAiBot('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toBe('ClaudeBot');
      expect(isAiBot('CCBot/2.0 (https://commoncrawl.org/faq/)')).toBe('CCBot');
    });

    it('matches citation / live-retrieval bots', () => {
      expect(isAiBot('OAI-SearchBot/1.0 (+https://openai.com/searchbot)')).toBe('OAI-SearchBot');
      expect(isAiBot('Mozilla/5.0 AppleWebKit ChatGPT-User/1.0')).toBe('ChatGPT-User');
      expect(isAiBot('Claude-SearchBot/1.0 (+https://www.anthropic.com)')).toBe('Claude-SearchBot');
      expect(isAiBot('Claude-User/1.0')).toBe('Claude-User');
    });

    // The single most important distinction for analytics: the periodic
    // crawler vs the live per-query fetch must not collapse into one label.
    it('distinguishes PerplexityBot (crawler) from Perplexity-User (live fetch)', () => {
      expect(isAiBot('PerplexityBot/1.0 (+https://perplexity.ai/perplexitybot)')).toBe('PerplexityBot');
      expect(isAiBot('Mozilla/5.0 Perplexity-User/1.0 (+https://perplexity.ai)')).toBe('Perplexity-User');
    });

    // Likewise ClaudeBot (training) must not shadow Claude-SearchBot/Claude-User.
    it('distinguishes ClaudeBot from Claude-SearchBot / Claude-User', () => {
      expect(isAiBot('ClaudeBot/1.0')).toBe('ClaudeBot');
      expect(isAiBot('Claude-SearchBot/1.0')).toBe('Claude-SearchBot');
      expect(isAiBot('Claude-User/1.0')).toBe('Claude-User');
    });

    it('is case-insensitive', () => {
      expect(isAiBot('gptbot/1.0')).toBe('GPTBot');
      expect(isAiBot('PERPLEXITYBOT/1.0')).toBe('PerplexityBot');
    });
  });

  describe('robotsAiBots', () => {
    it('includes the major answer-engine bots (training + citation)', () => {
      const names = robotsAiBots().map((b) => b.name);
      // training
      expect(names).toContain('GPTBot');
      expect(names).toContain('ClaudeBot');
      expect(names).toContain('Google-Extended');
      expect(names).toContain('PerplexityBot');
      expect(names).toContain('CCBot');
      // citation (the new ones added 2026-06)
      expect(names).toContain('OAI-SearchBot');
      expect(names).toContain('ChatGPT-User');
      expect(names).toContain('Claude-SearchBot');
      expect(names).toContain('Claude-User');
      expect(names).toContain('Perplexity-User');
    });

    it('only returns bots flagged robots:true', () => {
      for (const b of robotsAiBots()) expect(b.robots).toBe(true);
    });
  });

  describe('AI_BOTS registry shape', () => {
    it('every entry has name, lowercase ua, valid kind, boolean robots flag', () => {
      for (const b of AI_BOTS) {
        expect(typeof b.name).toBe('string');
        expect(b.name.length).toBeGreaterThan(0);
        expect(b.ua).toBe(b.ua.toLowerCase());
        expect(['training', 'citation']).toContain(b.kind);
        expect(typeof b.robots).toBe('boolean');
      }
    });

    it('has no duplicate ua substrings', () => {
      const uas = AI_BOTS.map((b) => b.ua);
      expect(new Set(uas).size).toBe(uas.length);
    });
  });
});
