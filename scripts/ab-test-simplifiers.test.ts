// A/B test simplifier post-passes to find which is hurting parity.
//
// Run: AB_TEST=1 npx vitest run scripts/ab-test-simplifiers.test.ts
//
// Tests 5 scenarios on the 9 staged jobs:
//   1. baseline (all simplifiers enabled)
//   2. WALL_SERVICE disabled
//   3. RP disabled
//   4. TB2B disabled
//   5. ALL disabled
//
// For each: nearest-neighbour pair codec output vs Detailer reference,
// count exact / drift / missing / extra. Compare match% across scenarios.
// The scenario with HIGHEST match% reveals which simplifier was hurting.

import { describe, it } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { framecadImportToRfy } from "../lib/framecad-import";
import { decryptRfy } from "@hytek/rfy-codec";

const RUN = process.env.AB_TEST === "1";
const STAGED = join(process.cwd(), "tmp_detailer_test", "multi-job");

interface Op { tag: string; type: string; pos?: string; start?: string; end?: string; }
type StickMap = Record<string, Op[]>;
type FrameMap = Record<string, StickMap>;

function parseInner(path: string): FrameMap {
  // Quick text-level XML parse — much faster than full DOMParser for our use
  const text = readFileSync(path, "utf-8");
  const out: FrameMap = {};
  const frameRe = /<frame\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/frame>/g;
  const stickRe = /<stick\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/stick>/g;
  const opRe = /<(point-tool|spanned-tool|start-tool|end-tool)\s+([^/>]+?)(?:\/>|>)/g;
  const attrRe = /(\w+)="([^"]*)"/g;
  let fm: RegExpExecArray | null;
  while ((fm = frameRe.exec(text)) !== null) {
    const fname = fm[1]!;
    const fbody = fm[2]!;
    const sticks: StickMap = {};
    let sm: RegExpExecArray | null;
    const sRe = new RegExp(stickRe.source, "g");
    while ((sm = sRe.exec(fbody)) !== null) {
      const sname = sm[1]!;
      const sbody = sm[2]!;
      const ops: Op[] = [];
      let om: RegExpExecArray | null;
      const oRe = new RegExp(opRe.source, "g");
      while ((om = oRe.exec(sbody)) !== null) {
        const tag = om[1]!;
        const attrs: Record<string, string> = {};
        let am: RegExpExecArray | null;
        const aRe = new RegExp(attrRe.source, "g");
        while ((am = aRe.exec(om[2]!)) !== null) {
          attrs[am[1]!] = am[2]!;
        }
        ops.push({ tag, type: attrs.type ?? "?", pos: attrs.pos, start: attrs.startPos, end: attrs.endPos });
      }
      sticks[sname] = ops;
    }
    out[fname] = sticks;
  }
  return out;
}

function opPos(op: Op): number {
  return parseFloat(op.pos ?? op.start ?? "0") || 0;
}

interface Counts { exact: number; small: number; medium: number; large: number; missing: number; extra: number; }

function pairAndCount(ref: FrameMap, codec: FrameMap): { totals: Counts; byType: Record<string, Counts> } {
  const totals: Counts = { exact: 0, small: 0, medium: 0, large: 0, missing: 0, extra: 0 };
  const byType: Record<string, Counts> = {};

  function addByType(opType: string, key: keyof Counts) {
    if (!byType[opType]) byType[opType] = { exact: 0, small: 0, medium: 0, large: 0, missing: 0, extra: 0 };
    byType[opType][key]++;
    totals[key]++;
  }

  for (const fname of Object.keys(ref)) {
    const refSticks = ref[fname]!;
    const codecSticks = codec[fname] ?? {};
    const allSticks = new Set([...Object.keys(refSticks), ...Object.keys(codecSticks)]);
    for (const sname of allSticks) {
      const rOps = refSticks[sname] ?? [];
      const cOps = codecSticks[sname] ?? [];
      const groups: Record<string, { rs: Op[]; cs: Op[] }> = {};
      for (const r of rOps) {
        const k = `${r.type}|${r.tag}`;
        if (!groups[k]) groups[k] = { rs: [], cs: [] };
        groups[k]!.rs.push(r);
      }
      for (const c of cOps) {
        const k = `${c.type}|${c.tag}`;
        if (!groups[k]) groups[k] = { rs: [], cs: [] };
        groups[k]!.cs.push(c);
      }
      for (const k of Object.keys(groups)) {
        const { rs, cs } = groups[k]!;
        const sortedRs = rs.slice().sort((a, b) => opPos(a) - opPos(b));
        const sortedCs = cs.slice().sort((a, b) => opPos(a) - opPos(b));
        const used = new Array(sortedCs.length).fill(false);
        for (const r of sortedRs) {
          let bestI = -1; let bestD = Infinity;
          for (let i = 0; i < sortedCs.length; i++) {
            if (used[i]) continue;
            const d = Math.abs(opPos(sortedCs[i]!) - opPos(r));
            if (d < bestD) { bestD = d; bestI = i; }
          }
          if (bestI >= 0) {
            used[bestI] = true;
            const drift = bestD;
            if (drift <= 0.5) addByType(r.type, "exact");
            else if (drift <= 5) addByType(r.type, "small");
            else if (drift <= 30) addByType(r.type, "medium");
            else addByType(r.type, "large");
          } else {
            addByType(r.type, "missing");
          }
        }
        for (let i = 0; i < sortedCs.length; i++) {
          if (!used[i]) addByType(sortedCs[i]!.type, "extra");
        }
      }
    }
  }
  return { totals, byType };
}

