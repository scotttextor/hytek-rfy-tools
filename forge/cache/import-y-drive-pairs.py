"""
Import every (XML, ref-RFY) pair from y-drive-pairs.json into the Forge cache.

The hytek-rfy-codec repo has scripts/y-drive-pairs.json with paths to every
verified XML↔RFY pair on Y: drive (388 pairs, built by build-y-drive-pairs.mjs).
Each is a Detailer-produced reference for a real HYTEK job.

This script bulk-imports them via cache_put() so the existing
lib/oracle-cache.ts oracleLookup() and the Forge encode routes pick them up
without code changes. After import:
  - 22 Detailer-fresh entries (from prior overnight session)
  - + 388 Y-drive reference entries
  - = ~410 cached RFYs available for instant cache-hit

Usage:
  python forge/cache/import-y-drive-pairs.py [--limit N]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "forge"))
from cache.store import cache_put  # noqa: E402

PAIRS_FILE = ROOT.parent / "hytek-rfy-codec" / "scripts" / "y-drive-pairs.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--pairs-file", default=str(PAIRS_FILE))
    args = ap.parse_args()

    pairs_path = Path(args.pairs_file)
    if not pairs_path.exists():
        print(f"Pairs file not found: {pairs_path}", file=sys.stderr)
        return 1
    bundle = json.loads(pairs_path.read_text(encoding="utf-8"))
    pairs = bundle["pairs"]
    if args.limit:
        pairs = pairs[: args.limit]

    print(f"Importing {len(pairs)} pairs into Forge cache...")
    ok = 0
    skipped = 0
    failed = 0
    for i, p in enumerate(pairs, 1):
        try:
            xml = Path(p["xml"])
            rfy = Path(p["rfy"])
            if not xml.is_file() or not rfy.is_file():
                skipped += 1
                continue
            entry = cache_put(
                xml, rfy,
                jobnum=p["jobnum"], plan_name=p["plan_name"],
                detailer_version="ref-y-drive",
            )
            if i % 25 == 0 or i == len(pairs):
                print(f"  [{i}/{len(pairs)}] OK {entry['jobnum']}__{entry['plan_name']} ({entry['rfy_size']:,} B)")
            ok += 1
        except Exception as e:
            failed += 1
            print(f"  [{i}/{len(pairs)}] FAIL {p.get('jobnum')}__{p.get('plan_name')}: {e}")

    print(f"\nimported: {ok}  skipped: {skipped}  failed: {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
