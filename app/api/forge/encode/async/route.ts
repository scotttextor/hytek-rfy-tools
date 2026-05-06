// Forge Phase 4 (async): POST framecad_import XML, get back a job_id;
// poll /api/forge/jobs/[id] for completion + result.
//
// Behaviour:
//   - cache HIT  → returns 200 with the RFY bytes immediately, x-forge-source=cache
//   - cache MISS → spawns forge/queue/runner.py detached, returns 202 with
//                  { id, status: "pending", poll_url }. Client polls until done.
//
// Job state is filesystem-rooted under <cache_root>/_queue/<id>/. The runner
// updates state.json as it progresses; the GET endpoint inspects that.
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readBodyText } from "@/lib/read-body";
import { oracleLookup } from "@/lib/oracle-cache";
import { resolveCacheRoot, queueDir } from "@/lib/forge-paths";

export const runtime = "nodejs";
export const maxDuration = 30; // we only spawn — actual work is detached.

const REPO_ROOT = process.cwd();
const RUNNER = join(REPO_ROOT, "forge", "queue", "runner.py");

function pythonExe(): string {
  return process.env.FORGE_PYTHON || "python";
}

function quickScanXml(xmlText: string): { jobnum: string | null; planName: string | null } {
  const jobnumMatch = xmlText.match(/<jobnum>\s*"?\s*([A-Za-z0-9#-]+?)\s*"?\s*<\/jobnum>/);
  const planMatch = xmlText.match(/<plan\s+name="([^"]+)"/);
  return {
    jobnum: jobnumMatch ? jobnumMatch[1]! : null,
    planName: planMatch ? planMatch[1]! : null,
  };
}

export async function POST(req: Request) {
  try {
    const xmlText = (await readBodyText(req)).trim();
    if (!xmlText) return new NextResponse("Empty request body", { status: 400 });
    if (!xmlText.toLowerCase().includes("<framecad_import")) {
      return new NextResponse("Forge async accepts <framecad_import> XML only",
                              { status: 400 });
    }

    const { jobnum, planName } = quickScanXml(xmlText);
    if (!jobnum || !planName) {
      return new NextResponse(
        `Could not extract jobnum/planName (jobnum=${jobnum ?? "null"}, planName=${planName ?? "null"})`,
        { status: 400 }
      );
    }

    // Cache hit fast path — no need to queue.
    const oracle = oracleLookup(xmlText);
    if (oracle.hit) {
      return new NextResponse(new Uint8Array(oracle.rfyBytes), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${oracle.jobnum}_${oracle.planName}.rfy"`,
          "x-forge-source": "cache",
          "x-forge-jobnum": oracle.jobnum,
          "x-forge-plan": oracle.planName,
          "x-forge-cache-hit": "true",
        },
      });
    }

    if (!existsSync(RUNNER)) {
      return new NextResponse(
        `Forge runner not found at ${RUNNER}. Async mode unavailable on this deploy.`,
        { status: 503 }
      );
    }

    // Allocate job dir
    const id = randomUUID();
    const queue = queueDir();
    const jobDir = join(queue, id);
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, "input.xml"), xmlText, "utf-8");
    writeFileSync(
      join(jobDir, "state.json"),
      JSON.stringify({
        id,
        status: "pending",
        jobnum,
        plan_name: planName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, null, 2),
      "utf-8"
    );

    // Detached spawn — the route returns immediately, runner finishes ~50s later.
    const isWin = process.platform === "win32";
    const child = spawn(
      pythonExe(),
      ["-u", RUNNER, jobDir],
      {
        detached: true,
        stdio: "ignore",
        ...(isWin ? { windowsHide: false, shell: false } : {}),
        // CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP — independent of parent.
        // @ts-expect-error: creationFlags is win32-only on Node 18+
        creationFlags: isWin ? 0x10 | 0x00000200 : 0,
      }
    );
    child.unref(); // parent doesn't wait on it

    return NextResponse.json(
      {
        id,
        status: "pending",
        jobnum,
        plan_name: planName,
        poll_url: `/api/forge/jobs/${id}`,
      },
      {
        status: 202,
        headers: {
          "x-forge-job-id": id,
          "x-forge-source": "queued",
        },
      }
    );
  } catch (e) {
    return new NextResponse(
      `Forge async error: ${e instanceof Error ? e.message : String(e)}`,
      { status: 500 }
    );
  }
}
