"""
Forge Phase 4 (async): per-job runner.

Spawned detached by /api/forge/encode/async. Reads <queue_dir>/<id>/input.xml,
runs the Detailer worker, writes state.json + out.rfy, optionally caches.

Layout under <queue_dir>/<id>/:
  input.xml            — XML the user POSTed
  state.json           — { id, created_at, updated_at, status, error?, jobnum?, plan_name? }
  out.rfy              — present iff status == "done"
  worker.log           — captured worker stderr (always)
  error.txt            — present iff status == "failed"

State transitions:
  pending  →  running  →  done | failed

Usage:
  python forge/queue/runner.py <queue_dir>/<id>
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
WORKER = ROOT / "forge" / "worker" / "detailer-worker.py"

# Make forge.cache importable
sys.path.insert(0, str(ROOT / "forge"))
try:
    from cache.store import cache_put  # type: ignore
except Exception:
    cache_put = None


def update_state(state_path: Path, **changes):
    """Read-modify-write the state.json. Best-effort."""
    state: dict = {}
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            state = {}
    state.update(changes)
    state["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    tmp = state_path.with_suffix(state_path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(tmp, state_path)


def quick_scan_xml(xml_text: str):
    job_m = re.search(r"<jobnum>\s*\"?\s*([A-Za-z0-9#-]+?)\s*\"?\s*</jobnum>", xml_text)
    plan_m = re.search(r'<plan\s+name="([^"]+)"', xml_text)
    return (job_m.group(1) if job_m else None,
            plan_m.group(1) if plan_m else None)


def main():
    if len(sys.argv) != 2:
        print("usage: runner.py <queue_dir>/<id>", file=sys.stderr)
        return 2

    job_dir = Path(sys.argv[1]).resolve()
    if not job_dir.is_dir():
        print(f"job dir not found: {job_dir}", file=sys.stderr)
        return 2

    state_path = job_dir / "state.json"
    input_xml = job_dir / "input.xml"
    out_rfy = job_dir / "out.rfy"
    error_txt = job_dir / "error.txt"
    worker_log = job_dir / "worker.log"

    if not input_xml.exists():
        update_state(state_path, status="failed", error="input.xml missing")
        return 2

    xml_text = input_xml.read_text(encoding="utf-8", errors="replace")
    jobnum, plan_name = quick_scan_xml(xml_text)
    update_state(state_path, status="running", jobnum=jobnum, plan_name=plan_name)

    # Run the worker. CREATE_NEW_CONSOLE for foreground rights on Windows.
    creationflags = 0x10 if os.name == "nt" else 0
    try:
        with open(worker_log, "w", encoding="utf-8") as logf:
            proc = subprocess.run(
                [sys.executable, "-u", str(WORKER), str(input_xml), str(out_rfy)],
                stdout=subprocess.DEVNULL,
                stderr=logf,
                timeout=240,
                creationflags=creationflags,
            )
        rc = proc.returncode
    except subprocess.TimeoutExpired:
        rc = 6
        update_state(state_path, status="failed", error="worker timeout")
        error_txt.write_text("worker timeout (>240s)", encoding="utf-8")
        return 1
    except Exception as e:
        update_state(state_path, status="failed", error=f"runner exception: {e}")
        error_txt.write_text(f"runner exception: {e}", encoding="utf-8")
        return 1

    if rc != 0 or not out_rfy.exists():
        # Read tail of worker.log for the error
        tail = ""
        try:
            tail = worker_log.read_text(encoding="utf-8")[-2000:]
        except Exception:
            pass
        update_state(state_path, status="failed",
                     error=f"worker exit {rc}", worker_stderr_tail=tail[-500:])
        error_txt.write_text(tail or f"worker exit {rc}", encoding="utf-8")
        return 1

    rfy_size = out_rfy.stat().st_size

    # Cache the result (best-effort)
    cache_meta = None
    if cache_put is not None and jobnum and plan_name:
        try:
            cache_meta = cache_put(input_xml, out_rfy,
                                   jobnum=jobnum, plan_name=plan_name)
        except Exception as e:
            update_state(state_path, cache_write_error=str(e))

    update_state(state_path, status="done", rfy_size=rfy_size,
                 cached=cache_meta is not None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
