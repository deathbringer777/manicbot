const { describe, it } = require("node:test");
const assert = require("node:assert");
const { humanizeCron } = require("../cron-humanize.js");

describe("cron-humanize", () => {
  const cases = [
    ["0 1 * * *", "каждый день в 01:00"],
    ["30 3 * * *", "каждый день в 03:30"],
    ["*/15 * * * *", "каждые 15 мин"],
    ["0 * * * *", "каждый час в :00"],
    ["15 * * * *", "каждый час в :15"],
    ["0 12 * * 1", "по понедельникам в 12:00"],
    ["0 9 * * 1-5", "по будням в 09:00"],
    ["0 0 1 * *", "1-го числа в 00:00"],
    ["* * * * *", "каждую минуту"],
    ["0 */2 * * *", "каждые 2 ч"],
  ];

  for (const [expr, expected] of cases) {
    it(`${expr} → ${expected}`, () => {
      assert.strictEqual(humanizeCron(expr), expected);
    });
  }

  it("неизвестный/сложный паттерн → исходное выражение", () => {
    assert.strictEqual(humanizeCron("1 2 3 4 5"), "1 2 3 4 5");
  });

  it("мусор → как есть", () => {
    assert.strictEqual(humanizeCron("nonsense"), "nonsense");
  });
});
