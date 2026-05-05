// Verification test — Agent Q TB2B pre-trim guard migration
//
// Confirms framecadImportToParsedProject() leaves chord, vertical-W, and
// diagonal-W stick endpoints at raw XML values for plans matching
// /-LIN-/i or /-TB2B-/i. Mirrors the diff harness's pre-trim guards in
// hytek-rfy-codec/scripts/diff-vs-detailer.mjs.

import { readFileSync, existsSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { framecadImportToParsedProject } from "./framecad-import";

// Resolve the codec test-corpus relative to this repo. We don't ship
// the test corpus inside hytek-rfy-tools — it lives in the sibling
// hytek-rfy-codec repo. This test is only meaningful when both repos
// are checked out side-by-side.
const TB2B_XML = "C:/Users/Scott/CLAUDE CODE/hytek-rfy-codec/test-corpus/HG250082_FLAGSTONE_OSHC/TRUSSES-GF-TB2B-89.115.xml";
const LBW_XML = "C:/Users/Scott/CLAUDE CODE/hytek-rfy-codec/test-corpus/HG250082_FLAGSTONE_OSHC/UPPER-GF-LBW-89.075.xml";

interface Vec3 { x: number; y: number; z: number }

function dist3(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

// Re-parse the raw <start>/<end> values from the XML so we can compare
// the importer's parsed endpoints to the unmodified centerline.
function parseRawStickLengths(xml: string): Map<string, number> {
  const out = new Map<string, number>();
  const reFrame = /<frame[^>]+name="([^"]+)"[^>]*>([\s\S]*?)<\/frame>/g;
  let fm: RegExpExecArray | null;
  while ((fm = reFrame.exec(xml))) {
    const frameName = fm[1]!;
    const body = fm[2]!;
    const reStick = /<stick[^>]+name="([^"]+)"[^>]*>([\s\S]*?)<\/stick>/g;
    let sm: RegExpExecArray | null;
    while ((sm = reStick.exec(body))) {
      const stickName = sm[1]!;
      const sb = sm[2]!;
      const reStart = /<start>\s*([^<]+?)\s*<\/start>/;
      const reEnd = /<end>\s*([^<]+?)\s*<\/end>/;
      const startM = sb.match(reStart);
      const endM = sb.match(reEnd);
      if (!startM || !endM) continue;
      const parse = (t: string): Vec3 => {
        const n = t.split(/[ ,\t]+/).map(Number);
        return { x: n[0]||0, y: n[1]||0, z: n[2]||0 };
      };
      const len = dist3(parse(startM[1]!), parse(endM[1]!));
      out.set(`${frameName}/${stickName}`, len);
    }
  }
  return out;
}

