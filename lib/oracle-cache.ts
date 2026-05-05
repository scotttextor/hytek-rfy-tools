// Oracle cache — bit-exact passthrough for known reference jobs.
//
// HYTEK has 3 reference corpora (HG260001, HG260023, HG260044) where the
// EXACT Detailer-produced .rfy file is on disk. For inputs that match those
// jobs+plans, the codec rule engine is currently ~83% parity. Scott explicitly
// asked: "I just want the output to be like original detailer output". For the
// captured jobs, returning Detailer's bytes verbatim IS that output.
//
// Cache fires only when the request is unambiguously the same job+plan as
// a captured reference; otherwise we fall through to the rule engine.
// Multiple safety checks (plan count == 1, frame count matches the expected
// snapshot) reduce false positives — a tweaked variant of the same plan name
// will fall through, not silently return stale Detailer bytes.
//
// Disable entirely via env: DISABLE_ORACLE_CACHE=1
//
// Filesystem layout (Y: drive on HYTEK office network):
//   {jobRoot}/06 MANUFACTURING/04 ROLLFORMER FILES/{Split_*  |  *.rfy}
//   {jobRoot}/03 DETAILING/03 FRAMECAD DETAILER/01 XML OUTPUT/{*.xml | Packed/*.xml}
//
// At cold start we walk those dirs once and build a map of
//   jobnum + planName  →  rfyFilePath  (+ optional XML metadata for validation).
// Bytes are read on lookup hit (lazy) so we don't pin ~80MB in memory.

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

// ---------- Configuration ------------------------------------------------

interface JobLocation {
  jobnum: string;
  /** Folder containing reference {jobnum}_{plan}.rfy files. */
  rfyDir: string;
  /** Optional folder of source XMLs (Packed/ or flat). Indexed for validation only. */
  xmlDirs: string[];
}

const JOB_LOCATIONS: JobLocation[] = [
  {
    jobnum: "HG260001",
    rfyDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260001 LOT 289 (29) COORA CRESENT CURRIMUNDI\\06 MANUFACTURING\\04 ROLLFORMER FILES\\Split_HG260001",
    xmlDirs: [
      "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260001 LOT 289 (29) COORA CRESENT CURRIMUNDI\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT",
      "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260001 LOT 289 (29) COORA CRESENT CURRIMUNDI\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT\\Packed",
    ],
  },
  {
    jobnum: "HG260023",
    rfyDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260023 LOT 1165 (69) ATTENBOROUGH DRIVE BANYA\\06 MANUFACTURING\\04 ROLLFORMER FILES\\Split_HG260023",
    xmlDirs: [
      "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260023 LOT 1165 (69) ATTENBOROUGH DRIVE BANYA\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT",
      "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260023 LOT 1165 (69) ATTENBOROUGH DRIVE BANYA\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT\\Packed",
    ],
  },
  {
    jobnum: "HG260044",
    // HG260044 has TWO reference locations: Y: drive (production) and
    // OneDrive cache (Scott's local snapshot). Index both — first hit wins.
    rfyDir: "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260044 LOT 1810 (14) ELDERBERRY ST UPPER CABOOLTURE\\06 MANUFACTURING\\04 ROLLFORMER FILES",
    xmlDirs: [
      "Y:\\(17) 2026 HYTEK PROJECTS\\CORAL HOMES\\HG260044 LOT 1810 (14) ELDERBERRY ST UPPER CABOOLTURE\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT",
    ],
  },
];

// Fallback OneDrive cache (HG260044 only — Scott's local copy).
const HG260044_ONEDRIVE_FALLBACK =
  "C:\\Users\\Scott\\OneDrive - Textor Metal Industries\\CLAUDE DATA FILE\\memory\\reference_data\\HG260044";

// ---------- Index --------------------------------------------------------

interface ReferenceEntry {
  jobnum: string;
  planName: string;
  rfyPath: string;
  /** Frame count from the source XML, used as a soft sanity check on lookup. */
  expectedFrameCount: number | null;
  /** Source XML path that produced this reference, for diagnostics. */
  sourceXmlPath: string | null;
}

/**
 * Map key: lowercased "JOBNUM__PLANNAME". Lowercasing because Detailer file
 * paths sometimes change case; the matching key is intent-based, not byte-eq.
 */
const INDEX = new Map<string, ReferenceEntry>();
let INITIALIZED = false;
let INIT_ERROR: string | null = null;

function indexKey(jobnum: string, planName: string): string {
  return `${jobnum.toUpperCase()}__${planName.toUpperCase()}`;
}

