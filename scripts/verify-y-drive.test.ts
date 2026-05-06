// Cross-job verification harness — answers "is the codec producing
// 100% byte-exact RFY output for ANY job on Y: drive?".
//
// Repurposed as a vitest test so it can use the same TypeScript+ESM pipeline
// the rest of the tools project uses. Run with:
//
//   VERIFY_Y_DRIVE=1 npx vitest run scripts/verify-y-drive.test.ts
//   VERIFY_Y_DRIVE=1 VERIFY_JOBS=HG260017,HG260023 npx vitest run scripts/verify-y-drive.test.ts
//
// Without VERIFY_Y_DRIVE=1, the test SKIPS so it doesn't slow the regular
// vitest suite. With it set:
//   1. Walk Y:\(17) 2026 HYTEK PROJECTS\<builder>\HG*\ for all jobs
//   2. For each job, find single-plan XML inputs at 03 DETAILING/.../01 XML OUTPUT/
//   3. Find reference RFYs at 06 MANUFACTURING/04 ROLLFORMER FILES/<split or flat>/
//   4. For each XML, run framecadImportToRfy → produced RFY bytes
//   5. Buffer.equals against the reference → bit-exact / size-match / mismatch
//   6. Write scripts/verify-y-drive-report.json + console table
//
// "100% match" means every codec-produced RFY byte-equals its reference.

import { describe, it } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { framecadImportToRfy } from "../lib/framecad-import";

const PROJECTS_ROOT = "Y:\\(17) 2026 HYTEK PROJECTS";

interface XmlEntry {
  path: string;
  planName: string | null;
}
interface RfyEntry {
  path: string;
  jobnum: string;
  planName: string;
}
interface JobInspection {
  jobDir: string;
  xmls: XmlEntry[];
  rfys: RfyEntry[];
  rfyDirsScanned: string[];
}

