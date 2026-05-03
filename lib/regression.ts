// Regression dashboard helpers — corpus walking + per-job diff orchestration.
//
// Drives the codec's existing `scripts/diff-vs-detailer.mjs` once per paired
// XML/RFY job in the corpus, parses the JSON+txt reports it writes, and
// aggregates the results for the dashboard.
//
// Design choice: shell out to the codec script rather than re-implementing
// the diff logic inline. The diff script embeds ~1000 lines of
// empirically-verified rules (LIN/RP/FJ/LBW post-processing, Web@pt
// derivation, raking-frame chamfers, etc.). Re-implementing here would
// fork those rules and silently drift from the source of truth. Per
// CLAUDE.md: "no patches — root cause only", and the source of truth lives
// in the codec.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ---------- types ----------

export interface JobDiffByOpType {
  [opKey: string]: { matched: number; missing: number; extras: number };
}

export interface JobDiffStick {
  name: string;
  oursLength: number;
  refLength: number;
  matchedCount: number;
  extras: string[];
  missing: string[];
}

export interface JobDiffFrame {
  name: string;
  sticks: JobDiffStick[];
  // Aggregated counts across all sticks in this frame.
  matched: number;
  missing: number;
  extras: number;
}

export interface JobResult {
  project: string;
  plan: string;
  xmlPath: string;
  rfyPath: string;
  // From totals (matched is matched, ref is ours+missing, etc.)
  matched: number;
  refOps: number;
  oursOps: number;
  missingTotal: number;
  extrasTotal: number;
  matchPercent: number; // matched / refOps * 100, 0 if refOps=0
  byOpType: JobDiffByOpType;
  frames: JobDiffFrame[];
  setup: { id: string; name: string } | null;
  error?: string;
}

export interface CategoryStat {
  category: string;
  count: number;
  matched: number;
  ref: number;
  matchPercent: number;
}

export interface RegressionSummary {
  generatedAt: string;
  corpusDir: string;
  totalJobs: number;
  succeededJobs: number;
  jobsAt100: number;
  totalMatched: number;
  totalRef: number;
  overallMatchPercent: number;
  byCategory: CategoryStat[];
  errors: { project: string; plan: string; error: string }[];
}

export interface RegressionReport {
  summary: RegressionSummary;
  jobs: JobResult[];
}

// ---------- corpus discovery ----------

const DEFAULT_CORPUS_DIR =
  process.env.CORPUS_DIR ||
  "C:\\Users\\Scott\\CLAUDE CODE\\hytek-rfy-codec\\test-corpus";

export function getCorpusDir(): string {
  return DEFAULT_CORPUS_DIR;
}

export interface CorpusPair {
  project: string;
  plan: string;
  xmlPath: string;
  rfyPath: string;
}

export function discoverPairs(corpusDir: string): CorpusPair[] {
  if (!existsSync(corpusDir)) {
    throw new Error(
      `Corpus directory not found: ${corpusDir}. Set CORPUS_DIR env var to override.`,
    );
  }
  const projects = readdirSync(corpusDir).filter((d) => {
    const p = join(corpusDir, d);
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });

  const pairs: CorpusPair[] = [];
  for (const project of projects) {
    const dir = join(corpusDir, project);
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    const xmls = files.filter((f) => f.toLowerCase().endsWith(".xml"));
    for (const xml of xmls) {
      const base = xml.replace(/\.xml$/i, "");
      const rfy = files.find((f) => f === `${base}.rfy`);
      if (!rfy) continue;
      pairs.push({
        project,
        plan: base,
        xmlPath: join(dir, xml),
        rfyPath: join(dir, rfy),
      });
    }
  }
  return pairs;
}

// ---------- codec script location ----------

