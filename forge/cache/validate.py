"""
Forge Phase 2: cache validator.

Walks every entry in the Forge cache, verifies:
  - <jobnum>/<plan>.rfy exists, size matches meta
  - <jobnum>/<plan>.meta.json parses
  - _index.json contains the entry under the right key
  - (optional, if --check-source) the source XML on Y: drive still hashes
    to meta.xml_sha256 (ie the cache entry isn't stale)

Exit:
  0 — every entry valid
  1 — at least one entry invalid (details on stderr)

Usage:
  python forge/cache/validate.py
  python forge/cache/validate.py --check-source
  python forge/cache/validate.py --cache-root /path/to/cache
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Import store from this dir
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cache.store import resolve_cache_root, sha256_file  # noqa: E402


def validate(cache_root: Path, check_source: bool = False) -> int:
    if not cache_root.exists():
        print(f"FAIL: cache root not found: {cache_root}", file=sys.stderr)
        return 1

    idx_path = cache_root / "_index.json"
    if not idx_path.exists():
        print(f"FAIL: no _index.json at {cache_root}", file=sys.stderr)
        return 1
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    entries = idx.get("entries", {})

    issues: list[str] = []
    valid = 0
    stale_source = 0

    for key, meta in sorted(entries.items()):
        jobnum = meta.get("jobnum")
        plan = meta.get("plan_name")
        if not jobnum or not plan:
            issues.append(f"{key}: meta missing jobnum/plan_name")
            continue

        rfy = cache_root / jobnum / f"{plan}.rfy"
        meta_file = cache_root / jobnum / f"{plan}.meta.json"
        if not rfy.exists():
            issues.append(f"{key}: rfy file missing at {rfy}")
            continue
        if not meta_file.exists():
            issues.append(f"{key}: meta file missing at {meta_file}")
            continue

        actual_size = rfy.stat().st_size
        recorded_size = meta.get("rfy_size", -1)
        if actual_size != recorded_size:
            issues.append(
                f"{key}: rfy size {actual_size} != recorded {recorded_size}")
            continue

        # Re-read the per-entry meta and compare to index entry
        per_entry = json.loads(meta_file.read_text(encoding="utf-8"))
        if per_entry.get("xml_sha256") != meta.get("xml_sha256"):
            issues.append(
                f"{key}: index xml_sha256 != per-entry xml_sha256")
            continue

        # Optional source validation: walk back to the XML on Y:
        if check_source:
            src = meta.get("source_xml_path")
            if src and Path(src).exists():
                live_hash = sha256_file(Path(src))
                if live_hash != meta.get("xml_sha256"):
                    issues.append(
                        f"{key}: STALE — source XML hash drift "
                        f"({live_hash[:12]} != {meta['xml_sha256'][:12]})")
                    stale_source += 1
                    continue

        valid += 1

    total = len(entries)
    print(f"\nForge cache validation @ {cache_root}", file=sys.stderr)
    print(f"  Total entries:    {total}", file=sys.stderr)
    print(f"  Valid:            {valid}", file=sys.stderr)
    if check_source:
        print(f"  Stale source:     {stale_source}", file=sys.stderr)
    print(f"  Issues:           {len(issues)}", file=sys.stderr)

    for issue in issues:
        print(f"    ✗ {issue}", file=sys.stderr)

    return 0 if not issues else 1


def main():
    ap = argparse.ArgumentParser(description="Forge cache validator")
    ap.add_argument("--cache-root", default=None, help="override cache root path")
    ap.add_argument("--check-source", action="store_true",
                    help="also re-hash source XMLs on Y: to detect staleness")
    args = ap.parse_args()
    root = Path(args.cache_root).resolve() if args.cache_root else resolve_cache_root()
    return validate(root, check_source=args.check_source)


if __name__ == "__main__":
    sys.exit(main())
