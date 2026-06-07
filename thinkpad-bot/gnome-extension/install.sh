#!/usr/bin/env bash
#
# Install + enable the MbShot GNOME Shell extension on the server (run ON the
# ThinkPad, as the desktop user). GNOME loads newly-installed extensions only at
# the next login, so after this you must log out / log in (or reboot) once for
# screenshots to start working. Re-running after that is a no-op.
#
set -euo pipefail

UUID="mbshot@manicbot.local"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${UUID}"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

echo "▶ Installing ${UUID} -> ${DEST_DIR}"
mkdir -p "$DEST_DIR"
cp "$SRC_DIR/metadata.json" "$SRC_DIR/extension.js" "$DEST_DIR/"

echo "▶ Enabling…"
gnome-extensions enable "$UUID" 2>&1 || true
gnome-extensions info "$UUID" 2>&1 || true

echo
echo "✓ Installed. GNOME only loads NEW extensions at login."
echo "  → Log out and back in (or reboot) once, then the bot can take screenshots."
echo "  Verify after re-login:"
echo "    gdbus call --session --dest org.local.MbShot --object-path /org/local/MbShot --method org.local.MbShot.Ping"
