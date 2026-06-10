// /blog + blog:* callbacks — the bot side of the blog approval pipeline.
// The heavy lifting happens in ~/manicbot-backend/crons/blog/publish.js;
// the bot only lists pending drafts, relays button taps to that script and
// collects revision feedback as the next plain-text message.

const { describe, it, before, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let blogCmd;
let backendDir;

function writeDraft(slug) {
  const dir = path.join(backendDir, "marketing", "articles", "drafts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ slug }));
}

let fetchCalls;
const originalFetch = global.fetch;

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test-groq-key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  backendDir = fs.mkdtempSync(path.join(os.tmpdir(), "blog-cmd-test-"));
  process.env.MANICBOT_BACKEND_DIR = backendDir;
  delete require.cache[path.resolve(__dirname, "../config.js")];
  delete require.cache[path.resolve(__dirname, "../commands/blog.js")];
  blogCmd = require("../commands/blog.js");
});

beforeEach(() => {
  fetchCalls = [];
  global.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) };
  };
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("/blog command", () => {
  it("reports when there are no pending drafts", async () => {
    const out = await blogCmd.commands["/blog"].handler(12345, "");
    assert.ok(/нет|пуст/i.test(typeof out === "string" ? out : out.text));
  });

  it("lists pending drafts", async () => {
    writeDraft("summer-trends");
    const out = await blogCmd.commands["/blog"].handler(12345, "");
    const text = typeof out === "string" ? out : out.text;
    assert.ok(text.includes("summer-trends"));
  });
});

describe("blog callbacks", () => {
  const cq = (data) => ({ id: "cb1", data, message: { chat: { id: 12345 }, message_id: 1 } });

  it("blog:pub:<slug> shells out to publish.js with --action publish", async () => {
    writeDraft("post-1");
    const execCalls = [];
    blogCmd.deps.execFile = (cmd, args, opts, cb) => {
      execCalls.push({ cmd, args });
      cb(null, JSON.stringify({ ok: true }), "");
    };
    await blogCmd.handleCallback(cq("blog:pub:post-1"));
    assert.strictEqual(execCalls.length, 1);
    assert.strictEqual(execCalls[0].cmd, "node");
    const a = execCalls[0].args;
    assert.ok(a[0].endsWith("crons/blog/publish.js"));
    assert.strictEqual(a[a.indexOf("--slug") + 1], "post-1");
    assert.strictEqual(a[a.indexOf("--action") + 1], "publish");
  });

  it("blog:rev:<slug> arms the pending-revision state; next text becomes feedback", async () => {
    writeDraft("post-2");
    const execCalls = [];
    blogCmd.deps.execFile = (cmd, args, opts, cb) => {
      execCalls.push({ cmd, args });
      cb(null, JSON.stringify({ ok: true }), "");
    };

    await blogCmd.handleCallback(cq("blog:rev:post-2"));
    assert.strictEqual(execCalls.length, 0, "revision waits for feedback text");

    const consumed = await blogCmd.consumePendingRevision(12345, "сделай тон мягче");
    assert.strictEqual(consumed, true);
    const a = execCalls[0].args;
    assert.strictEqual(a[a.indexOf("--action") + 1], "revise");
    assert.strictEqual(a[a.indexOf("--feedback") + 1], "сделай тон мягче");

    const again = await blogCmd.consumePendingRevision(12345, "ещё текст");
    assert.strictEqual(again, false, "state consumed after one message");
  });

  it("«отмена» cancels a pending revision without running anything", async () => {
    const execCalls = [];
    blogCmd.deps.execFile = (cmd, args, opts, cb) => { execCalls.push(args); cb(null, "{}", ""); };
    await blogCmd.handleCallback(cq("blog:rev:post-3"));
    const consumed = await blogCmd.consumePendingRevision(12345, "отмена");
    assert.strictEqual(consumed, true);
    assert.strictEqual(execCalls.length, 0);
  });

  it("publish failure is relayed to the chat instead of swallowed", async () => {
    blogCmd.deps.execFile = (cmd, args, opts, cb) => cb(new Error("exit 1"), "", "Draft not found: nope");
    await blogCmd.handleCallback(cq("blog:pub:nope"));
    const sent = fetchCalls.filter(c => c.url.includes("sendMessage"));
    assert.ok(sent.length >= 1);
    assert.ok(sent.some(c => String(c.opts.body).includes("Draft not found")));
  });
});
