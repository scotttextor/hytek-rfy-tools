// Forge Phase 4: Detailer-on-cache-miss API.
//
// POST /api/forge/encode    framecad_import XML  →  RFY bytes
//
// Flow:
//   1. quickScan the input XML for jobnum + plan name
//   2. oracleLookup → if HIT, return cached RFY bytes (instant)
//   3. on MISS: spawn forge/worker/detailer-worker.py to drive Detailer
//   4. on worker success: write the result into the cache, return RFY bytes
//
// Differs from /api/encode-auto: that route falls back to the rule-engine
// codec on cache miss (~82% Detailer parity). This route force-runs Detailer
// for bit-exact output. Trade-off is ~50s blocking call per miss.
//
// Local-only: this requires Python + Detailer + a license-OK install on the
// machine running the Next.js server. On Vercel/cloud it returns 503.
import { NextResponse } from "next/server";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBodyText } from "@/lib/read-body";
import { oracleLookup } from "@/lib/oracle-cache";

export const runtime = "nodejs";
// Detailer worker has 180s internal timeout; orchestrator gives 240s; we add buffer.
export const maxDuration = 300;

const REPO_ROOT = process.cwd();
const WORKER = join(REPO_ROOT, "forge", "worker", "detailer-worker.py");
const CACHE_STORE = join(REPO_ROOT, "forge", "cache", "store.py");

interface ForgeResponse {
  source: "cache" | "detailer";
  jobnum: string;
  planName: string;
  rfyBytes: number;
  elapsedMs: number;
  rfyPath?: string;
  workerStderrTail?: string;
}

function quickScanXml(xmlText: string): { jobnum: string | null; planName: string | null } {
  const jobnumMatch = xmlText.match(/<jobnum>\s*"?\s*([A-Za-z0-9#-]+?)\s*"?\s*<\/jobnum>/);
  const jobnum = jobnumMatch ? jobnumMatch[1]! : null;
  // Pick first <plan name="..."> — the encode route assumes one-plan-per-call.
  const planMatch = xmlText.match(/<plan\s+name="([^"]+)"/);
  const planName = planMatch ? planMatch[1]! : null;
  return { jobnum, planName };
}

function pythonExe(): string {
  // Honour explicit override; else pick "python" (Windows + most distros).
  return process.env.FORGE_PYTHON || "python";
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const xmlText = (await readBodyText(req)).trim();
    if (!xmlText) {
      return new NextResponse("Empty request body", { status: 400 });
    }
    if (!xmlText.toLowerCase().includes("<framecad_import")) {
      return new NextResponse(
        "Forge encode currently accepts <framecad_import> XML only",
        { status: 400 }
      );
    }

    const { jobnum, planName } = quickScanXml(xmlText);
    if (!jobnum || !planName) {
      return new NextResponse(
        `Could not extract jobnum/planName (jobnum=${jobnum ?? "null"}, planName=${planName ?? "null"})`,
        { status: 400 }
      );
    }

    // Step 1 — cache lookup
    const oracle = oracleLookup(xmlText);
    if (oracle.hit) {
      const body: ForgeResponse = {
        source: "cache",
        jobnum: oracle.jobnum,
        planName: oracle.planName,
        rfyBytes: oracle.rfyBytes.length,
        elapsedMs: Date.now() - t0,
        rfyPath: oracle.rfyPath,
      };
      return new NextResponse(new Uint8Array(oracle.rfyBytes), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${jobnum}_${planName}.rfy"`,
          "x-forge-source": "cache",
          "x-forge-jobnum": body.jobnum,
          "x-forge-plan": body.planName,
          "x-forge-cache-hit": "true",
          "x-forge-elapsed-ms": String(body.elapsedMs),
        },
      });
    }

    // Step 2 — spawn worker (Detailer subprocess driver)
    if (!existsSync(WORKER)) {
      return new NextResponse(
        `Forge worker not found at ${WORKER}. Is this a non-repo deployment?`,
        { status: 503 }
      );
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "forge-route-"));
    const tmpXml = join(tmpDir, "input.xml");
    const tmpRfy = join(tmpDir, "out.rfy");
    writeFileSync(tmpXml, xmlText, "utf-8");

    let workerResult;
    try {
      // CREATE_NEW_CONSOLE = 0x10 — needed for pyautogui foreground rights on Windows.
      const isWin = process.platform === "win32";
      const creationflags = isWin ? 0x10 : 0;
      workerResult = spawnSync(
        pythonExe(),
        ["-u", WORKER, tmpXml, tmpRfy],
        {
          encoding: "utf-8",
          timeout: 240_000,
          windowsHide: false, // CREATE_NEW_CONSOLE makes a window briefly visible — that's OK
          ...(isWin ? { detached: false, shell: false } : {}),
          // @ts-expect-error: creationFlags is win32-only on Node 18+
          creationFlags: creationflags,
        }
      );
      if (workerResult.status !== 0) {
        const stderr = (workerResult.stderr || "").toString();
        const tail = stderr.slice(-2000);
        return new NextResponse(
          `Detailer worker failed (exit ${workerResult.status}). Tail of stderr:\n${tail}`,
          {
            status: 500,
            headers: { "x-forge-worker-exit": String(workerResult.status) },
          }
        );
      }
      if (!existsSync(tmpRfy)) {
        return new NextResponse(
          "Worker exited 0 but no RFY file produced — investigate stderr",
          { status: 500 }
        );
      }

      // Step 3 — read RFY bytes
      const rfyBytes = readFileSync(tmpRfy);

      // Step 4 — store cache entry (best-effort; failure doesn't fail the request)
      try {
        spawnSync(
          pythonExe(),
          ["-u", CACHE_STORE, "put", "--xml", tmpXml, "--rfy", tmpRfy,
            "--jobnum", jobnum, "--plan-name", planName],
          { encoding: "utf-8", timeout: 30_000 }
        );
      } catch {
        // intentional: cache write is best-effort
      }

      const body: ForgeResponse = {
        source: "detailer",
        jobnum,
        planName,
        rfyBytes: rfyBytes.length,
        elapsedMs: Date.now() - t0,
        workerStderrTail: (workerResult.stderr || "").toString().slice(-1000),
      };
      return new NextResponse(new Uint8Array(rfyBytes), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${jobnum}_${planName}.rfy"`,
          "x-forge-source": "detailer",
          "x-forge-jobnum": body.jobnum,
          "x-forge-plan": body.planName,
          "x-forge-cache-hit": "false",
          "x-forge-elapsed-ms": String(body.elapsedMs),
        },
      });
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  } catch (e) {
    return new NextResponse(
      `Forge encode error: ${e instanceof Error ? e.message : String(e)}`,
      { status: 500 }
    );
  }
}
