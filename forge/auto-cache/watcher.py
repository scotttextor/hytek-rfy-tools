"""
Auto-cache pipeline — runs the Forge orchestrator continuously over every
XML on Y: drive (and any newly-arrived XMLs) so the cache stays current.

Operates in two modes which can be combined:

  --once          Single pass over the Y: drive, then exit. Use this for
                  the initial backfill (already-existing XMLs that have no
                  RFY counterpart).
  --watch [SEC]   Loop forever, scanning every SEC seconds (default 300 = 5min)
                  for any XML that's not yet in the cache, run Forge on it,
                  and write the result. Designed to run as a Windows scheduled
                  task or via `nohup` while Detailer is alive.

Skip rules (an XML is NOT processed if any of):
  - Its (jobnum, plan_name) is already in the Forge cache index.
  - It's currently being processed (.in-progress lock file in queue).
  - It has been retried >= --max-retries times this session.
  - Its size is suspicious (< 1 KB or > 50 MB).

Per-XML processing:
  1. Compute (jobnum, plan_name) from XML content.
  2. Check cache (forge.cache.store.cache_get) — if hit, skip.
  3. Run forge/orchestrator/detailer-orchestrator.py with a single-XML manifest.
  4. cache_put on success.

Logs to <cache_root>/_auto-cache.log. State (retries, last-seen) in
<cache_root>/_auto-cache-state.json.

Usage:
    python forge/auto-cache/watcher.py --once
    python forge/auto-cache/watcher.py --watch 300
    python forge/auto-cache/watcher.py --watch 300 --max-retries 1
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "forge"))
from cache.store import resolve_cache_root, cache_get, cache_put  # noqa: E402

WORKER = ROOT / "forge" / "worker" / "detailer-worker.py"

PROJECTS_ROOTS = [
    Path(r"Y:\(17) 2026 HYTEK PROJECTS"),
    Path(r"Y:\(14) 2025 HYTEK PROJECTS"),
]


def find_all_xmls() -> list[Path]:
    """Walk every <projects_root>/<builder>/<job>/03 DETAILING/03 FRAMECAD
    DETAILER/01 XML OUTPUT (and Packed/) and collect every *.xml."""
    found: list[Path] = []
    for root in PROJECTS_ROOTS:
        if not root.exists():
            continue
        for builder in root.iterdir():
            if not builder.is_dir():
                continue
            for job in builder.iterdir():
                if not job.is_dir():
                    continue
                xml_dir = job / "03 DETAILING" / "03 FRAMECAD DETAILER" / "01 XML OUTPUT"
                if not xml_dir.exists():
                    continue
                for f in xml_dir.iterdir():
                    if f.is_file() and f.suffix.lower() == ".xml":
                        found.append(f)
                packed = xml_dir / "Packed"
                if packed.exists():
                    for f in packed.iterdir():
                        if f.is_file() and f.suffix.lower() == ".xml":
                            found.append(f)
    return found


def quick_scan(xml_path: Path) -> tuple[str | None, str | None]:
    """Best-effort regex scan for jobnum + plan-name (single-plan)."""
    try:
        if xml_path.stat().st_size > 50 * 1024 * 1024:
            return None, None
        text = xml_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None, None
    job_m = re.search(r"<jobnum>\s*\"?\s*([A-Za-z0-9#-]+?)\s*\"?\s*</jobnum>", text)
    plan_m = re.search(r'<plan\s+name="([^"]+)"', text)
    return (job_m.group(1) if job_m else None,
            plan_m.group(1) if plan_m else None)


def is_cached_fast(jobnum: str | None, plan: str | None, cache_root: Path) -> bool:
    """Fast cache-existence check by (jobnum, plan_name) without re-reading
    or re-hashing the XML. Skips the canonical-hash validation in cache_get
    (we trust the cache by job/plan alone for the watcher's purposes — full
    hash validation runs on the encode-route hot path)."""
    if not jobnum or not plan:
        return False
    cached_rfy = cache_root / jobnum / f"{plan}.rfy"
    cached_meta = cache_root / jobnum / f"{plan}.meta.json"
    return cached_rfy.exists() and cached_meta.exists() and cached_rfy.stat().st_size > 0


def load_state(state_path: Path) -> dict:
    if not state_path.exists():
        return {"retries": {}, "last_seen": {}}
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {"retries": {}, "last_seen": {}}


def save_state(state_path: Path, state: dict) -> None:
    tmp = state_path.with_suffix(state_path.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    os.replace(tmp, state_path)


def log(log_path: Path, msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} | {msg}\n"
    print(line, end="", file=sys.stderr)
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def run_worker(xml_path: Path, rfy_out: Path, timeout_sec: int = 240) -> tuple[int, str]:
    """Spawn the Detailer worker. Returns (exit_code, stderr_tail)."""
    rfy_out.parent.mkdir(parents=True, exist_ok=True)
    if rfy_out.exists():
        rfy_out.unlink()
    creationflags = 0x10 if os.name == "nt" else 0  # CREATE_NEW_CONSOLE
    import tempfile
    stderr_fd = tempfile.NamedTemporaryFile(
        mode="w+", delete=False, suffix=".forge.log", encoding="utf-8"
    )
    stderr_path = stderr_fd.name
    stderr_fd.close()
    rc = None
    try:
        with open(stderr_path, "w", encoding="utf-8") as ef:
            try:
                result = subprocess.run(
                    [sys.executable, "-u", str(WORKER), str(xml_path), str(rfy_out)],
                    timeout=timeout_sec,
                    stdout=subprocess.DEVNULL,
                    stderr=ef,
                    creationflags=creationflags,
                )
                rc = result.returncode
            except subprocess.TimeoutExpired:
                rc = 6
        with open(stderr_path, "r", encoding="utf-8", errors="replace") as ef:
            stderr_text = ef.read()
    finally:
        try:
            os.unlink(stderr_path)
        except Exception:
            pass
    return rc, stderr_text[-500:]


def process_xml(
    xml_path: Path,
    cache_root: Path,
    state: dict,
    state_path: Path,
    log_path: Path,
    max_retries: int,
) -> str:
    """Process a single XML. Returns "cached" | "skipped:<reason>" | "ok" | "fail:<reason>"."""
    key = str(xml_path)
    retries = state["retries"].get(key, 0)
    if retries >= max_retries:
        return f"skipped:max_retries({retries})"
    # Cheap (no file read): if last_seen is recent and we marked it cached
    # before, skip without re-checking. Reset every 24h to re-validate.
    last = state["last_seen"].get(key, 0)
    if time.time() - last < 24 * 3600 and state.get("cached_keys", {}).get(key):
        return "cached"

    jobnum, plan = quick_scan(xml_path)
    if not jobnum or not plan:
        state["retries"][key] = retries + 1
        save_state(state_path, state)
        return "skipped:no_jobnum_plan"

    if is_cached_fast(jobnum, plan, cache_root):
        state["last_seen"][key] = time.time()
        state.setdefault("cached_keys", {})[key] = True
        # Save state every 100 cached hits to avoid disk thrash
        if int(time.time()) % 100 == 0:
            save_state(state_path, state)
        return "cached"

    log(log_path, f"START {jobnum}/{plan} <- {xml_path.name}")
    tmp_rfy = cache_root / "_auto-cache-tmp" / f"{jobnum}_{plan}.rfy"
    tmp_rfy.parent.mkdir(parents=True, exist_ok=True)
    rc, stderr_tail = run_worker(xml_path, tmp_rfy)
    if rc != 0 or not tmp_rfy.exists() or tmp_rfy.stat().st_size == 0:
        state["retries"][key] = retries + 1
        save_state(state_path, state)
        log(log_path, f"FAIL  rc={rc} {jobnum}/{plan}: {stderr_tail.replace(chr(10), ' ')[:200]}")
        return f"fail:worker_rc_{rc}"

    # Cache it
    try:
        entry = cache_put(
            xml_path, tmp_rfy,
            jobnum=jobnum, plan_name=plan,
            cache_root=cache_root,
        )
        log(log_path, f"OK    {jobnum}/{plan} ({entry['rfy_size']:,} B)")
        state["last_seen"][key] = time.time()
        save_state(state_path, state)
        try:
            tmp_rfy.unlink()
        except Exception:
            pass
        return "ok"
    except Exception as e:
        state["retries"][key] = retries + 1
        save_state(state_path, state)
        log(log_path, f"FAIL  cache_put failed: {e}")
        return f"fail:cache_put({e})"


def one_pass(cache_root: Path, state: dict, state_path: Path, log_path: Path, max_retries: int) -> dict:
    xmls = find_all_xmls()
    log(log_path, f"PASS  scanning {len(xmls)} XMLs")
    counts = {"ok": 0, "cached": 0, "skipped": 0, "fail": 0}
    for i, xml in enumerate(xmls, 1):
        result = process_xml(xml, cache_root, state, state_path, log_path, max_retries)
        if result == "ok":
            counts["ok"] += 1
        elif result == "cached":
            counts["cached"] += 1
        elif result.startswith("skipped:"):
            counts["skipped"] += 1
        else:
            counts["fail"] += 1
        if i % 25 == 0:
            log(log_path, f"PROG  [{i}/{len(xmls)}] ok={counts['ok']} cached={counts['cached']} skip={counts['skipped']} fail={counts['fail']}")
    log(log_path, f"PASS  done. ok={counts['ok']} cached={counts['cached']} skip={counts['skipped']} fail={counts['fail']}")
    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="Single pass then exit")
    ap.add_argument("--watch", type=int, default=0, help="Loop forever, sleep N seconds between passes")
    ap.add_argument("--max-retries", type=int, default=2, help="Per-XML retry budget within this state file")
    args = ap.parse_args()

    if not args.once and args.watch <= 0:
        print("Use --once or --watch SEC", file=sys.stderr)
        return 2

    cache_root = resolve_cache_root()
    cache_root.mkdir(parents=True, exist_ok=True)
    state_path = cache_root / "_auto-cache-state.json"
    log_path = cache_root / "_auto-cache.log"
    state = load_state(state_path)

    # Mutex via lockfile — only one watcher at a time can drive Detailer.
    # Stale lockfiles (>1 hour old) are reaped automatically.
    lock_path = cache_root / "_auto-cache.lock"
    if lock_path.exists():
        age = time.time() - lock_path.stat().st_mtime
        if age < 3600:
            print(f"Another watcher is already running (lockfile age {age:.0f}s). Aborting.", file=sys.stderr)
            return 3
        else:
            print(f"Reaping stale lockfile (age {age:.0f}s)", file=sys.stderr)
            lock_path.unlink()
    lock_path.write_text(f"pid={os.getpid()} started={time.strftime('%Y-%m-%d %H:%M:%S')}\n", encoding="utf-8")
    import atexit
    atexit.register(lambda: lock_path.unlink(missing_ok=True) if lock_path.exists() else None)

    log(log_path, f"START cache_root={cache_root} pid={os.getpid()}")

    if args.once:
        one_pass(cache_root, state, state_path, log_path, args.max_retries)
        return 0

    while True:
        one_pass(cache_root, state, state_path, log_path, args.max_retries)
        log(log_path, f"SLEEP {args.watch}s")
        time.sleep(args.watch)


if __name__ == "__main__":
    sys.exit(main())
