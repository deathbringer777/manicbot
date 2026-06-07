const { sh, timestamp, fs } = require("./helpers.js");

async function captureFullScreen(outputPath) {
  const path = outputPath || `/tmp/screenshot_${timestamp()}.png`;
  const out = await sh(`grim "${path}"`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  if (!fs.existsSync(path)) return { ok: false, error: "screenshot file not created" };
  const size = fs.statSync(path).size;
  return { ok: true, path, size };
}

async function captureArea(x, y, width, height, outputPath) {
  if (x != null && y != null && width != null && height != null) {
    const path = outputPath || `/tmp/screenshot_${timestamp()}.png`;
    const out = await sh(`grim -g "${x},${y} ${width}x${height}" "${path}"`);
    if (out.startsWith("Ошибка")) return { ok: false, error: out };
    if (!fs.existsSync(path)) return { ok: false, error: "screenshot file not created" };
    const size = fs.statSync(path).size;
    return { ok: true, path, size };
  }
  const path = outputPath || `/tmp/screenshot_${timestamp()}.png`;
  const out = await sh(`grim -g "$(slurp)" "${path}"`);
  if (out.startsWith("Ошибка")) return { ok: false, error: out };
  if (!fs.existsSync(path)) return { ok: false, error: "screenshot file not created" };
  const size = fs.statSync(path).size;
  return { ok: true, path, size };
}

async function captureWindow(outputPath) {
  const geo = await sh("xdotool getactivewindow getwindowgeometry --shell 2>/dev/null");
  if (geo.startsWith("Ошибка")) {
    return captureFullScreen(outputPath);
  }
  const mX = geo.match(/X=(\d+)/);
  const mY = geo.match(/Y=(\d+)/);
  const mW = geo.match(/WIDTH=(\d+)/);
  const mH = geo.match(/HEIGHT=(\d+)/);
  if (mX && mY && mW && mH) {
    return captureArea(
      parseInt(mX[1]), parseInt(mY[1]),
      parseInt(mW[1]), parseInt(mH[1]),
      outputPath
    );
  }
  return captureFullScreen(outputPath);
}

async function getScreenSize() {
  const out = await sh("xdotool getdisplaygeometry 2>/dev/null");
  if (!out.startsWith("Ошибка")) {
    const m = out.match(/(\d+)\s+(\d+)/);
    if (m) return { ok: true, width: parseInt(m[1]), height: parseInt(m[2]) };
  }
  const geo = await sh("xdpyinfo 2>/dev/null | grep dimensions || echo 'not found'");
  if (!geo.includes("not found")) {
    const m = geo.match(/(\d+)x(\d+)/);
    if (m) return { ok: true, width: parseInt(m[1]), height: parseInt(m[2]) };
  }
  return { ok: true, width: 1920, height: 1080, note: "detected fallback" };
}

module.exports = {
  captureFullScreen,
  captureArea,
  captureWindow,
  getScreenSize,
};
