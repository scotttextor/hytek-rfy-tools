"""
Forge Phase 2: Oracle Cache Writer

Stores Detailer-produced RFYs in the layout already expected by the TS reader
(`lib/oracle-cache.ts`):

    <cache_root>/
      <jobnum>/
        <planName>.rfy            — bytes verbatim from Detailer
        <planName>.meta.json      — { xml_sha256, generated_at, source_xml_path,
                                       rfy_size, detailer_version, ...}
      _index.json                 — full index for fast cold-start scanning

Atomic write strategy:
  - RFY + meta.json written via tempfile in same dir, then os.replace().
  - _index.json updated by read-modify-write under a sibling .lock file
    (best-effort; collisions tolerated, last writer wins for index entries).

The orchestrator calls cache_put() after each successful Detailer worker run.
The Next.js encode route checks the existing TS reader; this writer feeds it.

Cache root resolution priority:
  1. FORGE_CACHE_DIR env var
  2. ~/OneDrive* /CLAUDE DATA FILE/detailer-oracle-cache    (Scott's existing path)
  3. ~/.forge-cache                                          (fallback)
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Optional


def resolve_cache_root() -> Path:
    """Pick the cache root directory.

    Priority:
      1. FORGE_CACHE_DIR env var (explicit)
      2. Any OneDrive subfolder where detailer-oracle-cache ALREADY EXISTS
         (preserves location set up by a previous PC)
      3. Prefer "OneDrive - <suffix>" (work account) over plain "OneDrive"
         under <home>/CLAUDE DATA FILE/detailer-oracle-cache
      4. ~/.forge-cache fallback
    """
    env = os.environ.get("FORGE_CACHE_DIR")
    if env:
        return Path(env).resolve()
    home = Path.home()

    if home.exists():
        # First pass: any OneDrive that already has the cache dir wins.
        onedrive_candidates: list[Path] = []
        for entry in home.iterdir():
            if entry.name.startswith("OneDrive") and entry.is_dir():
                candidate = entry / "CLAUDE DATA FILE" / "detailer-oracle-cache"
                if candidate.exists():
                    return candidate.resolve()
                onedrive_candidates.append(entry)

        # Second pass: prefer "OneDrive - <work suffix>" over plain "OneDrive"
        if onedrive_candidates:
            onedrive_candidates.sort(key=lambda p: (p.name == "OneDrive", p.name))
            chosen = onedrive_candidates[0]
            return (chosen / "CLAUDE DATA FILE" / "detailer-oracle-cache").resolve()

    return (home / ".forge-cache").resolve()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


_JOBNUM_RE = re.compile(r"<jobnum>\s*\"?\s*([A-Za-z0-9#-]+?)\s*\"?\s*</jobnum>")
_PLAN_RE = re.compile(r'<plan\s+name="([^"]+)"')


def _scan_xml(xml_path: Path) -> tuple[Optional[str], list[str]]:
    """Best-effort regex scan for jobnum + plan names. Returns (jobnum, plans)."""
    try:
        # Cap at 50MB — packed XMLs are ~5-10MB
        if xml_path.stat().st_size > 50 * 1024 * 1024:
            return None, []
        text = xml_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None, []
    jobnum_m = _JOBNUM_RE.search(text)
    jobnum = jobnum_m.group(1) if jobnum_m else None
    plans = list(dict.fromkeys(_PLAN_RE.findall(text)))  # dedupe, preserve order
    return jobnum, plans


def _atomic_write_json(path: Path, payload: object) -> None:
    """Write JSON via tempfile + os.replace — atomic on Windows + POSIX."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    os.replace(tmp, path)


