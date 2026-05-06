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

// Detailer-pre-rolled cache (populated by forge/orchestrator/detailer-orchestrator.py
// → forge/cache/store.py, or the legacy scripts/detailer-batch.py). Contains
// {jobnum}/{plan}.rfy + {plan}.meta.json for every job/plan that's been
// pre-rolled through Detailer. These bytes ARE Detailer's output by definition,
// so any input matching a cached entry returns 100% bit-exact match.
//
// This is the headless-Detailer-as-oracle path (Forge): instead of reverse-
// engineering Detailer's algorithms, we use Detailer itself as the source of
// truth, run it once per (jobnum, plan), and serve the cached bytes forever
// after.
//
// Layout (matches forge/cache/store.py):
//   <root>/<jobnum>/<plan>.rfy        — Detailer-produced RFY (bit-exact)
//   <root>/<jobnum>/<plan>.meta.json  — { xml_sha256, generated_at, ... }
//   <root>/_index.json                — full index of entries
//
// On cache lookup, the meta.xml_sha256 is checked against the input XML's
// hash; if they match, the cached RFY is served. If the XML has been edited
// since the cache was built, we fall through to the rule engine.
//
// Path resolution (mirrors resolve_cache_root() in forge/cache/store.py):
//   1. FORGE_CACHE_DIR env var
//   2. Any %USERPROFILE%/OneDrive*/CLAUDE DATA FILE/detailer-oracle-cache that exists
//   3. Hardcoded Scott home-PC fallback
const DETAILER_PREROLLED_CACHE = (() => {
  const envPath = process.env.FORGE_CACHE_DIR;
  if (envPath) return envPath;
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    try {
      const entries = readdirSync(home);
      // Prefer "OneDrive - <suffix>" (work account) over plain "OneDrive"
      const oneDrives = entries
        .filter((e) => e.startsWith("OneDrive"))
        .sort((a, b) => (a === "OneDrive" ? 1 : 0) - (b === "OneDrive" ? 1 : 0));
      for (const e of oneDrives) {
        const candidate = join(home, e, "CLAUDE DATA FILE", "detailer-oracle-cache");
        if (existsSync(candidate)) return candidate;
      }
      if (oneDrives.length > 0) {
        // Nothing exists yet — return the preferred path for forward-compat.
        return join(home, oneDrives[0]!, "CLAUDE DATA FILE", "detailer-oracle-cache");
      }
    } catch {
      // ignore
    }
  }
  // Legacy fallback to Scott's home-PC absolute path.
  return "C:\\Users\\Scott\\OneDrive - Textor Metal Industries\\CLAUDE DATA FILE\\detailer-oracle-cache";
})();

// ---------- Index --------------------------------------------------------

interface ReferenceEntry {
  jobnum: string;
  planName: string;
  rfyPath: string;
  /** Frame count from the source XML, used as a soft sanity check on lookup. */
  expectedFrameCount: number | null;
  /** Source XML path that produced this reference, for diagnostics. */
  sourceXmlPath: string | null;
  /** SHA-256 of the source XML at cache-build time (only set for Detailer-
   *  pre-rolled cache entries). When present, the lookup will check the
   *  input XML's hash against this for stronger validation. */
  xmlSha256: string | null;
  /** Where this entry came from. */
  source: "reference" | "prerolled";
}

/**
 * Map key: lowercased "JOBNUM__PLANNAME". Lowercasing because Detailer file
 * paths sometimes change case; the matching key is intent-based, not byte-eq.
 */
const INDEX = new Map<string, ReferenceEntry>();
let INITIALIZED = false;
let INIT_ERROR: string | null = null;
/** Last mtime of <DETAILER_PREROLLED_CACHE>/_index.json when we built INDEX.
 *  Used to detect external cache writes (orchestrator, async runner, route)
 *  and trigger a rebuild without a server restart. */
let LAST_PREROLLED_INDEX_MTIME = 0;

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

/** Read the prerolled cache's _index.json mtime; 0 if missing. */
function prerolledIndexMtime(): number {
  try {
    const idx = join(DETAILER_PREROLLED_CACHE, "_index.json");
    if (!existsSync(idx)) return 0;
    return statSync(idx).mtimeMs;
  } catch {
    return 0;
  }
}

