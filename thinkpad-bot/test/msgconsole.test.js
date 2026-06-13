// commands/msgconsole.js — Messaging control-panel screens (menu/stats/plan/
// calendar/settings/cron). Unit-tests the pure view builders and integration-
// tests the delegated callback router with a mocked seam (fetch), Telegram
// transport and shell.

const { describe, it, before, beforeEach, mock } = require("node:test");
const assert = require("node:assert");
const { setTestEnv } = require("./helpers/mock.js");

setTestEnv();
process.env.MESSAGING_TOKEN = "ttok";

const mc = require("../commands/msgconsole.js");
const tg = require("../telegram.js");
const helpers = require("../tools/helpers.js");
const V = mc._internal;

const STATS = { ok: true, send_enabled: false, send_paused: false, counts: { draft: 3, active: 1, scheduled: 2, paused: 0, done: 5 }, templates: { draft: 8, approved: 40 }, deliveries_by_channel: { center: 4, bell: 2 }, next_scheduled: 1798675200 };
const PLAN = { ok: true, items: [{ id: "pc1", occasion_key: "christmas", template_key: "seasonal_christmas", scheduled_at: 1798675200, status: "scheduled" }] };
const CAL = { ok: true, occasions: [{ id: "h1", date: "2026-12-24", occasion_key: "christmas", name_pl: "Wigilia" }] };

function installFetch(routes) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const route = String(url).split("/admin/messaging/")[1];
    const base = route.split("?")[0];
    calls.push({ route: base, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
    const r = routes[base] ?? { status: 404, json: { ok: false, error: "not_found" } };
    return { ok: (r.status || 200) < 400, status: r.status || 200, text: async () => JSON.stringify(r.json) };
  };
  return calls;
}
const cq = (data) => ({ id: "cb1", data, message: { chat: { id: 1 }, message_id: 9 } });
const labels = (v) => v.keyboard.inline_keyboard.flat().map((b) => b.callback_data);

describe("pure views", () => {
  it("menuView shows counts + hub buttons", () => {
    const v = V.menuView(STATS);
    assert.match(v.text, /пульт/);
    assert.ok(labels(v).includes("msg:list:0"));
    assert.ok(labels(v).includes("msg:stats"));
    assert.ok(labels(v).includes("msg:set"));
  });
  it("statsView aggregates counts, channels and the send state", () => {
    const v = V.statsView(STATS);
    assert.match(v.text, /📝3 ✅1 ⏳2 ✔️5/);
    assert.match(v.text, /center 4/);
    assert.match(v.text, /выключены глобально/); // send_enabled false
  });
  it("planView humanizes occasions and links to drafts cards", () => {
    const v = V.planView(PLAN, 0);
    assert.match(v.text, /Сочельник/);
    assert.ok(labels(v).includes("msg:card:seasonal_christmas:0"));
  });
  it("calendarView lists upcoming occasions with dates", () => {
    const v = V.calendarView(CAL, 0);
    assert.match(v.text, /Сочельник/);
    assert.match(v.text, /2026-12-24/);
  });
  it("settingsView offers the right toggle for the current pause state", () => {
    assert.ok(labels(V.settingsView(STATS)).includes("msg:setpause:1")); // not paused → offer pause
    assert.ok(labels(V.settingsView({ ...STATS, send_paused: true })).includes("msg:setpause:0"));
  });
  it("views degrade to a friendly error when the seam failed", () => {
    assert.match(V.statsView({ ok: false, error: "boom" }).text, /Ошибка/);
  });
});

describe("integration: handleConsoleCallback", () => {
  before(() => mock.method(tg, "answerCallbackQuery", async () => ({ ok: true })));
  let edits;
  beforeEach(() => {
    edits = [];
    mock.method(tg, "editMessageText", async (cid, mid, text, extra) => { edits.push({ text, extra }); return { ok: true }; });
  });

  it("msg:menu fetches stats and renders the hub", async () => {
    installFetch({ stats: { json: STATS } });
    await mc.handleConsoleCallback(cq("msg:menu"));
    assert.match(edits.at(-1).text, /пульт/);
  });

  it("msg:setpauseY posts the pause flag then re-renders settings", async () => {
    const calls = installFetch({ flag: { json: { ok: true, send_paused: true } }, stats: { json: { ...STATS, send_paused: true } } });
    await mc.handleConsoleCallback(cq("msg:setpauseY:1"));
    const flagCall = calls.find((c) => c.route === "flag");
    assert.strictEqual(flagCall.body.paused, true);
    assert.match(edits.at(-1).text, /Настройки рассылок/);
  });

  it("msg:cron reads pm2 + logs and lists the messaging crons", async () => {
    installFetch({});
    mock.method(helpers, "sh", async (cmd) => {
      if (cmd.includes("pm2 jlist")) return JSON.stringify([{ name: "msg-health", pm2_env: { status: "stopped" } }]);
      if (cmd.includes("tail")) return "[health] 2026-06-13T10:15:00Z draft_campaigns=51 draft_templates=51";
      return "";
    });
    await mc.handleConsoleCallback(cq("msg:cron"));
    assert.match(edits.at(-1).text, /msg-health/);
    assert.match(edits.at(-1).text, /draft_campaigns=51/);
  });
});
