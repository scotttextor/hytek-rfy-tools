// Forge operator-review API: takes XML, returns codec output + per-stick
// confidence scores derived from the 66,262-record truth corpus stats.
//
// Confidence levels (definitions live in lib/forge-confidence.ts):
//   high   — op count within 1σ of corpus mean AND no ops missing that >70% of similar sticks have
//   medium — op count 1-2σ from mean OR missing one common op type
//   low    — op count >2σ from mean OR missing 2+ common op types
//
// The UI at /forge/review renders frames + sticks colour-coded by this score
// so the operator can spot likely codec misses before sending the RFY to the
// rollformer.
//
// The scoring logic is shared with /api/encode-auto (when invoked with
// ?withConfidence=1) — see lib/forge-confidence.ts.
import { NextResponse } from "next/server";
import { decode } from "@hytek/rfy-codec";
import { readBodyText } from "@/lib/read-body";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { scoreDecodedDocument } from "@/lib/forge-confidence";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const xmlText = (await readBodyText(req)).trim();
    if (!xmlText) return new NextResponse("Empty body", { status: 400 });
    if (!xmlText.toLowerCase().includes("<framecad_import")) {
      return new NextResponse("Forge review accepts <framecad_import> XML only", { status: 400 });
    }

    // Run codec to produce RFY
    const result = framecadImportToRfy(xmlText);
    if (result.stickCount === 0) {
      return new NextResponse("No sticks in XML", { status: 400 });
    }
    const rfyBuf: Buffer = result.rfy;

    // Decode RFY back to structured ops, then score every stick.
    const decoded = decode(rfyBuf);
    const scored = scoreDecodedDocument(decoded);

    return NextResponse.json({
      jobnum: decoded.project.jobNum ?? "?",
      project_name: decoded.project.name,
      counts: scored.counts,
      total_sticks: scored.total_sticks,
      frames: scored.frames,
      rfy_base64: Buffer.from(rfyBuf).toString("base64"),
      rfy_size: rfyBuf.length,
    });
  } catch (e) {
    return new NextResponse(
      `Review error: ${e instanceof Error ? e.message : String(e)}`,
      { status: 500 }
    );
  }
}
