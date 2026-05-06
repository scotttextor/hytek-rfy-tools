"""
Forge Phase 1: Detailer Worker

A single-shot Detailer subprocess driver that produces an RFY from one XML.
NO STATE between calls. NO RETRIES inside. Pure subprocess work.

The orchestrator calls this once per XML and handles retries. The worker just
does ONE conversion or exits with a categorised error code.

Contract:
  python detailer-worker.py <xml_path> <rfy_out_path>

Exit codes (see README.md for full taxonomy):
  0  success
  1  license invalid
  2  input XML missing/unreadable
  3  Detailer UI not detectable
  4  import failed
  5  export failed
  6  timeout
  7  unknown error

stderr emits one JSON status line per major step:
  {"step": "launch", "elapsed_ms": 8123}
  {"step": "import_started", "elapsed_ms": 8500}
  {"step": "import_complete", "elapsed_ms": 12500}
  {"step": "export_complete", "elapsed_ms": 25000}
  {"step": "done", "rfy_bytes": 75552}

If failure: stderr's last line is JSON with status="error" and category code.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

# Constants
EXE_PATH = r"C:\Program Files (x86)\FRAMECAD\Detailer\Version 5\FRAMECAD Detailer.exe"
TIMEOUT_SEC = 180
LAUNCH_SETTLE_SEC = 15
STARTUP_POLL_DEADLINE_SEC = 45  # total wait for main window with valid license title

# Exit code taxonomy
EX_OK              = 0
EX_LICENSE_BAD     = 1
EX_INPUT_MISSING   = 2
EX_UI_NOT_DETECTED = 3
EX_IMPORT_FAILED   = 4
EX_EXPORT_FAILED   = 5
EX_TIMEOUT         = 6
EX_UNKNOWN         = 7


def _emit(step: str, **kwargs):
    """Emit one structured status line to stderr."""
    payload = {"step": step, **kwargs}
    print(json.dumps(payload), file=sys.stderr, flush=True)


def _emit_error(category: int, message: str, **kwargs):
    payload = {"status": "error", "category": category, "message": message, **kwargs}
    print(json.dumps(payload), file=sys.stderr, flush=True)


# Lazy imports for Windows-only deps (so file is at least syntax-importable elsewhere)
def _import_deps():
    global psutil, pyautogui, Application
    import psutil as _psutil  # noqa
    import pyautogui as _pyautogui  # noqa
    from pywinauto import Application as _Application  # noqa
    psutil = _psutil
    pyautogui = _pyautogui
    Application = _Application


def kill_zombies():
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if "Detailer" in (p.info["name"] or ""):
                psutil.Process(p.info["pid"]).kill()
        except Exception:
            pass


def find_pid():
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if "Detailer" in (p.info["name"] or ""):
                return p.info["pid"]
        except Exception:
            pass
    return None


def launch_and_wait():
    """Launch Detailer, wait for main window, return Application handle."""
    if not Path(EXE_PATH).exists():
        raise RuntimeError(f"Detailer.exe not at {EXE_PATH}")
    subprocess.Popen([EXE_PATH], cwd=os.path.dirname(EXE_PATH))
    pid = None
    deadline = time.time() + 30
    while time.time() < deadline:
        time.sleep(0.5)
        pid = find_pid()
        if pid:
            break
    if not pid:
        raise RuntimeError("Detailer process not found within 30s of launch")
    time.sleep(LAUNCH_SETTLE_SEC)
    return Application(backend="win32").connect(process=pid), pid


def find_visible(app, cls):
    for w in app.windows():
        try:
            if w.is_visible() and w.class_name() == cls:
                return w
        except Exception:
            pass
    return None


def license_dialog_present(app):
    return find_visible(app, "TfrmLicenseNotice") is not None


def find_main_window(app):
    """Return the visible TfrmContainer-style main window if present (one shot)."""
    for w in app.windows():
        try:
            cls = w.class_name()
            if w.is_visible() and cls.startswith("Tfrm") and cls not in ("TfrmLicenseNotice",):
                return w
        except Exception:
            pass
    return None


def wait_for_ready_main(app, deadline_sec=STARTUP_POLL_DEADLINE_SEC):
    """
    Poll until we have a visible Tfrm* main window whose title contains
    'License valid'. Tolerates startup race where license-notice or empty
    windows briefly appear before the real main window settles.

    Returns (main_win, title) on success, (None, observation_str) on timeout.

    Observation strings start with one of:
      LICENSE_BLOCKED  — TfrmLicenseNotice persists (online activation failed,
                         most commonly because user is on a VPN that blocks
                         FrameCAD's licensing server)
      UI_NOT_READY     — no Tfrm* main window appeared in time
      UI_TITLE_BAD     — main window appeared but title lacks 'License valid'
    """
    end = time.time() + deadline_sec
    last_obs = "UI_NOT_READY: no windows seen yet"
    persistent_license_since = None
    while time.time() < end:
        # Hard fail only if TfrmLicenseNotice dialog persists >5s
        if license_dialog_present(app):
            persistent_license_since = persistent_license_since or time.time()
            if time.time() - persistent_license_since > 5:
                return None, (
                    "LICENSE_BLOCKED: TfrmLicenseNotice persisted >5s. "
                    "Detailer's online activation failed. Most likely cause: "
                    "user is on a VPN that blocks FrameCAD's licensing server. "
                    "Disconnect VPN, then retry."
                )
        else:
            persistent_license_since = None

        main = find_main_window(app)
        if main is not None:
            try:
                title = main.window_text() or ""
            except Exception:
                title = ""
            if "License valid" in title:
                return main, title
            last_obs = f"UI_TITLE_BAD: main window title lacks 'License valid': {title!r}"
        else:
            last_obs = "UI_NOT_READY: no Tfrm* main window yet"
        time.sleep(0.5)
    return None, f"{last_obs} (timeout after {deadline_sec}s)"


def auto_dismiss_popups(app, accept_labels=("&OK", "OK", "&Yes", "Yes", "&Ignore", "Ignore"), timeout=2):
    """Click OK / Yes / Ignore on any TMessageForm popup. Never Cancel."""
    deadline = time.time() + timeout
    dismissed = False
    while time.time() < deadline:
        w = find_visible(app, "TMessageForm")
        if not w:
            return dismissed
        clicked = False
        for label in accept_labels:
            for c in w.descendants():
                try:
                    if c.class_name() == "TButton" and c.window_text() == label:
                        c.click()
                        time.sleep(0.4)
                        clicked = True
                        dismissed = True
                        break
                except Exception:
                    pass
            if clicked:
                break
        if not clicked:
            time.sleep(0.3)
    return dismissed


def set_clipboard(text):
    """Set Windows clipboard to text via UTF-16 encoding."""
    subprocess.run(["clip"], input=text.encode("utf-16-le"), check=False)
    time.sleep(0.2)


def import_xml(app, main, xml_path, deadline):
    """Drive File > Import > XML. Returns True on success."""
    main.set_focus()
    time.sleep(0.4)

    # Open import dialog: Alt+F → i → x
    pyautogui.hotkey("alt", "f"); time.sleep(0.5)
    pyautogui.press("i"); time.sleep(0.4)
    pyautogui.press("x"); time.sleep(1.5)

    dlg = find_visible(app, "TdlgImport")
    if not dlg:
        return False

    # Click Add
    add_btn = None
    for c in dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Add":
                add_btn = c
                break
        except Exception:
            pass
    if not add_btn:
        return False
    add_btn.click(); time.sleep(1.5)

    # File picker
    file_dlg = find_visible(app, "#32770")
    if not file_dlg:
        return False

    # Find filename combo
    file_combo = None
    for c in file_dlg.descendants():
        try:
            cls = c.class_name()
            if (cls == "Edit" or "ComboBox" in cls) and c.rectangle().width() > 100:
                file_combo = c
                break
        except Exception:
            pass
    if not file_combo:
        return False

    # Set path via clipboard paste (avoids autocomplete issues with parens)
    file_combo.set_focus(); time.sleep(0.2)
    pyautogui.hotkey("ctrl", "a"); time.sleep(0.1)
    pyautogui.press("delete"); time.sleep(0.1)
    set_clipboard(xml_path)
    pyautogui.hotkey("ctrl", "v"); time.sleep(0.5)

    # Click Open
    open_btn = None
    for c in file_dlg.descendants():
        try:
            if c.class_name() == "Button" and c.window_text() in ("&Open", "Open"):
                open_btn = c
                break
        except Exception:
            pass
    if open_btn:
        open_btn.click_input(); time.sleep(2)
    else:
        pyautogui.press("enter"); time.sleep(2)

    # Wait for picker to close
    for _ in range(20):
        time.sleep(0.5)
        if not find_visible(app, "#32770"):
            break

    # Re-acquire dialog and let plan settle
    time.sleep(2)
    dlg = find_visible(app, "TdlgImport")
    if not dlg:
        return False

    # Select All to ensure plan is checked
    for c in dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Select All":
                c.click_input(); time.sleep(0.4)
                break
        except Exception:
            pass

    # Click Import
    import_btn = None
    for c in dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Import":
                import_btn = c
                break
        except Exception:
            pass
    if not import_btn:
        return False
    r = import_btn.rectangle()
    cx, cy = (r.left + r.right) // 2, (r.top + r.bottom) // 2
    pyautogui.moveTo(cx, cy, duration=0.2); time.sleep(0.3)
    pyautogui.click(); time.sleep(2)

    # Wait for import to complete: TdlgImport closes + popups dismissed
    while time.time() < deadline:
        time.sleep(0.5)
        auto_dismiss_popups(app, timeout=0.3)
        if not find_visible(app, "TdlgImport") and not find_visible(app, "TMessageForm"):
            time.sleep(2)  # let canvas settle
            return True
    return False


def export_rfy(app, main, rfy_out_path, deadline):
    """Drive File > Export > Rollformer RFY file → save."""
    main.set_focus()
    time.sleep(0.5)

    # Open Export submenu and navigate to RFY (item 7, so 6 downs after open)
    pyautogui.hotkey("alt", "f"); time.sleep(0.5)
    pyautogui.press("e"); time.sleep(0.5)
    for _ in range(6):
        pyautogui.press("down"); time.sleep(0.15)
    pyautogui.press("enter"); time.sleep(1.5)

    # Wait up to 10s for "Export to File" dialog
    export_dlg = None
    for _ in range(20):
        for w in app.windows():
            try:
                if w.is_visible() and "Export" in w.window_text() and w.class_name() not in ("TfrmContainer", "TApplication"):
                    export_dlg = w
                    break
            except Exception:
                pass
        if export_dlg:
            break
        time.sleep(0.5)
    if not export_dlg:
        return False

    # Click Select All
    for c in export_dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Select All":
                c.click_input(); time.sleep(0.5)
                break
        except Exception:
            pass

    # Click Export button (find by label, may be Delphi or Win32 class)
    export_btn = None
    for c in export_dlg.descendants():
        try:
            cls = c.class_name()
            if cls in ("TButton", "TBitBtn", "Button") and c.window_text() in ("Export", "&Export"):
                export_btn = c
                break
        except Exception:
            pass
    if not export_btn:
        return False
    export_btn.click_input(); time.sleep(2)

    # Standard Save dialog
    save_dlg = find_visible(app, "#32770")
    if not save_dlg:
        return False

    # Filename combo
    save_combo = None
    for c in save_dlg.descendants():
        try:
            cls = c.class_name()
            if (cls == "Edit" or "ComboBox" in cls) and c.rectangle().width() > 100:
                save_combo = c
                break
        except Exception:
            pass
    if not save_combo:
        return False

    # Set output path via clipboard
    save_combo.set_focus(); time.sleep(0.2)
    pyautogui.hotkey("ctrl", "a"); time.sleep(0.1)
    pyautogui.press("delete"); time.sleep(0.2)
    set_clipboard(rfy_out_path)
    pyautogui.hotkey("ctrl", "v"); time.sleep(0.5)
    pyautogui.press("enter"); time.sleep(2)

    # Wait for "Export Successful" popup, dismiss + verify file landed
    output = Path(rfy_out_path)
    while time.time() < deadline:
        time.sleep(0.5)
        auto_dismiss_popups(app, timeout=0.3)
        if output.exists() and output.stat().st_size > 0:
            time.sleep(0.5)
            return True

    # If our exact filename isn't there, look for ANY new RFY in the output dir
    out_dir = output.parent
    started = time.time() - 30
    for f in out_dir.glob("*.rfy"):
        try:
            if f.stat().st_mtime > started and f.stat().st_size > 0:
                # Detailer named it differently — rename to what we asked for
                if output.exists():
                    output.unlink()
                shutil.move(str(f), str(output))
                return True
        except Exception:
            pass
    return False


def main():
    parser = argparse.ArgumentParser(description="Forge Detailer worker — single-shot XML → RFY")
    parser.add_argument("xml_path", help="Input XML file path")
    parser.add_argument("rfy_out_path", help="Output RFY file path")
    args = parser.parse_args()

    xml_path = str(Path(args.xml_path).resolve())
    rfy_out = str(Path(args.rfy_out_path).resolve())

    if not Path(xml_path).is_file():
        _emit_error(EX_INPUT_MISSING, f"XML not found: {xml_path}")
        return EX_INPUT_MISSING

    Path(rfy_out).parent.mkdir(parents=True, exist_ok=True)
    if Path(rfy_out).exists():
        Path(rfy_out).unlink()

    try:
        _import_deps()
    except ImportError as e:
        _emit_error(EX_UNKNOWN, f"missing deps (psutil/pyautogui/pywinauto): {e}")
        return EX_UNKNOWN

    t0 = time.time()
    deadline = t0 + TIMEOUT_SEC

    try:
        kill_zombies()
        time.sleep(1)
        _emit("zombie_kill_done", elapsed_ms=int((time.time() - t0) * 1000))

        app, pid = launch_and_wait()
        _emit("launch_done", elapsed_ms=int((time.time() - t0) * 1000), pid=pid)

        # Robust startup wait: poll up to STARTUP_POLL_DEADLINE_SEC for a real
        # main window with "License valid" in its title. Handles the startup
        # race where TfrmLicenseNotice briefly flashes or windows aren't ready.
        main_win, observation = wait_for_ready_main(app)
        if main_win is None:
            elapsed = int((time.time() - t0) * 1000)
            if observation.startswith("LICENSE_BLOCKED"):
                _emit_error(EX_LICENSE_BAD, observation, elapsed_ms=elapsed)
                return EX_LICENSE_BAD
            _emit_error(EX_UI_NOT_DETECTED, observation, elapsed_ms=elapsed)
            return EX_UI_NOT_DETECTED

        title = main_win.window_text()
        _emit("main_window_found", title=title, elapsed_ms=int((time.time() - t0) * 1000))

        if not import_xml(app, main_win, xml_path, deadline):
            elapsed = int((time.time() - t0) * 1000)
            if time.time() >= deadline:
                _emit_error(EX_TIMEOUT, "import phase timed out", elapsed_ms=elapsed)
                return EX_TIMEOUT
            _emit_error(EX_IMPORT_FAILED, "import phase failed", elapsed_ms=elapsed)
            return EX_IMPORT_FAILED

        _emit("import_done", elapsed_ms=int((time.time() - t0) * 1000))

        if not export_rfy(app, main_win, rfy_out, deadline):
            elapsed = int((time.time() - t0) * 1000)
            if time.time() >= deadline:
                _emit_error(EX_TIMEOUT, "export phase timed out", elapsed_ms=elapsed)
                return EX_TIMEOUT
            _emit_error(EX_EXPORT_FAILED, "export phase failed", elapsed_ms=elapsed)
            return EX_EXPORT_FAILED

        rfy_size = Path(rfy_out).stat().st_size
        _emit("done", elapsed_ms=int((time.time() - t0) * 1000), rfy_bytes=rfy_size, rfy_path=rfy_out)
        # Clean exit — print success path to stdout for orchestrators
        print(rfy_out)
        return EX_OK

    except Exception as e:
        _emit_error(EX_UNKNOWN, f"unexpected exception: {e}", traceback=traceback.format_exc()[-500:])
        return EX_UNKNOWN
    finally:
        try:
            kill_zombies()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