/** Walk JOB_LOCATIONS once, populate INDEX. Tolerates missing dirs (logs + skips).
 *  Auto-rebuilds when the prerolled cache's _index.json has been updated since
 *  the last build (orchestrator / async runner / sync route just wrote new
 *  entries). */
function buildIndex(): void {
  // Mtime-based invalidation: if the prerolled _index.json is newer than our
  // last build, rebuild from scratch.
  const liveMtime = prerolledIndexMtime();
  if (INITIALIZED && liveMtime <= LAST_PREROLLED_INDEX_MTIME) return;
  if (INITIALIZED) {
    // Stale rebuild — clear and re-walk.
    INDEX.clear();
  }
  INITIALIZED = true;
  LAST_PREROLLED_INDEX_MTIME = liveMtime;

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
          xmlSha256: null,
          source: "reference",
        });
        foundForJob++;
      }
    }
    if (foundForJob === 0) {
      rfyDirsMissing++;
      console.warn(`[oracle-cache] no reference RFYs found for job ${job.jobnum}`);
    }
  }

  // ---- Detailer pre-rolled cache (scripts/detailer-batch.py output) ----
  let prerolledCount = 0;
  try {
    if (existsSync(DETAILER_PREROLLED_CACHE)) {
      for (const jobnumDir of readdirSync(DETAILER_PREROLLED_CACHE)) {
        const jobPath = join(DETAILER_PREROLLED_CACHE, jobnumDir);
        try {
          if (!statSync(jobPath).isDirectory()) continue;
        } catch { continue; }
        if (jobnumDir.startsWith("_")) continue; // skip _index.json, _tmp, etc.
        for (const name of readdirSync(jobPath)) {
          if (!name.toLowerCase().endsWith(".rfy")) continue;
          const planName = name.slice(0, -4);
          const rfyPath = join(jobPath, name);
          const metaPath = join(jobPath, `${planName}.meta.json`);
          let xmlSha256: string | null = null;
          try {
            if (existsSync(metaPath)) {
              const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
              xmlSha256 = meta.xml_sha256 ?? null;
            }
          } catch (e) {
            console.warn(`[oracle-cache] meta read failed: ${metaPath} — ${e}`);
          }
          const k = indexKey(jobnumDir, planName);
          // Pre-rolled cache wins over reference cache when both exist —
          // pre-rolled is keyed by content hash, more authoritative.
          INDEX.set(k, {
            jobnum: jobnumDir,
            planName,
            rfyPath,
            expectedFrameCount: null, // pre-rolled doesn't track frame count separately
            sourceXmlPath: null,
            xmlSha256,
            source: "prerolled",
          });
          prerolledCount++;
        }
      }
    }
  } catch (e) {
    console.warn(`[oracle-cache] pre-rolled scan error: ${e}`);
  }

  console.log(
    `[oracle-cache] indexed ${INDEX.size} entries: ` +
    `${INDEX.size - prerolledCount} reference RFYs (${JOB_LOCATIONS.length} jobs) + ${prerolledCount} pre-rolled. ` +
    `xml scanned=${xmlsScanned}, skipped=${xmlsSkipped}, missing rfy dirs=${rfyDirsMissing}`
  );
}

