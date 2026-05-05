// Plain Text OR XML → RFY. Auto-detects format from content:
// - Starts with `<?xml` → XML path → encryptRfy
// - Otherwise → strip `# ===` headers/comments → synthesizeRfyFromCsv
import { NextResponse } from "next/server";
import { encryptRfy, synthesizeRfyFromCsv } from "@hytek/rfy-codec";
import { readBodyText } from "@/lib/read-body";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { oracleLookup } from "@/lib/oracle-cache";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.txt");
    const raw = (await readBodyText(req)).trim();
    if (!raw) throw new Error("Empty input");

    // Detect format from the first non-whitespace bytes of the body.
    const lower = raw.toLowerCase();
    const isXml = lower.startsWith("<?xml") || lower.startsWith("<schedule");
    let outName = filename.replace(/\.(txt|csv|xml)$/i, "") + ".rfy";

    let rfy: Buffer;
    let detectedFormat: string;
    let oracleHit = false;
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
          rfy = oracle.rfyBytes;
          const safeJob = oracle.jobnum.replace(/[^A-Za-z0-9]/g, "");
          const safePlan = oracle.planName.replace(/[^A-Za-z0-9._-]/g, "");
          outName = `${safeJob}_${safePlan}.rfy`;
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
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${outName}"`,
      "x-detected-format": detectedFormat,
      "x-oracle-hit": String(oracleHit),
    };
    if (!oracleHit && oracleMissReason) headers["x-oracle-miss-reason"] = oracleMissReason;
    return new NextResponse(new Uint8Array(rfy), { status: 200, headers });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
