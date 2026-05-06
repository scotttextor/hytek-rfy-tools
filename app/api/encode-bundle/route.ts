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
import { oracleLookup, oracleLookupPerPlan } from "@/lib/oracle-cache";

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

    // Oracle cache: single-plan input matching a captured reference returns
    // Detailer's exact bytes. Multi-plan packed XMLs check per-plan via
    // oracleLookupPerPlan below — each plan that hits the cache is emitted
    // as a bit-exact {jobnum}_{planName}.rfy matching Detailer's output
    // structure.
    const oracle = oracleLookup(xml);
    let oracleHit = oracle.hit;
    let oracleMissReason: string | null = oracle.hit ? null : oracle.reason;
    if (!oracle.hit) console.log(`[encode-bundle] single-plan oracle miss: ${oracle.reason}`);

    // Per-plan oracle lookup runs for ALL inputs. Single-plan inputs that
    // hit `oracle` above will also produce a 1-result perPlan; multi-plan
    // inputs only get per-plan hits. We use perPlan to drive the bundle's
    // RFY emission strategy in the multi-plan branch below.
    const perPlan = oracleLookupPerPlan(xml);
    const perPlanHits = perPlan.results.filter(r => r.hit).length;
    if (perPlan.totalPlans > 1) {
      console.log(
        `[encode-bundle] per-plan oracle: ${perPlanHits}/${perPlan.totalPlans} hit ` +
        `(${perPlan.allHit ? "all hit — bit-exact bundle" : "mixed"})`
      );
    }

    // 1. Synthesize: parse XML → ParsedProject → RfyDocument → encrypted RFY.
    //    Even on oracle hit we still run the codec — we need the synthesized
    //    inner XML to produce CSVs (the rollformer reads the .rfy, but the
    //    plant audit pipeline still consumes the .csv files). The oracle bytes
    //    replace the .rfy contents only.
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

    // RFY file(s).
    //
    // Single plan: use the plan name. Oracle hit → Detailer-bit-exact bytes;
    //              miss → codec output.
    //
    // Multi-plan: emit ONE FILE PER PLAN matching Detailer's actual output
    //             structure ({jobnum}_{planName}.rfy). For each plan, oracle
    //             hit → reference bytes; miss → fallback to the combined
    //             codec RFY for that plan only is NOT trivial (would require
    //             slicing ParsedProject and re-encoding). We compromise: if
    //             ALL plans hit, emit per-plan oracle bytes (bit-exact); if
    //             ANY miss, emit per-plan oracle bytes for the hits AND a
    //             combined codec .rfy for the misses, so the user always gets
    //             every plan's output.
    if (doc.project.plans.length === 1) {
      const planName = planNames[0]!.replace(/[^A-Za-z0-9._-]/g, "");
      const rfyName = `${safeJob}_${planName}.rfy`;
      const rfyBytes = oracle.hit ? oracle.rfyBytes : result.rfy;
      zip.file(rfyName, new Uint8Array(rfyBytes));
      wrote.push(rfyName);
    } else if (perPlan.allHit && perPlan.totalPlans > 0) {
      // Bit-exact path: every plan in the packed XML maps to a captured
      // reference. Emit per-plan files matching Detailer's structure.
      for (const r of perPlan.results) {
        const safePlanName = r.planName.replace(/[^A-Za-z0-9._-]/g, "");
        const rfyName = `${safeJob}_${safePlanName}.rfy`;
        zip.file(rfyName, new Uint8Array(r.rfyBytes!));
        wrote.push(rfyName);
      }
      oracleHit = true;
      oracleMissReason = null;
    } else if (perPlanHits > 0) {
      // Partial: some plans hit, some don't. Emit per-plan oracle files for
      // the hits + the combined codec RFY (which contains all plans, possibly
      // duplicating the hit ones with codec-derived content). The rollformer
      // operator picks the per-plan files for the hits.
      for (const r of perPlan.results) {
        if (!r.hit) continue;
        const safePlanName = r.planName.replace(/[^A-Za-z0-9._-]/g, "");
        const rfyName = `${safeJob}_${safePlanName}.rfy`;
        zip.file(rfyName, new Uint8Array(r.rfyBytes!));
        wrote.push(rfyName);
      }
      // Codec combined RFY for the misses.
      const combinedName = `${safeJob}.rfy`;
      zip.file(combinedName, new Uint8Array(result.rfy));
      wrote.push(combinedName);
      oracleHit = false;
      oracleMissReason = `partial: ${perPlanHits}/${perPlan.totalPlans} plans hit cache; combined codec .rfy included for misses`;
    } else {
      // No cache hits anywhere. Codec output unchanged.
      oracleHit = false;
      oracleMissReason = oracleMissReason ?? perPlan.firstMissReason ?? "multi-plan input — no cache hits";
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

    const respHeaders: Record<string, string> = {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${safeJob}_bundle.zip"`,
      "x-plan-count": String(result.planCount),
      "x-stick-count": String(result.stickCount),
      "x-oracle-hit": String(oracleHit),
    };
    if (!oracleHit && oracleMissReason) respHeaders["x-oracle-miss-reason"] = oracleMissReason;
    if (oracleHit && oracle.hit) respHeaders["x-oracle-source"] = oracle.rfyPath;
    if (perPlan.totalPlans > 1) {
      respHeaders["x-oracle-per-plan-hits"] = String(perPlanHits);
      respHeaders["x-oracle-per-plan-total"] = String(perPlan.totalPlans);
    }
    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: respHeaders,
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
