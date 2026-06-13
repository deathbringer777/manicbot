// vision.js — incoming Telegram images → a Claude vision request.
// The bot has no native image model; it downloads each photo to disk and lets
// the claude CLI SEE it through its Read tool. These tests pin the pure helpers
// (which file_id to fetch, what is an image, how the prompt is shaped) and the
// download side effect via injected deps (no real network / disk in a unit test).

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

let vision;

before(() => {
  process.env.TELEGRAM_TOKEN = "test:token";
  process.env.GROQ_KEY = "test:key";
  process.env.ALLOWED_USER_ID = "12345";
  process.env.CHAT_ID = "12345";
  delete require.cache[path.resolve(__dirname, "../config.js")];
  delete require.cache[path.resolve(__dirname, "../vision.js")];
  vision = require("../vision.js");
});

describe("vision.pickLargestPhotoId", () => {
  it("returns the highest-resolution PhotoSize file_id", () => {
    const photo = [
      { file_id: "thumb", width: 90, file_size: 1000 },
      { file_id: "mid", width: 320, file_size: 8000 },
      { file_id: "full", width: 1280, file_size: 90000 },
    ];
    assert.strictEqual(vision.pickLargestPhotoId(photo), "full");
  });

  it("returns null for an empty / missing array", () => {
    assert.strictEqual(vision.pickLargestPhotoId([]), null);
    assert.strictEqual(vision.pickLargestPhotoId(undefined), null);
  });
});

describe("vision.isImageDocument", () => {
  it("true for image/* mime type (screenshot sent as a file)", () => {
    assert.ok(vision.isImageDocument({ mime_type: "image/png", file_name: "Screenshot.png" }));
  });
  it("true by extension when mime is absent", () => {
    assert.ok(vision.isImageDocument({ file_name: "photo.JPG" }));
  });
  it("false for non-image documents", () => {
    assert.ok(!vision.isImageDocument({ mime_type: "application/pdf", file_name: "report.pdf" }));
    assert.ok(!vision.isImageDocument(null));
  });
});

describe("vision.imageRefFromMessage", () => {
  it("picks the largest size from a photo message", () => {
    const ref = vision.imageRefFromMessage({
      photo: [{ file_id: "s", width: 90 }, { file_id: "l", width: 1280 }],
    });
    assert.deepStrictEqual(ref, { fileId: "l" });
  });
  it("handles an image sent as a document", () => {
    const ref = vision.imageRefFromMessage({ document: { file_id: "doc1", mime_type: "image/webp" } });
    assert.deepStrictEqual(ref, { fileId: "doc1" });
  });
  it("returns null for a plain text message", () => {
    assert.strictEqual(vision.imageRefFromMessage({ text: "hello" }), null);
    assert.strictEqual(vision.imageRefFromMessage({ document: { mime_type: "application/zip" } }), null);
  });
});

describe("vision.buildVisionPrompt", () => {
  it("lists every image path and tells the agent to Read them", () => {
    const p = vision.buildVisionPrompt({
      instruction: "почему нет шаблонов?",
      imagePaths: ["/tmp/a.png", "/tmp/b.png"],
    });
    assert.match(p, /\/tmp\/a\.png/);
    assert.match(p, /\/tmp\/b\.png/);
    assert.match(p, /Read/);            // instructs the agent to use its Read tool
    assert.match(p, /2 image/);         // count surfaced
    assert.match(p, /почему нет шаблонов\?/); // the owner's instruction is carried verbatim
  });

  it("falls back to a default instruction when no caption was given", () => {
    const p = vision.buildVisionPrompt({ instruction: "", imagePaths: ["/tmp/a.png"] });
    assert.match(p, /\/tmp\/a\.png/);
    assert.ok(p.length > 20);
  });

  it("throws when there are no image paths (caller must guard)", () => {
    assert.throws(() => vision.buildVisionPrompt({ instruction: "x", imagePaths: [] }));
  });
});

describe("vision.download", () => {
  beforeEach(() => {
    vision.deps.fetch = undefined;
    vision.deps.writeFile = undefined;
  });

  it("getFile → download bytes → write to /tmp, returns the path", async () => {
    const seen = { gets: [], wrote: null };
    vision.deps.fetch = async (url) => {
      seen.gets.push(url);
      if (url.includes("getFile")) {
        return { json: async () => ({ ok: true, result: { file_path: "photos/file_9.jpg" } }) };
      }
      // the file download
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    };
    vision.deps.writeFile = (dest, buf) => { seen.wrote = { dest, len: buf.length }; };

    const r = await vision.download("FILEID123");
    assert.ok(r.path.startsWith("/tmp/"));
    assert.match(r.path, /\.jpg$/);            // preserves the remote extension
    assert.ok(seen.gets[0].includes("getFile"));
    assert.ok(seen.gets[1].includes("/file/bot"), "second call downloads the actual file");
    assert.strictEqual(seen.wrote.len, 4);
    assert.strictEqual(seen.wrote.dest, r.path);
  });

  it("rejects when getFile fails", async () => {
    vision.deps.fetch = async () => ({ json: async () => ({ ok: false }) });
    await assert.rejects(() => vision.download("X"), /getFile/i);
  });

  it("rejects when the file download is non-200", async () => {
    vision.deps.fetch = async (url) =>
      url.includes("getFile")
        ? { json: async () => ({ ok: true, result: { file_path: "p/f.png" } }) }
        : { ok: false, status: 410 };
    await assert.rejects(() => vision.download("X"), /410/);
  });
});
