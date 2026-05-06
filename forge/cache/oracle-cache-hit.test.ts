// Forge Phase 3: end-to-end cache hit test.
//
// Verifies that an XML on Y: drive whose Detailer-produced RFY was just stored
// by forge/cache/store.py is served bit-exactly by oracleLookup() without
// touching the codec rule engine.
//
// Skipped automatically when:
//   - Y: drive isn't accessible (off-network)
//   - The forge cache hasn't been seeded with HG260017
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const HG260017_XML = String.raw`Y:\(17) 2026 HYTEK PROJECTS\CORAL HOMES\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA\03 DETAILING\03 FRAMECAD DETAILER\01 XML OUTPUT\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA-GF-LBW-70.075.xml`;

describe("Forge oracle cache (Phase 3 integration)", () => {
  // Index scan walks Y: drive XMLs across HG260001/023/044 — ~20s on this network.
  // First run cold; subsequent runs in the same process reuse the cached INDEX.
  it("serves HG260017 GF-LBW-70.075 from the Forge cache", { timeout: 60_000 }, async () => {
    if (!existsSync(HG260017_XML)) {
      console.warn("[skip] Y: drive not accessible — cannot test cache hit");
      return;
    }
    const xmlText = readFileSync(HG260017_XML, "utf-8");

    // Late require because the cache resolver runs at module load time.
    const { oracleLookup } = await import("../../lib/oracle-cache");
    const result = oracleLookup(xmlText);

    if (!result.hit) {
      console.warn(`[oracle miss] ${result.reason}`);
      console.warn("Run the orchestrator first to seed the cache:");
      console.warn("  python forge/orchestrator/detailer-orchestrator.py --jobs HG260017 --out-dir ./tmp");
    }
    expect(result.hit).toBe(true);
    if (result.hit) {
      expect(result.jobnum).toBe("HG260017");
      expect(result.planName).toBe("GF-LBW-70.075");
      expect(result.rfyBytes.length).toBeGreaterThan(60_000);
      expect(result.rfyBytes.length).toBeLessThan(120_000);
      // Read the cached RFY directly from the same path the writer used and
      // confirm bit-exact equality with what oracleLookup returned.
      const direct = readFileSync(result.rfyPath);
      expect(Buffer.compare(direct, result.rfyBytes)).toBe(0);
      console.log(`[hit] ${result.jobnum}/${result.planName} → ${result.rfyBytes.length} bytes from ${result.rfyPath}`);
    }
  });
});
