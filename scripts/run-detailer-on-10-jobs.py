"""Run the proven single-shot Detailer driver on 10 random jobs.

Each job runs in its own subprocess for clean isolation (the in-process
batch loop has state issues; subprocess-per-call avoids that).

For each job:
  1. Pick a suitable XML (LBW preferred, fall back to NLBW/RP/TIN)
  2. Kill any zombie Detailer
  3. Subprocess: python scripts/detailer-batch.py <xml> <out>
  4. Move output + extract decoded inner XML for spreadsheet builder

Output:
  tmp_detailer_test/multi-job-detailer/
    <jobnum>/
      detailer-fresh.rfy        — RFY produced by Detailer today
      detailer-fresh.xml        — decoded inner XML
      codec.rfy                 — RFY produced by our codec
      codec.xml                 — codec inner XML
      meta.json                 — paths + sizes + frame/op counts
"""
import os
import re
import subprocess
import sys
import time
import json
from pathlib import Path

PROJECTS_ROOT = r"Y:\(17) 2026 HYTEK PROJECTS"
SCRIPT_DIR = Path(__file__).parent
TOOLS_ROOT = SCRIPT_DIR.parent
DRIVER = SCRIPT_DIR / "detailer-batch.py"
TMP_OUT = Path(r"C:\tmp\detailer-multijob")
RESULTS_DIR = TOOLS_ROOT / "tmp_detailer_test" / "multi-job-detailer"

# 10 jobs across varied builders
JOBS = [
    "HG260002",  # Bowe Projects
    "HG260005",  # Brisbane Homes
    "HG260010",  # Coral Homes Samford
    "HG260014",  # Precision Living
    "HG260016",  # Modish Homes
    "HG260024",  # Stylemaster Homes
    "HG260028",  # GFG Projects
    "HG260040",  # Coral Homes Banya
    "HG260043",  # Powerhouse Switchrooms
    "HG260045",  # Coral Homes Needlewood
]


def find_job_dir(jobnum):
    for builder in os.listdir(PROJECTS_ROOT):
        bp = os.path.join(PROJECTS_ROOT, builder)
        if not os.path.isdir(bp): continue
        try:
            for sub in os.listdir(bp):
                if sub.upper().startswith(jobnum.upper()):
                    return os.path.join(bp, sub), builder
        except Exception: pass
    return None, None


def find_target_xml(jobnum):
    """Pick the best test XML for a job: LBW > NLBW > RP > TIN."""
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
                if not m: continue
                return {
                    "jobnum": jobnum,
                    "builder": builder,
                    "job_dir": job_dir,
                    "xml_path": os.path.join(xml_dir, xml),
                    "plan_name": f"{m.group(1)}-{m.group(2)}",
                }
    return None


def kill_detailer():
    subprocess.run(["taskkill", "/IM", "FRAMECAD Detailer.exe", "/F"],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)


def run_single_shot(xml_path, out_rfy, timeout=300):
    """Invoke detailer-batch.py in single-shot mode. Returns True on success."""
    kill_detailer()
    os.makedirs(os.path.dirname(out_rfy), exist_ok=True)
    if os.path.exists(out_rfy):
        os.remove(out_rfy)
    try:
        result = subprocess.run(
            [sys.executable, "-u", str(DRIVER), xml_path, out_rfy],
            timeout=timeout,
            capture_output=True,
            text=True,
        )
        if os.path.exists(out_rfy) and os.path.getsize(out_rfy) > 0:
            return True, result.stdout + result.stderr
        return False, f"No output produced. stderr: {result.stderr[:500]}"
    except subprocess.TimeoutExpired:
        return False, f"timeout after {timeout}s"
    except Exception as e:
        return False, f"exception: {e}"


def main():
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    TMP_OUT.mkdir(parents=True, exist_ok=True)

    summary = []
    for i, jobnum in enumerate(JOBS, 1):
        target = find_target_xml(jobnum)
        if not target:
            print(f"[{i}/{len(JOBS)}] {jobnum}: SKIP (no suitable XML)")
            summary.append({"jobnum": jobnum, "status": "skip", "reason": "no suitable XML"})
            continue

        print(f"\n[{i}/{len(JOBS)}] {jobnum} ({target['builder']}) {target['plan_name']}")
        print(f"  XML: {target['xml_path']}")

        job_out_dir = RESULTS_DIR / jobnum
        job_out_dir.mkdir(exist_ok=True)
        tmp_rfy = TMP_OUT / f"{jobnum}-{target['plan_name']}.rfy"

        t0 = time.time()
        ok, log = run_single_shot(target["xml_path"], str(tmp_rfy))
        elapsed = time.time() - t0

        if not ok:
            print(f"  FAIL ({elapsed:.0f}s): {log[:200]}")
            summary.append({
                "jobnum": jobnum, "status": "fail", "reason": log[:500],
                "plan_name": target["plan_name"], "xml_path": target["xml_path"],
                "elapsed_sec": elapsed,
            })
            continue

        # Move RFY to results dir
        final_rfy = job_out_dir / "detailer-fresh.rfy"
        if final_rfy.exists(): final_rfy.unlink()
        os.replace(str(tmp_rfy), str(final_rfy))

        rfy_size = final_rfy.stat().st_size
        print(f"  OK ({elapsed:.0f}s) — {rfy_size:,} bytes")

        summary.append({
            "jobnum": jobnum, "status": "ok",
            "plan_name": target["plan_name"], "builder": target["builder"],
            "xml_path": target["xml_path"], "job_dir": target["job_dir"],
            "rfy_path": str(final_rfy), "rfy_size": rfy_size,
            "elapsed_sec": elapsed,
        })

        # Save target metadata
        with open(job_out_dir / "meta.json", "w") as f:
            json.dump({
                "jobnum": jobnum, "builder": target["builder"],
                "plan_name": target["plan_name"], "xml_path": target["xml_path"],
                "rfy_path": str(final_rfy), "rfy_size": rfy_size,
            }, f, indent=2)

    kill_detailer()
    with open(RESULTS_DIR / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    ok_count = sum(1 for r in summary if r["status"] == "ok")
    fail_count = sum(1 for r in summary if r["status"] == "fail")
    skip_count = sum(1 for r in summary if r["status"] == "skip")
    print()
    print("=" * 60)
    print(f"DONE — {ok_count} OK, {fail_count} FAIL, {skip_count} SKIP")
    print(f"Results: {RESULTS_DIR}")


if __name__ == "__main__":
    main()
