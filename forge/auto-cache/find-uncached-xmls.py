"""
Walk Y: drive, build a list of XMLs that:
  1. Have no matching reference RFY on Y: drive (so the codec / Detailer
     never produced one for them).
  2. AND are not already in the Forge cache.

These are the XMLs that need Detailer run NOW, while it's still alive, so
the cache covers them post-EOL.

Output: scripts/uncached-xmls.json — a manifest the orchestrator can feed.

Usage:
    python forge/auto-cache/find-uncached-xmls.py

Then run the orchestrator on the result:
    python forge/orchestrator/detailer-orchestrator.py \
        --manifest forge/auto-cache/uncached-xmls.json \
        --resume --max-retries 1
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "forge"))
from cache.store import resolve_cache_root  # noqa: E402

PROJECTS_ROOTS = [
    Path(r"Y:\(17) 2026 HYTEK PROJECTS"),
    Path(r"Y:\(14) 2025 HYTEK PROJECTS"),
]


def plan_name_from_xml_filename(name: str) -> str | None:
    stem = name[:-4] if name.lower().endswith(".xml") else name
    m = re.search(r"(?:^|-)((?:TH\d+-)?(?:GF|FF|RF|UF|MF)-[A-Z0-9]+-[\d.]+)$", stem, re.I)
    return m.group(1) if m else None


def walk_xmls():
    out = []
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
                        out.append((f, builder.name, job.name))
                packed = xml_dir / "Packed"
                if packed.exists():
                    for f in packed.iterdir():
                        if f.is_file() and f.suffix.lower() == ".xml":
                            out.append((f, builder.name, job.name))
    return out


def main():
    cache_root = resolve_cache_root()
    cached_keys: set[str] = set()
    idx = cache_root / "_index.json"
    if idx.exists():
        bundle = json.loads(idx.read_text(encoding="utf-8"))
        cached_keys = set(bundle.get("entries", {}).keys())
    print(f"Cache has {len(cached_keys)} keys.")

    print(f"Walking Y: drive...")
    xmls = walk_xmls()
    print(f"Found {len(xmls)} XML files.")

    # For each XML, derive (jobnum, plan_name)
    uncached = []
    for path, builder, jobdir in xmls:
        plan = plan_name_from_xml_filename(path.name)
        # Jobnum: first whitespace-delimited token of jobdir, must start with HG
        jobnum = jobdir.split()[0] if jobdir.split() else None
        if not (jobnum and re.match(r"^HG\d+", jobnum, re.I)):
            continue
        if not plan:
            continue
        key = f"{jobnum.upper()}__{plan.upper()}"
        if key in cached_keys:
            continue
        uncached.append({
            "id": f"{jobnum}__{plan}",
            "xml_path": str(path),
            "rfy_out": str(cache_root / "_auto-cache-tmp" / f"{jobnum}_{plan}.rfy"),
            "_meta": {"jobnum": jobnum, "plan_name": plan, "builder": builder, "jobdir": jobdir},
        })

    out_path = ROOT / "forge" / "auto-cache" / "uncached-xmls.json"
    out_path.write_text(json.dumps(uncached, indent=2), encoding="utf-8")
    print(f"Uncached XMLs: {len(uncached)}")
    print(f"Manifest: {out_path}")

    # Stats
    by_plan_type: dict[str, int] = {}
    by_builder: dict[str, int] = {}
    by_year: dict[str, int] = {}
    for u in uncached:
        m = u["_meta"]
        plan_type = m["plan_name"].split("-")
        plan_type = plan_type[1] if len(plan_type) > 1 else "?"
        by_plan_type[plan_type] = by_plan_type.get(plan_type, 0) + 1
        by_builder[m["builder"]] = by_builder.get(m["builder"], 0) + 1
        if "2026" in str(u["xml_path"]):
            by_year["2026"] = by_year.get("2026", 0) + 1
        elif "2025" in str(u["xml_path"]):
            by_year["2025"] = by_year.get("2025", 0) + 1

    print()
    print("By plan-type (first 10):")
    for k, v in sorted(by_plan_type.items(), key=lambda x: -x[1])[:10]:
        print(f"  {k:10s}  {v}")
    print("By builder (top 10):")
    for k, v in sorted(by_builder.items(), key=lambda x: -x[1])[:10]:
        print(f"  {k:40s}  {v}")
    print("By year:")
    for k, v in by_year.items():
        print(f"  {k}  {v}")


if __name__ == "__main__":
    main()
