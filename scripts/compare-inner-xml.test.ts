// Decode the reference RFY and our codec output for the same input, then
// diff the inner XML side-by-side. Tells us WHAT specifically differs:
// tooling ops (the diff harness's signal), graphics (3D mesh / polys),
// or metadata (GUIDs, version stamps).
//
// Run:
//   COMPARE_INNER=1 npx vitest run scripts/compare-inner-xml.test.ts
//   COMPARE_INNER=1 COMPARE_PLAN=GF-LBW-70.075 COMPARE_JOB=HG260017 npx vitest run scripts/compare-inner-xml.test.ts

import { describe, it } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { framecadImportToRfy } from "../lib/framecad-import";
import { decryptRfy } from "@hytek/rfy-codec";

const RUN = process.env.COMPARE_INNER === "1";

// Default sample: HG260017 PK4-GF-LBW-70.075 (was 50% size delta)
const JOB = process.env.COMPARE_JOB ?? "HG260017";
const PLAN = process.env.COMPARE_PLAN ?? "GF-LBW-70.075";

const JOB_LOC: Record<string, { rfyDir: string; xmlDir: string; jobnum: string; xmlPrefix: string }> = {
  HG260001: {
    jobnum: "HG260001",
    rfyDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260001 LOT 289 (29) COORA CRESENT CURRIMUNDI\\06 MANUFACTURING\\04 ROLLFORMER FILES\\Split_HG260001",
    xmlDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260001 LOT 289 (29) COORA CRESENT CURRIMUNDI\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT",
    xmlPrefix: "HG260001 LOT 289 (29) COORA CRESENT CURRIMUNDI",
  },
  HG260017: {
    jobnum: "HG260017",
    rfyDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA\\06 MANUFACTURING\\04 ROLLFORMER FILES\\HG260017_SPLIT_2026-03-05",
    xmlDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT",
    xmlPrefix: "HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA",
  },
  HG260023: {
    jobnum: "HG260023",
    rfyDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260023 LOT 1165 (69) ATTENBOROUGH DRIVE BANYA\\06 MANUFACTURING\\04 ROLLFORMER FILES\\Split_HG260023",
    xmlDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260023 LOT 1165 (69) ATTENBOROUGH DRIVE BANYA\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT",
    xmlPrefix: "HG260023 LOT 1165 (69) ATTENBOROUGH DRIVE BANYA",
  },
};

function decryptInflate(rfyBytes: Buffer): string {
  // decryptRfy already returns the inflated UTF-8 inner XML string.
  return decryptRfy(rfyBytes);
}

describe.skipIf(!RUN)("compare-inner-xml", () => {
  it("decodes ref RFY + codec output, dumps both inner XMLs to disk", () => {
    const loc = JOB_LOC[JOB];
    if (!loc) throw new Error(`Unknown job: ${JOB}`);

    const xmlPath = join(loc.xmlDir, `${loc.xmlPrefix}-${PLAN}.xml`);
    const rfyName = `${loc.jobnum}_${PLAN}.rfy`;
    const rfyPath = join(loc.rfyDir, rfyName);

    if (!existsSync(xmlPath)) throw new Error(`XML not found: ${xmlPath}`);
    if (!existsSync(rfyPath)) throw new Error(`RFY not found: ${rfyPath}`);

    console.log(`\n=== Comparing inner XMLs for ${JOB} ${PLAN} ===`);
    console.log(`XML input:    ${xmlPath}`);
    console.log(`Reference:    ${rfyPath}`);

    const xmlText = readFileSync(xmlPath, "utf-8");
    const refBytes = readFileSync(rfyPath);
    const codecResult = framecadImportToRfy(xmlText, { lenient: true });
    const codecBytes = codecResult.rfy;

    console.log(`\nByte sizes:`);
    console.log(`  Codec: ${codecBytes.length}`);
    console.log(`  Ref:   ${refBytes.length}`);
    console.log(`  Δ:     ${codecBytes.length - refBytes.length}`);

    const refInner = decryptInflate(refBytes);
    const codecInner = codecResult.xml; // already-decoded inner XML

    console.log(`\nInner XML sizes:`);
    console.log(`  Codec: ${codecInner.length}`);
    console.log(`  Ref:   ${refInner.length}`);
    console.log(`  Δ:     ${codecInner.length - refInner.length}`);

    // Save both for offline diff
    const outDir = join(process.cwd(), "scripts", "compare-output");
    const fs = require("node:fs") as typeof import("node:fs");
    if (!existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const refOut = join(outDir, `${JOB}_${PLAN}.ref.xml`);
    const codecOut = join(outDir, `${JOB}_${PLAN}.codec.xml`);
    writeFileSync(refOut, refInner, "utf-8");
    writeFileSync(codecOut, codecInner, "utf-8");
    console.log(`\nWrote: ${refOut}`);
    console.log(`Wrote: ${codecOut}`);

    // Tag-level diff: count opening tags by name in each.
    function countTags(xml: string): Record<string, number> {
      const counts: Record<string, number> = {};
      const re = /<([a-zA-Z][a-zA-Z0-9_-]*)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        counts[m[1]!] = (counts[m[1]!] ?? 0) + 1;
      }
      return counts;
    }
    const refCounts = countTags(refInner);
    const codecCounts = countTags(codecInner);
    const allTags = new Set([...Object.keys(refCounts), ...Object.keys(codecCounts)]);
    console.log(`\n=== Tag count comparison (top 15 by ref count) ===`);
    console.log(`${"tag".padEnd(28)}${"ref".padStart(8)}${"codec".padStart(8)}${"Δ".padStart(8)}`);
    const sorted = [...allTags].sort((a, b) => (refCounts[b] ?? 0) - (refCounts[a] ?? 0));
    for (const tag of sorted.slice(0, 25)) {
      const r = refCounts[tag] ?? 0;
      const c = codecCounts[tag] ?? 0;
      if (r === 0 && c === 0) continue;
      console.log(`${tag.padEnd(28)}${String(r).padStart(8)}${String(c).padStart(8)}${String(c - r).padStart(8)}`);
    }
  });
});