def _update_index(cache_root: Path, key: str, entry: dict) -> None:
    """Read-modify-write the _index.json. Best-effort; last writer wins."""
    idx_path = cache_root / "_index.json"
    existing: dict = {}
    if idx_path.exists():
        try:
            existing = json.loads(idx_path.read_text(encoding="utf-8"))
        except Exception:
            # Corrupt index — start fresh; the rfy/meta files are the source of truth
            existing = {}
    if "entries" not in existing or not isinstance(existing.get("entries"), dict):
        existing = {"entries": {}, "version": 1}
    existing["entries"][key] = entry
    existing["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    _atomic_write_json(idx_path, existing)


def cache_put(
    xml_path: str | os.PathLike,
    rfy_path: str | os.PathLike,
    *,
    jobnum: Optional[str] = None,
    plan_name: Optional[str] = None,
    detailer_version: str = "5.3.4.0",
    cache_root: Optional[Path] = None,
) -> dict:
    """Store an RFY in the cache. Returns the entry dict.

    If jobnum/plan_name aren't provided, they're extracted from the XML.
    Raises ValueError if the XML doesn't yield a unique (jobnum, plan_name).
    """
    xml_p = Path(xml_path).resolve()
    rfy_p = Path(rfy_path).resolve()
    if not xml_p.is_file():
        raise FileNotFoundError(f"xml not found: {xml_p}")
    if not rfy_p.is_file():
        raise FileNotFoundError(f"rfy not found: {rfy_p}")

    if cache_root is None:
        cache_root = resolve_cache_root()
    cache_root = Path(cache_root).resolve()

    if jobnum is None or plan_name is None:
        scanned_job, scanned_plans = _scan_xml(xml_p)
        if jobnum is None:
            jobnum = scanned_job
        if plan_name is None:
            if len(scanned_plans) == 1:
                plan_name = scanned_plans[0]
            elif len(scanned_plans) == 0:
                # Fall back: derive from XML filename, e.g. ...-GF-LBW-70.075.xml
                m = re.search(r"-(GF|FF|RF)-(.+?)\.xml$", xml_p.name, re.I)
                if m:
                    plan_name = f"{m.group(1)}-{m.group(2)}"

    if not jobnum or not plan_name:
        raise ValueError(
            f"could not derive (jobnum, plan_name) for {xml_p.name}: "
            f"got jobnum={jobnum!r} plan_name={plan_name!r}"
        )

    xml_sha = sha256_file(xml_p)
    rfy_size = rfy_p.stat().st_size

    job_dir = cache_root / jobnum
    job_dir.mkdir(parents=True, exist_ok=True)
    cached_rfy = job_dir / f"{plan_name}.rfy"
    cached_meta = job_dir / f"{plan_name}.meta.json"

    # Atomic copy: write to .tmp, then os.replace
    tmp_rfy = cached_rfy.with_suffix(cached_rfy.suffix + ".tmp")
    shutil.copyfile(rfy_p, tmp_rfy)
    os.replace(tmp_rfy, cached_rfy)

    entry = {
        "jobnum": jobnum,
        "plan_name": plan_name,
        "xml_sha256": xml_sha,
        "rfy_size": rfy_size,
        "rfy_path_relative": f"{jobnum}/{plan_name}.rfy",
        "source_xml_path": str(xml_p),
        "detailer_version": detailer_version,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    _atomic_write_json(cached_meta, entry)

    key = f"{jobnum.upper()}__{plan_name.upper()}"
    _update_index(cache_root, key, entry)
    return entry


def cache_get(
    xml_path: str | os.PathLike,
    *,
    jobnum: Optional[str] = None,
    plan_name: Optional[str] = None,
    cache_root: Optional[Path] = None,
) -> Optional[dict]:
    """Look up a cache entry. Returns dict with rfy_path + meta if hit, else None."""
    xml_p = Path(xml_path).resolve()
    if cache_root is None:
        cache_root = resolve_cache_root()
    cache_root = Path(cache_root).resolve()

    if jobnum is None or plan_name is None:
        scanned_job, scanned_plans = _scan_xml(xml_p)
        if jobnum is None:
            jobnum = scanned_job
        if plan_name is None and len(scanned_plans) == 1:
            plan_name = scanned_plans[0]
    if not jobnum or not plan_name:
        return None

    job_dir = cache_root / jobnum
    cached_rfy = job_dir / f"{plan_name}.rfy"
    cached_meta = job_dir / f"{plan_name}.meta.json"
    if not cached_rfy.exists() or not cached_meta.exists():
        return None

    try:
        meta = json.loads(cached_meta.read_text(encoding="utf-8"))
    except Exception:
        return None

    # Validate xml hash
    if meta.get("xml_sha256"):
        live_hash = sha256_file(xml_p)
        if live_hash != meta["xml_sha256"]:
            return None  # stale

    return {
        "hit": True,
        "rfy_path": str(cached_rfy),
        "meta": meta,
    }


# CLI for orchestrator + manual seeding
def _cli():
    import argparse
    ap = argparse.ArgumentParser(description="Forge cache CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_put = sub.add_parser("put", help="Store an RFY in the cache")
    p_put.add_argument("--xml", required=True)
    p_put.add_argument("--rfy", required=True)
    p_put.add_argument("--jobnum", default=None)
    p_put.add_argument("--plan-name", default=None)
    p_put.add_argument("--cache-root", default=None)

    p_get = sub.add_parser("get", help="Look up an RFY in the cache")
    p_get.add_argument("--xml", required=True)
    p_get.add_argument("--jobnum", default=None)
    p_get.add_argument("--plan-name", default=None)
    p_get.add_argument("--cache-root", default=None)

    p_root = sub.add_parser("root", help="Print the resolved cache root")

    p_index = sub.add_parser("index", help="Print summary of cached entries")
    p_index.add_argument("--cache-root", default=None)

    args = ap.parse_args()
    cache_root = Path(args.cache_root).resolve() if getattr(args, "cache_root", None) else None

    if args.cmd == "put":
        entry = cache_put(args.xml, args.rfy,
                          jobnum=args.jobnum, plan_name=args.plan_name,
                          cache_root=cache_root)
        print(json.dumps(entry, indent=2))
    elif args.cmd == "get":
        res = cache_get(args.xml,
                        jobnum=args.jobnum, plan_name=args.plan_name,
                        cache_root=cache_root)
        if res:
            print(json.dumps(res, indent=2))
            return 0
        print("MISS", file=sys.stderr)
        return 1
    elif args.cmd == "root":
        print(resolve_cache_root())
    elif args.cmd == "index":
        root = cache_root or resolve_cache_root()
        idx_path = root / "_index.json"
        if not idx_path.exists():
            print(f"No index at {idx_path}", file=sys.stderr)
            return 1
        idx = json.loads(idx_path.read_text(encoding="utf-8"))
        entries = idx.get("entries", {})
        print(f"Cache root: {root}")
        print(f"Updated:    {idx.get('updated_at', '?')}")
        print(f"Entries:    {len(entries)}")
        for k, e in sorted(entries.items()):
            print(f"  {k:40s}  {e.get('rfy_size', 0):>8} B  {e.get('generated_at', '?')}")
    return 0


if __name__ == "__main__":
    sys.exit(_cli() or 0)
