// Multi-job comparison: extract Detailer reference + codec output inner XMLs
// for 10 random jobs across Y: drive. Output staged in tmp_detailer_test/multi-job/
// for the Python builder script to assemble per-job spreadsheets.
//
// Run: MULTI_JOB=1 npx vitest run scripts/multi-job-stick-compare.test.ts

import { describe, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { framecadImportToRfy } from "../lib/framecad-import";
import { decryptRfy } from "@hytek/rfy-codec";

const RUN = process.env.MULTI_JOB === "1";

interface JobTarget {
  jobnum: string;
  builder: string;
  jobDir: string;
  xmlPath: string;
  refRfyPath: string;
  planName: string;
}

const PROJECTS_ROOT = "Y:\\(17) 2026 HYTEK PROJECTS";

// 10 selected jobs, varied builders. For each, we'll auto-pick a plan that
// has both an XML and a non-pack-split reference RFY.
const JOBS_TO_TEST = [
  "HG260002", "HG260005", "HG260010", "HG260014", "HG260016",
  "HG260021", "HG260024", "HG260028", "HG260043", "HG260045",
];

function findJobDir(jobnum: string): { dir: string; builder: string } | null {
  for (const builder of readdirSync(PROJECTS_ROOT)) {
    const bp = join(PROJECTS_ROOT, builder);
    try { if (!statSync(bp).isDirectory()) continue; } catch { continue; }
    try {
      for (const sub of readdirSync(bp)) {
        if (sub.toUpperCase().startsWith(jobnum.toUpperCase())) {
          return { dir: join(bp, sub), builder };
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

function findTargetForJob(jobnum: string): JobTarget | null {
  const found = findJobDir(jobnum);
  if (!found) { console.log(`[skip] ${jobnum}: directory not found`); return null; }
  const xmlDir = join(found.dir, "03 DETAILING", "03 FRAMECAD DETAILER", "01 XML OUTPUT");
  const rollformerParent = join(found.dir, "06 MANUFACTURING", "04 ROLLFORMER FILES");
  if (!existsSync(xmlDir) || !existsSync(rollformerParent)) {
    console.log(`[skip] ${jobnum}: missing dirs`); return null;
  }

  // Index reference RFYs (walk one level deep into Split_* dirs)
  const refRfys: { name: string; path: string }[] = [];
  for (const sub of readdirSync(rollformerParent)) {
    const sp = join(rollformerParent, sub);
    try {
      if (statSync(sp).isFile() && sp.toLowerCase().endsWith(".rfy")) {
        refRfys.push({ name: sub, path: sp });
      } else if (statSync(sp).isDirectory()) {
        for (const f of readdirSync(sp)) {
          if (f.toLowerCase().endsWith(".rfy")) refRfys.push({ name: f, path: join(sp, f) });
        }
      }
    } catch { /* ignore */ }
  }

  // Index XMLs and try to find an LBW first, then NLBW, then any
  const xmls: { name: string; path: string }[] = [];
  for (const f of readdirSync(xmlDir)) {
    if (f.toLowerCase().endsWith(".xml")) xmls.push({ name: f, path: join(xmlDir, f) });
  }
  const preferOrder = ["-LBW-", "-NLBW-", "-RP-", "-TIN-"];
  for (const pref of preferOrder) {
    for (const xml of xmls) {
      if (!xml.name.includes(pref)) continue;
      // Extract plan from xml filename
      const m = xml.name.match(/-(GF|FF|RF)-(.+?)\.xml$/i);
      if (!m) continue;
      const planName = `${m[1]}-${m[2]}`;
      // Find matching ref RFY (exact or PK#-prefixed)
      const upperPlan = planName.toUpperCase();
      let bestRef: typeof refRfys[number] | null = null;
      for (const ref of refRfys) {
        const stem = ref.name.replace(/\.rfy$/i, "");
        const idx = stem.indexOf("_");
        if (idx <= 0) continue;
        let refPlan = stem.slice(idx + 1).toUpperCase();
        // Strip PK#- prefix
        const pk = refPlan.match(/^PK\d+-(.+)$/);
        if (pk) refPlan = pk[1];
        if (refPlan === upperPlan) { bestRef = ref; break; }
      }
      if (bestRef) {
        return { jobnum, builder: found.builder, jobDir: found.dir,
          xmlPath: xml.path, refRfyPath: bestRef.path, planName };
      }
    }
  }
  console.log(`[skip] ${jobnum}: no LBW/NLBW/RP/TIN with matching ref RFY`);
  return null;
}

describe.skipIf(!RUN)("multi-job-stick-compare", () => {
  it("extract per-job Detailer-reference + codec inner XMLs for 10 jobs", { timeout: 10 * 60 * 1000 }, () => {
    const outBase = join(process.cwd(), "tmp_detailer_test", "multi-job");
    mkdirSync(outBase, { recursive: true });

    const results: any[] = [];
    for (const jobnum of JOBS_TO_TEST) {
      const target = findTargetForJob(jobnum);
      if (!target) continue;

      const jobOutDir = join(outBase, jobnum);
      mkdirSync(jobOutDir, { recursive: true });

      console.log(`\n[${jobnum}] ${target.builder} ${target.planName}`);
      console.log(`  XML:    ${target.xmlPath}`);
      console.log(`  RefRFY: ${target.refRfyPath}`);

      try {
        // 1. Read XML, run codec
        const xml = readFileSync(target.xmlPath, "utf-8");
        const codecResult = framecadImportToRfy(xml, { lenient: true });
        // 2. Decrypt reference RFY
        const refBytes = readFileSync(target.refRfyPath);
        const refInner = decryptRfy(refBytes);
        // 3. Save both inner XMLs
        const refOut = join(jobOutDir, `${jobnum}-${target.planName}.detailer-ref.xml`);
        const codecOut = join(jobOutDir, `${jobnum}-${target.planName}.codec.xml`);
        writeFileSync(refOut, refInner);
        writeFileSync(codecOut, codecResult.xml);
        // 4. Save metadata
        writeFileSync(join(jobOutDir, "meta.json"), JSON.stringify({
          jobnum: target.jobnum,
          builder: target.builder,
          planName: target.planName,
          xmlPath: target.xmlPath,
          refRfyPath: target.refRfyPath,
          refRfyBytes: refBytes.length,
          codecRfyBytes: codecResult.rfy.length,
          refInnerChars: refInner.length,
          codecInnerChars: codecResult.xml.length,
          jobDir: target.jobDir,
        }, null, 2));
        results.push({ jobnum, status: "ok", planName: target.planName });
        console.log(`  OK — ref ${refBytes.length}B / codec ${codecResult.rfy.length}B`);
      } catch (e: any) {
        console.log(`  FAIL: ${e.message}`);
        results.push({ jobnum, status: "fail", error: String(e.message) });
      }
    }

    writeFileSync(join(outBase, "results.json"), JSON.stringify(results, null, 2));
    console.log(`\n[done] processed ${results.filter(r => r.status === "ok").length}/${JOBS_TO_TEST.length} jobs`);
    console.log(`Output staged in: ${outBase}`);
  });
});
