"""Probe Detailer's File menu items to find Export accelerator."""
import time, os, subprocess
import psutil, pyautogui
from pywinauto import Application

EXE = r"C:\Program Files (x86)\FRAMECAD\Detailer\Version 5\FRAMECAD Detailer.exe"

for p in psutil.process_iter(["pid","name"]):
    if "Detailer" in (p.info["name"] or ""):
        try: psutil.Process(p.info["pid"]).kill()
        except: pass
time.sleep(1)
subprocess.Popen([EXE], cwd=os.path.dirname(EXE))
pid = None
for _ in range(40):
    time.sleep(0.5)
    for p in psutil.process_iter(["pid","name"]):
        if "Detailer" in (p.info["name"] or ""): pid = p.info["pid"]; break
    if pid: break
time.sleep(8)

app = Application(backend="win32").connect(process=pid)
main = None
for w in app.windows():
    try:
        if w.is_visible() and w.class_name() == "TfrmContainer":
            main = w; break
    except: pass
main.set_focus()
time.sleep(0.5)

# Try UIA backend to enumerate menu items
print("=== UIA backend probe ===")
try:
    uia = Application(backend="uia").connect(process=pid)
    for w in uia.windows():
        try:
            if "FRAMECAD Detailer" in w.window_text():
                print(f"main: {w.window_text()!r}")
                # Find menu bar
                for d in w.descendants():
                    try:
                        ct = d.element_info.control_type
                        t = d.window_text()
                        if ct == "MenuBar" or "Menu" in (ct or ""):
                            print(f"  ctype={ct} text={t!r}")
                            for child in d.children():
                                try:
                                    print(f"    ctype={child.element_info.control_type} text={child.window_text()!r}")
                                except: pass
                    except: pass
                break
        except: pass
except Exception as e:
    print(f"UIA failed: {e}")

# Open File menu and screenshot
print("\n=== Win32: open File menu, screenshot ===")
pyautogui.hotkey("alt", "f")
time.sleep(0.8)
img = pyautogui.screenshot()
out = r"C:\Users\Scott\CLAUDE CODE\hytek-rfy-tools\tmp_detailer_test\file-menu-open.png"
img.save(out)
print(f"  saved: {out}")
print("  visible windows:")
for w in app.windows():
    try:
        if w.is_visible():
            print(f"    class={w.class_name()!r} text={w.window_text()!r}")
    except: pass

# Press Esc to close menu
pyautogui.press("escape"); time.sleep(0.5)
pyautogui.press("escape"); time.sleep(0.5)
