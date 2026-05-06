// Forge Phase 4 (async): GET status / result for a queued job.
//
// GET  /api/forge/jobs/<id>             → state JSON (polling)
// GET  /api/forge/jobs/<id>?result=1    → RFY bytes (only when status=done)
//
// State is read off disk (forge/queue/runner.py is the writer).
import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { queueDir } from "@/lib/forge-paths";

export const runtime = "nodejs";

interface ForgeJobState {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  jobnum?: string;
  plan_name?: string;
  rfy_size?: number;
  cached?: boolean;
  error?: string;
  worker_stderr_tail?: string;
  cache_write_error?: string;
  created_at?: string;
  updated_at?: string;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  // Defensive: only allow id chars matching uuid v4 / v7 / hex.
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
    return new NextResponse("Invalid job id", { status: 400 });
  }

  const jobDir = join(queueDir(), id);
  const statePath = join(jobDir, "state.json");
  if (!existsSync(statePath)) {
    return new NextResponse(`No such job: ${id}`, { status: 404 });
  }

  let state: ForgeJobState;
  try {
    state = JSON.parse(readFileSync(statePath, "utf-8"));
  } catch (e) {
    return new NextResponse(
      `Job state file unreadable: ${e instanceof Error ? e.message : e}`,
      { status: 500 }
    );
  }

  const wantResult = new URL(req.url).searchParams.get("result") === "1";
  if (wantResult) {
    if (state.status !== "done") {
      return NextResponse.json(
        { error: "result not ready", status: state.status },
        { status: 409 }
      );
    }
    const rfyPath = join(jobDir, "out.rfy");
    if (!existsSync(rfyPath)) {
      return new NextResponse(
        "state=done but out.rfy missing — runner integrity issue",
        { status: 500 }
      );
    }
    const rfy = readFileSync(rfyPath);
    const filename = state.jobnum && state.plan_name
      ? `${state.jobnum}_${state.plan_name}.rfy`
      : `${id}.rfy`;
    return new NextResponse(new Uint8Array(rfy), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-forge-job-id": id,
        "x-forge-jobnum": state.jobnum ?? "",
        "x-forge-plan": state.plan_name ?? "",
        "x-forge-cached": String(state.cached ?? false),
      },
    });
  }

  // Status poll — return state JSON.
  return NextResponse.json(state, {
    status: 200,
    headers: { "x-forge-job-id": id },
  });
}
