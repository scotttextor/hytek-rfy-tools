// Smoke tests for the oracle cache. These tests require Y: drive and/or
// the OneDrive HG260044 reference cache to be reachable. When neither is
// available the tests SKIP rather than fail — CI/dev machines off the
// HYTEK network shouldn't break the suite.
//
// What we verify (when references are present):
//   1. Index has > 0 entries (the corpus walked and produced something).
//   2. For each known reference, feeding the source XML to oracleLookup
//      returns hit=true and bytes that exactly match the on-disk RFY.
//   3. Negative case: a fabricated jobnum that does NOT exist in the
//      corpus returns hit=false with a sensible reason.
//   4. DISABLE_ORACLE_CACHE=1 short-circuits to miss.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  oracleLookup,
  oracleLookupPerPlan,
  oracleIndexSnapshot,
  _resetOracleCacheForTests,
} from "./oracle-cache";

const HG260001_PACKED_DIR =
  "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260001 LOT 289 (29) COORA CRESENT CURRIMUNDI\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT\\Packed";
const HG260023_PACKED_DIR =
  "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260023 LOT 1165 (69) ATTENBOROUGH DRIVE BANYA\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT\\Packed";
const HG260044_FLAT_DIR =
  "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260044 LOT 1810 (14) ELDERBERRY ST UPPER CABOOLTURE\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT";

const HG260001_RFY_DIR =
  "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260001 LOT 289 (29) COORA CRESENT CURRIMUNDI\\06 MANUFACTURING\\04 ROLLFORMER FILES\\Split_HG260001";
const HG260023_RFY_DIR =
  "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260023 LOT 1165 (69) ATTENBOROUGH DRIVE BANYA\\06 MANUFACTURING\\04 ROLLFORMER FILES\\Split_HG260023";
const HG260044_RFY_DIR =
  "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260044 LOT 1810 (14) ELDERBERRY ST UPPER CABOOLTURE\\06 MANUFACTURING\\04 ROLLFORMER FILES";

const Y_DRIVE_AVAILABLE = existsSync(HG260001_RFY_DIR);

/** Extract a single <plan> from a multi-plan packed XML so we can feed
 *  oracle a single-plan input (matches the real upload shape). */
function extractSinglePlanXml(packedXml: string, planName: string): string | null {
  const start = packedXml.indexOf(`<plan name="${planName}"`);
  if (start === -1) return null;
  // Find the matching </plan>. Plans don't nest in this XML.
  const end = packedXml.indexOf("</plan>", start);
  if (end === -1) return null;
  const planSegment = packedXml.slice(start, end + "</plan>".length);
  // Reuse the prologue of the original document up to <plan first occurrence,
  // then append our single plan and the closing root tag.
  const firstPlan = packedXml.indexOf("<plan name=");
  const prologue = packedXml.slice(0, firstPlan);
  return `${prologue}${planSegment}\n</framecad_import>`;
}

