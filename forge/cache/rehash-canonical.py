"""
One-shot migration: re-hash cached entries from sha256_file → sha256_xml_canonical.

Background: original cache_put used sha256_file (raw byte hash). The TS reader
in lib/oracle-cache.ts hashes the .trim()ed XML string after Next.js parses it
out of the request body. These produce different hashes when the source XML has
trailing newlines/whitespace, so prerolled cache entries silently miss.

Fix: store.py now hashes the trimmed UTF-8 form (sha256_xml_canonical). This
script walks every entry in _index.json, looks up the source XML, recomputes
canonical hash, and writes it back into meta.json + _index.json.

Idempotent — running twice is fine.

Usage:
  python forge/cache/rehash-canonical.py [--cache-root <dir>] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from cache.store import (  # noqa: E402
    resolve_cache_root, sha256_xml_canonical, _atomic_write_json,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache-root", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    root = Path(args.cache_root).resolve() if args.cache_root else resolve_cache_root()
    idx_path = root / "_index.json"
    if not idx_path.exists():
        print(f"No _index.json at {root}", file=sys.stderr)
        return 1

    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    entries = idx.get("entries", {})

    updated = 0
    same = 0
    missing_xml = 0
    failed = 0

    for key, meta in sorted(entries.items()):
        src = meta.get("source_xml_path")
        if not src:
            print(f"  skip {key}: no source_xml_path")
            failed += 1
            continue
        src_path = Path(src)
        if not src_path.exists():
            print(f"  skip {key}: source XML missing at {src}")
            missing_xml += 1
            continue

        try:
            new_hash = sha256_xml_canonical(src_path)
        except Exception as e:
            print(f"  fail {key}: {e}")
            failed += 1
            continue

        old_hash = meta.get("xml_sha256")
        if old_hash == new_hash:
            same += 1
            continue

        print(f"  rehash {key}: {old_hash[:12] if old_hash else 'None'} -> {new_hash[:12]}")
        if args.dry_run:
            updated += 1
            continue

        # Update both index and per-entry meta
        meta["xml_sha256"] = new_hash
        # Update meta.json on disk
        meta_path = root / meta["jobnum"] / f"{meta['plan_name']}.meta.json"
        if meta_path.exists():
            try:
                disk_meta = json.loads(meta_path.read_text(encoding="utf-8"))
                disk_meta["xml_sha256"] = new_hash
                _atomic_write_json(meta_path, disk_meta)
            except Exception as e:
                print(f"    warn: meta.json update failed for {key}: {e}")
        updated += 1

    # Persist index changes
    if not args.dry_run and updated > 0:
        _atomic_write_json(idx_path, idx)

    print(f"\nrehashed: {updated}  unchanged: {same}  "
          f"missing-xml: {missing_xml}  failed: {failed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