function findCodecScriptDir(): string {
  // We prefer the LOCAL source codec at `../hytek-rfy-codec` (sibling repo)
  // over the npm-installed snapshot. Reason: the source repo's diff script
  // and rules are the running source of truth (matches
  // `node scripts/test-corpus-local.mjs` numbers exactly), whereas the npm
  // install pulls a snapshot from GitHub that may lag behind unmerged local
  // work. CLAUDE.md mandates "the diff harness output is the source of
  // truth — ensure your numbers match scripts/test-corpus-local.mjs", so we
  // run against the same codec that script does.
  //
  // Override: set CODEC_DIR env var to a specific repo directory.
  // Fallback: walk up to node_modules/@hytek/rfy-codec.
  const checked: string[] = [];
  function tryDir(p: string): string | null {
    checked.push(p);
    if (existsSync(join(p, "scripts", "diff-vs-detailer.mjs")) && existsSync(join(p, "dist", "index.js"))) {
      return p;
    }
    return null;
  }

  if (process.env.CODEC_DIR) {
    const hit = tryDir(process.env.CODEC_DIR);
    if (hit) return hit;
  }

  // Sibling-repo fallback. Walk up from this file looking for a sibling
  // named `hytek-rfy-codec`. Standard layout has both repos as siblings
  // under `CLAUDE CODE/`.
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = process.cwd();
  }
  const startPoints = [dir, process.cwd()];
  for (const start of startPoints) {
    let cur = start;
    for (let i = 0; i < 10; i++) {
      const sibling = join(dirname(cur), "hytek-rfy-codec");
      const hit = tryDir(sibling);
      if (hit) return hit;
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  // Final fallback: npm-installed package.
  for (const start of startPoints) {
    let cur = start;
    for (let i = 0; i < 10; i++) {
      const candidate = join(cur, "node_modules", "@hytek", "rfy-codec");
      const hit = tryDir(candidate);
      if (hit) return hit;
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  throw new Error(
    `Could not locate hytek-rfy-codec. Set CODEC_DIR env var. Tried: ${checked.join(", ")}`,
  );
}

// ---------- per-job diff invocation ----------

interface DiffJsonReport {
  inputXml: string;
  reference: string;
  generated: string;
  setup: { id: string; name: string } | null;
  totals: {
    ours: number;
    ref: number;
    matched: number;
    missing: number;
    extras: number;
  };
  byFrame: Array<{
    name: string;
    sticks: Array<{
      name: string;
      oursLength: number;
      refLength: number;
      matchedCount: number;
      extras: string[];
      missing: string[];
    }>;
  }>;
}

// Parse the BY OP TYPE table from the txt report. The codec's diff script
// emits this as a fixed-format text block; the JSON dump omits it.
function parseByOpTypeFromTxt(txt: string): JobDiffByOpType {
  const result: JobDiffByOpType = {};
  const lines = txt.split(/\r?\n/);
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("BY OP TYPE:")) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line.startsWith("FRAMES WITH GAPS")) break;
    if (line.startsWith("Op ") || line.startsWith("---")) continue;
    if (!line.trim()) continue;
    // Format: `Op@kind            matched   missing   extras   (NN% ref-coverage)`
    // The Op token may itself contain @ — split on whitespace.
    const m = line.match(
      /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s*(?:\(.*\))?\s*$/,
    );
    if (!m) continue;
    const [, opKey, matched, missing, extras] = m;
    result[opKey] = {
      matched: parseInt(matched, 10),
      missing: parseInt(missing, 10),
      extras: parseInt(extras, 10),
    };
  }
  return result;
}

