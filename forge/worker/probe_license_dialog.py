"""Probe: launch Detailer in the license-blocked state, walk the licensing
dialog descendants, dump their class/text. Used to figure out what to click
to drive the sign-in flow."""
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
print("[probe] launching Detailer...", flush=True)
subprocess.Popen([EXE], cwd=os.path.dirname(EXE))

pid = None
for _ in range(40):
    time.sleep(0.5)
    pid = find_pid()
    if pid: break
print(f"[probe] PID={pid}", flush=True)

# Connect FAST — Detailer self-closes if the license dialog dismisses badly.
# Poll every 0.5s for up to 25s for the TfrmLicenseNotice dialog to appear.
app = None
deadline = time.time() + 25
while time.time() < deadline:
    time.sleep(0.5)
    # Re-check process is still alive
    if find_pid() is None:
        print("[probe] FATAL: Detailer process exited before we could connect", flush=True)
        sys.exit(1)
    try:
        app = Application(backend="win32").connect(process=pid)
        # Look for TfrmLicenseNotice
        for w in app.windows():
            try:
                if w.is_visible() and w.class_name() == "TfrmLicenseNotice":
                    print(f"[probe] TfrmLicenseNotice up at t={int(time.time()-deadline+25)}s", flush=True)
                    raise StopIteration
            except StopIteration: raise
            except Exception: pass
    except StopIteration:
        break
    except Exception:
        pass
else:
    print("[probe] timeout waiting for TfrmLicenseNotice — bailing", flush=True)
    sys.exit(1)

def dump_window(w, indent=0):
    try:
        cls = w.class_name()
        txt = (w.window_text() or "")[:80]
        vis = w.is_visible()
    except Exception as e:
        print(f"{'  '*indent}<err {e}>", flush=True); return
    if not vis: return
    print(f"{'  '*indent}cls={cls!r} txt={txt!r}", flush=True)
    try:
        for c in w.descendants():
            try:
                vis2 = c.is_visible()
                if not vis2: continue
                cls2 = c.class_name()
                txt2 = (c.window_text() or "")[:80]
                rect = c.rectangle()
                w_, h_ = rect.width(), rect.height()
                print(f"{'  '*(indent+1)}cls={cls2!r} txt={txt2!r} size={w_}x{h_}", flush=True)
            except Exception as e:
                print(f"{'  '*(indent+1)}<desc err {e}>", flush=True)
    except Exception as e:
        print(f"{'  '*indent}<descendants err {e}>", flush=True)

print("\n=== STAGE 1: Licensing block dialog (TfrmLicenseNotice) ===", flush=True)
for w in app.windows():
    try:
        if w.is_visible() and w.class_name() == "TfrmLicenseNotice":
            dump_window(w)
    except Exception: pass

# Now find and click "Show License Information" button
print("\n=== Trying to click 'Show License Information' ===", flush=True)
license_notice = None
for w in app.windows():
    try:
        if w.is_visible() and w.class_name() == "TfrmLicenseNotice":
            license_notice = w; break
    except Exception: pass

if license_notice:
    show_btn = None
    for c in license_notice.descendants():
        try:
            if c.class_name() == "TButton" and "Show License" in (c.window_text() or ""):
                show_btn = c; break
            # Also try other button class names
            if "Button" in c.class_name() and "License" in (c.window_text() or ""):
                show_btn = c; break
        except Exception: pass
    if show_btn:
        print(f"[probe] clicking: {show_btn.class_name()!r} '{show_btn.window_text()}'", flush=True)
        show_btn.click()
        time.sleep(8)
    else:
        print("[probe] 'Show License Information' button NOT FOUND on TfrmLicenseNotice", flush=True)
        # Dump again with all descendants regardless of class
        print("\n=== TfrmLicenseNotice ALL descendants (no filter) ===", flush=True)
        for c in license_notice.descendants():
            try:
                cls = c.class_name(); txt = (c.window_text() or "")[:80]
                print(f"  cls={cls!r} txt={txt!r}", flush=True)
            except Exception: pass

print("\n=== STAGE 2a: All visible top-level windows in DETAILER process ===", flush=True)
for w in app.windows():
    try:
        if w.is_visible():
            cls = w.class_name()
            txt = (w.window_text() or "")[:80]
            print(f"\n--- {cls!r} '{txt}' ---", flush=True)
            dump_window(w)
    except Exception as e: print(f"err: {e}", flush=True)

print("\n=== STAGE 2b: ALL visible top-level windows on DESKTOP ===", flush=True)
for w in Desktop(backend="win32").windows():
    try:
        if not w.is_visible(): continue
        cls = w.class_name()
        txt = (w.window_text() or "")[:80]
        try: ppid = w.process_id()
        except: ppid = "?"
        # Skip known non-Detailer system windows
        if cls in ("WorkerW", "Progman", "Shell_TrayWnd", "TaskListThumbnailWnd",
                   "MSCTFIME UI", "IME", "TPUtilWindow",
                   "Windows.UI.Core.CoreWindow", "ApplicationFrameWindow"):
            continue
        if not txt and cls in ("CabinetWClass", "Edit"): continue
        print(f"\n--- pid={ppid} cls={cls!r} '{txt}' ---", flush=True)
        try:
            for c in w.descendants():
                try:
                    if not c.is_visible(): continue
                    cls2 = c.class_name(); txt2 = (c.window_text() or "")[:80]
                    rect = c.rectangle()
                    print(f"  cls={cls2!r} txt={txt2!r} size={rect.width()}x{rect.height()}", flush=True)
                except Exception: pass
        except Exception as e:
            print(f"  <descendants err: {e}>", flush=True)
    except Exception: pass

print("\n[probe] leaving Detailer running for 5s then killing", flush=True)
time.sleep(5)
kill_all()
print("[probe] done", flush=True)
