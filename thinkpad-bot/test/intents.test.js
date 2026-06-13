// intents.js — fast rule-based layer that runs before the LLM. classify() is
// pure, so we can pin exactly which phrasings snap the local screen vs. fall
// through to the LLM/vision path. The regression these tests guard: the bare
// word «скриншот» used to fire a screenshot for ANY sentence mentioning it, so
// "проанализируй эти скриншоты" snapped the bot's own (black) screen instead of
// routing the request to the model.

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { setTestEnv } = require("./helpers/mock.js");

// intents.js transitively loads config.js (via keyboards/tools), which throws
// without the required env — set the test env before requiring it.
setTestEnv();
const { classify } = require("../intents.js");

describe("intents.classify — screenshot vs. talking about screenshots", () => {
  it("fires on a bare screenshot request", () => {
    assert.strictEqual(classify("скрин")?.kind, "screenshot");
    assert.strictEqual(classify("сделай скриншот")?.kind, "screenshot");
    assert.strictEqual(classify("скинь скрин")?.kind, "screenshot");
    assert.strictEqual(classify("screenshot")?.kind, "screenshot");
  });

  it("fires on the explicit screen phrases", () => {
    assert.strictEqual(classify("что на экране")?.kind, "screenshot");
    assert.strictEqual(classify("покажи экран")?.kind, "screenshot");
  });

  it("does NOT fire when the owner talks ABOUT screenshots", () => {
    assert.strictEqual(
      classify("проанализируй все скриншоты тут почему нет сгенерированных шаблонов"),
      null,
    );
    assert.strictEqual(classify("на этих скриншотах видно ошибку, разберись"), null);
  });

  it("still routes music / volume intents", () => {
    assert.strictEqual(classify("включи lofi")?.kind, "music_play");
    assert.strictEqual(classify("что играет")?.kind, "now_playing");
    assert.strictEqual(classify("громкость 40")?.kind, "volume_set");
    assert.strictEqual(classify("выключи музыку")?.kind, "music_stop");
  });

  it("returns null for ordinary free text", () => {
    assert.strictEqual(classify("привет, как дела"), null);
    assert.strictEqual(classify(""), null);
  });
});
