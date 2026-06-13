// commands/messaging.js — System & Seasonal Messaging approval surface.
// Unit-tests the pure transforms (occasion grouping, locale collapse, pagination,
// variable substitution, view builders + the no-raw-ULID-in-list contract) and
// integration-tests the inline-button router (handleCallback) with a mocked seam
// (fetch) and a mocked Telegram transport — no live network.

const { describe, it, before, beforeEach, mock } = require("node:test");
const assert = require("node:assert");
const { setTestEnv } = require("./helpers/mock.js");

setTestEnv();
process.env.MESSAGING_TOKEN = "ttok"; // seam short-circuits without it

const msg = require("../commands/messaging.js");
const tg = require("../telegram.js");
const I = msg._internal;

// ── fetch mock: route → canned JSON; records POST bodies ─────────────────────
function installFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const route = String(url).split("/admin/messaging/")[1];
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ route, method: opts.method || "GET", body });
    const entry = routes[route] ?? { status: 404, json: { ok: false, error: "not_found" } };
    const r = typeof entry === "function" ? entry(body) : entry;
    return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => JSON.stringify(r.json) };
  };
  return calls;
}

const DRAFTS = {
  ok: true,
  campaigns: [{ id: "pc_xmas", occasion_key: "christmas", template_key: "seasonal_christmas", scheduled_at: 1798675200, status: "draft" }],
  templates: [
    { id: "pmt_ru", template_key: "seasonal_christmas", locale: "ru", status: "draft", bodies_json: JSON.stringify({ center: "С наступающим, {salon_name}!" }) },
    { id: "pmt_en", template_key: "seasonal_christmas", locale: "en", status: "draft", bodies_json: JSON.stringify({ center: "Merry Christmas, {salon_name}!" }) },
    { id: "pmt_nye", template_key: "seasonal_new_years_eve", locale: "ru", status: "draft", bodies_json: JSON.stringify({ center: "С Новым годом!" }) },
  ],
};

let _cbSeq = 0;
const cq = (data) => ({ id: `cb${++_cbSeq}`, data, message: { chat: { id: 1 }, message_id: 9 } }); // unique id (callback dedupe)

describe("pure: occasionName / occasionOf", () => {
  it("maps known occasion keys to Russian names", () => {
    assert.strictEqual(I.occasionName("womens_day"), "8 Марта");
    assert.strictEqual(I.occasionName("new_years_eve"), "Новогодняя ночь");
  });
  it("prettifies unknown keys, never leaking snake_case", () => {
    const out = I.occasionName(I.occasionOf("seasonal_some_new_thing"));
    assert.match(out, /Some New Thing/);
    assert.doesNotMatch(out, /_/);
  });
});

describe("pure: groupDrafts", () => {
  it("collapses locales into one group per occasion and attaches the campaign", () => {
    const groups = I.groupDrafts(DRAFTS);
    assert.strictEqual(groups.length, 2); // christmas + new_years_eve
    const xmas = groups.find((g) => g.key === "seasonal_christmas");
    assert.strictEqual(Object.keys(xmas.locales).length, 2); // ru + en
    assert.strictEqual(xmas.campaign.id, "pc_xmas");
    assert.strictEqual(xmas.name, "Сочельник");
  });
  it("orders occasions with a scheduled campaign before template-only ones", () => {
    const groups = I.groupDrafts(DRAFTS);
    assert.strictEqual(groups[0].key, "seasonal_christmas"); // has a dated campaign
  });
});

describe("pure: localeReadiness / fillVars / previewBody", () => {
  it("flags missing locales", () => {
    const [g] = I.groupDrafts({ templates: [{ template_key: "seasonal_christmas", locale: "ru" }] });
    assert.match(I.localeReadiness(g), /нет UA PL EN/);
  });
  it("substitutes sample variables", () => {
    assert.strictEqual(I.fillVars("Привет, {salon_name}!"), "Привет, Demo Studio!");
    assert.strictEqual(I.fillVars("{unknown}"), "{unknown}");
  });
  it("renders a localized preview body with variables filled", () => {
    const g = I.groupDrafts(DRAFTS).find((x) => x.key === "seasonal_christmas");
    assert.match(I.previewBody(g, "en").text, /Merry Christmas, Demo Studio!/);
    assert.match(I.previewBody(g, "ru").text, /С наступающим, Demo Studio!/);
  });
});

describe("pure: paginate", () => {
  it("slices to PAGE_SIZE and clamps the page index", () => {
    const items = Array.from({ length: 14 }, (_, n) => n);
    assert.strictEqual(I.paginate(items, 0).pages, 3);
    assert.strictEqual(I.paginate(items, 0).pageItems.length, I.PAGE_SIZE);
    assert.strictEqual(I.paginate(items, 99).page, 2); // clamped to last
  });
});