interface Scenario { label: string; env: Record<string, string>; }
const SCENARIOS: Scenario[] = [
  { label: "baseline (all simplifiers ON)", env: {} },
  { label: "WALL_SERVICE off", env: { CODEC_DISABLE_WALL_SERVICE: "1" } },
  { label: "RP off", env: { CODEC_DISABLE_RP: "1" } },
  { label: "TB2B off", env: { CODEC_DISABLE_TB2B: "1" } },
  { label: "ALL simplifiers off", env: {
    CODEC_DISABLE_WALL_SERVICE: "1",
    CODEC_DISABLE_RP: "1",
    CODEC_DISABLE_TB2B: "1",
  } },
];

describe.skipIf(!RUN)("ab-test-simplifiers", () => {
  it("runs each scenario across 9 staged jobs and compares match counts", { timeout: 10 * 60 * 1000 }, () => {
    const jobs: { jobnum: string; xmlPath: string; refXml: string }[] = [];
    for (const jn of readdirSync(STAGED)) {
      const jp = join(STAGED, jn);
      try { if (!statSync(jp).isDirectory()) continue; } catch { continue; }
      const meta_path = join(jp, "meta.json");
      if (!existsSync(meta_path)) continue;
      const meta = JSON.parse(readFileSync(meta_path, "utf-8"));
      const refXml = readdirSync(jp).find(f => f.endsWith(".detailer-ref.xml"));
      if (!refXml) continue;
      jobs.push({ jobnum: jn, xmlPath: meta.xmlPath, refXml: join(jp, refXml) });
    }
    console.log(`\n[ab-test] ${jobs.length} jobs across ${SCENARIOS.length} scenarios\n`);

    const results: { scenario: string; totals: Counts; byType: Record<string, Counts> }[] = [];

    for (const sc of SCENARIOS) {
      // Apply env
      const prev: Record<string, string | undefined> = {};
      for (const k of ["CODEC_DISABLE_WALL_SERVICE", "CODEC_DISABLE_RP", "CODEC_DISABLE_TB2B"]) {
        prev[k] = process.env[k];
        delete process.env[k];
      }
      for (const [k, v] of Object.entries(sc.env)) process.env[k] = v;

      // Aggregate over all jobs
      const aggTotals: Counts = { exact: 0, small: 0, medium: 0, large: 0, missing: 0, extra: 0 };
      const aggByType: Record<string, Counts> = {};
      for (const job of jobs) {
        try {
          const xml = readFileSync(job.xmlPath, "utf-8");
          const result = framecadImportToRfy(xml, { lenient: true });
          const refInner = parseInner(job.refXml);
          // Save codec inner to a temp string -- we need to write+parse
          // Actually we can parse codec result.xml directly with our regex parser
          const codecMap = parseInnerFromString(result.xml);
          const { totals, byType } = pairAndCount(refInner, codecMap);
          for (const k of Object.keys(totals) as (keyof Counts)[]) aggTotals[k] += totals[k];
          for (const t of Object.keys(byType)) {
            if (!aggByType[t]) aggByType[t] = { exact: 0, small: 0, medium: 0, large: 0, missing: 0, extra: 0 };
            for (const k of Object.keys(byType[t]!) as (keyof Counts)[]) aggByType[t]![k] += byType[t]![k];
          }
        } catch (e: any) {
          console.log(`  ${job.jobnum}: FAIL ${e.message}`);
        }
      }
      results.push({ scenario: sc.label, totals: aggTotals, byType: aggByType });

      const totalRef = aggTotals.exact + aggTotals.small + aggTotals.medium + aggTotals.large + aggTotals.missing;
      const trueMatch = aggTotals.exact + aggTotals.small;
      console.log(`[${sc.label}]`);
      console.log(`  exact=${aggTotals.exact}  drift<=5=${aggTotals.small}  drift<=30=${aggTotals.medium}  big-drift=${aggTotals.large}  missing=${aggTotals.missing}  extra=${aggTotals.extra}`);
      console.log(`  TRUE MATCH (exact+small): ${trueMatch}/${totalRef} = ${(100*trueMatch/totalRef).toFixed(1)}%\n`);

      // Restore env
      for (const k of Object.keys(sc.env)) delete process.env[k];
      for (const [k, v] of Object.entries(prev)) {
        if (v !== undefined) process.env[k] = v;
      }
    }

    // Final comparison table
    console.log("=".repeat(80));
    console.log("AGGREGATE COMPARISON");
    console.log("=".repeat(80));
    console.log(`${"Scenario".padEnd(35)}${"Exact".padStart(8)}${"Drift5".padStart(8)}${"Drift30".padStart(8)}${"Big".padStart(8)}${"Miss".padStart(8)}${"Extra".padStart(8)}${"True%".padStart(8)}`);
    for (const r of results) {
      const total = r.totals.exact + r.totals.small + r.totals.medium + r.totals.large + r.totals.missing;
      const tm = r.totals.exact + r.totals.small;
      const pct = total > 0 ? `${(100*tm/total).toFixed(1)}%` : "-";
      console.log(`${r.scenario.padEnd(35)}${String(r.totals.exact).padStart(8)}${String(r.totals.small).padStart(8)}${String(r.totals.medium).padStart(8)}${String(r.totals.large).padStart(8)}${String(r.totals.missing).padStart(8)}${String(r.totals.extra).padStart(8)}${pct.padStart(8)}`);
    }

    // Per-op-type drill-down for the biggest-impact difference
    console.log("\n=== Per-op-type by scenario (TRUE matches: exact+small) ===");
    const opTypes = new Set<string>();
    for (const r of results) for (const t of Object.keys(r.byType)) opTypes.add(t);
    const sortedTypes = [...opTypes].sort();
    let header = "Op type".padEnd(20);
    for (const r of results) header += r.scenario.slice(0, 12).padStart(14);
    console.log(header);
    for (const t of sortedTypes) {
      let line = t.padEnd(20);
      for (const r of results) {
        const c = r.byType[t];
        const tm = c ? (c.exact + c.small) : 0;
        line += String(tm).padStart(14);
      }
      console.log(line);
    }

    writeFileSync(join(process.cwd(), "tmp_detailer_test", "ab-test-results.json"), JSON.stringify(results, null, 2));
    console.log("\nResults: tmp_detailer_test/ab-test-results.json");
  });
});

