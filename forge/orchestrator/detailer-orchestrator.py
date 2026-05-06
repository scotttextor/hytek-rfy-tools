"""
Forge Phase 1.2: Detailer Orchestrator

Runs forge/worker/detailer-worker.py over a batch of XMLs with:
  - subprocess isolation per XML (no in-process state pollution)
  - bounded retry on transient failures (UI race, timeout, import/export glitches)
  - resume support (skip XMLs whose output RFY already exists)
  - per-job structured status capture (parses worker's stderr JSON lines)
  - aggregate summary written to <out_dir>/_orchestrator-summary.json
  - hard stop on fatal categories (license bad)

Inputs (one of these is required):
  --manifest <file>       JSON list: [{"xml_path": "...", "rfy_out": "...", "id": "..."}]
  --xml-glob <pattern>    Glob pattern for inputs; output paths inferred from --out-dir + filename
  --jobs <comma-list>     Job numbers (HG260017,...) — picks XMLs the same way Phase 1 driver did
                          (LBW > NLBW > RP > TIN). Output paths placed under --out-dir/<jobnum>/.

Optional:
  --out-dir <dir>         Where to write RFYs (default: ./forge-orchestrator-out)
  --max-retries N         Per-job retry budget (default: 2 — total 3 attempts)
  --retry-backoff-sec S   Sleep between retries (default: 5)
  --timeout-sec S         Per-attempt timeout (default: 240; worker itself enforces 180s internal)
  --resume                Skip jobs whose rfy_out already exists with size>0
  --halt-on-license-bad   Stop the whole batch when a license-bad exit is observed (default: on)

Exit code:
  0 — every requested job has a final OK or RESUME-SKIP status
  1 — at least one job failed permanently after retries
  2 — fatal abort (license bad and --halt-on-license-bad set, or invalid usage)
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

# Repo paths
ROOT = Path(__file__).resolve().parent.parent.parent
WORKER = ROOT / "forge" / "worker" / "detailer-worker.py"
PROJECTS_ROOT = r"Y:\(17) 2026 HYTEK PROJECTS"

# Make forge/cache importable
sys.path.insert(0, str(ROOT / "forge"))
try:
    from cache.store import cache_put, resolve_cache_root  # type: ignore
except Exception:
    cache_put = None  # cache write is best-effort; orchestrator still works without it
    resolve_cache_root = None

# Worker exit code taxonomy (mirrored from worker)
EX_OK              = 0
EX_LICENSE_BAD     = 1
EX_INPUT_MISSING   = 2
EX_UI_NOT_DETECTED = 3
EX_IMPORT_FAILED   = 4
EX_EXPORT_FAILED   = 5
EX_TIMEOUT         = 6
EX_UNKNOWN         = 7

FATAL = {EX_LICENSE_BAD}
SKIP  = {EX_INPUT_MISSING}  # don't retry, just record and continue
RETRYABLE = {EX_UI_NOT_DETECTED, EX_IMPORT_FAILED, EX_EXPORT_FAILED, EX_TIMEOUT, EX_UNKNOWN}


def find_job_dir(jobnum: str):
    if not os.path.isdir(PROJECTS_ROOT):
        return None, None
    for builder in os.listdir(PROJECTS_ROOT):
        bp = os.path.join(PROJECTS_ROOT, builder)
        if not os.path.isdir(bp):
            continue
        try:
            for sub in os.listdir(bp):
                if sub.upper().startswith(jobnum.upper()):
                    return os.path.join(bp, sub), builder
        except Exception:
            pass
    return None, None


def find_target_xml(jobnum: str):
    """Pick the best test XML for a job: LBW > NLBW > RP > TIN. Same heuristic as the Phase 1 driver."""
    job_dir, builder = find_job_dir(jobnum)
    if not job_dir:
        return None
    xml_dir = os.path.join(job_dir, "03 DETAILING", "03 FRAMECAD DETAILER", "01 XML OUTPUT")
    if not os.path.isdir(xml_dir):
        return None
    xmls = [f for f in os.listdir(xml_dir) if f.lower().endswith(".xml")]
    for prefix in ("-LBW-", "-NLBW-", "-RP-", "-TIN-"):
        for xml in xmls:
            if prefix in xml:
                m = re.search(r"-(GF|FF|RF)-(.+?)\.xml$", xml, re.I)
                if not m:
                    continue
                return {
                    "jobnum": jobnum,
                    "builder": builder,
                    "job_dir": job_dir,
                    "xml_path": os.path.join(xml_dir, xml),
                    "plan_name": f"{m.group(1)}-{m.group(2)}",
                }
    return None


def parse_worker_status(stderr_text: str):
    """Walk the worker's structured-stderr lines. Return {steps: [...], error: {...} or None}."""
    steps = []
    error = None
    for line in stderr_text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("status") == "error":
            error = obj
        else:
            steps.append(obj)
    return {"steps": steps, "error": error}