function runDiffForPair(pair: CorpusPair, codecDir: string): JobResult {
  // Each job gets its own tempdir so the JSON/txt files don't collide.
  const tmp = mkdtempSync(join(tmpdir(), "rfy-diff-"));
  const outPrefix = join(tmp, "diff");
  try {
    execFileSync(
      process.execPath,
      [
        join("scripts", "diff-vs-detailer.mjs"),
        pair.xmlPath,
        pair.rfyPath,
        outPrefix,
      ],
      {
        cwd: codecDir,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const jsonRaw = readFileSync(`${outPrefix}.json`, "utf-8");
    const txtRaw = readFileSync(`${outPrefix}.txt`, "utf-8");
    const report: DiffJsonReport = JSON.parse(jsonRaw);
    const byOpType = parseByOpTypeFromTxt(txtRaw);

    const refOps = report.totals.ref;
    const matched = report.totals.matched;
    const matchPercent = refOps > 0 ? (matched / refOps) * 100 : 0;

    // Frames in `report.byFrame` only include frames that have *gaps*. For
    // the dashboard we surface those. Compute per-frame agg counts.
    const frames: JobDiffFrame[] = report.byFrame.map((fr) => {
      let m = 0,
        miss = 0,
        ext = 0;
      for (const st of fr.sticks) {
        m += st.matchedCount;
        miss += st.missing.length;
        ext += st.extras.length;
      }
      return {
        name: fr.name,
        sticks: fr.sticks,
        matched: m,
        missing: miss,
        extras: ext,
      };
    });

    return {
      project: pair.project,
      plan: pair.plan,
      xmlPath: pair.xmlPath,
      rfyPath: pair.rfyPath,
      matched,
      refOps,
      oursOps: report.totals.ours,
      missingTotal: report.totals.missing,
      extrasTotal: report.totals.extras,
      matchPercent,
      byOpType,
      frames,
      setup: report.setup,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      project: pair.project,
      plan: pair.plan,
      xmlPath: pair.xmlPath,
      rfyPath: pair.rfyPath,
      matched: 0,
      refOps: 0,
      oursOps: 0,
      missingTotal: 0,
      extrasTotal: 0,
      matchPercent: 0,
      byOpType: {},
      frames: [],
      setup: null,
      error: msg.slice(0, 500),
    };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures — tmp dirs are reaped by the OS.
    }
  }
}

// ---------- category stats (mirrors test-corpus-local.mjs categorisation) ----------

function categoriseFromPlan(plan: string): string {
  // Same regex as test-corpus-local.mjs: trailing -<TYPE>-<profile>.<gauge>
  const m = plan.match(/-([A-Z]+)-(\d+\.\d+)$/);
  return m ? `${m[1]}-${m[2]}` : "OTHER";
}

function buildSummary(
  jobs: JobResult[],
  corpusDir: string,
): RegressionSummary {
  const succeeded = jobs.filter((j) => !j.error);
  let totalMatched = 0;
  let totalRef = 0;
  let jobsAt100 = 0;
  const byCat = new Map<string, { count: number; matched: number; ref: number }>();
  const errors: RegressionSummary["errors"] = [];

  for (const j of jobs) {
    if (j.error) {
      errors.push({ project: j.project, plan: j.plan, error: j.error });
      continue;
    }
    totalMatched += j.matched;
    totalRef += j.refOps;
    if (j.matchPercent >= 99.999) jobsAt100++;
    const cat = categoriseFromPlan(j.plan);
    const s = byCat.get(cat) ?? { count: 0, matched: 0, ref: 0 };
    s.count++;
    s.matched += j.matched;
    s.ref += j.refOps;
    byCat.set(cat, s);
  }

  const byCategory: CategoryStat[] = [...byCat.entries()]
    .map(([category, s]) => ({
      category,
      count: s.count,
      matched: s.matched,
      ref: s.ref,
      matchPercent: s.ref > 0 ? (s.matched / s.ref) * 100 : 0,
    }))
    .sort((a, b) => b.ref - a.ref);

  return {
    generatedAt: new Date().toISOString(),
    corpusDir,
    totalJobs: jobs.length,
    succeededJobs: succeeded.length,
    jobsAt100,
    totalMatched,
    totalRef,
    overallMatchPercent: totalRef > 0 ? (totalMatched / totalRef) * 100 : 0,
    byCategory,
    errors,
  };
}

// ---------- driver ----------

export interface RunRegressionOptions {
  corpusDir?: string;
  // Optional plan-substring filter for partial reruns. Matches against
  // `${project}/${plan}` case-insensitive.
  filter?: string;
}

export function runRegression(
  opts: RunRegressionOptions = {},
): RegressionReport {
  const corpusDir = opts.corpusDir ?? getCorpusDir();
  const codecDir = findCodecScriptDir();
  const allPairs = discoverPairs(corpusDir);
  const pairs = opts.filter
    ? allPairs.filter((p) =>
        `${p.project}${sep}${p.plan}`
          .toLowerCase()
          .includes(opts.filter!.toLowerCase()),
      )
    : allPairs;

  const jobs: JobResult[] = [];
  for (const pair of pairs) {
    jobs.push(runDiffForPair(pair, codecDir));
  }

  return {
    summary: buildSummary(jobs, corpusDir),
    jobs,
  };
}

// ---------- in-memory cache (per server-process) ----------

let cached: RegressionReport | null = null;
let runningPromise: Promise<RegressionReport> | null = null;

export function getCached(): RegressionReport | null {
  return cached;
}

export async function refreshRegression(
  opts: RunRegressionOptions = {},
): Promise<RegressionReport> {
  // De-dupe concurrent refreshes — they all observe the same in-flight run.
  if (runningPromise) return runningPromise;
  runningPromise = (async () => {
    try {
      const report = runRegression(opts);
      cached = report;
      return report;
    } finally {
      runningPromise = null;
    }
  })();
  return runningPromise;
}

// Ensure tmpdir is writable on first import (Vercel Lambda gotcha).
export function probeWritableTmp(): boolean {
  try {
    const probe = mkdtempSync(join(tmpdir(), "rfy-probe-"));
    rmSync(probe, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