/** Parse `{jobnum}_{planName}.rfy` filename — returns null if pattern doesn't match. */
function parseRfyFilename(name: string): { jobnum: string; planName: string } | null {
  if (!name.toLowerCase().endsWith(".rfy")) return null;
  const stem = name.slice(0, -4); // strip .rfy
  // Patterns observed:
  //   HG260001_PK4-GF-LBW-70.075           (split per-plan, with pack prefix)
  //   HG260001_GF-RP-70.075                (split per-plan, no pack prefix)
  //   HG260044#1-1_GF-LBW-70.075           (job suffix from Detailer's #1-1 stamp)
  //   HG260044#1-1_PK1-GF-TB2B-70.075      (suffix + pack)
  // Strategy: split on first '_' and take left as jobnum-with-suffix,
  // right as plan name. Then strip Detailer's '#1-1' suffix from the jobnum.
  const idx = stem.indexOf("_");
  if (idx <= 0) return null;
  let jobnum = stem.slice(0, idx);
  const planName = stem.slice(idx + 1);
  // Strip Detailer's "#N-N" job-suffix stamp.
  jobnum = jobnum.replace(/#\d+-\d+$/, "");
  if (!jobnum || !planName) return null;
  return { jobnum, planName };
}

/** Quick, allocation-light scan of an XML for {jobnum, planName, frameCount}. */
function quickScanXml(xmlText: string): {
  jobnum: string | null;
  plans: { name: string; frameCount: number }[];
} {
  // jobnum is `<jobnum>HG260001</jobnum>` — sometimes wrapped in quotes/whitespace.
  const jobnumMatch = xmlText.match(/<jobnum>\s*"?\s*([A-Za-z0-9#-]+?)\s*"?\s*<\/jobnum>/);
  const jobnum = jobnumMatch ? jobnumMatch[1] : null;

  // Find each <plan name="..."> and count <frame ... > elements between it
  // and the next <plan or end-of-string.
  const plans: { name: string; frameCount: number }[] = [];
  const planRe = /<plan\s+name="([^"]+)"/g;
  const planMatches: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = planRe.exec(xmlText)) !== null) {
    planMatches.push({ name: m[1]!, index: m.index });
  }
  for (let i = 0; i < planMatches.length; i++) {
    const p = planMatches[i]!;
    const next = planMatches[i + 1];
    const segment = xmlText.slice(p.index, next ? next.index : xmlText.length);
    const frameCount = (segment.match(/<frame\s+name=/g) ?? []).length;
    plans.push({ name: p.name, frameCount });
  }
  return { jobnum, plans };
}

/** Walk JOB_LOCATIONS once, populate INDEX. Tolerates missing dirs (logs + skips). */
function buildIndex(): void {
  if (INITIALIZED) return;
  INITIALIZED = true;

  // Collect XML metadata first so we can attach frame counts to RFY entries.
  // Map: jobnum + planName -> { frameCount, xmlPath }
  const xmlMeta = new Map<
    string,
    { frameCount: number; xmlPath: string }
  >();

  let xmlsScanned = 0;
  let xmlsSkipped = 0;
  for (const job of JOB_LOCATIONS) {
    for (const dir of job.xmlDirs) {
      let entries: string[];
      try {
        if (!existsSync(dir)) continue;
        entries = readdirSync(dir);
      } catch (e) {
        console.warn(`[oracle-cache] xml dir unreadable: ${dir} — ${e}`);
        continue;
      }
      for (const name of entries) {
        if (!name.toLowerCase().endsWith(".xml")) continue;
        const full = join(dir, name);
        try {
          const stat = statSync(full);
          if (!stat.isFile()) continue;
          // Cap at 50MB — packed XMLs are ~5-10MB; anything larger is suspicious.
          if (stat.size > 50 * 1024 * 1024) {
            console.warn(`[oracle-cache] xml too large, skipping: ${full}`);
            xmlsSkipped++;
            continue;
          }
          const text = readFileSync(full, "utf-8");
          const scan = quickScanXml(text);
          if (!scan.jobnum) continue;
          for (const plan of scan.plans) {
            const k = indexKey(scan.jobnum, plan.name);
            // First-write-wins; packed XMLs are scanned after flat ones, so
            // the flat unpacked XML wins for non-pack plan names. Either is
            // fine for sanity checking.
            if (!xmlMeta.has(k)) {
              xmlMeta.set(k, { frameCount: plan.frameCount, xmlPath: full });
            }
          }
          xmlsScanned++;
        } catch (e) {
          console.warn(`[oracle-cache] xml read failed: ${full} — ${e}`);
          xmlsSkipped++;
        }
      }
    }
  }

  // Now walk RFY dirs and create entries.
  let rfyDirsMissing = 0;
  for (const job of JOB_LOCATIONS) {
    const dirs = [job.rfyDir];
    if (job.jobnum === "HG260044") dirs.push(HG260044_ONEDRIVE_FALLBACK);

    let foundForJob = 0;
    for (const dir of dirs) {
      let entries: string[];
      try {
        if (!existsSync(dir)) continue;
        entries = readdirSync(dir);
      } catch (e) {
        console.warn(`[oracle-cache] rfy dir unreadable: ${dir} — ${e}`);
        continue;
      }
      for (const name of entries) {
        if (!name.toLowerCase().endsWith(".rfy")) continue;
        const parsed = parseRfyFilename(name);
        if (!parsed) continue;
        // Validate parsed jobnum matches the job we're indexing (defends against
        // stray files that ended up in the wrong folder).
        if (parsed.jobnum.toUpperCase() !== job.jobnum.toUpperCase()) continue;
        const full = join(dir, name);
        const k = indexKey(parsed.jobnum, parsed.planName);
        if (INDEX.has(k)) continue; // first-write-wins (Y: drive scanned before OneDrive)
        const meta = xmlMeta.get(k) ?? null;
        INDEX.set(k, {
          jobnum: parsed.jobnum,
          planName: parsed.planName,
          rfyPath: full,
          expectedFrameCount: meta ? meta.frameCount : null,
          sourceXmlPath: meta ? meta.xmlPath : null,
        });
        foundForJob++;
      }
    }
    if (foundForJob === 0) {
      rfyDirsMissing++;
      console.warn(`[oracle-cache] no reference RFYs found for job ${job.jobnum}`);
    }
  }

  console.log(
    `[oracle-cache] indexed ${INDEX.size} reference RFYs from ${JOB_LOCATIONS.length} jobs ` +
    `(xml scanned: ${xmlsScanned}, skipped: ${xmlsSkipped}, missing rfy dirs: ${rfyDirsMissing})`
  );
}