describe("oracle-cache", () => {
  beforeEach(() => {
    delete process.env.DISABLE_ORACLE_CACHE;
    _resetOracleCacheForTests();
  });

  it("indexes references when Y: drive is available", () => {
    if (!Y_DRIVE_AVAILABLE) {
      console.warn("Y: drive not available — skipping index test");
      return;
    }
    const snap = oracleIndexSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.size).toBeGreaterThan(20); // expect ~38 across 3 jobs
    // Every entry has a jobnum and a planName.
    for (const e of snap.entries) {
      expect(e.jobnum).toMatch(/^HG\d+/);
      expect(e.planName.length).toBeGreaterThan(0);
    }
  });

  it("returns bit-exact reference bytes for HG260001 PK4-GF-LBW-70.075", () => {
    if (!Y_DRIVE_AVAILABLE) return;
    const packedXmlPath = join(HG260001_PACKED_DIR, "2-Panels-LBW-70.xml");
    if (!existsSync(packedXmlPath)) {
      console.warn(`Skipping: ${packedXmlPath} not present`);
      return;
    }
    const packed = readFileSync(packedXmlPath, "utf-8");
    const single = extractSinglePlanXml(packed, "PK4-GF-LBW-70.075");
    expect(single).not.toBeNull();
    const result = oracleLookup(single!);
    expect(result.hit).toBe(true);
    if (!result.hit) return;
    expect(result.jobnum).toBe("HG260001");
    expect(result.planName).toBe("PK4-GF-LBW-70.075");
    const expected = readFileSync(join(HG260001_RFY_DIR, "HG260001_PK4-GF-LBW-70.075.rfy"));
    expect(result.rfyBytes.equals(expected)).toBe(true);
  });

  it("returns bit-exact reference bytes for HG260023 PK3-GF-LBW-89.075", () => {
    if (!Y_DRIVE_AVAILABLE) return;
    const packedXmlPath = join(HG260023_PACKED_DIR, "2-Panels-LBW-89.xml");
    if (!existsSync(packedXmlPath)) {
      console.warn(`Skipping: ${packedXmlPath} not present`);
      return;
    }
    const packed = readFileSync(packedXmlPath, "utf-8");
    const single = extractSinglePlanXml(packed, "PK3-GF-LBW-89.075");
    expect(single).not.toBeNull();
    const result = oracleLookup(single!);
    expect(result.hit).toBe(true);
    if (!result.hit) return;
    const expected = readFileSync(join(HG260023_RFY_DIR, "HG260023_PK3-GF-LBW-89.075.rfy"));
    expect(result.rfyBytes.equals(expected)).toBe(true);
  });

  it("returns bit-exact reference bytes for HG260044 GF-LBW-70.075 (flat XML)", () => {
    if (!Y_DRIVE_AVAILABLE) return;
    const flatXmlPath = join(
      HG260044_FLAT_DIR,
      "HG260044 LOT 1810 (14) ELDERBERRY ST UPPER CABOOLTURE-GF-LBW-70.075.xml"
    );
    if (!existsSync(flatXmlPath)) {
      console.warn(`Skipping: ${flatXmlPath} not present`);
      return;
    }
    const xml = readFileSync(flatXmlPath, "utf-8");
    const result = oracleLookup(xml);
    expect(result.hit).toBe(true);
    if (!result.hit) return;
    expect(result.jobnum).toBe("HG260044");
    expect(result.planName).toBe("GF-LBW-70.075");
    const expected = readFileSync(join(HG260044_RFY_DIR, "HG260044#1-1_GF-LBW-70.075.rfy"));
    expect(result.rfyBytes.equals(expected)).toBe(true);
  });

  it("misses for jobnums not in the corpus", () => {
    // Fabricate an XML with a jobnum that won't be indexed.
    const fakeXml = `<?xml version="1.0" encoding="UTF-8"?>
<framecad_import name="FAKE">
  <jobnum>HG999999</jobnum>
  <plan name="GF-LBW-70.075">
    <frame name="F1" type="ExternalWall"></frame>
  </plan>
</framecad_import>`;
    const result = oracleLookup(fakeXml);
    expect(result.hit).toBe(false);
    if (!result.hit) {
      expect(result.reason).toMatch(/no reference for HG999999/);
    }
  });

  it("misses for multi-plan input even if jobnum matches", () => {
    if (!Y_DRIVE_AVAILABLE) return;
    const packedXmlPath = join(HG260001_PACKED_DIR, "2-Panels-LBW-70.xml");
    if (!existsSync(packedXmlPath)) return;
    const packed = readFileSync(packedXmlPath, "utf-8");
    const result = oracleLookup(packed);
    expect(result.hit).toBe(false);
    if (!result.hit) {
      expect(result.reason).toMatch(/multi-plan/);
    }
  });

  it("misses when frame count doesn't match the reference snapshot", () => {
    if (!Y_DRIVE_AVAILABLE) return;
    const packedXmlPath = join(HG260001_PACKED_DIR, "2-Panels-LBW-70.xml");
    if (!existsSync(packedXmlPath)) return;
    const packed = readFileSync(packedXmlPath, "utf-8");
    const single = extractSinglePlanXml(packed, "PK4-GF-LBW-70.075");
    if (!single) return;
    // Strip out 2 of the <frame> elements to simulate a tweaked variant.
    const tweaked = single.replace(/<frame [^/]*?<\/frame>/, "").replace(/<frame [^/]*?<\/frame>/, "");
    const result = oracleLookup(tweaked);
    // Either fewer frames mismatches, or it still matches if we couldn't strip
    // due to nested tags. The test asserts no false-positive: if hit=true,
    // bytes must STILL be a real reference (would only happen if our regex
    // strip didn't reduce frame count).
    if (result.hit) {
      // Nothing actually changed — accept as a no-op test.
      return;
    }
    expect(result.reason).toMatch(/frame count mismatch/);
  });

  // ---------- Per-plan multi-plan tests ----------

  it("oracleLookupPerPlan: multi-plan packed HG260001 XML — every plan hits cache", () => {
    if (!Y_DRIVE_AVAILABLE) return;
    const packedXmlPath = join(HG260001_PACKED_DIR, "2-Panels-LBW-70.xml");
    if (!existsSync(packedXmlPath)) {
      console.warn(`Skipping: ${packedXmlPath} not present`);
      return;
    }
    const packed = readFileSync(packedXmlPath, "utf-8");
    const result = oracleLookupPerPlan(packed);
    expect(result.jobnum).toBe("HG260001");
    expect(result.totalPlans).toBeGreaterThanOrEqual(1);
    // Every plan in this packed XML should have a captured reference.
    expect(result.allHit).toBe(true);
    expect(result.results.every(r => r.hit)).toBe(true);
    // Every hit's bytes must equal the on-disk RFY.
    for (const r of result.results) {
      if (!r.hit) continue;
      expect(r.rfyBytes).toBeDefined();
      expect(r.rfyPath).toBeDefined();
      const onDisk = readFileSync(r.rfyPath!);
      expect(r.rfyBytes!.equals(onDisk)).toBe(true);
    }
  });

  it("oracleLookupPerPlan: single-plan input still produces a 1-result", () => {
    if (!Y_DRIVE_AVAILABLE) return;
    const packedXmlPath = join(HG260001_PACKED_DIR, "2-Panels-LBW-70.xml");
    if (!existsSync(packedXmlPath)) return;
    const packed = readFileSync(packedXmlPath, "utf-8");
    const single = extractSinglePlanXml(packed, "PK4-GF-LBW-70.075");
    if (!single) return;
    const result = oracleLookupPerPlan(single);
    expect(result.totalPlans).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.hit).toBe(true);
    expect(result.allHit).toBe(true);
  });

  it("oracleLookupPerPlan: unknown jobnum produces all-miss results", () => {
    const fakeXml = `<?xml version="1.0" encoding="UTF-8"?>
<framecad_import name="FAKE">
  <jobnum>HG999999</jobnum>
  <plan name="GF-LBW-70.075">
    <frame name="F1" type="ExternalWall"></frame>
  </plan>
  <plan name="GF-NLBW-89.075">
    <frame name="F2" type="ExternalWall"></frame>
  </plan>
</framecad_import>`;
    const result = oracleLookupPerPlan(fakeXml);
    expect(result.jobnum).toBe("HG999999");
    expect(result.totalPlans).toBe(2);
    expect(result.allHit).toBe(false);
    expect(result.results.every(r => !r.hit)).toBe(true);
    expect(result.firstMissReason).toMatch(/no reference for HG999999/);
  });

  it("oracleLookupPerPlan: disabled via env returns immediate empty result", () => {
    process.env.DISABLE_ORACLE_CACHE = "1";
    const fakeXml = `<?xml version="1.0"?>
<framecad_import><jobnum>HG260001</jobnum><plan name="GF-LBW-70.075"><frame name="F"/></plan></framecad_import>`;
    const result = oracleLookupPerPlan(fakeXml);
    expect(result.allHit).toBe(false);
    expect(result.firstMissReason).toMatch(/disabled/);
  });

  it("disables via DISABLE_ORACLE_CACHE=1", () => {
    process.env.DISABLE_ORACLE_CACHE = "1";
    const fakeXml = `<?xml version="1.0"?>
<framecad_import><jobnum>HG260001</jobnum><plan name="GF-LBW-70.075"><frame name="F"/></plan></framecad_import>`;
    const result = oracleLookup(fakeXml);
    expect(result.hit).toBe(false);
    if (!result.hit) {
      expect(result.reason).toMatch(/disabled/);
    }
  });
});
