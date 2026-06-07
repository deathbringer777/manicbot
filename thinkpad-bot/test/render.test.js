const { describe, it } = require("node:test");
const assert = require("node:assert");
const r = require("../render.js");

describe("render.js", () => {
  it("esc экранирует & < >", () => {
    assert.strictEqual(r.esc('a < b & c > d'), "a &lt; b &amp; c &gt; d");
  });

  it("kv экранирует значение (защита от поломки HTML)", () => {
    assert.strictEqual(r.kv("PID", "<script>"), "<b>PID:</b> &lt;script&gt;");
  });

  it("bar строит прогресс-бар", () => {
    assert.strictEqual(r.bar(40), "████░░░░░░ 40%");
    assert.strictEqual(r.bar(0), "░░░░░░░░░░ 0%");
    assert.strictEqual(r.bar(100), "██████████ 100%");
  });

  it("bar клампит выход за границы", () => {
    assert.strictEqual(r.bar(150), "██████████ 100%");
    assert.strictEqual(r.bar(-10), "░░░░░░░░░░ 0%");
  });

  it("block оборачивает в <pre> и экранирует", () => {
    const out = r.block("a <b> c");
    assert.match(out, /^<pre>/);
    assert.match(out, /a &lt;b&gt; c/);
  });

  it("block обрезает по числу строк с пометкой", () => {
    const many = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
    const out = r.block(many, { maxLines: 10 });
    assert.match(out, /\+90 стр\./);
    assert.ok(out.includes("line0") && out.includes("line9") && !out.includes("line50"));
  });

  it("keyboard строит inline_keyboard", () => {
    const kb = r.keyboard([[["▶️", "m:play"], ["⏸", "m:pause"]]]);
    assert.deepStrictEqual(kb, {
      inline_keyboard: [[
        { text: "▶️", callback_data: "m:play" },
        { text: "⏸", callback_data: "m:pause" },
      ]],
    });
  });

  it("chunkPlain режет длинный текст по границам строк", () => {
    const text = Array.from({ length: 500 }, () => "x".repeat(20)).join("\n");
    const chunks = r.chunkPlain(text, 1000);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((c) => c.length <= 1000));
  });
});