function inspectJob(jobDir: string): JobInspection {
  const xmlDir = join(jobDir, "03 DETAILING", "03 FRAMECAD DETAILER", "01 XML OUTPUT");
  const rfyParent = join(jobDir, "06 MANUFACTURING", "04 ROLLFORMER FILES");

  const result: JobInspection = {
    jobDir,
    xmls: [],
    rfys: [],
    rfyDirsScanned: [],
  };

  if (existsSync(xmlDir)) {
    for (const name of readdirSync(xmlDir)) {
      if (!name.toLowerCase().endsWith(".xml")) continue;
      const full = join(xmlDir, name);
      try { if (!statSync(full).isFile()) continue; } catch { continue; }
      const stem = name.replace(/\.xml$/i, "");
      const planMatch = stem.match(/-(GF|FF|RF|FL\d*|FFL\d*)-(.+)$/i);
      const planName = planMatch ? `${planMatch[1]}-${planMatch[2]}` : null;
      result.xmls.push({ path: full, planName });
    }
  }

  if (existsSync(rfyParent)) {
    const candidates: string[] = [rfyParent];
    try {
      for (const sub of readdirSync(rfyParent)) {
        const full = join(rfyParent, sub);
        try { if (!statSync(full).isDirectory()) continue; } catch { continue; }
        if (sub.toLowerCase().includes("rework")) continue;
        candidates.push(full);
      }
    } catch { /* ignore */ }

    for (const dir of candidates) {
      result.rfyDirsScanned.push(dir);
      try {
        for (const name of readdirSync(dir)) {
          if (!name.toLowerCase().endsWith(".rfy")) continue;
          const full = join(dir, name);
          try { if (!statSync(full).isFile()) continue; } catch { continue; }
          const stem = name.replace(/\.rfy$/i, "");
          const idx = stem.indexOf("_");
          if (idx <= 0) continue;
          const jobnum = stem.slice(0, idx).replace(/#\d+-\d+$/, "");
          const planName = stem.slice(idx + 1);
          if (!planName) continue;
          result.rfys.push({ path: full, jobnum, planName });
        }
      } catch { /* ignore */ }
    }
  }

  return result;
}

function findAllJobs(): { jobnum: string; dir: string; builder: string }[] {
  if (!existsSync(PROJECTS_ROOT)) {
    throw new Error(`Y: drive not reachable at ${PROJECTS_ROOT}`);
  }
  const jobs: { jobnum: string; dir: string; builder: string }[] = [];
  for (const builder of readdirSync(PROJECTS_ROOT)) {
    const builderPath = join(PROJECTS_ROOT, builder);
    try { if (!statSync(builderPath).isDirectory()) continue; } catch { continue; }
    let entries: string[];
    try { entries = readdirSync(builderPath); } catch { continue; }
    for (const sub of entries) {
      if (!/^HG\d+/i.test(sub)) continue;
      const sp = join(builderPath, sub);
      try { if (!statSync(sp).isDirectory()) continue; } catch { continue; }
      const m = sub.match(/^(HG\d+)/i);
      const jobnum = m ? m[1].toUpperCase() : sub;
      jobs.push({ jobnum, dir: sp, builder });
    }
  }
  return jobs.sort((a, b) => a.jobnum.localeCompare(b.jobnum));
}

interface PairResult {
  plan: string;
  status:
    | "bit-exact"
    | "size-match-byte-diff"
    | "byte-mismatch"
    | "split-only"
    | "no-reference"
    | "codec-error";
  reason?: string;
  ourSize?: number;
  refSize?: number;
  multipleRefs?: string[];
  splitCount?: number;
}

interface JobReport {
  jobnum: string;
  builder: string;
  xmlCount: number;
  rfyCount: number;
  pairs: PairResult[];
  summary: {
    total: number;
    bitExact: number;
    sizeMatch: number;
    mismatches: number;
    splitOnly: number;
    noReference: number;
    codecError: number;
  };
  skipReason?: string;
}

/**
 * Match an XML's plan name to reference RFYs.
 * - Exact match → "matches"
 * - PK#-prefixed reference matching same plan name → "pkPrefixed" (single-pack
 *   case — same content, just renamed by Detailer with a pack index). Treated
 *   as a regular match: byte-compare against the codec output.
 * - Multiple PK#- variants → "trueSplit": codec doesn't pack-split, so we
 *   can't byte-compare cleanly. Flagged as not-comparable.
 */
function matchXmlToRfys(
  xml: XmlEntry,
  rfys: RfyEntry[],
): { matches: RfyEntry[]; pkPrefixed: RfyEntry[]; trueSplit: RfyEntry[] } {
  if (!xml.planName) return { matches: [], pkPrefixed: [], trueSplit: [] };
  const xmlPlan = xml.planName.toUpperCase();
  const matches: RfyEntry[] = [];
  const pkCandidates: RfyEntry[] = [];
  for (const r of rfys) {
    const refPlan = r.planName.toUpperCase();
    if (refPlan === xmlPlan) {
      matches.push(r);
    } else {
      const pkMatch = refPlan.match(/^PK\d+-(.+)$/);
      if (pkMatch && pkMatch[1] === xmlPlan) {
        pkCandidates.push(r);
      }
    }
  }
  // If only ONE PK-prefixed variant, it's a single-pack rename — treat as match.
  // If multiple, it's a true multi-pack split — codec can't reproduce this shape.
  if (pkCandidates.length === 1) {
    return { matches, pkPrefixed: pkCandidates, trueSplit: [] };
  } else if (pkCandidates.length > 1) {
    return { matches, pkPrefixed: [], trueSplit: pkCandidates };
  }
  return { matches, pkPrefixed: [], trueSplit: [] };
}

function verifyJob(job: { jobnum: string; dir: string; builder: string }): JobReport {
  const inspect = inspectJob(job.dir);
  const jobReport: JobReport = {
    jobnum: job.jobnum,
    builder: job.builder,
    xmlCount: inspect.xmls.length,
    rfyCount: inspect.rfys.length,
    pairs: [],
    summary: {
      total: 0,
      bitExact: 0,
      sizeMatch: 0,
      mismatches: 0,
      splitOnly: 0,
      noReference: 0,
      codecError: 0,
    },
  };
  if (inspect.xmls.length === 0 || inspect.rfys.length === 0) {
    jobReport.skipReason = inspect.xmls.length === 0 ? "no XML inputs" : "no reference RFYs";
    return jobReport;
  }

  for (const xml of inspect.xmls) {
    if (!xml.planName) continue;
    const { matches, pkPrefixed, trueSplit } = matchXmlToRfys(xml, inspect.rfys);
    // Use exact match if available; else fall back to single PK-prefixed match.
    const comparableRefs = matches.length > 0 ? matches : pkPrefixed;
    if (comparableRefs.length === 0 && trueSplit.length === 0) {
      jobReport.pairs.push({ plan: xml.planName, status: "no-reference", reason: "no matching RFY in rollformer dir" });
      jobReport.summary.noReference++;
      jobReport.summary.total++;
      continue;
    }
    if (comparableRefs.length === 0 && trueSplit.length > 0) {
      jobReport.pairs.push({
        plan: xml.planName,
        status: "split-only",
        reason: `XML maps to ${trueSplit.length} pack-split RFYs (codec doesn't pack-split)`,
        splitCount: trueSplit.length,
      });
      jobReport.summary.splitOnly++;
      jobReport.summary.total++;
      continue;
    }
    let xmlText: string;
    try { xmlText = readFileSync(xml.path, "utf-8"); }
    catch (e) {
      jobReport.pairs.push({ plan: xml.planName, status: "codec-error", reason: `XML read failed: ${(e as Error).message}` });
      jobReport.summary.codecError++;
      jobReport.summary.total++;
      continue;
    }
    let codecBytes: Buffer;
    try {
      const r = framecadImportToRfy(xmlText, { lenient: true });
      codecBytes = r.rfy;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      jobReport.pairs.push({ plan: xml.planName, status: "codec-error", reason: `codec threw: ${msg.slice(0, 200)}` });
      jobReport.summary.codecError++;
      jobReport.summary.total++;
      continue;
    }
    const ref = comparableRefs[0]!;
    let refBytes: Buffer;
    try { refBytes = readFileSync(ref.path); }
    catch (e) {
      jobReport.pairs.push({ plan: xml.planName, status: "codec-error", reason: `RFY read failed: ${(e as Error).message}` });
      jobReport.summary.codecError++;
      jobReport.summary.total++;
      continue;
    }
    const sizeDelta = codecBytes.length - refBytes.length;
    const exact = codecBytes.equals(refBytes);
    let status: PairResult["status"];
    let reason: string | undefined;
    if (exact) {
      status = "bit-exact";
      jobReport.summary.bitExact++;
    } else if (sizeDelta === 0) {
      status = "size-match-byte-diff";
      reason = `same size (${refBytes.length}B) but bytes differ`;
      jobReport.summary.sizeMatch++;
    } else {
      status = "byte-mismatch";
      reason = `size: ours=${codecBytes.length}B ref=${refBytes.length}B Δ=${sizeDelta}`;
      jobReport.summary.mismatches++;
    }
    jobReport.pairs.push({
      plan: xml.planName,
      status,
      reason,
      ourSize: codecBytes.length,
      refSize: refBytes.length,
      multipleRefs: comparableRefs.length > 1 ? comparableRefs.map(r => r.planName) : undefined,
    });
    jobReport.summary.total++;
  }
  return jobReport;
}

const RUN = process.env.VERIFY_Y_DRIVE === "1";
const FILTER_JOBS = (process.env.VERIFY_JOBS ?? "")
  .split(",")
  .map(s => s.trim().toUpperCase())
  .filter(s => /^HG\d+/.test(s));

describe.skipIf(!RUN)("verify-y-drive", () => {
  it("runs codec → reference RFY byte comparison across Y: drive", { timeout: 30 * 60 * 1000 }, () => {
    const allJobs = findAllJobs();
    const jobs = FILTER_JOBS.length > 0
      ? allJobs.filter(j => FILTER_JOBS.includes(j.jobnum))
      : allJobs;

    console.log(`\nFound ${allJobs.length} HG* jobs total. Verifying ${jobs.length}.\n`);

    const reports: JobReport[] = [];
    let total = 0, bitExact = 0, sizeMatch = 0, mismatch = 0, splitOnly = 0, noRef = 0, codecErr = 0;
    let jobsWithReferences = 0;

    for (const job of jobs) {
      process.stdout.write(`${job.jobnum.padEnd(10)} ${job.builder.slice(0, 25).padEnd(25)} `);
      const r = verifyJob(job);
      reports.push(r);
      if (r.skipReason) {
        console.log(`[skip] ${r.skipReason}`);
        continue;
      }
      jobsWithReferences++;
      const s = r.summary;
      total += s.total;
      bitExact += s.bitExact;
      sizeMatch += s.sizeMatch;
      mismatch += s.mismatches;
      splitOnly += s.splitOnly;
      noRef += s.noReference;
      codecErr += s.codecError;
      console.log(
        `xmls=${r.xmlCount} rfys=${r.rfyCount} ` +
        `→ exact=${s.bitExact}/${s.total} size-match=${s.sizeMatch} mismatch=${s.mismatches} split=${s.splitOnly} no-ref=${s.noReference} err=${s.codecError}`
      );
    }

    console.log();
    console.log("=".repeat(80));
    console.log(`TOTAL across ${jobsWithReferences} jobs (with both XMLs and RFYs):`);
    console.log(`  XMLs evaluated:        ${total}`);
    console.log(`  Bit-exact match:       ${bitExact}  (${(100 * bitExact / (total || 1)).toFixed(1)}%)`);
    console.log(`  Size match, byte diff: ${sizeMatch}`);
    console.log(`  Byte mismatch:         ${mismatch}`);
    console.log(`  Split-only (codec n/a):${splitOnly}  (TB2B/multi-pack)`);
    console.log(`  No reference:          ${noRef}`);
    console.log(`  Codec error:           ${codecErr}`);
    console.log("=".repeat(80));

    const out = {
      timestamp: new Date().toISOString(),
      jobsScanned: jobs.length,
      jobsWithReferences,
      totals: { total, bitExact, sizeMatch, mismatch, splitOnly, noRef, codecErr },
      reports,
    };
    const reportPath = join(process.cwd(), "scripts", "verify-y-drive-report.json");
    writeFileSync(reportPath, JSON.stringify(out, null, 2));
    console.log(`\nFull report: ${reportPath}`);
  });
});
