"""
Forge health check — runs cheap sanity tests and prints a status table.

Use this at the start of a session to confirm the forge pipeline is intact:

    python forge/health-check.py

Reports:
  - Detailer install presence + license-OK detection
  - Worker / orchestrator / cache / queue / route files all present
  - Cache root resolved, index parses, every entry valid
  - Python deps (psutil, pyautogui, pywinauto) importable
  - Last 5 git commits

Exit 0 if everything green, 1 if anything is wrong.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

CHECK_FILES = [
    "forge/worker/detailer-worker.py",
    "forge/worker/license_watcher.py",
    "forge/orchestrator/detailer-orchestrator.py",
    "forge/cache/store.py",
    "forge/cache/validate.py",
    "forge/cache/test_store.py",
    "forge/queue/runner.py",
    "lib/oracle-cache.ts",
    "lib/forge-paths.ts",
    "app/api/forge/encode/route.ts",
    "app/api/forge/encode/async/route.ts",
    "app/api/forge/jobs/[id]/route.ts",
]

DETAILER_EXE = r"C:\Program Files (x86)\FRAMECAD\Detailer\Version 5\FRAMECAD Detailer.exe"


def check(label: str, ok: bool, detail: str = "") -> bool:
    mark = "[OK]" if ok else "[FAIL]"
    line = f"  {mark}  {label}"
    if detail:
        line += f" -- {detail}"
    print(line)
    return ok


def main() -> int:
    print("Forge health check\n")
    all_ok = True

    print("Files (12 expected):")
    for f in CHECK_FILES:
        all_ok &= check(f, (REPO_ROOT / f).is_file())
    print()

    print("Detailer:")
    detailer_path = Path(DETAILER_EXE)
    detailer_present = detailer_path.is_file()
    all_ok &= check(f"install at {DETAILER_EXE}", detailer_present)
    print()

    print("Python deps:")
    for mod in ("psutil", "pyautogui", "pywinauto"):
        try:
            __import__(mod)
            check(f"import {mod}", True)
        except ImportError as e:
            check(f"import {mod}", False, str(e))
            all_ok = False
    print()

    print("Cache:")
    sys.path.insert(0, str(REPO_ROOT / "forge"))
    from cache.store import resolve_cache_root  # type: ignore
    from cache.validate import validate  # type: ignore
    cache_root = resolve_cache_root()
    cache_root_ok = cache_root.exists()
    all_ok &= check(f"root resolved --> {cache_root}", cache_root_ok)
    if cache_root_ok:
        idx_path = cache_root / "_index.json"
        if idx_path.exists():
            try:
                idx = json.loads(idx_path.read_text(encoding="utf-8"))
                entries = idx.get("entries", {})
                check(f"index parses, {len(entries)} entries", True)
                # Run validate (suppress its prints to avoid duplication)
                import io
                import contextlib
                buf = io.StringIO()
                with contextlib.redirect_stderr(buf):
                    rc = validate(cache_root, check_source=False)
                check("validate.py — all entries OK" if rc == 0 else "validate.py FAILED",
                      rc == 0)
                if rc != 0:
                    all_ok = False
                    print(buf.getvalue())
            except Exception as e:
                check("index parses", False, str(e))
                all_ok = False
        else:
            check("_index.json present", False)
            all_ok = False
    print()

    print("Recent commits:")
    try:
        log = subprocess.run(
            ["git", "log", "--oneline", "-5"],
            cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        )
        for line in log.stdout.strip().splitlines():
            print(f"  {line}")
    except Exception as e:
        print(f"  git log failed: {e}")
    print()

    print("=" * 50)
    print("OVERALL:", "ALL GREEN" if all_ok else "ISSUES FOUND")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