def run_worker_once(xml_path: str, rfy_out: str, timeout_sec: int):
    """Invoke the worker once. Returns dict with rc, status, error (if any), elapsed_sec.

    On Windows we spawn the child with CREATE_NEW_CONSOLE so it owns its own
    console and has foreground-window rights — needed for pywinauto's
    SetForegroundWindow calls. We capture stderr to a temp file (passed via
    --status-file is not yet a worker option, so we rely on file redirect).
    """
    rfy_out_p = Path(rfy_out)
    rfy_out_p.parent.mkdir(parents=True, exist_ok=True)
    if rfy_out_p.exists():
        rfy_out_p.unlink()

    # Capture stderr via redirect file. We can't use stderr=PIPE because piping
    # detaches the child from console foreground rights, breaking pywinauto.
    import tempfile
    stderr_fd = tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".forge.log",
                                             encoding="utf-8")
    stderr_path = stderr_fd.name
    stderr_fd.close()

    creationflags = 0
    if os.name == "nt":
        # CREATE_NEW_CONSOLE = 0x10 — child owns its own console; foreground rights work.
        creationflags = 0x00000010

    t0 = time.time()
    rc = None
    try:
        with open(stderr_path, "w", encoding="utf-8") as ef:
            try:
                result = subprocess.run(
                    [sys.executable, "-u", str(WORKER), xml_path, str(rfy_out_p)],
                    timeout=timeout_sec,
                    stdout=subprocess.DEVNULL,
                    stderr=ef,
                    creationflags=creationflags,
                )
                rc = result.returncode
            except subprocess.TimeoutExpired:
                rc = EX_TIMEOUT
        # Read accumulated stderr
        with open(stderr_path, "r", encoding="utf-8", errors="replace") as ef:
            stderr_text = ef.read()
    finally:
        try:
            os.unlink(stderr_path)
        except Exception:
            pass

    parsed = parse_worker_status(stderr_text)
    if rc == EX_TIMEOUT and not parsed["error"]:
        parsed["error"] = {"status": "error", "category": EX_TIMEOUT,
                           "message": f"orchestrator timeout after {timeout_sec}s"}
    elapsed = time.time() - t0

    rfy_size = rfy_out_p.stat().st_size if rfy_out_p.exists() else 0
    return {
        "rc": rc,
        "elapsed_sec": round(elapsed, 1),
        "rfy_size": rfy_size,
        "rfy_path": str(rfy_out_p),
        "steps": parsed["steps"],
        "error": parsed["error"],
        "stderr_text": stderr_text[-2000:],  # tail for debugging
    }


def run_with_retry(xml_path: str, rfy_out: str, timeout_sec: int,
                   max_retries: int, retry_backoff_sec: int):
    """Call the worker up to max_retries+1 times. Returns the final attempt result + attempt history."""
    attempts = []
    for attempt_idx in range(max_retries + 1):
        if attempt_idx > 0:
            time.sleep(retry_backoff_sec)
        res = run_worker_once(xml_path, rfy_out, timeout_sec)
        attempts.append({
            "attempt": attempt_idx + 1,
            "rc": res["rc"],
            "elapsed_sec": res["elapsed_sec"],
            "rfy_size": res["rfy_size"],
            "error_category": (res["error"] or {}).get("category"),
            "error_message": (res["error"] or {}).get("message"),
        })
        if res["rc"] == EX_OK:
            return res, attempts
        if res["rc"] in FATAL:
            return res, attempts
        if res["rc"] in SKIP:
            return res, attempts
        # Otherwise: retryable. Loop continues.
    return res, attempts


def load_manifest(manifest_path: Path):
    with open(manifest_path) as f:
        items = json.load(f)
    if not isinstance(items, list):
        raise SystemExit("Manifest must be a JSON list")
    out = []
    for item in items:
        if "xml_path" not in item or "rfy_out" not in item:
            raise SystemExit(f"Manifest entry missing xml_path or rfy_out: {item}")
        out.append({
            "id": item.get("id") or Path(item["xml_path"]).stem,
            "xml_path": item["xml_path"],
            "rfy_out": item["rfy_out"],
        })
    return out


def expand_jobs(jobs_csv: str, out_dir: Path):
    items = []
    for jobnum in [j.strip() for j in jobs_csv.split(",") if j.strip()]:
        target = find_target_xml(jobnum)
        if not target:
            print(f"  SKIP {jobnum}: no suitable XML found under {PROJECTS_ROOT}", file=sys.stderr)
            continue
        rfy_out = out_dir / jobnum / f"{jobnum}-{target['plan_name']}.rfy"
        items.append({
            "id": f"{jobnum}-{target['plan_name']}",
            "xml_path": target["xml_path"],
            "rfy_out": str(rfy_out),
            "_meta": {"jobnum": jobnum, "builder": target["builder"]},
        })
    return items


def expand_glob(pattern: str, out_dir: Path):
    from glob import glob
    items = []
    for xml in sorted(glob(pattern)):
        stem = Path(xml).stem
        rfy_out = out_dir / f"{stem}.rfy"
        items.append({"id": stem, "xml_path": xml, "rfy_out": str(rfy_out)})
    return items


