"""Probe Export submenu items via UIA for accurate text reading."""
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
main.set_focus(); time.sleep(0.5)

# Open Export submenu
pyautogui.hotkey("alt", "f"); time.sleep(0.5)
pyautogui.press("e"); time.sleep(0.8)

# UIA probe of menu items
print("=== UIA: enumerate visible windows + their menu items ===")
try:
    uia = Application(backend="uia").connect(process=pid)
    for w in uia.windows():
        try:
            if not w.is_visible(): continue
            ct = w.element_info.control_type
            t = w.window_text()
            print(f"window: ctype={ct} text={t!r}")
            for d in w.descendants():
                try:
                    dct = d.element_info.control_type
                    dt = d.window_text()
                    if dct == "MenuItem" and dt:
                        rect = d.rectangle()
                        print(f"  MenuItem text={dt!r} rect={rect}")
                except: pass
        except: pass
except Exception as e:
    print(f"UIA error: {e}")

# Don't close menu yet - take final screenshot
img = pyautogui.screenshot()
img.save(r"C:\Users\Scott\CLAUDE CODE\hytek-rfy-tools\tmp_detailer_test\probe-export-final.png")
print("\nScreenshot saved")
pyautogui.press("escape"); pyautogui.press("escape"); time.sleep(0.5)