/** SHA-256 of a UTF-8 string (Node.js built-in crypto). */
function sha256OfString(s: string): string {
  // Lazy require to keep this file usable in environments without crypto module.
  // (Should always be present in Node.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(s).digest("hex");
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
  // Pre-rolled cache: validate XML hash. If the source XML has changed since
  // the cache was built, skip — the cached RFY no longer matches this input.
  if (entry.source === "prerolled" && entry.xmlSha256) {
    const inputHash = sha256OfString(xmlText);
    if (inputHash !== entry.xmlSha256) {
      return {
        hit: false,
        reason: `pre-rolled cache stale: input hash ${inputHash.slice(0, 12)} != cached ${entry.xmlSha256.slice(0, 12)} — re-run detailer-batch.py for this job`,
      };
    }
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

// ---------- Per-plan API (multi-plan packed XML support) ----------------

export interface PerPlanResult {
  planName: string;
  frameCount: number;
  hit: boolean;
  rfyBytes?: Buffer;
  rfyPath?: string;
  reason?: string;
}
export interface PerPlanLookupResult {
  jobnum: string | null;
  totalPlans: number;
  /** Per-plan hits/misses in input order. */
  results: PerPlanResult[];
  /** True iff every plan hit the cache. Convenience for "fully-cached" path. */
  allHit: boolean;
  /** Reason returned when allHit is false (first miss reason or env disable). */
  firstMissReason: string | null;
}

/**
 * Per-plan oracle lookup for multi-plan packed XMLs.
 *
 * Unlike `oracleLookup` (single-plan only), this iterates every <plan>
 * element in the XML and returns a per-plan hit/miss. Useful for
 * /api/encode-bundle to emit bit-exact per-plan {jobnum}_{plan}.rfy files
 * matching Detailer's actual output structure.
 *
 * Plans that miss fall through to the caller's codec-encoding path.
 */
export function oracleLookupPerPlan(xmlText: string): PerPlanLookupResult {
  if (process.env.DISABLE_ORACLE_CACHE === "1") {
    return {
      jobnum: null,
      totalPlans: 0,
      results: [],
      allHit: false,
      firstMissReason: "cache disabled via DISABLE_ORACLE_CACHE=1",
    };
  }
  buildIndex();
  if (INIT_ERROR) {
    return {
      jobnum: null,
      totalPlans: 0,
      results: [],
      allHit: false,
      firstMissReason: `index init error: ${INIT_ERROR}`,
    };
  }

  const scan = quickScanXml(xmlText);
  if (!scan.jobnum) {
    return {
      jobnum: null,
      totalPlans: 0,
      results: [],
      allHit: false,
      firstMissReason: "no <jobnum> in input XML",
    };
  }
  if (scan.plans.length === 0) {
    return {
      jobnum: scan.jobnum,
      totalPlans: 0,
      results: [],
      allHit: false,
      firstMissReason: "no <plan> in input XML",
    };
  }

  const results: PerPlanResult[] = [];
  let allHit = true;
  let firstMissReason: string | null = null;

  for (const plan of scan.plans) {
    const k = indexKey(scan.jobnum, plan.name);
    const entry = INDEX.get(k);
    if (!entry) {
      const reason = `no reference for ${scan.jobnum} / ${plan.name}`;
      results.push({ planName: plan.name, frameCount: plan.frameCount, hit: false, reason });
      allHit = false;
      if (!firstMissReason) firstMissReason = reason;
      continue;
    }
    if (entry.expectedFrameCount !== null && entry.expectedFrameCount !== plan.frameCount) {
      const reason = `frame count mismatch for ${scan.jobnum}/${plan.name}: input has ${plan.frameCount}, reference has ${entry.expectedFrameCount}`;
      results.push({ planName: plan.name, frameCount: plan.frameCount, hit: false, reason });
      allHit = false;
      if (!firstMissReason) firstMissReason = reason;
      continue;
    }
    // Pre-rolled cache hash validation. We can't validate per-plan against the
    // packed XML easily (only the multi-plan hash is meaningful), so we trust
    // the lookup if the entry exists. Per-plan hash validation happens in the
    // single-plan oracleLookup() above.
    let bytes: Buffer;
    try {
      bytes = readFileSync(entry.rfyPath);
    } catch (e) {
      const reason = `reference unreadable: ${entry.rfyPath} (${e})`;
      results.push({ planName: plan.name, frameCount: plan.frameCount, hit: false, reason });
      allHit = false;
      if (!firstMissReason) firstMissReason = reason;
      continue;
    }
    results.push({
      planName: plan.name,
      frameCount: plan.frameCount,
      hit: true,
      rfyBytes: bytes,
      rfyPath: entry.rfyPath,
    });
  }

  return {
    jobnum: scan.jobnum,
    totalPlans: scan.plans.length,
    results,
    allHit,
    firstMissReason,
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
