const { sh } = require("./helpers.js");

// GNOME's Mutter does not implement wlr-data-control, so wl-clipboard can hang
// when no Wayland client holds the selection. Every call is therefore wrapped in
// `timeout` AND given a short sh() budget, so a stuck clipboard never freezes the
// bot — it degrades to a clear message instead.
const CLIP_MS = 3000;
const UNAVAILABLE = "буфер обмена недоступен в этой сессии";

function failed(out) {
  // timeout kills with 124; sh() reports "Ошибка (exit 124)…". Empty is also a miss.
  return out.startsWith("Ошибка") || /exit 124/.test(out);
}

async function read() {
  const out = await sh("timeout 2 wl-paste -n 2>/dev/null", CLIP_MS);
  if (!failed(out) && out !== "(нет вывода)") return { ok: true, text: out };

  const xout = await sh("timeout 2 xclip -o -selection clipboard 2>/dev/null", CLIP_MS);
  if (!failed(xout) && xout !== "(нет вывода)") return { ok: true, text: xout };

  return { ok: false, error: UNAVAILABLE };
}

async function write(text) {
  const escaped = String(text).replace(/'/g, "'\\''");
  const out = await sh(`timeout 2 wl-copy -- '${escaped}' 2>/dev/null`, CLIP_MS);
  if (!failed(out)) return { ok: true };

  const xout = await sh(`printf '%s' '${escaped}' | timeout 2 xclip -selection clipboard 2>/dev/null`, CLIP_MS);
  if (!failed(xout)) return { ok: true };

  return { ok: false, error: UNAVAILABLE };
}

async function clear() {
  return write("");
}

async function append(text) {
  const current = await read();
  if (current.ok) return write(current.text + text);
  return write(text);
}

module.exports = {
  read,
  write,
  clear,
  append,
};
