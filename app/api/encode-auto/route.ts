// Plain Text OR XML → RFY. Auto-detects format from content:
// - Starts with `<?xml` → XML path → encryptRfy
// - Otherwise → strip `# ===` headers/comments → synthesizeRfyFromCsv
//
// Optional confidence metadata (opt-in via ?withConfidence=1):
//   When set, instead of returning raw binary, the route returns JSON of the form
//     {
//       rfy_base64: string,           // base64-encoded RFY bytes
//       rfy_size: number,             // length in bytes (for sanity / progress)
//       filename: string,             // suggested attachment filename
//       detected_format: "framecad-import" | "xml-schedule" | "plain-text-csv",
//       oracle_hit: boolean,
//       oracle_source?: string,       // path of cache file when hit
//       oracle_miss_reason?: string,  // why cache missed (codec path)
//       confidence: {
//         source: "cached" | "codec",     // "cached" = Detailer-truth bytes; not scored
//         counts?: { high, medium, low, unknown },  // codec-only
//         total_sticks?: number,                    // codec-only
//         frames?: ScoredFrame[],                   // codec-only — see lib/forge-confidence.ts
//         note?: string,                            // explanation when not scored
//       }
//     }
//   For cache hits we return `confidence.source: "cached"` and skip scoring —
//   Detailer's bytes are ground truth by definition. For codec / synth output
//   we decode the RFY back to structured ops and score every stick against
//   the 66k-record corpus (see lib/forge-confidence.ts).
//
//   Without ?withConfidence=1 the response is unchanged binary RFY (existing
//   contract preserved for clients that don't ask for it).
import { NextResponse } from "next/server";
import { decode, encryptRfy, synthesizeRfyFromCsv } from "@hytek/rfy-codec";
import { readBodyText } from "@/lib/read-body";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { oracleLookup } from "@/lib/oracle-cache";
import { scoreDecodedDocument } from "@/lib/forge-confidence";

export const runtime = "nodejs";

interface ConfidenceJsonResponse {
  rfy_base64: string;
  rfy_size: number;
  filename: string;
  detected_format: "framecad-import" | "xml-schedule" | "plain-text-csv";
  oracle_hit: boolean;
  oracle_source?: string;
  oracle_miss_reason?: string;
  confidence:
    | { source: "cached"; note: string }
    | {
        source: "codec";
        counts: { high: number; medium: number; low: number; unknown: number };
        total_sticks: number;
        frames: ReturnType<typeof scoreDecodedDocument>["frames"];
      }
    | { source: "skipped"; note: string };
}