def main():
    ap = argparse.ArgumentParser(description="Forge Detailer orchestrator — Phase 1.2")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--manifest", help="JSON manifest with [{xml_path, rfy_out, id}] entries")
    src.add_argument("--xml-glob", help="Glob pattern for input XMLs")
    src.add_argument("--jobs", help="Comma-separated job numbers, e.g. HG260017,HG260023")

    ap.add_argument("--out-dir", default="./forge-orchestrator-out",
                    help="Output dir for non-manifest sources (default: ./forge-orchestrator-out)")
    ap.add_argument("--max-retries", type=int, default=2,
                    help="Retries per job after the first attempt (default: 2)")
    ap.add_argument("--retry-backoff-sec", type=int, default=5,
                    help="Sleep between retries (default: 5)")
    ap.add_argument("--timeout-sec", type=int, default=240,
                    help="Per-attempt timeout (default: 240; worker itself uses 180 internally)")
    ap.add_argument("--resume", action="store_true",
                    help="Skip jobs whose rfy_out already exists with size>0")
    ap.add_argument("--no-halt-on-license-bad", action="store_true",
                    help="Continue past license-bad exits instead of aborting (default: halt)")
    ap.add_argument("--no-cache-write", action="store_true",
                    help="Don't write successful results into the Forge cache (default: write)")
    args = ap.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.manifest:
        items = load_manifest(Path(args.manifest))
    elif args.xml_glob:
        items = expand_glob(args.xml_glob, out_dir)
    else:
        items = expand_jobs(args.jobs, out_dir)

    if not items:
        print("No jobs to run.", file=sys.stderr)
        return 2

    print(f"Forge orchestrator: {len(items)} job(s); out_dir={out_dir}; "
          f"retries={args.max_retries}; resume={args.resume}", file=sys.stderr)

    summary = []
    halted = False
    for i, item in enumerate(items, 1):
        rfy_out_p = Path(item["rfy_out"])
        # Resume support: skip if output already exists
        if args.resume and rfy_out_p.exists() and rfy_out_p.stat().st_size > 0:
            entry = {
                "id": item["id"],
                "status": "resume_skip",
                "rfy_out": str(rfy_out_p),
                "rfy_size": rfy_out_p.stat().st_size,
                "xml_path": item["xml_path"],
            }
            summary.append(entry)
            print(f"[{i}/{len(items)}] {item['id']} — RESUME-SKIP "
                  f"({rfy_out_p.stat().st_size:,} bytes already there)", file=sys.stderr)
            continue

        print(f"[{i}/{len(items)}] {item['id']} — RUN", file=sys.stderr)
        res, attempts = run_with_retry(
            item["xml_path"], item["rfy_out"],
            args.timeout_sec, args.max_retries, args.retry_backoff_sec,
        )
        entry = {
            "id": item["id"],
            "xml_path": item["xml_path"],
            "rfy_out": item["rfy_out"],
            "status": "ok" if res["rc"] == EX_OK else "fail",
            "rc": res["rc"],
            "rfy_size": res["rfy_size"],
            "elapsed_sec": res["elapsed_sec"],
            "attempts": attempts,
            "error": res["error"],
        }
        summary.append(entry)
        if res["rc"] == EX_OK:
            # Write into the Forge cache (best-effort)
            if not args.no_cache_write and cache_put is not None:
                try:
                    cache_entry = cache_put(item["xml_path"], item["rfy_out"])
                    entry["cached_at"] = cache_entry["generated_at"]
                    entry["cache_xml_sha256"] = cache_entry["xml_sha256"]
                except Exception as e:
                    entry["cache_write_error"] = str(e)
                    print(f"  warn: cache write failed: {e}", file=sys.stderr)
            print(f"  OK  ({res['elapsed_sec']}s, {res['rfy_size']:,} bytes, "
                  f"{len(attempts)} attempt(s))", file=sys.stderr)
        else:
            cat = (res["error"] or {}).get("category", res["rc"])
            msg = (res["error"] or {}).get("message", "(no message)")
            print(f"  FAIL category={cat} after {len(attempts)} attempt(s) — {msg}", file=sys.stderr)
            if res["rc"] in FATAL and not args.no_halt_on_license_bad:
                print(f"  HALT — fatal exit {res['rc']}; aborting batch.", file=sys.stderr)
                halted = True
                break

    summary_path = out_dir / "_orchestrator-summary.json"
    with open(summary_path, "w") as f:
        json.dump({
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "out_dir": str(out_dir),
            "halted": halted,
            "items": summary,
        }, f, indent=2)

    ok = sum(1 for e in summary if e["status"] == "ok")
    skip = sum(1 for e in summary if e["status"] == "resume_skip")
    fail = sum(1 for e in summary if e["status"] == "fail")
    print(f"\nDONE — {ok} OK, {skip} RESUME-SKIP, {fail} FAIL "
          f"(halted={halted})", file=sys.stderr)
    print(f"Summary: {summary_path}", file=sys.stderr)

    if halted:
        return 2
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
