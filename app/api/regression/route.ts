// Regression dashboard data API.
//
// GET  → returns the cached RegressionReport, or runs the corpus diff once
//        (lazy first-load) if no cache exists yet.
// POST → forces a fresh run (re-walks the corpus, re-runs every diff).
//
// The diff is expensive (40 jobs × ~1-3s each = 1-2 min), so we cache the
// result in-memory per-process. Refreshes block until the run completes;
// concurrent refresh requests share the same in-flight run.

import { NextResponse } from "next/server";
import {
  getCached,
  getCorpusDir,
  refreshRegression,
} from "@/lib/regression";

export const runtime = "nodejs";
// Long-running: corpus has 40 jobs × ~1-3s each. Set max duration generously.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * The regression diff runs against a local corpus folder. On Vercel /
 * other shared hosts the local Windows path doesn't exist, so we return
 * a structured "unavailable" response (200) instead of a 500 error
 * banner. The dashboard renders a friendly explanation when it sees
 * `corpusUnavailable: true`.
 */
function corpusMissingResponse(corpusDir: string, msg: string) {
  return NextResponse.json(
    {
      corpusUnavailable: true,
      corpusDir,
      message: msg,
      hint: "Run the dashboard locally with the corpus on disk, or set the CORPUS_DIR env var to a valid folder containing paired .xml/.rfy/.csv files.",
    },
    { status: 200 },
  );
}

function isCorpusMissing(e: unknown): boolean {
  const msg = String(e instanceof Error ? e.message : e);
  return /Corpus directory not found/i.test(msg) || /ENOENT/i.test(msg);
}

export async function GET() {
  try {
    let report = getCached();
    if (!report) {
      report = await refreshRegression();
    }
    return NextResponse.json(report);
  } catch (e) {
    if (isCorpusMissing(e)) {
      return corpusMissingResponse(getCorpusDir(), String(e instanceof Error ? e.message : e));
    }
    return NextResponse.json(
      {
        error: String(e instanceof Error ? e.message : e),
        corpusDir: getCorpusDir(),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { corpusDir?: string; filter?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — defaults to env-configured corpus.
  }
  try {
    const report = await refreshRegression({
      corpusDir: body.corpusDir,
      filter: body.filter,
    });
    return NextResponse.json(report);
  } catch (e) {
    if (isCorpusMissing(e)) {
      return corpusMissingResponse(body.corpusDir ?? getCorpusDir(), String(e instanceof Error ? e.message : e));
    }
    return NextResponse.json(
      {
        error: String(e instanceof Error ? e.message : e),
        corpusDir: body.corpusDir ?? getCorpusDir(),
      },
      { status: 500 },
    );
  }
}
