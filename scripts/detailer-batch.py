"""
detailer-batch.py — Drive FRAMECAD Detailer to convert input XML → RFY for many jobs.

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
# XML → RFY (single-shot)
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


def xml_to_rfy(xml_path: str, output_dir: str, app: Optional["Application"] = None) -> str:
    """Convert one XML to one RFY via Detailer GUI automation.

    Returns the absolute path to the written RFY.

    NOTE: this performs UI automation. Don't touch keyboard/mouse while it
    runs. If multiple XMLs are converted in sequence, reuse the same `app`
    instance to avoid the Detailer launch overhead each time.
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

    # ---- Import XML via File menu ----
    pyautogui.hotkey("alt", "f")
    time.sleep(0.4)
    pyautogui.press("i")    # Import
    time.sleep(0.3)
    pyautogui.press("x")    # XML
    time.sleep(1.0)

    open_dlg = app.window(title_re=".*Open.*|.*Import.*", class_name="#32770")
    open_dlg.wait("visible", timeout=15)
    file_edit = open_dlg.child_window(class_name="Edit", control_id=0x47C)
    file_edit.set_edit_text(xml_path)
    open_dlg.child_window(title="Open", class_name="Button").click()
    # Project import can take 5-30s for large frames
    time.sleep(8)

    # ---- Export RFY via File menu ----
    main.set_focus()
    pyautogui.hotkey("alt", "f")
    time.sleep(0.4)
    pyautogui.press("e")    # Export
    time.sleep(0.3)
    pyautogui.press("r")    # RFY
    time.sleep(1.0)

    save_dlg = app.window(title_re=".*Save.*|.*Export.*", class_name="#32770")
    save_dlg.wait("visible", timeout=15)
    rfy_basename = Path(xml_path).stem + ".rfy"
    rfy_out = str(Path(output_dir) / rfy_basename)
    save_edit = save_dlg.child_window(class_name="Edit", control_id=0x47C)
    save_edit.set_edit_text(rfy_out)
    save_dlg.child_window(title="Save", class_name="Button").click()
    time.sleep(2)

    # Confirm overwrite if prompted
    try:
        confirm = app.window(title_re=".*Confirm.*|.*overwrite.*", class_name="#32770")
        if confirm.exists(timeout=2):
            confirm.child_window(title="Yes", class_name="Button").click()
    except Exception:
        pass

    deadline = time.time() + 30
    while time.time() < deadline:
        if Path(rfy_out).exists():
            break
        time.sleep(0.5)
    if not Path(rfy_out).exists():
        raise RuntimeError(f"RFY was not produced at {rfy_out}")

    # ---- Close project to return to ready state ----
    pyautogui.hotkey("alt", "f")
    time.sleep(0.3)
    pyautogui.press("c")
    time.sleep(1)
    try:
        for w in app.windows():
            if w.is_visible() and w.class_name() == "#32770":
                no_btn = w.child_window(title="No", class_name="Button")
                if no_btn.exists():
                    no_btn.click()
                    break
    except Exception:
        pass

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
                print(f" FAIL: {e}")
                # Re-establish app handle in case Detailer crashed
                try:
                    app = assert_license_ok()
                except Exception:
                    print("[detailer-batch] cannot re-acquire Detailer; aborting")
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
        description="Drive Detailer to convert XMLs → RFYs (single or batch)."
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
