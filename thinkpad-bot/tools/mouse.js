const { sh } = require("./helpers.js");

async function mouseMoveAbsolute(x, y) {
  const out = await sh(`ydotool mousemove -a ${x} ${y}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function mouseMoveRelative(dx, dy) {
  const out = await sh(`ydotool mousemove ${dx} ${dy}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

const BTN_MAP = {
  left: "0xC0",
  right: "0xC1",
  middle: "0xC2",
  side: "0xC3",
  extra: "0xC4",
  forward: "0xC5",
  back: "0xC6",
  task: "0xC7",
};

async function mouseClick(button = "left") {
  const code = BTN_MAP[button];
  if (!code) return { ok: false, error: `unknown button: ${button}` };
  const out = await sh(`ydotool click ${code}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function mouseButtonDown(button = "left") {
  const code = BTN_MAP[button];
  if (!code) return { ok: false, error: `unknown button: ${button}` };
  const down = parseInt(code, 16) | 0x40;
  const out = await sh(`ydotool click 0x${down.toString(16)}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function mouseButtonUp(button = "left") {
  const code = BTN_MAP[button];
  if (!code) return { ok: false, error: `unknown button: ${button}` };
  const up = parseInt(code, 16) | 0x80;
  const out = await sh(`ydotool click 0x${up.toString(16)}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function mouseDoubleClick(button = "left") {
  const r1 = await mouseClick(button);
  if (!r1.ok) return r1;
  await new Promise(r => setTimeout(r, 50));
  return mouseClick(button);
}

async function getMousePosition() {
  const out = await sh("xdotool getmouselocation --shell 2>/dev/null");
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  const m = out.match(/X=(\d+)\s+Y=(\d+)/);
  if (!m) return { ok: false, error: "cannot parse position" };
  return { ok: true, x: parseInt(m[1]), y: parseInt(m[2]) };
}

async function mouseDrag(x1, y1, x2, y2, button = "left") {
  await mouseMoveAbsolute(x1, y1);
  await new Promise(r => setTimeout(r, 100));
  await mouseButtonDown(button);
  await new Promise(r => setTimeout(r, 100));
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x = x1 + Math.round((x2 - x1) * i / steps);
    const y = y1 + Math.round((y2 - y1) * i / steps);
    await mouseMoveAbsolute(x, y);
    await new Promise(r => setTimeout(r, 20));
  }
  await new Promise(r => setTimeout(r, 100));
  await mouseButtonUp(button);
  return { ok: true };
}

async function scrollVertical(amount) {
  const out = await sh(`ydotool mousemove -w -y ${amount}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function scrollHorizontal(amount) {
  const out = await sh(`ydotool mousemove -w -x ${amount}`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

module.exports = {
  mouseMoveAbsolute,
  mouseMoveRelative,
  mouseClick,
  mouseButtonDown,
  mouseButtonUp,
  mouseDoubleClick,
  getMousePosition,
  mouseDrag,
  scrollVertical,
  scrollHorizontal,
  BTN_MAP,
};
