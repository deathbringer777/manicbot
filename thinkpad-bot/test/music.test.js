const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const { setTestEnv } = require("./helpers/mock.js");

describe("music + intents", () => {
  let music, intents;

  before(() => {
    setTestEnv();
    music = require("../tools/music.js");
    intents = require("../intents.js");
  });

  it("aliasToPreset распознаёт жанры из фразы", () => {
    assert.strictEqual(music.aliasToPreset("включи ambient"), "ambient");
    assert.strictEqual(music.aliasToPreset("поставь лофи"), "lofi");
    assert.strictEqual(music.aliasToPreset("джаз"), "jazz");
    assert.strictEqual(music.aliasToPreset("электроника"), "electronic");
    assert.strictEqual(music.aliasToPreset("новости bbc"), "news");
    assert.strictEqual(music.aliasToPreset("радио"), "radio");
    assert.strictEqual(music.aliasToPreset("просто какой-то текст"), null);
  });

  it("classify ловит музыкальные фразы (регресс на кириллический \\b)", () => {
    assert.strictEqual(intents.classify("включи лофи").kind, "music_play");
    assert.strictEqual(intents.classify("поставь ambient").kind, "music_play");
    assert.strictEqual(intents.classify("вруби джаз").kind, "music_play");
    assert.strictEqual(intents.classify("сделай скриншот").kind, "screenshot");
    assert.strictEqual(intents.classify("что сейчас играет").kind, "now_playing");
    assert.strictEqual(intents.classify("выключи музыку").kind, "music_stop");
    assert.strictEqual(intents.classify("громкость 40").kind, "volume_set");
    assert.strictEqual(intents.classify("сделай погромче").kind, "volume_up");
  });

  it("classify НЕ реагирует на обычный разговор (нет ложных срабатываний)", () => {
    assert.strictEqual(intents.classify("привет как дела"), null);
    assert.strictEqual(intents.classify(""), null);
    assert.strictEqual(intents.classify("расскажи анекдот про кота"), null);
    assert.strictEqual(intents.classify("включи свет в комнате"), null);
  });
});
