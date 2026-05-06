// Three-way side-by-side: Detailer reference (Y: drive) vs Detailer fresh
// (via our driver) vs codec rule engine output, all on the same input XML.
//
// Run:
//   COMPARE_3WAY=1 npx vitest run scripts/three-way-compare.test.ts

import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { framecadImportToRfy } from "../lib/framecad-import";
import { decryptRfy, decodeXml } from "@hytek/rfy-codec";

const RUN = process.env.COMPARE_3WAY === "1";

const XML_PATH = "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT\\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA-GF-LBW-70.075.xml";
const REF_PATH = "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA\\06 MANUFACTURING\\04 ROLLFORMER FILES\\HG260017_SPLIT_2026-03-05\\HG260017_PK4-GF-LBW-70.075.rfy";
const DETAILER_NOW_PATH = "tmp_detailer_test\\test_output.rfy";

interface Stats {
  label: string;
  rfy_bytes: number;
  inner_chars: number;
  plans: number;
  frames: number;
  sticks: number;
  ops_total: number;
  ops_by_type: Record<string, number>;
}

function summarise(label: string, rfyBytes: Buffer): Stats {
  const inner = decryptRfy(rfyBytes);
  const doc = decodeXml(inner);
  let plans = doc.project.plans.length;
  let frames = 0, sticks = 0, ops_total = 0;
  const ops_by_type: Record<string, number> = {};
  for (const p of doc.project.plans) {
    frames += p.frames.length;
    for (const f of p.frames) {
      sticks += f.sticks.length;
      for (const s of f.sticks) {
        ops_total += s.tooling.length;
        for (const op of s.tooling) {
          ops_by_type[op.type] = (ops_by_type[op.type] ?? 0) + 1;
        }
      }
    }
  }
  return { label, rfy_bytes: rfyBytes.length, inner_chars: inner.length, plans, frames, sticks, ops_total, ops_by_type };
}

describe.skipIf(!RUN)("three-way-compare", () => {
  it("produces a side-by-side comparison of Y-drive ref / Detailer fresh / codec rule engine", () => {
    const xml = readFileSync(XML_PATH, "utf-8");
    const refBytes = readFileSync(REF_PATH);
    const detailerNowBytes = readFileSync(DETAILER_NOW_PATH);
    const codecResult = framecadImportToRfy(xml, { lenient: true });

    const a = summarise("Y-drive ref (Detailer 2026-03-05)", refBytes);
    const b = summarise("Detailer fresh today (driver 2026-05-06)", detailerNowBytes);
    const c = summarise("Codec rule engine (our code 2026-05-06)", codecResult.rfy);

    console.log("\n========================================================================");
    console.log("THREE-WAY COMPARISON: same XML input, three RFY outputs");
    console.log("========================================================================");
    console.log("Input XML: HG260017 GF-LBW-70.075 (10 frames)\n");
    console.log(`${"Metric".padEnd(28)}${"Y-drive ref".padStart(15)}${"Detailer-now".padStart(15)}${"Codec".padStart(15)}${"Codec %".padStart(10)}`);
    console.log("-".repeat(83));
    const fmt = (label: string, ra: number, rb: number, rc: number) => {
      const pct = ra > 0 ? `${(100 * rc / ra).toFixed(0)}%` : "-";
      console.log(`${label.padEnd(28)}${String(ra).padStart(15)}${String(rb).padStart(15)}${String(rc).padStart(15)}${pct.padStart(10)}`);
    };
    fmt("RFY bytes (encrypted)", a.rfy_bytes, b.rfy_bytes, c.rfy_bytes);
    fmt("Inner XML chars", a.inner_chars, b.inner_chars, c.inner_chars);
    fmt("Plans", a.plans, b.plans, c.plans);
    fmt("Frames", a.frames, b.frames, c.frames);
    fmt("Sticks", a.sticks, b.sticks, c.sticks);
    fmt("TOTAL ops", a.ops_total, b.ops_total, c.ops_total);
    console.log("-".repeat(83));

    // Per-op-type
    const all_op_types = new Set([...Object.keys(a.ops_by_type), ...Object.keys(b.ops_by_type), ...Object.keys(c.ops_by_type)]);
    const sorted = [...all_op_types].sort((x, y) => (b.ops_by_type[y] ?? 0) - (b.ops_by_type[x] ?? 0));
    console.log(`\n${"Op type".padEnd(28)}${"Y-drive ref".padStart(15)}${"Detailer-now".padStart(15)}${"Codec".padStart(15)}${"Codec %".padStart(10)}`);
    console.log("-".repeat(83));
    for (const t of sorted) {
      const ra = a.ops_by_type[t] ?? 0;
      const rb = b.ops_by_type[t] ?? 0;
      const rc = c.ops_by_type[t] ?? 0;
      if (ra === 0 && rb === 0 && rc === 0) continue;
      const pct = ra > 0 ? `${(100 * rc / ra).toFixed(0)}%` : "-";
      console.log(`  ${t.padEnd(26)}${String(ra).padStart(15)}${String(rb).padStart(15)}${String(rc).padStart(15)}${pct.padStart(10)}`);
    }
    console.log("-".repeat(83));

    // Save full data for offline inspection
    const out = {
      input_xml: XML_PATH,
      y_drive_ref: a,
      detailer_now: b,
      codec: c,
    };
    writeFileSync("tmp_detailer_test/THREE-WAY-COMPARE.json", JSON.stringify(out, null, 2));
    console.log("\nFull data saved to: tmp_detailer_test/THREE-WAY-COMPARE.json");
  });
});
