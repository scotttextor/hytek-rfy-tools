"""Diagnostic: launch Detailer, drive Show-Lic→I-Agree→Sign-In, then wait
60s and dump the final state so we can see what's actually on screen."""
import os, subprocess, sys, time
import psutil
from pywinauto import Application, Desktop

EXE = r"C:\Program Files (x86)\FRAMECAD\Detailer\Version 5\FRAMECAD Detailer.exe"

def kill_all():
    for p in psutil.process_iter(["pid","name"]):
        try:
            if "Detailer" in (p.info["name"] or ""):
                psutil.Process(p.info["pid"]).kill()
        except Exception: pass

def find_pid():
    for p in psutil.process_iter(["pid","name"]):
        try:
            if "Detailer" in (p.info["name"] or ""):
                return p.info["pid"]
        except Exception: pass
    return None

kill_all(); time.sleep(2)
print("[probe] launching", flush=True)
subprocess.Popen([EXE], cwd=os.path.dirname(EXE))

pid = None
for _ in range(40):
    time.sleep(0.5)
    pid = find_pid()
    if pid: break
print(f"[probe] PID={pid}", flush=True)

# Wait for TfrmLicenseNotice to appear
app = None
for _ in range(40):
    time.sleep(0.5)
    try:
        app = Application(backend="win32").connect(process=pid)
        for w in app.windows():
            try:
                if w.is_visible() and w.class_name() == "TfrmLicenseNotice":
                    raise StopIteration
            except StopIteration: raise
            except Exception: pass
    except StopIteration: break
    except Exception: pass

# Click Show License Information
print("\n[probe] clicking 'Show License Information'", flush=True)
notice = None
for w in app.windows():
    try:
        if w.is_visible() and w.class_name() == "TfrmLicenseNotice":
            notice = w; break
    except Exception: pass

show_btn = None
for c in notice.descendants():
    try:
        if c.class_name() == "TButton" and c.window_text() == "Show License Information":
            show_btn = c; break
    except Exception: pass
show_btn.click()
time.sleep(3)

# Find FRAMECAD Licensing System window
print("[probe] finding licensing system window", flush=True)
licsys = None
for _ in range(20):
    for w in app.windows():
        try:
            if not w.is_visible(): continue
            cls = w.class_name() or ""
            if cls.startswith("WindowsForms10.Window.8.app.") and "FRAMECAD Licensing System" in (w.window_text() or ""):
                licsys = w; break
        except Exception: pass
    if licsys: break
    time.sleep(0.5)
print(f"[probe] licsys={'YES' if licsys else 'NO'}", flush=True)

# Tick I agree (empty BUTTON ~23x21)
print("[probe] ticking I agree", flush=True)
agree = None
for c in licsys.descendants():
    try:
        cls = c.class_name() or ""
        if "WindowsForms10.BUTTON" not in cls: continue
        if c.window_text() or "": continue
        r = c.rectangle()
        if 18 <= r.width() <= 30 and 18 <= r.height() <= 26:
            agree = c; break
    except Exception: pass
print(f"[probe] agree={'YES' if agree else 'NO'}", flush=True)
if agree:
    try: agree.click()
    except: agree.click_input()
    time.sleep(0.7)

# Click Sign In
print("[probe] clicking Sign In", flush=True)
signin = None
for c in licsys.descendants():
    try:
        cls = c.class_name() or ""
        if "WindowsForms10.BUTTON" not in cls: continue
        if (c.window_text() or "").strip() == "Sign In":
            signin = c; break
    except Exception: pass
print(f"[probe] signin={'YES' if signin else 'NO'}", flush=True)
if signin:
    try: signin.click()
    except: signin.click_input()

# Wait 60s, dump state every 5s
print("\n[probe] waiting 60s, dumping state every 10s", flush=True)
for sec in (5, 15, 30, 45, 60):
    time.sleep(5 if sec == 5 else (sec - prev_sec if sec != 5 else 5))
    prev_sec = sec
    print(f"\n=== t+{sec}s ===", flush=True)
    try:
        for w in app.windows():
            try:
                if not w.is_visible(): continue
                cls = w.class_name() or ""
                txt = (w.window_text() or "")[:120]
                print(f"  cls={cls!r} txt={txt!r}", flush=True)
            except Exception: pass
    except Exception as e:
        print(f"  err: {e}", flush=True)

# Also dump descendants of any TfrmContainer or licensing window
print("\n=== final descendants of TfrmContainer (if any) ===", flush=True)
try:
    for w in app.windows():
        try:
            if not w.is_visible(): continue
            cls = w.class_name() or ""
            if cls == "TfrmContainer" or "Licensing" in (w.window_text() or ""):
                print(f"\n--- {cls!r} '{w.window_text()}' ---", flush=True)
                for c in w.descendants():
                    try:
                        if not c.is_visible(): continue
                        c_cls = c.class_name(); c_txt = (c.window_text() or "")[:100]
                        print(f"  cls={c_cls!r} txt={c_txt!r}", flush=True)
                    except Exception: pass
        except Exception: pass
except Exception as e:
    print(f"  err: {e}", flush=True)

print("\n[probe] done, killing Detailer in 5s", flush=True)
time.sleep(5)
kill_all()