// Inline regex parser for codec result.xml string (no file I/O)
function parseInnerFromString(text: string): FrameMap {
  const out: FrameMap = {};
  const frameRe = /<frame\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/frame>/g;
  const stickRe = /<stick\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/stick>/g;
  const opRe = /<(point-tool|spanned-tool|start-tool|end-tool)\s+([^/>]+?)(?:\/>|>)/g;
  const attrRe = /(\w+)="([^"]*)"/g;
  let fm: RegExpExecArray | null;
  while ((fm = frameRe.exec(text)) !== null) {
    const fname = fm[1]!;
    const sticks: StickMap = {};
    const sRe = new RegExp(stickRe.source, "g");
    let sm: RegExpExecArray | null;
    while ((sm = sRe.exec(fm[2]!)) !== null) {
      const sname = sm[1]!;
      const ops: Op[] = [];
      const oRe = new RegExp(opRe.source, "g");
      let om: RegExpExecArray | null;
      while ((om = oRe.exec(sm[2]!)) !== null) {
        const tag = om[1]!;
        const attrs: Record<string, string> = {};
        const aRe = new RegExp(attrRe.source, "g");
        let am: RegExpExecArray | null;
        while ((am = aRe.exec(om[2]!)) !== null) attrs[am[1]!] = am[2]!;
        ops.push({ tag, type: attrs.type ?? "?", pos: attrs.pos, start: attrs.startPos, end: attrs.endPos });
      }
      sticks[sname] = ops;
    }
    out[fname] = sticks;
  }
  return out;
}
