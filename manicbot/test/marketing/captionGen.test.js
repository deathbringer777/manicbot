import { describe, it, expect, vi } from 'vitest';
import {
  generateCaption,
  buildSystemPrompt,
  buildUserMessage,
  extractText,
  extractWorkersAIText,
  parseJsonOutput,
  validateOutput,
} from '../../src/marketing/captionGen.js';

const BRAND_VOICE_STUB = '# ManicBot brand voice (stub for tests)\nTone: empatyczny.';

const VALID_OUTPUT = {
  headline_pl: 'Tracisz 30% rezerwacji',
  caption_pl:
    'Twój salon zarabia mniej niż mógłby. Klienci piszą wieczorem, Ty odpisujesz rano — i tracisz ich na rzecz konkurencji. ManicBot odpowiada w 2 sekundy, 24/7, w 4 językach. Sprawdź manicbot.com 💅',
  hashtags: [
    '#ManicBot',
    '#paznokciewarszawa',
    '#salonpiekności',
    '#beautytech',
    '#rezerwacjaonline',
    '#warszawabeauty',
    '#manicurewarszawa',
    '#automatyzacja',
    '#salonurody',
    '#biznesbeauty',
  ],
  image_prompt_visual: 'A smartphone showing a chat conversation with an AI assistant',
};

function makeAnthropicResponse(jsonOutput, opts = {}) {
  const text = opts.fenced
    ? '```json\n' + JSON.stringify(jsonOutput) + '\n```'
    : JSON.stringify(jsonOutput);
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'msg_test',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 500, output_tokens: 250 },
    }),
    text: async () => '',
  };
}

function makeErrorResponse(status, body = 'rate limited') {
  return {
    ok: false,
    status,
    json: async () => ({ error: body }),
    text: async () => body,
  };
}

describe('marketing/captionGen — buildSystemPrompt', () => {
  it('includes brand voice content', () => {
    const sys = buildSystemPrompt(BRAND_VOICE_STUB);
    expect(sys).toContain(BRAND_VOICE_STUB);
  });

  it('specifies JSON output schema with all 4 keys', () => {
    const sys = buildSystemPrompt(BRAND_VOICE_STUB);
    expect(sys).toContain('headline_pl');
    expect(sys).toContain('caption_pl');
    expect(sys).toContain('hashtags');
    expect(sys).toContain('image_prompt_visual');
  });

  it('enforces hashtag count range', () => {
    const sys = buildSystemPrompt(BRAND_VOICE_STUB);
    expect(sys).toMatch(/10-15/);
  });
});

describe('marketing/captionGen — buildUserMessage', () => {
  it('formats inspiration slot with theme label', () => {
    const msg = buildUserMessage({
      theme: 'inspiration',
      topic: 'Tracisz 30% rezerwacji',
    });
    expect(msg).toContain('Inspiracja');
    expect(msg).toContain('09:00');
    expect(msg).toContain('Tracisz 30% rezerwacji');
  });

  it('formats product slot', () => {
    const msg = buildUserMessage({ theme: 'product', topic: 'Booksy vs ManicBot' });
    expect(msg).toContain('Funkcja produktu');
    expect(msg).toContain('13:00');
  });

  it('formats social_proof slot', () => {
    const msg = buildUserMessage({ theme: 'social_proof', topic: 'Kejs' });
    expect(msg).toContain('Dowód społeczny');
    expect(msg).toContain('19:00');
  });

  it('includes key_message when provided', () => {
    const msg = buildUserMessage({
      theme: 'inspiration',
      topic: 'X',
      key_message: 'AI odpowiada za 2 sek',
    });
    expect(msg).toContain('AI odpowiada za 2 sek');
  });
});

describe('marketing/captionGen — extractText', () => {
  it('returns text content from first text block', () => {
    expect(
      extractText({ content: [{ type: 'text', text: 'hello' }] }),
    ).toBe('hello');
  });

  it('skips non-text blocks', () => {
    expect(
      extractText({
        content: [
          { type: 'tool_use', input: {} },
          { type: 'text', text: 'the text' },
        ],
      }),
    ).toBe('the text');
  });

  it('returns null on missing content', () => {
    expect(extractText({})).toBeNull();
    expect(extractText(null)).toBeNull();
    expect(extractText({ content: [] })).toBeNull();
  });
});

