"""
detailer-batch.py — Drive FRAMECAD Detailer to convert input XML -> RFY for many jobs.

This is the production path to 100% bit-exact match: instead of reverse-
engineering Detailer's algorithms in code, we use Detailer itself as the
oracle. Run this script on a machine with a working Detailer license; it walks
Y: drive, runs every XML through Detailer, and writes the resulting RFY to a
shared cache directory. The Vercel app's oracle-cache then serves those bytes
verbatim for any matching upload — guaranteed bit-exact match because they ARE
Detailer's bytes.

Two modes:

  1. Single shot:
       python detailer-batch.py <xml_path> <out_rfy_path>

  2. Batch (walks Y: drive):
       python detailer-batch.py --batch [--filter HG260017] [--cache-dir D:\\detailer-cache]

Defaults:
  - Cache dir:  C:\\Users\\Scott\\OneDrive - Textor Metal Industries\\
                CLAUDE DATA FILE\\detailer-oracle-cache\\
  - Filter:     all jobs found under Y:\\(17) 2026 HYTEK PROJECTS\\
  - License:    aborts cleanly if license dialog won't dismiss.

Output cache layout:
    <cache_dir>/<jobnum>/<plan>.rfy
    <cache_dir>/<jobnum>/<plan>.meta.json    {xml_size, xml_sha256, generated_at}
    <cache_dir>/_index.json                  list of all entries

The Vercel app reads <cache_dir>/<jobnum>/<plan>.rfy on startup just like the
existing reference-RFY index.

DEPENDENCIES (one-time setup on the runner machine):
    pip install psutil pyautogui pywinauto pillow

PRE-FLIGHT:
    1. Detailer 5.x installed at C:\\Program Files (x86)\\FRAMECAD\\Detailer\\Version 5\\
    2. License valid (Sign In via online or HASP dongle)
    3. NO other Detailer instance running
    4. Y: drive mounted

If license is broken, the script aborts at startup with a clear error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

# Lazy imports for Windows-only deps so the file is at least syntactically
# importable on non-Windows machines (CI, etc.) — the actual driver of course
# only runs on Windows.
try:
    import psutil  # type: ignore
    import pyautogui  # type: ignore
    from pywinauto import Application  # type: ignore
    HAS_DRIVER_DEPS = True
except ImportError:
    HAS_DRIVER_DEPS = False

EXE_PATH = r"C:\Program Files (x86)\FRAMECAD\Detailer\Version 5\FRAMECAD Detailer.exe"
PROJECTS_ROOT = r"Y:\(17) 2026 HYTEK PROJECTS"
DEFAULT_CACHE_DIR = (
    r"C:\Users\Scott\OneDrive - Textor Metal Industries\CLAUDE DATA FILE"
    r"\detailer-oracle-cache"
)


# ---------------------------------------------------------------------------
# Process / license management
# ---------------------------------------------------------------------------

def find_detailer_pid() -> Optional[int]:
    if not HAS_DRIVER_DEPS:
        return None
    for p in psutil.process_iter(["pid", "name"]):
        if "Detailer" in (p.info["name"] or ""):
            return p.info["pid"]
    return None


def kill_existing_detailer() -> None:
    if not HAS_DRIVER_DEPS:
        return
    for p in psutil.process_iter(["pid", "name"]):
        if "Detailer" in (p.info["name"] or ""):
            try:
                psutil.Process(p.info["pid"]).kill()
            except Exception:
                pass


def launch_detailer() -> int:
    if not Path(EXE_PATH).exists():
        raise FileNotFoundError(f"Detailer not found at {EXE_PATH}")
    subprocess.Popen([EXE_PATH], cwd=os.path.dirname(EXE_PATH))
    for _ in range(30):  # wait up to 15s
        time.sleep(0.5)
        pid = find_detailer_pid()
        if pid:
            return pid
    raise TimeoutError("Detailer launched but PID not found")


def connect(pid: Optional[int] = None) -> "Application":
    if pid is None:
        pid = find_detailer_pid()
    if pid is None:
        raise RuntimeError("Detailer is not running")
    return Application(backend="win32").connect(process=pid)


def license_dialog_present(app: "Application") -> bool:
    try:
        for w in app.windows():
            if w.is_visible() and w.class_name() == "TfrmLicenseNotice":
                return True
    except Exception:
        pass
    return False


def assert_license_ok() -> "Application":
    """Launch Detailer, dismiss any license-info popup, ensure no
    license-block dialog remains. Returns the connected Application.
    Raises if license is bad."""
    pid = find_detailer_pid()
    if pid is None:
        pid = launch_detailer()
    app = connect(pid)

    # Wait briefly to see if a license dialog appears.
    deadline = time.time() + 8
    while time.time() < deadline:
        if license_dialog_present(app):
            break
        time.sleep(0.5)

    if license_dialog_present(app):
        raise RuntimeError(
            "Detailer license dialog is up — license is not valid. "
            "Activate the license (Sign In with online account, or attach "
            "HASP dongle) manually first, then re-run this script. "
            "If you've just activated and Detailer still won't dismiss the "
            "license dialog, kill Detailer fully, then relaunch."
        )
    return app


# ---------------------------------------------------------------------------
# XML -> RFY (single-shot)
# ---------------------------------------------------------------------------

def find_main_window(app: "Application"):
    for w in app.windows():
        try:
            cls = w.class_name()
            if w.is_visible() and cls.startswith("Tfrm") and cls != "TfrmLicenseNotice":
                return w
        except Exception:
            pass
    return None


def _find_visible(app, cls):
    for w in app.windows():
        try:
            if w.is_visible() and w.class_name() == cls:
                return w
        except Exception: pass
    return None


def _project_tree_has_children(main_win) -> bool:
    """Detect successful import. Check several signals.

    Detailer does NOT change main_win.window_text() on import (stays
    'untitled.fcp' for an untitled-but-imported project). So we look for:
      1. Any descendant whose text starts with 'HG' (the project name appears
         in Project Tree)
      2. Or TTreeView with non-empty children
      3. Or new windows (canvas painted)
    """
    try:
        for c in main_win.descendants():
            try:
                t = c.window_text() or ""
                # Project Tree node label looks like 'HG260017 LOT 925 (42)...'
                if t.startswith("HG") and len(t) > 5:
                    return True
                # GF/FF/etc. plan nodes
                if t.startswith(("GF-", "FF-", "RF-")) and len(t) > 5:
                    return True
            except Exception: pass
    except Exception: pass
    return False


def xml_to_rfy(xml_path: str, output_dir: str, app: Optional["Application"] = None) -> str:
    """Convert one XML to one RFY via Detailer GUI automation.

    Updated 2026-05-06 with the actual flow from manual verification:
    1. Alt+F -> i -> x -> TdlgImport (Detailer's custom XML import dialog)
    2. Click 'Add' -> standard #32770 file picker -> type path -> Enter
    3. Click 'Import' on TdlgImport -> Detailer imports (auto-selects machine
       setup from XML profile; no need to manually set combos)
    4. Detection: Project Tree populates (NOT title bar — Detailer leaves
       title as 'untitled.fcp' for imports)
    5. Alt+F -> e -> r -> 'Export to File' dialog (TdlgExport custom Detailer
       dialog with frame grid)
    6. Click 'Select All' -> click 'Export' button
    7. Standard Save dialog -> set path -> click Save
    8. RFY lands at the path

    Returns the absolute path to the written RFY.
    """
    if not HAS_DRIVER_DEPS:
        raise RuntimeError(
            "Driver dependencies not installed. Run: "
            "pip install psutil pyautogui pywinauto pillow"
        )

    xml_path = str(Path(xml_path).resolve())
    output_dir = str(Path(output_dir).resolve())
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    if not Path(xml_path).is_file():
        raise FileNotFoundError(xml_path)

    app = app or assert_license_ok()
    main = find_main_window(app)
    if main is None:
        raise RuntimeError("No Detailer main window visible")
    main.set_focus()
    time.sleep(0.4)

    # =================== IMPORT ===================
    pyautogui.hotkey("alt", "f"); time.sleep(0.4)
    pyautogui.press("i"); time.sleep(0.3)
    pyautogui.press("x"); time.sleep(1.5)

    dlg = _find_visible(app, "TdlgImport")
    if not dlg:
        raise RuntimeError("TdlgImport did not appear after Alt+F->i->x")

    # Click 'Add' button
    add_btn = None
    for c in dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Add":
                add_btn = c; break
        except Exception: pass
    if not add_btn:
        raise RuntimeError("'Add' button not found on TdlgImport")
    add_btn.click(); time.sleep(1.5)

    # Standard file picker
    file_dlg = _find_visible(app, "#32770")
    if not file_dlg:
        raise RuntimeError("File picker (#32770) did not appear after clicking Add")

    # Find filename combo + paste path
    file_combo = None
    for c in file_dlg.descendants():
        try:
            cls = c.class_name()
            if (cls == "Edit" or "ComboBox" in cls) and c.rectangle().width() > 100:
                file_combo = c; break
        except Exception: pass
    if not file_combo:
        raise RuntimeError("Filename combo not found in file picker")
    file_combo.set_focus(); time.sleep(0.2)
    pyautogui.hotkey("ctrl", "a"); time.sleep(0.1)
    pyautogui.press("delete"); time.sleep(0.1)
    pyautogui.typewrite(xml_path, interval=0.005); time.sleep(0.8)

    # Click 'Open' button explicitly instead of pressing Enter (paths with
    # parens like '(17)' confuse Enter handling in some Windows file dialogs).
    open_btn = None
    for c in file_dlg.descendants():
        try:
            cls = c.class_name()
            if cls == "Button" and c.window_text() in ("&Open", "Open"):
                open_btn = c; break
        except Exception: pass
    if open_btn:
        open_btn.click_input(); time.sleep(2)
    else:
        pyautogui.press("enter"); time.sleep(2)

    # Wait for picker to close
    for _ in range(20):
        time.sleep(0.5)
        if not _find_visible(app, "#32770"):
            break

    # Wait a full 3s for Detailer to register the added plan in the CheckListBox.
    # Without this, clicking Import too quickly causes silent failure.
    time.sleep(3)

    # Click 'Import' on TdlgImport
    dlg = _find_visible(app, "TdlgImport")
    if not dlg:
        raise RuntimeError("TdlgImport disappeared after file picker close")

    # Ensure all plans in the CheckListBox are checked (Select All button).
    for c in dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Select All":
                c.click_input(); time.sleep(0.5); break
        except Exception: pass

    import_btn = None
    for c in dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Import":
                import_btn = c; break
        except Exception: pass
    if not import_btn:
        raise RuntimeError("'Import' button not found on TdlgImport")
    # Move mouse to the button and click via OS-level pyautogui (more reliable
    # for 32-bit apps automated from 64-bit Python).
    r = import_btn.rectangle()
    cx, cy = (r.left + r.right) // 2, (r.top + r.bottom) // 2
    pyautogui.moveTo(cx, cy, duration=0.3); time.sleep(0.4)
    pyautogui.click(); time.sleep(3)

    # Wait for import to complete; auto-dismiss any TMessageForm popups
    # (they are benign warnings like "Some imported sections could not be
    # matched and have been created in the project configuration"). Click
    # OK / Yes / Ignore in priority order — they all advance the import.
    # NEVER click Cancel — that aborts the import.
    deadline = time.time() + 90
    imported = False
    while time.time() < deadline:
        time.sleep(0.5)
        # Auto-dismiss popups via OK/Yes/Ignore
        for w in app.windows():
            try:
                if w.is_visible() and w.class_name() == "TMessageForm":
                    clicked = False
                    for label in ("&OK", "OK", "&Yes", "Yes", "&Ignore", "Ignore"):
                        if clicked: break
                        for c in w.descendants():
                            try:
                                if c.class_name() == "TButton" and c.window_text() == label:
                                    c.click(); time.sleep(0.5); clicked = True; break
                            except Exception: pass
                    break
            except Exception: pass
        # Detection: TdlgImport gone AND no popup = import done
        if not _find_visible(app, "TdlgImport") and not _find_visible(app, "TMessageForm"):
            time.sleep(2)  # let canvas paint
            imported = True
            break
    if not imported:
        raise RuntimeError("Import did not complete within 90s")

    # =================== EXPORT ===================
    # Menu navigation: Alt+F -> e opens the Export submenu. The submenu items
    # in order (verified manually 2026-05-06):
    #   1. 3D VRML
    #   2. DXF
    #   3. Excel
    #   4. Frame Types / Machine Setups / Steel Setups
    #   5. 3D DXF file
    #   6. IFC file
    #   7. Rollformer RFY file   ← target
    #   8. Upload to NEXA
    #   9. FIM file
    # On submenu open, cursor is on item 1. Press DOWN 6 times to reach RFY,
    # then Enter to fire it.
    main.set_focus(); time.sleep(0.5)
    pyautogui.hotkey("alt", "f"); time.sleep(0.5)
    pyautogui.press("e"); time.sleep(0.5)  # opens Export submenu
    for _ in range(6):
        pyautogui.press("down"); time.sleep(0.15)
    pyautogui.press("enter"); time.sleep(1.5)

    # 'Export to File' dialog (custom Detailer, not standard Save).
    # Wait up to 10s for it to appear.
    export_dlg = None
    for _ in range(20):
        for w in app.windows():
            try:
                if w.is_visible() and "Export" in w.window_text():
                    cls = w.class_name()
                    # Skip the main window which has 'Export' in some menu state
                    if cls != "TfrmContainer" and cls != "TApplication":
                        export_dlg = w; break
            except Exception: pass
        if export_dlg: break
        time.sleep(0.5)
    if not export_dlg:
        # Diagnostic dump
        print("  [diagnostic] visible windows after Export menu:")
        for w in app.windows():
            try:
                if w.is_visible():
                    print(f"    class={w.class_name()!r}  text={w.window_text()!r}")
            except Exception: pass
        try:
            full = pyautogui.screenshot()
            diag_path = str(Path(output_dir) / "export-failure-state.png")
            full.save(diag_path)
            print(f"  [diagnostic] full screenshot: {diag_path}")
        except Exception: pass
        raise RuntimeError("'Export' dialog did not appear after Alt+F+e+r")

    # Click 'Select All' button to ensure all frames selected
    for c in export_dlg.descendants():
        try:
            if c.class_name() == "TButton" and c.window_text() == "Select All":
                c.click_input(); time.sleep(0.5); break
        except Exception: pass

    # Click 'Export' button. May be Delphi (TButton/TBitBtn) or Windows native (Button).
    export_btn = None
    all_buttons = []  # for diagnostics
    button_classes = ("TButton", "TBitBtn", "TSpeedButton", "TBmpButton", "Button")
    for c in export_dlg.descendants():
        try:
            cls = c.class_name()
            if cls in button_classes:
                t = c.window_text()
                all_buttons.append(f"{cls}:{t!r}")
                if t in ("Export", "&Export"):
                    export_btn = c; break
        except Exception: pass
    if not export_btn:
        for c in export_dlg.descendants():
            try:
                cls = c.class_name()
                if cls in button_classes:
                    t = c.window_text()
                    if "Export" in t and "Options" not in t:
                        export_btn = c; break
            except Exception: pass
    if not export_btn:
        # Last resort: click via known coords (fragile but works on this PC).
        # From Scott's screenshot the Export button is at roughly (872, 1042).
        # Probe FALLBACK only if all_buttons is empty.
        print(f"  [diagnostic] Export dialog buttons by class: {all_buttons[:20]}")
        # Print all descendants so we can identify the right class
        all_desc = []
        for c in export_dlg.descendants():
            try:
                cls = c.class_name(); t = c.window_text()[:30] if c.window_text() else ""
                if t:
                    all_desc.append(f"{cls}:{t!r}")
            except: pass
        print(f"  [diagnostic] all descendants with text: {all_desc[:30]}")
        raise RuntimeError(f"'Export' button not found")
    export_btn.click_input(); time.sleep(2)

    # Standard Save dialog
    save_dlg = _find_visible(app, "#32770")
    if not save_dlg:
        raise RuntimeError("Save dialog (#32770) did not appear after Export click")

    # Filename combo. The "Export RFY file to" dialog opens in Recent Items
    # by default, so typing a full path letter-by-letter triggers autocomplete
    # and the leading chars get eaten. We use clipboard paste instead.
    save_combo = None
    for c in save_dlg.descendants():
        try:
            cls = c.class_name()
            if (cls == "Edit" or "ComboBox" in cls) and c.rectangle().width() > 100:
                save_combo = c; break
        except Exception: pass
    if not save_combo:
        raise RuntimeError("Filename combo not found in save dialog")

    rfy_basename = Path(xml_path).stem + ".rfy"
    rfy_out = str(Path(output_dir) / rfy_basename)

    # Set clipboard to the full path, then paste with Ctrl+V. Atomic — bypasses
    # autocomplete entirely.
    save_combo.set_focus(); time.sleep(0.3)
    pyautogui.hotkey("ctrl", "a"); time.sleep(0.1)
    pyautogui.press("delete"); time.sleep(0.2)
    # Use Windows clipboard API directly (no extra deps).
    import subprocess as _sp
    _sp.run(["clip"], input=rfy_out.encode("utf-16-le"), check=False)
    time.sleep(0.3)
    pyautogui.hotkey("ctrl", "v"); time.sleep(0.5)
    pyautogui.press("enter"); time.sleep(2)

    # If a "can't save here" error dialog appeared, dismiss it and retry
    # — but for now, fail loudly so we can see the issue.
    for w in app.windows():
        try:
            if w.is_visible() and w.class_name() == "#32770" and "save" in w.window_text().lower():
                # Could be the parent save dialog or a child error dialog.
                # If it has only OK button, it's an error.
                pass
        except Exception: pass

    # Confirm overwrite if prompted
    try:
        confirm = _find_visible(app, "#32770")
        if confirm and confirm.handle != save_dlg.handle:
            for c in confirm.descendants():
                try:
                    if c.class_name() == "Button" and c.window_text() in ("&Yes", "Yes"):
                        c.click_input(); time.sleep(0.5); break
                except Exception: pass
    except Exception: pass

    # Detailer pops an "Export Successful" / "Information" dialog after writing
    # the RFY. Click OK to dismiss it, then look for the new RFY file.
    deadline = time.time() + 60
    started = time.time() - 5  # 5s grace
    produced = None
    success_dismissed = False
    while time.time() < deadline:
        time.sleep(0.5)
        # Dismiss any "Export Successful" / Information popup
        for w in app.windows():
            try:
                if w.is_visible() and w.class_name() == "TMessageForm":
                    title = w.window_text()
                    # Click OK / Yes
                    for c in w.descendants():
                        try:
                            if c.class_name() == "TButton" and c.window_text() in ("OK", "&OK", "Yes", "&Yes"):
                                c.click(); time.sleep(0.5)
                                if "Information" in title or "Success" in title or "Export" in title:
                                    success_dismissed = True
                                break
                        except Exception: pass
                    break
            except Exception: pass
        # Look for the new RFY file
        try:
            for f in Path(output_dir).glob("*.rfy"):
                try:
                    if f.stat().st_mtime > started and f.stat().st_size > 0:
                        produced = f; break
                except Exception: pass
            if produced and success_dismissed: break
        except Exception: pass
    if not produced:
        raise RuntimeError(f"No new RFY appeared in {output_dir} within 60s")

    # Now close the "Export to File" dialog (it's still open behind the popup)
    for w in app.windows():
        try:
            if w.is_visible() and "Export" in w.window_text() and w.class_name() != "TfrmContainer":
                # Click Cancel to close
                for c in w.descendants():
                    try:
                        if c.class_name() == "TButton" and c.window_text() in ("Cancel", "&Cancel", "Close"):
                            c.click(); time.sleep(0.5); break
                    except Exception: pass
                break
        except Exception: pass

    # Rename to the requested output if different
    target = Path(rfy_out)
    if produced.resolve() != target.resolve():
        try:
            if target.exists(): target.unlink()
            produced.rename(target)
            print(f"  [detailer-batch] renamed {produced.name} -> {target.name}")
        except Exception as e:
            print(f"  [detailer-batch] rename failed ({e}), keeping {produced.name}")
            rfy_out = str(produced)
    else:
        rfy_out = str(produced)

    # =================== CLEANUP — close project ===================
    main.set_focus(); time.sleep(0.3)
    pyautogui.hotkey("alt", "f"); time.sleep(0.3)
    pyautogui.press("c"); time.sleep(1)
    # Discard 'save changes?' if prompted
    for w in app.windows():
        try:
            if w.is_visible() and w.class_name() == "TMessageForm":
                for c in w.descendants():
                    try:
                        if c.class_name() == "TButton" and c.window_text() in ("&No", "No"):
                            c.click(); time.sleep(0.5); break
                    except Exception: pass
                break
        except Exception: pass

    return rfy_out


# ---------------------------------------------------------------------------
# Batch mode: walk Y: drive, convert every XML, populate cache
# ---------------------------------------------------------------------------

def find_jobs() -> list[tuple[str, str, str]]:
    """Return list of (jobnum, builder, job_dir)."""
    jobs: list[tuple[str, str, str]] = []
    if not Path(PROJECTS_ROOT).exists():
        return jobs
    for builder in os.listdir(PROJECTS_ROOT):
        bp = os.path.join(PROJECTS_ROOT, builder)
        if not os.path.isdir(bp):
            continue
        try:
            for sub in os.listdir(bp):
                if not re.match(r"^HG\d+", sub, re.IGNORECASE):
                    continue
                sp = os.path.join(bp, sub)
                if not os.path.isdir(sp):
                    continue
                m = re.match(r"^(HG\d+)", sub, re.IGNORECASE)
                jobnum = m.group(1).upper() if m else sub
                jobs.append((jobnum, builder, sp))
        except Exception:
            pass
    return sorted(jobs, key=lambda t: t[0])


def find_xmls_for_job(job_dir: str) -> list[tuple[str, str]]:
    """Return list of (xml_path, plan_name) for one job's single-plan XMLs."""
    xml_dir = os.path.join(
        job_dir, "03 DETAILING", "03 FRAMECAD DETAILER", "01 XML OUTPUT"
    )
    if not os.path.isdir(xml_dir):
        return []
    out: list[tuple[str, str]] = []
    for name in os.listdir(xml_dir):
        if not name.lower().endswith(".xml"):
            continue
        full = os.path.join(xml_dir, name)
        if not os.path.isfile(full):
            continue
        # Plan name: trailing -<floor>-<plan> after the location prefix.
        stem = name[:-4]  # strip .xml
        m = re.search(r"-(GF|FF|RF|FL\d*|FFL\d*)-(.+)$", stem, re.IGNORECASE)
        if not m:
            continue
        plan = f"{m.group(1)}-{m.group(2)}"
        out.append((full, plan))
    return out


def sha256_of_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_cache(
    cache_dir: str,
    job_filter: Optional[set[str]] = None,
    skip_existing: bool = True,
) -> None:
    """Walk Y: drive, run every XML through Detailer, write RFYs to cache."""
    if not HAS_DRIVER_DEPS:
        raise RuntimeError(
            "Driver dependencies not installed. Run: "
            "pip install psutil pyautogui pywinauto pillow"
        )

    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    print(f"[detailer-batch] cache_dir = {cache_dir}")
    app = assert_license_ok()
    print("[detailer-batch] license OK, Detailer ready")

    jobs = find_jobs()
    if job_filter:
        jobs = [j for j in jobs if j[0] in job_filter]
    print(f"[detailer-batch] processing {len(jobs)} jobs")

    index = []
    total_xmls = 0
    total_done = 0
    total_skipped = 0
    total_failed = 0

    for jobnum, builder, jobdir in jobs:
        xmls = find_xmls_for_job(jobdir)
        if not xmls:
            continue
        job_cache_dir = os.path.join(cache_dir, jobnum)
        os.makedirs(job_cache_dir, exist_ok=True)
        for xml_path, plan in xmls:
            total_xmls += 1
            rfy_out = os.path.join(job_cache_dir, f"{plan}.rfy")
            meta_out = os.path.join(job_cache_dir, f"{plan}.meta.json")

            if skip_existing and os.path.isfile(rfy_out) and os.path.isfile(meta_out):
                # Re-validate: did the source XML change?
                try:
                    with open(meta_out, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    current_sha = sha256_of_file(xml_path)
                    if meta.get("xml_sha256") == current_sha:
                        total_skipped += 1
                        index.append({
                            "jobnum": jobnum, "plan": plan,
                            "rfy": os.path.relpath(rfy_out, cache_dir),
                            "xml_sha256": current_sha,
                            "generated_at": meta.get("generated_at"),
                            "status": "cached",
                        })
                        continue
                except Exception:
                    pass

            print(f"[{total_done+total_failed+1}/{total_xmls}] {jobnum} {plan} ...", end="", flush=True)
            try:
                tmp_dir = os.path.join(cache_dir, "_tmp")
                produced = xml_to_rfy(xml_path, tmp_dir, app=app)
                shutil.move(produced, rfy_out)
                meta = {
                    "jobnum": jobnum,
                    "plan": plan,
                    "xml_path": xml_path,
                    "xml_size": os.path.getsize(xml_path),
                    "xml_sha256": sha256_of_file(xml_path),
                    "rfy_size": os.path.getsize(rfy_out),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "detailer_version": "5.x",
                }
                with open(meta_out, "w", encoding="utf-8") as f:
                    json.dump(meta, f, indent=2)
                index.append({
                    "jobnum": jobnum, "plan": plan,
                    "rfy": os.path.relpath(rfy_out, cache_dir),
                    "xml_sha256": meta["xml_sha256"],
                    "generated_at": meta["generated_at"],
                    "status": "fresh",
                })
                total_done += 1
                print(f" OK ({meta['rfy_size']} bytes)")
            except Exception as e:
                total_failed += 1
                # Sanitise non-ascii for Windows console (cp1252)
                emsg = str(e).encode("ascii", errors="replace").decode("ascii")
                print(f" FAIL: {emsg}")
                # Detailer may be in a bad state (modal dialog up, project loaded
                # but unfinished). Kill + relaunch for clean slate before next
                # iteration. Slow but reliable.
                try:
                    kill_existing_detailer()
                    time.sleep(2)
                    app = assert_license_ok()
                except Exception as e2:
                    emsg2 = str(e2).encode("ascii", errors="replace").decode("ascii")
                    print(f"[detailer-batch] cannot re-acquire Detailer ({emsg2}); aborting")
                    break

    # Write the index
    index_path = os.path.join(cache_dir, "_index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "totals": {
                "found": total_xmls,
                "fresh": total_done,
                "cached_skip": total_skipped,
                "failed": total_failed,
            },
            "entries": index,
        }, f, indent=2)
    print()
    print(f"[detailer-batch] DONE — fresh={total_done} cached={total_skipped} failed={total_failed} of {total_xmls} found")
    print(f"[detailer-batch] index: {index_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Drive Detailer to convert XMLs -> RFYs (single or batch)."
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Walk Y: drive and convert every job's XMLs.",
    )
    parser.add_argument(
        "--cache-dir",
        default=DEFAULT_CACHE_DIR,
        help=f"Output cache directory (default: {DEFAULT_CACHE_DIR})",
    )
    parser.add_argument(
        "--filter",
        nargs="*",
        help="Limit batch to specific jobnums (e.g. HG260017 HG260023)",
    )
    parser.add_argument(
        "--no-skip",
        action="store_true",
        help="Re-process even if cached RFY already matches source XML hash",
    )
    parser.add_argument("xml_path", nargs="?", help="(single-shot) Input XML path")
    parser.add_argument("rfy_path", nargs="?", help="(single-shot) Output RFY path")
    args = parser.parse_args()

    if args.batch:
        job_filter = set(s.upper() for s in (args.filter or []))
        try:
            build_cache(
                cache_dir=args.cache_dir,
                job_filter=job_filter or None,
                skip_existing=not args.no_skip,
            )
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1
        return 0

    if not args.xml_path:
        parser.print_help()
        return 1

    out_dir = os.path.dirname(os.path.abspath(args.rfy_path or args.xml_path))
    try:
        produced = xml_to_rfy(args.xml_path, out_dir)
        if args.rfy_path and produced != os.path.abspath(args.rfy_path):
            shutil.move(produced, args.rfy_path)
            produced = args.rfy_path
        print(f"WROTE: {produced}")
        return 0
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
