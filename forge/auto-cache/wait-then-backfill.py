"""
Polls for Detailer license-OK every N seconds. When it sees it, fires the
orchestrator on the uncached-xmls.json manifest. Designed to run unattended
overnight — sleeps while VPN blocks Detailer, processes ~204 jobs over
~3 hours when VPN is off, then idles.

Re-runs find-uncached-xmls.py before each batch to pick up newly-arrived
XMLs.

Usage:
    python forge/auto-cache/wait-then-backfill.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LICENSE_WATCHER = ROOT / "forge" / "worker" / "license_watcher.py"
ORCHESTRATOR = ROOT / "forge" / "orchestrator" / "detailer-orchestrator.py"
FIND_UNCACHED = ROOT / "forge" / "auto-cache" / "find-uncached-xmls.py"
MANIFEST = ROOT / "forge" / "auto-cache" / "uncached-xmls.json"


def license_ok() -> bool:
    """One-shot license check via the proven license_watcher.py path."""
    r = subprocess.run(
        [sys.executable, str(LICENSE_WATCHER), "--interval", "10", "--max-hours", "0.0033"],
        capture_output=True, text=True, timeout=30,
    )
    return r.returncode == 0


def find_uncached() -> bool:
    print(f"[{time.strftime('%H:%M:%S')}] Finding uncached XMLs...")
    r = subprocess.run([sys.executable, str(FIND_UNCACHED)], capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        print(f"  find-uncached failed: {r.stderr[-500:]}", file=sys.stderr)
        return False
    print(r.stdout.split("Manifest:")[0].split("Cache has ")[1][:200] if "Manifest:" in r.stdout else r.stdout[:200])
    return MANIFEST.exists()


def run_backfill() -> int:
    """Run the orchestrator on the manifest. Returns exit code."""
    print(f"[{time.strftime('%H:%M:%S')}] Starting backfill orchestrator...")
    r = subprocess.run(
        [sys.executable, "-u", str(ORCHESTRATOR),
         "--manifest", str(MANIFEST),
         "--resume", "--max-retries", "2",
         "--no-halt-on-license-bad"],  # don't halt on transient license failures
        timeout=8 * 3600,  # 8h max
    )
    return r.returncode


def main():
    poll_sec = 600  # 10 min between license checks while waiting
    print(f"wait-then-backfill started at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Polling for Detailer license every {poll_sec}s...")

    while True:
        try:
            ok = license_ok()
        except Exception as e:
            print(f"  license check error: {e}")
            ok = False

        if not ok:
            print(f"[{time.strftime('%H:%M:%S')}] License BLOCKED — sleeping {poll_sec}s...")
            time.sleep(poll_sec)
            continue

        print(f"[{time.strftime('%H:%M:%S')}] License OK — refreshing manifest + running backfill")
        if not find_uncached():
            time.sleep(poll_sec)
            continue
        rc = run_backfill()
        print(f"[{time.strftime('%H:%M:%S')}] Backfill exit {rc}")
        # After backfill, sleep then check for newly-arrived XMLs
        print(f"[{time.strftime('%H:%M:%S')}] Sleeping {poll_sec}s before next poll...")
        time.sleep(poll_sec)


if __name__ == "__main__":
    sys.exit(main())
