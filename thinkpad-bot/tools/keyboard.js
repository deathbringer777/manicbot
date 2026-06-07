const { sh } = require("./helpers.js");

const KEYCODES = {
  ctrl: 29, control: 29,
  shift: 42, alt: 56, super: 125, meta: 125,
  enter: 28, return: 28,
  tab: 15,
  space: 57,
  backspace: 14,
  escape: 1, esc: 1,
  delete: 111, del: 111,
  insert: 110,
  home: 102, end: 107,
  pageup: 104, pagedown: 109,
  up: 103, down: 108, left: 105, right: 106,
  a: 30, b: 48, c: 46, d: 32, e: 18, f: 33, g: 34, h: 35,
  i: 23, j: 36, k: 37, l: 38, m: 50, n: 49, o: 24, p: 25,
  q: 16, r: 19, s: 31, t: 20, u: 22, v: 47, w: 17, x: 45,
  y: 21, z: 44,
  "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8, "8": 9, "9": 10,
  f1: 59, f2: 60, f3: 61, f4: 62, f5: 63, f6: 64,
  f7: 65, f8: 66, f9: 67, f10: 68, f11: 87, f12: 88,
  minus: 12, equal: 13, bracketleft: 26, bracketright: 27,
  semicolon: 39, quote: 40, comma: 51, dot: 52, slash: 53,
  backslash: 43, grave: 41,
};

function keycode(name) {
  const lower = name.toLowerCase();
  if (KEYCODES[lower] != null) return KEYCODES[lower];
  return null;
}

function parseHotkey(hotkey) {
  const parts = hotkey.split("+");
  const codes = [];
  for (const p of parts) {
    const kc = keycode(p.trim());
    if (kc == null) return { error: `unknown key: ${p}` };
    codes.push(kc);
  }
  return { codes: [...new Set(codes)] };
}

async function typeText(text) {
  const escaped = text.replace(/'/g, "'\\''");
  const out = await sh(`wtype '${escaped}'`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function hotkey(hotkey) {
  const parsed = parseHotkey(hotkey);
  if (parsed.error) return { ok: false, error: parsed.error };
  const keyStr = parsed.codes.join("+");
  const out = await sh(`ydotool key ${keyStr}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function pressKey(key) {
  const kc = keycode(key);
  if (kc == null) return { ok: false, error: `unknown key: ${key}` };
  const out = await sh(`ydotool key ${kc}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function holdKey(key) {
  const kc = keycode(key);
  if (kc == null) return { ok: false, error: `unknown key: ${key}` };
  const out = await sh(`ydotool key ${kc} -d 0`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function releaseKey(key) {
  const kc = keycode(key);
  if (kc == null) return { ok: false, error: `unknown key: ${key}` };
  const out = await sh(`ydotool key ${kc} -u 0`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

module.exports = {
  typeText,
  hotkey,
  pressKey,
  holdKey,
  releaseKey,
  KEYCODES,
};