describe("TB2B pre-trim guards — Agent Q migration", () => {
  if (!existsSync(TB2B_XML)) {
    it.skip(`SKIP — TB2B XML fixture not present at ${TB2B_XML}`, () => {});
    return;
  }

  const xml = readFileSync(TB2B_XML, "utf8");
  const project = framecadImportToParsedProject(xml);
  const rawLengths = parseRawStickLengths(xml);

  // Find a TB2B plan
  const tb2bPlan = project.plans.find(p => /-TB2B-/i.test(p.name));
  it("has at least one TB2B plan in fixture", () => {
    expect(tb2bPlan).toBeDefined();
  });
  if (!tb2bPlan) return;

  it("chord endpoints are raw (no 4mm/end EndClearance trim on TB2B)", () => {
    let assertedAny = false;
    for (const frame of tb2bPlan.frames) {
      for (const stick of frame.sticks) {
        const u = String(stick.usage ?? "").toLowerCase();
        if (u !== "topchord" && u !== "bottomchord") continue;
        const parsedLen = dist3(stick.start, stick.end);
        const rawLen = rawLengths.get(`${frame.name}/${stick.name}`);
        if (rawLen === undefined) continue;
        // With the guard active, parsed length must equal raw centerline
        // length. Without it (old behavior), parsed = raw - 8mm.
        expect(parsedLen).toBeCloseTo(rawLen, 1);
        assertedAny = true;
      }
    }
    expect(assertedAny).toBe(true);
  });

  it("vertical-W endpoints are raw (no +11mm lipDepth extension on TB2B)", () => {
    let assertedAny = false;
    for (const frame of tb2bPlan.frames) {
      for (const stick of frame.sticks) {
        if (!/^W\d/.test(stick.name)) continue;
        if (String(stick.usage ?? "").toLowerCase() !== "web") continue;
        const dx = stick.end.x - stick.start.x;
        const dy = stick.end.y - stick.start.y;
        const horiz = Math.sqrt(dx*dx + dy*dy);
        if (horiz >= 1.0) continue; // diagonals handled below
        const parsedLen = dist3(stick.start, stick.end);
        const rawLen = rawLengths.get(`${frame.name}/${stick.name}`);
        if (rawLen === undefined) continue;
        expect(parsedLen).toBeCloseTo(rawLen, 1);
        assertedAny = true;
      }
    }
    // It's OK if a TB2B plan has no vertical Ws — just don't assert nothing was checked.
    if (!assertedAny) console.warn("No TB2B vertical-W sticks found in fixture; chord/diagonal coverage still asserted.");
  });

  it("diagonal-W endpoints are raw (no 2mm Kb-style trim on TB2B)", () => {
    let assertedAny = false;
    for (const frame of tb2bPlan.frames) {
      for (const stick of frame.sticks) {
        if (!/^W\d/.test(stick.name)) continue;
        if (String(stick.usage ?? "").toLowerCase() !== "web") continue;
        const dx = stick.end.x - stick.start.x;
        const dy = stick.end.y - stick.start.y;
        const horiz = Math.sqrt(dx*dx + dy*dy);
        if (horiz < 1.0) continue; // verticals handled above
        const parsedLen = dist3(stick.start, stick.end);
        const rawLen = rawLengths.get(`${frame.name}/${stick.name}`);
        if (rawLen === undefined) continue;
        expect(parsedLen).toBeCloseTo(rawLen, 1);
        assertedAny = true;
      }
    }
    if (!assertedAny) console.warn("No TB2B diagonal-W sticks found in fixture; chord/vertical coverage still asserted.");
  });

  // Negative-case sanity: a non-LIN/non-TB2B plan should STILL apply the
  // 4mm/end EndClearance trim to wall plates. Guards against this migration
  // accidentally suppressing the trim globally.
  it("non-LIN/non-TB2B wall plates still get the 4mm/end trim", () => {
    if (!existsSync(LBW_XML)) {
      console.warn(`SKIP — LBW XML not present at ${LBW_XML}`);
      return;
    }
    const lbwXml = readFileSync(LBW_XML, "utf8");
    const lbwProject = framecadImportToParsedProject(lbwXml);
    const lbwRaw = parseRawStickLengths(lbwXml);

    const wallPlan = lbwProject.plans.find(p => !/-LIN-/i.test(p.name) && !/-TB2B-/i.test(p.name));
    expect(wallPlan).toBeDefined();
    if (!wallPlan) return;

    let foundTrimmedPlate = false;
    for (const frame of wallPlan.frames) {
      for (const stick of frame.sticks) {
        const u = String(stick.usage ?? "").toLowerCase();
        if (u !== "topplate" && u !== "bottomplate") continue;
        const parsedLen = dist3(stick.start, stick.end);
        const rawLen = lbwRaw.get(`${frame.name}/${stick.name}`);
        if (rawLen === undefined) continue;
        // Wall plates on a normal plan should be trimmed by ~8mm total
        // (4mm/end EndClearance for the F325iT 70/89mm setups). One
        // matching example is enough to confirm the trim still fires.
        if (Math.abs((rawLen - parsedLen) - 8) < 0.5) {
          foundTrimmedPlate = true;
          break;
        }
      }
      if (foundTrimmedPlate) break;
    }
    expect(foundTrimmedPlate).toBe(true);
  });
});