describe("pure: listView contract", () => {
  it("shows human names (in buttons) + pagination, never a raw ULID or technical tag", () => {
    const v = I.listView(I.groupDrafts(DRAFTS), 0);
    const labels = v.keyboard.inline_keyboard.flat().map((b) => b.text).join(" ");
    assert.match(labels, /Сочельник/); // occasion name lives in the (tappable) button label
    assert.doesNotMatch(labels, /pmt_/); // no raw ULID in the UI
    assert.doesNotMatch(v.text, /seasonal_christmas\/ru/); // no old technical tag
    const btns = v.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(btns.includes("msg:card:seasonal_christmas:0"));
  });
  it("renders an empty state with a refresh button", () => {
    const v = I.listView([], 0);
    assert.match(v.text, /Черновиков нет/);
  });
});

describe("pure: cardView", () => {
  it("shows preview, locale-switch buttons, actions, and the ULID only here", () => {
    const g = I.groupDrafts(DRAFTS).find((x) => x.key === "seasonal_christmas");
    const v = I.cardView(g, 0, "ru");
    assert.match(v.text, /Превью · RU/);
    assert.match(v.text, /ID: pmt_ru/); // ULID surfaced only inside the card
    const btns = v.keyboard.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(btns.includes("msg:loc:seasonal_christmas:en:0"));
    assert.ok(btns.includes("msg:appr:seasonal_christmas:0"));
    assert.ok(btns.includes("msg:sched:seasonal_christmas:0")); // has a campaign
  });
  it("keeps every callback_data under Telegram's 64-byte limit", () => {
    const g = I.groupDrafts(DRAFTS).find((x) => x.key === "seasonal_christmas");
    for (const b of I.cardView(g, 9, "ru").keyboard.inline_keyboard.flat()) {
      assert.ok(Buffer.byteLength(b.callback_data, "utf8") <= 64, b.callback_data);
    }
  });
});

describe("pure: filterGroups (search)", () => {
  const groups = () => I.groupDrafts(DRAFTS);
  it("matches by occasion name / key substring", () => {
    assert.strictEqual(I.filterGroups(groups(), "соче").length, 1); // Сочельник
    assert.strictEqual(I.filterGroups(groups(), "new_years_eve").length, 1);
  });
  it("supports missing:<locale>", () => {
    // christmas has ru+en (no pl), new_years_eve has ru only → both missing pl
    assert.strictEqual(I.filterGroups(groups(), "missing:pl").length, 2);
  });
  it("renders a friendly empty result", () => {
    assert.match(I.filteredView([], "zzz").text, /Ничего не найдено/);
  });
});

describe("integration: handleCallback", () => {
  before(() => {
    mock.method(tg, "answerCallbackQuery", async () => ({ ok: true }));
  });
  let edits;
  beforeEach(() => {
    edits = [];
    mock.method(tg, "editMessageText", async (chatId, mid, text, extra) => {
      edits.push({ text, extra });
      return { ok: true };
    });
  });

  it("msg:list renders the grouped list", async () => {
    installFetch({ drafts: { json: DRAFTS } });
    await msg.handleCallback(cq("msg:list:0"));
    assert.strictEqual(edits.length, 1);
    assert.match(edits[0].text, /Черновики рассылок/);
  });

  it("msg:card opens the occasion card", async () => {
    installFetch({ drafts: { json: DRAFTS } });
    await msg.handleCallback(cq("msg:card:seasonal_christmas:0"));
    assert.match(edits[0].text, /Сочельник/);
    assert.match(edits[0].text, /Превью/);
  });

  it("msg:apprY approves templates + campaign exactly once each, then edits the message", async () => {
    const calls = installFetch({
      drafts: { json: DRAFTS },
      "template-status": { json: { ok: true, updated: 2 } },
      approve: { json: { ok: true, status: "active" } },
    });
    await msg.handleCallback(cq("msg:apprY:seasonal_christmas:0"));
    const tplCalls = calls.filter((c) => c.route === "template-status");
    const apprCalls = calls.filter((c) => c.route === "approve");
    assert.strictEqual(tplCalls.length, 1);
    assert.strictEqual(tplCalls[0].body.template_key, "seasonal_christmas");
    assert.strictEqual(tplCalls[0].body.status, "approved");
    assert.strictEqual(apprCalls.length, 1);
    assert.strictEqual(apprCalls[0].body.id, "pc_xmas");
    assert.match(edits.at(-1).text, /одобрено/);
  });

  it("ignores a redelivered callback (same id) — idempotent", async () => {
    const calls = installFetch({
      drafts: { json: DRAFTS },
      "template-status": { json: { ok: true, updated: 2 } },
      approve: { json: { ok: true, status: "active" } },
    });
    const dup = { id: "dup1", data: "msg:apprY:seasonal_christmas:0", message: { chat: { id: 1 }, message_id: 9 } };
    await msg.handleCallback(dup);
    await msg.handleCallback(dup); // redelivery
    assert.strictEqual(calls.filter((c) => c.route === "approve").length, 1); // acted only once
  });

  it("surfaces a friendly error (with retry) when the seam is down", async () => {
    installFetch({ drafts: { status: 500, json: { ok: false, error: "boom" } } });
    await msg.handleCallback(cq("msg:list:0"));
    assert.match(edits.at(-1).text, /Не удалось/);
    const btns = edits.at(-1).extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    assert.ok(btns.includes("msg:list:0"));
  });
});
