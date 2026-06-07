// MbShot — a minimal GNOME Shell extension that lets the ThinkPad ops-bot take
// screenshots on GNOME Wayland.
//
// Why this exists: on GNOME 50/Wayland there is no headless screenshot path for
// an external process — grim needs wlr-screencopy (Mutter lacks it), the
// org.gnome.Shell.Screenshot D-Bus method returns AccessDenied, and the
// xdg-desktop-portal Screenshot is interactive (blocks on a permission dialog).
// Code running *inside* the Shell, however, may use Shell.Screenshot directly.
// So this extension exports a private session-bus service the bot can call.
//
// Interface: org.local.MbShot at /org/local/MbShot
//   Ping()                                  -> "mbshot-ok"   (liveness check)
//   Capture(b include_cursor, s filename)   -> b success
//   CaptureArea(i x,y,w,h, s filename)      -> b success

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

const IFACE = `
<node>
  <interface name="org.local.MbShot">
    <method name="Ping">
      <arg type="s" direction="out" name="pong"/>
    </method>
    <method name="Capture">
      <arg type="b" direction="in" name="include_cursor"/>
      <arg type="s" direction="in" name="filename"/>
      <arg type="b" direction="out" name="success"/>
    </method>
    <method name="CaptureArea">
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="i" direction="in" name="width"/>
      <arg type="i" direction="in" name="height"/>
      <arg type="s" direction="in" name="filename"/>
      <arg type="b" direction="out" name="success"/>
    </method>
  </interface>
</node>`;

export default class MbShotExtension {
  enable() {
    this._impl = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
    this._impl.export(Gio.DBus.session, '/org/local/MbShot');
    this._nameId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      'org.local.MbShot',
      Gio.BusNameOwnerFlags.NONE,
      null, null, null,
    );
  }

  disable() {
    if (this._nameId) {
      Gio.bus_unown_name(this._nameId);
      this._nameId = null;
    }
    if (this._impl) {
      this._impl.unexport();
      this._impl = null;
    }
  }

  Ping() {
    return 'mbshot-ok';
  }

  _openStream(filename) {
    const file = Gio.File.new_for_path(filename);
    return file.replace(null, false, Gio.FileCreateFlags.NONE, null);
  }

  Capture(includeCursor, filename) {
    const shooter = new Shell.Screenshot();
    const stream = this._openStream(filename);
    return new Promise((resolve) => {
      shooter.screenshot(includeCursor, stream, (obj, res) => {
        let ok = false;
        try { [ok] = shooter.screenshot_finish(res); } catch (_e) { ok = false; }
        try { stream.close(null); } catch (_e) { /* ignore */ }
        resolve(!!ok);
      });
    });
  }

  CaptureArea(x, y, width, height, filename) {
    const shooter = new Shell.Screenshot();
    const stream = this._openStream(filename);
    return new Promise((resolve) => {
      shooter.screenshot_area(x, y, width, height, stream, (obj, res) => {
        let ok = false;
        try { [ok] = shooter.screenshot_area_finish(res); } catch (_e) { ok = false; }
        try { stream.close(null); } catch (_e) { /* ignore */ }
        resolve(!!ok);
      });
    });
  }
}
