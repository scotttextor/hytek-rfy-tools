"""Open Detailer's File→Export submenu and screenshot it to see items."""
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

# Open File menu
print("Pressing Alt+F")
pyautogui.hotkey("alt", "f"); time.sleep(0.8)
img = pyautogui.screenshot()
img.save(r"C:\Users\Scott\CLAUDE CODE\hytek-rfy-tools\tmp_detailer_test\probe-1-file-menu.png")

# Press 'e' to open Export submenu
print("Pressing 'e'")
pyautogui.press("e"); time.sleep(0.8)
img = pyautogui.screenshot()
img.save(r"C:\Users\Scott\CLAUDE CODE\hytek-rfy-tools\tmp_detailer_test\probe-2-export-submenu.png")

# Don't navigate further. Take a screenshot of just the menu region.
print("done; screenshots saved")
print("Press Esc to close menus")
pyautogui.press("escape"); pyautogui.press("escape"); time.sleep(0.5)
