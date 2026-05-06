"""
Forge async queue cleanup.

The `/api/forge/encode/async` endpoint creates `<cache_root>/_queue/<uuid>/`
per request. After the runner finishes (status=done|failed), the dir lingers
forever. This script deletes finished jobs older than --age-hours.

Use cases:
  - Manual housekeeping: `python forge/queue/cleanup.py --age-hours 24`
  - Cron / scheduled task: trim weekly to keep the queue dir tidy.

We never delete a job whose state.json reads `pending` or `running` — those
might still be in flight. Only `done` (already returned to the client) and
`failed` get pruned.

Defaults to dry-run; pass --apply to actually delete.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cache.store import resolve_cache_root  # noqa: E402


def parse_iso(s: str) -> float:
    """Parse the runner's `updated_at` (best-effort). Returns POSIX timestamp."""
    if not s:
        return 0.0
    try:
        # Format: "2026-05-06T22:08:09" — naive local time
        import datetime as _dt
        return _dt.datetime.fromisoformat(s).timestamp()
    except Exception:
        return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--age-hours", type=float, default=24,
                    help="Delete done/failed jobs older than this (default 24h)")
    ap.add_argument("--cache-root", default=None)
    ap.add_argument("--apply", action="store_true",
                    help="Actually delete (default is dry-run).")
    args = ap.parse_args()

    cache_root = (
        Path(args.cache_root).resolve() if args.cache_root else resolve_cache_root()
    )
    queue_dir = cache_root / "_queue"
    if not queue_dir.exists():
        print(f"No queue dir at {queue_dir}", file=sys.stderr)
        return 0

    cutoff = time.time() - args.age_hours * 3600
    examined = 0
    pruned = 0
    skipped_inflight = 0
    skipped_recent = 0
    bytes_freed = 0

    for job_dir in sorted(queue_dir.iterdir()):
        if not job_dir.is_dir():
            continue
        examined += 1
        state_path = job_dir / "state.json"
        if not state_path.exists():
            # Orphaned dir — older than cutoff? Use mtime.
            if job_dir.stat().st_mtime < cutoff:
                action = "PRUNE (orphan, no state.json)"
            else:
                skipped_recent += 1
                continue
        else:
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
            except Exception:
                state = {}
            status = state.get("status", "")
            if status in ("pending", "running"):
                skipped_inflight += 1
                continue
            if status not in ("done", "failed"):
                # Unknown status — be conservative
                skipped_inflight += 1
                continue
            updated_at_ts = parse_iso(state.get("updated_at", ""))
            if updated_at_ts == 0.0:
                # Fall back to mtime
                updated_at_ts = state_path.stat().st_mtime
            if updated_at_ts > cutoff:
                skipped_recent += 1
                continue
            action = f"PRUNE ({status}, updated_at={state.get('updated_at')})"

        # Compute bytes that would be freed
        size = sum(p.stat().st_size for p in job_dir.rglob("*") if p.is_file())
        print(f"  {action} {job_dir.name} ({size:,} B)")
        if args.apply:
            shutil.rmtree(job_dir, ignore_errors=True)
        pruned += 1
        bytes_freed += size

    print()
    print(f"Examined: {examined}  pruned: {pruned}  in-flight: {skipped_inflight}  "
          f"too-recent: {skipped_recent}")
    print(f"Bytes freed: {bytes_freed:,} ({bytes_freed/1024/1024:.1f} MB)")
    if not args.apply and pruned > 0:
        print("(dry-run — pass --apply to actually delete)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
