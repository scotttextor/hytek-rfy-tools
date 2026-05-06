"""Probe TdlgImport's controls so we can drive it programmatically."""
import time, os, subprocess
import psutil, pyautogui
from pywinauto import Application

EXE = r"C:\Program Files (x86)\FRAMECAD\Detailer\Version 5\FRAMECAD Detailer.exe"


def kill_zombies():
    for p in psutil.process_iter(["pid", "name"]):
        if "Detailer" in (p.info["name"] or ""):
            try: psutil.Process(p.info["pid"]).kill()
            except Exception: pass


def find_pid():
    for p in psutil.process_iter(["pid", "name"]):
        if "Detailer" in (p.info["name"] or ""):
            return p.info["pid"]


def main():
    kill_zombies()
    time.sleep(1)
    subprocess.Popen([EXE], cwd=os.path.dirname(EXE))
    pid = None
    for _ in range(40):
        time.sleep(0.5)
        pid = find_pid()
        if pid: break
    time.sleep(8)

    app = Application(backend="win32").connect(process=pid)
    main_win = None
    for w in app.windows():
        try:
            if w.is_visible() and w.class_name() == "TfrmContainer":
                main_win = w; break
        except Exception: pass
    main_win.set_focus(); time.sleep(0.5)
    pyautogui.hotkey("alt", "f"); time.sleep(0.6)
    pyautogui.press("i"); time.sleep(0.4)
    pyautogui.press("x"); time.sleep(1.5)

    # Find TdlgImport
    for w in app.windows():
        try:
            if w.is_visible() and w.class_name() == "TdlgImport":
                print(f"TdlgImport title: {w.window_text()!r}")
                print(f"\nDescendants:")
                for c in w.descendants():
                    try:
                        print(f"  class={c.class_name()!r:30s} text={(c.window_text() or '')[:40]!r:42s} rect={c.rectangle()}")
                    except Exception as e:
                        print(f"  err: {e}")
                break
        except Exception: pass


if __name__ == "__main__":
    main()