describe('marketing/captionGen — parseJsonOutput', () => {
  it('parses plain JSON', () => {
    expect(parseJsonOutput('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(parseJsonOutput('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it('strips ``` fences without json tag', () => {
    expect(parseJsonOutput('```\n{"a":3}\n```')).toEqual({ a: 3 });
  });

  it('extracts {} from surrounding prose if needed', () => {
    expect(
      parseJsonOutput('Sure, here is your JSON:\n{"a":4}\nLet me know if you want more.'),
    ).toEqual({ a: 4 });
  });

  it('throws on truly invalid input', () => {
    expect(() => parseJsonOutput('not json at all')).toThrow(/failed to parse/);
  });
});

describe('marketing/captionGen — validateOutput', () => {
  it('accepts valid output', () => {
    expect(() => validateOutput(VALID_OUTPUT)).not.toThrow();
  });

  it('rejects missing fields', () => {
    const o = { ...VALID_OUTPUT };
    delete o.hashtags;
    expect(() => validateOutput(o)).toThrow(/hashtags/);
  });

  it('rejects too-short headline', () => {
    expect(() =>
      validateOutput({ ...VALID_OUTPUT, headline_pl: 'no' }),
    ).toThrow(/headline_pl/);
  });

  it('rejects too-short caption', () => {
    expect(() =>
      validateOutput({ ...VALID_OUTPUT, caption_pl: 'tiny' }),
    ).toThrow(/caption_pl/);
  });

  it('rejects hashtags below 8', () => {
    expect(() =>
      validateOutput({ ...VALID_OUTPUT, hashtags: ['#a', '#b', '#c'] }),
    ).toThrow(/hashtags count/);
  });

  it('rejects hashtags above 30', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`);
    expect(() => validateOutput({ ...VALID_OUTPUT, hashtags: tags })).toThrow(/hashtags count/);
  });

  it('rejects hashtag without # prefix', () => {
    const tags = [...VALID_OUTPUT.hashtags];
    tags[0] = 'noPrefix';
    expect(() => validateOutput({ ...VALID_OUTPUT, hashtags: tags })).toThrow(/invalid hashtag/);
  });

  it('rejects too-short image_prompt_visual', () => {
    expect(() =>
      validateOutput({ ...VALID_OUTPUT, image_prompt_visual: 'no' }),
    ).toThrow(/image_prompt_visual/);
  });

  it('rejects non-object', () => {
    expect(() => validateOutput(null)).toThrow();
    expect(() => validateOutput('string')).toThrow();
  });
});

describe('marketing/captionGen — generateCaption (e2e with fetch mock)', () => {
  it('calls Anthropic API with correct headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeAnthropicResponse(VALID_OUTPUT));
    await generateCaption(
      { ANTHROPIC_API_KEY: 'sk-ant-test' },
      {
        brandVoice: BRAND_VOICE_STUB,
        slot: { theme: 'inspiration', topic: 'X' },
        fetchImpl,
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('sends system + user messages', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeAnthropicResponse(VALID_OUTPUT));
    await generateCaption(
      { ANTHROPIC_API_KEY: 'k' },
      {
        brandVoice: BRAND_VOICE_STUB,
        slot: { theme: 'product', topic: 'Topic' },
        fetchImpl,
      },
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.system).toContain(BRAND_VOICE_STUB);
    expect(body.messages).toEqual([
      { role: 'user', content: expect.stringContaining('Topic') },
    ]);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(1024);
  });

  it('allows model + maxTokens override', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeAnthropicResponse(VALID_OUTPUT));
    await generateCaption(
      { ANTHROPIC_API_KEY: 'k' },
      {
        brandVoice: BRAND_VOICE_STUB,
        slot: { theme: 'inspiration', topic: 'X' },
        model: 'claude-sonnet-4-6',
        maxTokens: 2000,
        fetchImpl,
      },
    );
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(2000);
  });

  it('returns parsed + validated structured output', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeAnthropicResponse(VALID_OUTPUT));
    const result = await generateCaption(
      { ANTHROPIC_API_KEY: 'k' },
      {
        brandVoice: BRAND_VOICE_STUB,
        slot: { theme: 'inspiration', topic: 'X' },
        fetchImpl,
      },
    );
    expect(result).toEqual(VALID_OUTPUT);
  });

  it('handles fenced JSON in model output', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeAnthropicResponse(VALID_OUTPUT, { fenced: true }));
    const result = await generateCaption(
      { ANTHROPIC_API_KEY: 'k' },
      {
        brandVoice: BRAND_VOICE_STUB,
        slot: { theme: 'inspiration', topic: 'X' },
        fetchImpl,
      },
    );
    expect(result.headline_pl).toBe(VALID_OUTPUT.headline_pl);
  });

  it('throws when no caption backend is available (no key, no AI binding)', async () => {
    await expect(
      generateCaption(
        {},
        { brandVoice: BRAND_VOICE_STUB, slot: { theme: 'inspiration', topic: 'X' } },
      ),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('falls back to Workers AI when no ANTHROPIC_API_KEY but env.AI is bound', async () => {
    const run = vi.fn().mockResolvedValue({ response: JSON.stringify(VALID_OUTPUT) });
    const result = await generateCaption(
      { AI: { run } },
      { brandVoice: BRAND_VOICE_STUB, slot: { theme: 'product', topic: 'Topic' } },
    );
    expect(result).toEqual(VALID_OUTPUT);
    expect(run).toHaveBeenCalledTimes(1);
    const [model, input] = run.mock.calls[0];
    expect(model).toContain('@cf/');
    expect(input.messages[0]).toEqual({ role: 'system', content: expect.stringContaining(BRAND_VOICE_STUB) });
    expect(input.messages[1]).toEqual({ role: 'user', content: expect.stringContaining('Topic') });
  });

  it('parses the Workers AI result.response shape', async () => {
    const run = vi.fn().mockResolvedValue({ result: { response: JSON.stringify(VALID_OUTPUT) } });
    const result = await generateCaption(
      { AI: { run } },
      { brandVoice: BRAND_VOICE_STUB, slot: { theme: 'social_proof', topic: 'X' } },
    );
    expect(result).toEqual(VALID_OUTPUT);
  });

  it('prefers Anthropic over Workers AI when both are configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeAnthropicResponse(VALID_OUTPUT));
    const run = vi.fn();
    await generateCaption(
      { ANTHROPIC_API_KEY: 'k', AI: { run } },
      { brandVoice: BRAND_VOICE_STUB, slot: { theme: 'inspiration', topic: 'X' }, fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  describe('extractWorkersAIText (response-shape normalization)', () => {
    const S = JSON.stringify(VALID_OUTPUT);
    it('reads { response } (llama)', () => expect(extractWorkersAIText({ response: S })).toBe(S));
    it('reads { result: { response } }', () => expect(extractWorkersAIText({ result: { response: S } })).toBe(S));
    it('reads OpenAI { choices:[{ message:{ content } }] }', () =>
      expect(extractWorkersAIText({ choices: [{ message: { content: S } }] })).toBe(S));
    it('reads gpt-oss { output:[{ content:[{ text }] }] }, skipping reasoning', () => {
      const out = { output: [
        { type: 'reasoning', content: [] },
        { type: 'message', content: [{ type: 'output_text', text: S }] },
      ] };
      expect(extractWorkersAIText(out)).toBe(S);
    });
    it('reads a bare string', () => expect(extractWorkersAIText(S)).toBe(S));
    it('returns "" on empty / reasoning-only / null', () => {
      expect(extractWorkersAIText({})).toBe('');
      expect(extractWorkersAIText({ response: '' })).toBe('');
      expect(extractWorkersAIText({ output: [{ type: 'reasoning', content: [] }] })).toBe('');
      expect(extractWorkersAIText(null)).toBe('');
    });
  });

  it('throws on unknown theme', async () => {
    await expect(
      generateCaption(
        { ANTHROPIC_API_KEY: 'k' },
        { brandVoice: BRAND_VOICE_STUB, slot: { theme: 'made-up', topic: 'X' } },
      ),
    ).rejects.toThrow(/theme/);
  });

  it('throws when topic missing', async () => {
    await expect(
      generateCaption(
        { ANTHROPIC_API_KEY: 'k' },
        { brandVoice: BRAND_VOICE_STUB, slot: { theme: 'inspiration' } },
      ),
    ).rejects.toThrow(/topic/);
  });

  it('wraps Anthropic HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeErrorResponse(429, 'rate limited'));
    await expect(
      generateCaption(
        { ANTHROPIC_API_KEY: 'k' },
        {
          brandVoice: BRAND_VOICE_STUB,
          slot: { theme: 'inspiration', topic: 'X' },
          fetchImpl,
        },
      ),
    ).rejects.toThrow(/Anthropic returned 429/);
  });

  it('wraps fetch network errors', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(
      generateCaption(
        { ANTHROPIC_API_KEY: 'k' },
        {
          brandVoice: BRAND_VOICE_STUB,
          slot: { theme: 'inspiration', topic: 'X' },
          fetchImpl,
        },
      ),
    ).rejects.toThrow(/fetch failed.*network down/);
  });

  it('throws when validation fails (e.g. too few hashtags)', async () => {
    const bad = { ...VALID_OUTPUT, hashtags: ['#a'] };
    const fetchImpl = vi.fn().mockResolvedValue(makeAnthropicResponse(bad));
    await expect(
      generateCaption(
        { ANTHROPIC_API_KEY: 'k' },
        {
          brandVoice: BRAND_VOICE_STUB,
          slot: { theme: 'inspiration', topic: 'X' },
          fetchImpl,
        },
      ),
    ).rejects.toThrow(/hashtags count/);
  });
});
