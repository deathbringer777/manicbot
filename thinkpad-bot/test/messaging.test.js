// commands/messaging.js — System & Seasonal Messaging approval surface.
// Tests the PURE view builders: occasion humanization, draft grouping, #N refs,
// empty state, and the no-raw-ULID / no-technical-tag contract the redesign
// promised (the old version dumped pmt_01K... + [seasonal_x/locale]).

const { describe, it } = require("node:test");
const assert = require("node:assert");

const msg = require("../commands/messaging.js");

describe("humanizeOccasion", () => {
  it("maps known occasion keys to RU names with emoji", () => {
    assert.strictEqual(msg.humanizeOccasion("seasonal_womens_day"), "💐 8 Марта");
    assert.strictEqual(msg.humanizeOccasion("summer_start"), "☀️ Начало лета");
  });
  it("prettifies unknown keys instead of showing raw snake_case", () => {
    const out = msg.humanizeOccasion("seasonal_some_new_thing");
    assert.match(out, /Some New Thing/);
    assert.doesNotMatch(out, /seasonal_/);
    assert.doesNotMatch(out, /_/);
  });
});

describe("buildDraftsView", () => {
  it("returns an empty-state when there is nothing", () => {
    const v = msg.buildDraftsView({ campaigns: [], templates: [] });
    assert.match(v.text, /Черновиков нет/);
    assert.deepStrictEqual(v.refs, {});
    assert.strictEqual(v.keyboard, undefined);
  });

  it("groups templates by occasion with locale flags and NO raw ULIDs / tags", () => {
    const templates = [
      { id: "pmt_01KTYVSXN8HAAHDQRDEACZGR00", template_key: "seasonal_new_years_eve", locale: "en" },
      { id: "pmt_01KTYVS8E7W7Y4GF03RG1W204A", template_key: "seasonal_new_years_eve", locale: "ru" },
      { id: "pmt_01KTYVRPJAGF44Z1J4H3K5GF0A", template_key: "seasonal_christmas", locale: "pl" },
    ];
    const v = msg.buildDraftsView({ campaigns: [], templates });
    // human names + flags present
    assert.match(v.text, /Новогодняя ночь/);
    assert.match(v.text, /Сочельник/);
    assert.match(v.text, /🇬🇧/);
    assert.match(v.text, /🇷🇺/);
    // the old offenders must be gone
    assert.doesNotMatch(v.text, /pmt_01K/);
    assert.doesNotMatch(v.text, /seasonal_new_years_eve\/en/);
    // one approve-occasion button per key (2 keys) + refresh
    const btns = v.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(btns.includes("msg:tpl:seasonal_new_years_eve"));
    assert.ok(btns.includes("msg:tpl:seasonal_christmas"));
    assert.ok(btns.includes("msg:refresh"));
  });

  it("numbers campaigns #1.. with approve/skip buttons and a ref map (no ULID shown)", () => {
    const campaigns = [
      { id: "pc_AAA", occasion_key: "summer_start", template_key: "seasonal_summer_start", scheduled_at: 1782032400, status: "draft" },
      { id: "pc_BBB", title: "Custom", kind: "announcement", scheduled_at: null, status: "active" },
    ];
    const v = msg.buildDraftsView({ campaigns, templates: [] });
    assert.match(v.text, /#1/);
    assert.match(v.text, /Начало лета/);
    assert.match(v.text, /#2/);
    assert.doesNotMatch(v.text, /pc_AAA/); // id never shown
    assert.deepStrictEqual(v.refs, { 1: "pc_AAA", 2: "pc_BBB" });
    const btns = v.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(btns.includes("msg:approve:pc_AAA"));
    assert.ok(btns.includes("msg:skip:pc_BBB"));
  });
});

describe("buildPreviewCard", () => {
  it("renders a campaign card with human occasion + date, not JSON", () => {
    const card = msg.buildPreviewCard({ occasion_key: "womens_day", template_key: "seasonal_womens_day", scheduled_at: 1772928000, status: "draft" });
    assert.match(card, /8 Марта/);
    assert.match(card, /Когда/);
    assert.doesNotMatch(card, /\{/); // no raw JSON braces
  });
  it("renders a template card with the center body preview", () => {
    const card = msg.buildPreviewCard({ template_key: "seasonal_christmas", locale: "ru", status: "draft", bodies_json: JSON.stringify({ center: "С наступающим!" }) });
    assert.match(card, /Сочельник/);
    assert.match(card, /С наступающим/);
  });
  it("returns null for a missing item", () => {
    assert.strictEqual(msg.buildPreviewCard(null), null);
  });
});
