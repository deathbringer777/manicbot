const { sh } = require("./helpers.js");

async function listWindows() {
  const out = await sh("wmctrl -l 2>/dev/null");
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  const lines = out.split("\n").filter(Boolean);
  const windows = lines.map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      id: parts[0],
      desktop: parts[1],
      pid: parts[2],
      title: parts.slice(3).join(" "),
    };
  });
  return { ok: true, windows };
}

async function focusWindow(windowId) {
  const out = await sh(`xdotool windowactivate ${windowId} 2>/dev/null`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function focusWindowByName(name) {
  const out = await sh(`xdotool search --name '${name}' 2>/dev/null`);
  if (out.startsWith("Ошибка") || !out.trim()) {
    const classOut = await sh(`xdotool search --class '${name}' 2>/dev/null`);
    if (classOut.startsWith("Ошибка") || !classOut.trim()) {
      return { ok: false, error: `window not found: ${name}` };
    }
    const ids = classOut.trim().split("\n");
    return focusWindow(ids[0]);
  }
  const ids = out.trim().split("\n");
  return focusWindow(ids[0]);
}

async function minimizeWindow(windowId) {
  const out = await sh(`xdotool windowminimize ${windowId} 2>/dev/null`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function maximizeWindow(windowId) {
  const out = await sh(`xdotool windowstate --add FULLSCREEN ${windowId} 2>/dev/null`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function closeWindow(windowId) {
  const out = await sh(`xdotool windowclose ${windowId} 2>/dev/null`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  return { ok: true };
}

async function getActiveWindow() {
  const id = await sh("xdotool getactivewindow 2>/dev/null");
  if (id.startsWith("Ошибка")) return { ok: false, error: id };
  const name = await sh("xdotool getactivewindow getwindowname 2>/dev/null");
  return {
    ok: true,
    id: id.trim(),
    title: name.startsWith("Ошибка") ? "unknown" : name.trim(),
  };
}

async function getWindowGeometry(windowId) {
  const out = await sh(`xdotool getwindowgeometry --shell ${windowId} 2>/dev/null`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  const mX = out.match(/X=(\d+)/);
  const mY = out.match(/Y=(\d+)/);
  const mW = out.match(/WIDTH=(\d+)/);
  const mH = out.match(/HEIGHT=(\d+)/);
  return {
    ok: true,
    x: mX ? parseInt(mX[1]) : 0,
    y: mY ? parseInt(mY[1]) : 0,
    width: mW ? parseInt(mW[1]) : 0,
    height: mH ? parseInt(mH[1]) : 0,
  };
}

module.exports = {
  listWindows,
  focusWindow,
  focusWindowByName,
  minimizeWindow,
  maximizeWindow,
  closeWindow,
  getActiveWindow,
  getWindowGeometry,
};
