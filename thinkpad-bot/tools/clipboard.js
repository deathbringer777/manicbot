const { sh } = require("./helpers.js");

async function read() {
  const out = await sh("wl-paste 2>/dev/null");
  if (out.startsWith("Ошибка")) {
    const xout = await sh("xclip -o -selection clipboard 2>/dev/null");
    if (xout.startsWith("Ошибка")) return { ok: false, error: "clipboard not available" };
    return { ok: true, text: xout };
  }
  return { ok: true, text: out };
}

async function write(text) {
  const escaped = text.replace(/'/g, "'\\''");
  const out = await sh(`wl-copy '${escaped}'`);
  if (out.startsWith("Ошибка")) {
    const xout = await sh(`echo '${escaped}' | xclip -selection clipboard 2>/dev/null`);
    if (xout.startsWith("Ошибка")) return { ok: false, error: "clipboard not available" };
  }
  return { ok: true };
}

async function clear() {
  return write("");
}

async function append(text) {
  const current = await read();
  if (current.ok) {
    return write(current.text + text);
  }
  return write(text);
}

module.exports = {
  read,
  write,
  clear,
  append,
};
