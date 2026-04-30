// FrameCAD <framecad_import> XML → ZIP containing the production bundle:
//
//   <jobnum>_<plan>.rfy           — encrypted file the F300i loads
//   <jobnum>#1-1_<plan>.csv       — per-plan rollforming CSV (one per plan)
//   README.txt                    — quick reference for what's inside
//
// This is the end-to-end Detailer-replacement output: the same set of files
// HYTEK's existing production workflow expects to find in a job folder.
// The user uploads the FrameCAD CNC-INPUT XML and downloads everything in
// one click.
import { NextResponse } from "next/server";
import { decodeXml, documentToCsvs } from "@hytek/rfy-codec";
import JSZip from "jszip";
import { framecadImportToRfy } from "@/lib/framecad-import";
import { readBodyText } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = (await readBodyText(req)).trim();
    if (!xml) throw new Error("Empty input");

    const lower = xml.toLowerCase();
    if (!lower.includes("<framecad_import")) {
      throw new Error(
        "Expected <framecad_import> XML at the top level. " +
        "If you have a Detailer schedule XML instead, use 'Plain Text or XML → RFY' to encode it directly."
      );
    }

    // 1. Synthesize: parse XML → ParsedProject → RfyDocument → encrypted RFY.
    const result = framecadImportToRfy(xml);
    if (result.stickCount === 0) {
      throw new Error("No sticks found in <framecad_import> document.");
    }

    // 2. Decode synthesized inner XML into RfyDocument so we can also emit CSVs.
    const doc = decodeXml(result.xml);

    // 3. Filename helpers — match Detailer's `<jobnum>_<plan>.rfy` pattern.
    const baseName = filename.replace(/\.(xml|txt)$/i, "");
    const safeJob = (result.jobnum || baseName).replace(/[^A-Za-z0-9]/g, "");
    const planNames = doc.project.plans.map(p => p.name);
    const csvs = documentToCsvs(doc);

    // 4. Assemble the bundle ZIP.
    const zip = new JSZip();
    const wrote: string[] = [];

    // RFY file(s). Single plan → use the plan name; multi-plan → one combined RFY.
    if (doc.project.plans.length === 1) {
      const planName = planNames[0]!.replace(/[^A-Za-z0-9._-]/g, "");
      const rfyName = `${safeJob}_${planName}.rfy`;
      zip.file(rfyName, new Uint8Array(result.rfy));
      wrote.push(rfyName);
    } else {
      const rfyName = `${safeJob}.rfy`;
      zip.file(rfyName, new Uint8Array(result.rfy));
      wrote.push(rfyName);
    }

    // Per-plan CSVs (Stage 4 deliverable). Each plan name typically encodes
    // frame-type + profile (e.g. "GF-LBW-70.075"), making this implicitly
    // per-profile.
    for (const [planName, csvText] of Object.entries(csvs)) {
      const safePlanName = planName.replace(/[^A-Za-z0-9._-]/g, "_");
      const csvName = `${safeJob}#1-1_${safePlanName}.csv`;
      zip.file(csvName, csvText);
      wrote.push(csvName);
    }

    zip.file(
      "README.txt",
      `HYTEK RFY Tools — production bundle\n` +
      `===================================\n\n` +
      `Generated from: ${filename}\n` +
      `Project:        ${result.projectName}\n` +
      `Job number:     ${result.jobnum || "<unset>"}\n` +
      `Plans:          ${result.planCount}\n` +
      `Frames:         ${result.frameCount}\n` +
      `Sticks:         ${result.stickCount}\n\n` +
      `Files in this bundle (${wrote.length}):\n` +
      wrote.map(f => `  ${f}`).join("\n") + "\n\n" +
      `RFY files:   load on the F300i rollformer via USB.\n` +
      `CSV files:   per-plan rollforming sequence (matches Detailer output).\n`
    );

    const zipBuf = await zip.generateAsync({ type: "uint8array" });

    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${safeJob}_bundle.zip"`,
        "x-plan-count": String(result.planCount),
        "x-stick-count": String(result.stickCount),
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