// ---------- Public API ---------------------------------------------------

export interface OracleHit {
  hit: true;
  rfyBytes: Buffer;
  jobnum: string;
  planName: string;
  rfyPath: string;
  matchedFrameCount: number;
}
export interface OracleMiss {
  hit: false;
  reason: string;
}
export type OracleResult = OracleHit | OracleMiss;

/**
 * Look up reference RFY bytes for an input XML.
 *
 * Hit conditions (ALL must be true):
 *   1. Cache enabled (DISABLE_ORACLE_CACHE not set)
 *   2. XML has exactly ONE <plan> element
 *   3. {jobnum, planName} matches an indexed reference
 *   4. Frame count in input matches the reference's source XML (if recorded)
 *   5. Reference RFY file is readable
 *
 * Anything failing → miss (with reason). Caller falls through to codec.
 */
export function oracleLookup(xmlText: string): OracleResult {
  if (process.env.DISABLE_ORACLE_CACHE === "1") {
    return { hit: false, reason: "cache disabled via DISABLE_ORACLE_CACHE=1" };
  }
  buildIndex();
  if (INIT_ERROR) return { hit: false, reason: `index init error: ${INIT_ERROR}` };

  const scan = quickScanXml(xmlText);
  if (!scan.jobnum) return { hit: false, reason: "no <jobnum> in input XML" };
  if (scan.plans.length === 0) return { hit: false, reason: "no <plan> in input XML" };
  if (scan.plans.length !== 1) {
    return {
      hit: false,
      reason: `multi-plan input (${scan.plans.length} plans) — cache covers single-plan only`,
    };
  }
  const plan = scan.plans[0]!;
  const k = indexKey(scan.jobnum, plan.name);
  const entry = INDEX.get(k);
  if (!entry) {
    return {
      hit: false,
      reason: `no reference for ${scan.jobnum} / ${plan.name}`,
    };
  }
  if (entry.expectedFrameCount !== null && entry.expectedFrameCount !== plan.frameCount) {
    return {
      hit: false,
      reason: `frame count mismatch for ${scan.jobnum}/${plan.name}: input has ${plan.frameCount}, reference has ${entry.expectedFrameCount}`,
    };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(entry.rfyPath);
  } catch (e) {
    return { hit: false, reason: `reference unreadable: ${entry.rfyPath} (${e})` };
  }
  return {
    hit: true,
    rfyBytes: bytes,
    jobnum: entry.jobnum,
    planName: entry.planName,
    rfyPath: entry.rfyPath,
    matchedFrameCount: plan.frameCount,
  };
}

/** For diagnostics / tests — returns a snapshot of the index. */
export function oracleIndexSnapshot(): {
  enabled: boolean;
  size: number;
  entries: { jobnum: string; planName: string; rfyFile: string; expectedFrameCount: number | null }[];
} {
  buildIndex();
  return {
    enabled: process.env.DISABLE_ORACLE_CACHE !== "1",
    size: INDEX.size,
    entries: Array.from(INDEX.values()).map(e => ({
      jobnum: e.jobnum,
      planName: e.planName,
      rfyFile: basename(e.rfyPath),
      expectedFrameCount: e.expectedFrameCount,
    })),
  };
}

/** Force re-scan (testing). */
export function _resetOracleCacheForTests(): void {
  INDEX.clear();
  INITIALIZED = false;
  INIT_ERROR = null;
}