function wantsConfidence(req: Request): boolean {
  // Two opt-in mechanisms (either works). Picking ?withConfidence=1 as primary
  // since this route already uses headers (x-filename) for client-supplied
  // metadata and adding more headers risks collisions.
  const url = new URL(req.url);
  const qp = url.searchParams.get("withConfidence");
  if (qp === "1" || qp === "true") return true;
  return false;
}

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.txt");
    const raw = (await readBodyText(req)).trim();
    if (!raw) throw new Error("Empty input");
    const withConfidence = wantsConfidence(req);

    // Detect format from the first non-whitespace bytes of the body.
    const lower = raw.toLowerCase();
    const isXml = lower.startsWith("<?xml") || lower.startsWith("<schedule");
    let outName = filename.replace(/\.(txt|csv|xml)$/i, "") + ".rfy";

    let rfy: Buffer;
    let detectedFormat: "framecad-import" | "xml-schedule" | "plain-text-csv";
    let oracleHit = false;
    let oracleSourcePath: string | undefined;
    let oracleMissReason: string | null = null;

    if (isXml) {
      // Two XML formats can come through this endpoint:
      //   1. <framecad_import>  — FrameCAD CNC INPUT feed. We parse it,
      //                            convert to CSV, then synth an RFY from the CSV.
      //   2. <schedule>          — Inner XML extracted from an existing RFY.
      //                            encryptRfy direct (round-trip preserves graphics).
      if (lower.includes("<framecad_import")) {
        detectedFormat = "framecad-import";
        // Oracle cache: if the input XML matches a captured Detailer reference
        // (HG260001/023/044), return Detailer's exact bytes. Bit-exact 100%.
        // Anything else falls through to the codec rule engine below.
        const oracle = oracleLookup(raw);
        if (oracle.hit) {
          oracleHit = true;
          oracleSourcePath = oracle.rfyPath;
          rfy = oracle.rfyBytes;
          const safeJob = oracle.jobnum.replace(/[^A-Za-z0-9]/g, "");
          const safePlan = oracle.planName.replace(/[^A-Za-z0-9._-]/g, "");
          outName = `${safeJob}_${safePlan}.rfy`;
          if (!withConfidence) {
            return new NextResponse(new Uint8Array(rfy), {
              status: 200,
              headers: {
                "content-type": "application/octet-stream",
                "content-disposition": `attachment; filename="${outName}"`,
                "x-detected-format": detectedFormat,
                "x-oracle-hit": "true",
                "x-oracle-source": oracle.rfyPath,
              },
            });
          }
          // Cache-hit + confidence requested: skip scoring (Detailer is truth)
          // and return JSON below via the shared end-of-route path.
          // Falls through to the JSON-response builder.
          const body: ConfidenceJsonResponse = {
            rfy_base64: Buffer.from(rfy).toString("base64"),
            rfy_size: rfy.length,
            filename: outName,
            detected_format: detectedFormat,
            oracle_hit: true,
            oracle_source: oracleSourcePath,
            confidence: {
              source: "cached",
              note: "Detailer-produced bytes from oracle cache — scoring skipped (ground truth).",
            },
          };
          return NextResponse.json(body, {
            status: 200,
            headers: {
              "x-detected-format": detectedFormat,
              "x-oracle-hit": "true",
              "x-oracle-source": oracle.rfyPath,
            },
          });
        }
        oracleMissReason = oracle.reason;
        console.log(`[encode-auto] oracle miss: ${oracleMissReason}`);
        // Direct path: framecad_import XML → ParsedProject → synthesizeRfyFromPlans.
        // Carries 3D <envelope> + stick <start>/<end> through to the codec so
        // elevation-graphics renders correctly on the rollformer.
        const result = framecadImportToRfy(raw);
        if (result.stickCount === 0) throw new Error("No sticks found in <framecad_import> document");
        rfy = result.rfy;
        // Name like Detailer: "<jobnum>_<planname>.rfy" — the HYTEK rollformer
        // parses this filename pattern to display jobs in the "Add Job" UI.
        // Spaces and special chars must be stripped — the machine's USB reader
        // shows "Could not read" if the filename has whitespace.
        const planName = result.xml.match(/<plan name="([^"]+)"/)?.[1] ?? "PLAN";
        const safeJob = result.jobnum.replace(/[^A-Za-z0-9]/g, "");
        const safePlan = planName.replace(/[^A-Za-z0-9._-]/g, "");
        outName = `${safeJob}_${safePlan}.rfy`;
      } else if (lower.includes("<schedule")) {
        detectedFormat = "xml-schedule";
        rfy = encryptRfy(raw);
      } else {
        throw new Error(
          "XML root is not <schedule> or <framecad_import>. " +
          "Expected either the inner FrameCAD schedule XML (from 'RFY → Plain Text + XML') " +
          "or a FrameCAD CNC import XML."
        );
      }
    } else {
      detectedFormat = "plain-text-csv";
      // Strip `# ===` section markers and `#` comments, then synth from first plan.
      const lines = raw.split(/\r?\n/);
      const sections: { name: string; lines: string[] }[] = [];
      let current: { name: string; lines: string[] } | null = null;
      for (const line of lines) {
        const sectionMatch = line.match(/^#\s*===\s*(.+?)\s*===\s*$/);
        if (sectionMatch) {
          current = { name: sectionMatch[1], lines: [] };
          sections.push(current);
          continue;
        }
        if (line.trim().startsWith("#")) continue;
        if (!current) {
          current = { name: "single-plan", lines: [] };
          sections.push(current);
        }
        current.lines.push(line);
      }
      const useSection = sections.find(s => s.lines.some(l => l.trim().length > 0));
      if (!useSection) throw new Error("No CSV rows found in plain-text input");
      const csv = useSection.lines.join("\n").trim();
      const result = synthesizeRfyFromCsv(csv);
      rfy = result.rfy;
    }

    const headers: Record<string, string> = {
      "x-detected-format": detectedFormat,
      "x-oracle-hit": String(oracleHit),
    };
    if (!oracleHit && oracleMissReason) headers["x-oracle-miss-reason"] = oracleMissReason;

    if (!withConfidence) {
      // Original binary contract — unchanged.
      return new NextResponse(new Uint8Array(rfy), {
        status: 200,
        headers: {
          ...headers,
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${outName}"`,
        },
      });
    }

    // Codec / synth path with confidence requested: decode RFY → score sticks.
    // For <schedule> + plain-text-csv we still run the scorer because both end
    // up as a real RFY document; if the corpus has no bucket for that profile/
    // role the scorer returns "unknown" rather than throwing, so this is safe.
    const body: ConfidenceJsonResponse = {
      rfy_base64: Buffer.from(rfy).toString("base64"),
      rfy_size: rfy.length,
      filename: outName,
      detected_format: detectedFormat,
      oracle_hit: false,
      ...(oracleMissReason ? { oracle_miss_reason: oracleMissReason } : {}),
      confidence: (() => {
        try {
          const decoded = decode(rfy);
          const scored = scoreDecodedDocument(decoded);
          return {
            source: "codec" as const,
            counts: scored.counts,
            total_sticks: scored.total_sticks,
            frames: scored.frames,
          };
        } catch (e) {
          // Decode failure shouldn't break the response — return RFY anyway
          // and tell the caller scoring was skipped.
          return {
            source: "skipped" as const,
            note: `decode failed during scoring: ${e instanceof Error ? e.message : String(e)}`,
          };
        }
      })(),
    };
    return NextResponse.json(body, { status: 200, headers });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
