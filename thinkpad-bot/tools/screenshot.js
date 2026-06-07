const { sh, timestamp, fs } = require("./helpers.js");

// Screenshots go through the MbShot GNOME Shell extension (see
// gnome-extension/). On GNOME Wayland no external tool can capture the screen
// (grim lacks wlr-screencopy on Mutter, Shell.Screenshot D-Bus is AccessDenied,
// the portal is interactive), so we call the extension's private session-bus
// service, which uses the Shell's own screenshot API.
const DEST = "org.local.MbShot";
const OBJ = "/org/local/MbShot";

function gdbusCall(method, args = "") {
  return `gdbus call --session --dest ${DEST} --object-path ${OBJ} --method ${DEST}.${method}${args ? " " + args : ""}`;
}

function backendUnavailable(out) {
  // sh() returns "Ошибка (exit N): ..." on non-zero exit; a missing service
  // shows up as ServiceUnknown / "not provided by any .service".
  return (
    out.startsWith("Ошибка") ||
    /ServiceUnknown|not provided by any|UnknownMethod|Error\b/i.test(out)
  );
}

const BACKEND_HINT =
  "📸 Скриншот-бэкенд ещё не активен.\n\n" +
  "На GNOME Wayland для скриншотов нужен Shell-расширение mbshot. Оно установлено, " +
  "но GNOME подхватывает новые расширения только после перезахода в сессию.\n\n" +
  "➡️ Выйди и зайди в систему на ThinkPad (или перезагрузи его) — после этого скриншоты заработают.";

async function isBackendReady() {
  const out = await sh(gdbusCall("Ping"), 6000);
  return out.includes("mbshot-ok");
}

function gdbusReturnedTrue(out) {
  return /\(\s*true\b/.test(out);
}

async function captureFullScreen(outputPath) {
  const path = outputPath || `/tmp/screenshot_${timestamp()}.png`;
  const out = await sh(gdbusCall("Capture", `true "${path}"`), 25000);
  if (!gdbusReturnedTrue(out)) {
    if (backendUnavailable(out) && !(await isBackendReady())) {
      return { ok: false, error: BACKEND_HINT };
    }
    return { ok: false, error: `Не удалось сделать скриншот: ${out}` };
  }
  if (!fs.existsSync(path)) return { ok: false, error: BACKEND_HINT };
  return { ok: true, path, size: fs.statSync(path).size };
}

async function captureArea(x, y, width, height, outputPath) {
  if (x == null || y == null || width == null || height == null) {
    // Interactive region picking (slurp) isn't available on GNOME Wayland —
    // fall back to the full screen.
    return captureFullScreen(outputPath);
  }
  const path = outputPath || `/tmp/screenshot_${timestamp()}.png`;
  const out = await sh(
    gdbusCall("CaptureArea", `${x} ${y} ${width} ${height} "${path}"`),
    25000,
  );
  if (!gdbusReturnedTrue(out)) {
    if (backendUnavailable(out) && !(await isBackendReady())) {
      return { ok: false, error: BACKEND_HINT };
    }
    // Area capture may be unsupported on this Shell version — fall back to full.
    return captureFullScreen(outputPath);
  }
  if (!fs.existsSync(path)) return { ok: false, error: BACKEND_HINT };
  return { ok: true, path, size: fs.statSync(path).size };
}

// Whole active window: GNOME Wayland gives no reliable per-window geometry to an
// external process, so this is just the full screen.
async function captureWindow(outputPath) {
  return captureFullScreen(outputPath);
}

// No external display-geometry query on GNOME Wayland; return a safe default.
async function getScreenSize() {
  return { ok: true, width: 1920, height: 1080, note: "default (no Wayland geometry query)" };
}

module.exports = {
  captureFullScreen,
  captureArea,
  captureWindow,
  getScreenSize,
  isBackendReady,
  BACKEND_HINT,
};
