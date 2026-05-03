"use client";

// Regression dashboard — per-job match status across the test corpus, with
// drill-down into per-frame missing/extra ops. Live equivalent of running
// `node scripts/test-corpus-local.mjs` in the codec repo.
//
// Hot-path tap budget: 2 taps to the worst job's missing ops list:
//   (1) tap row to expand frames → (2) tap frame to see missing/extras.

import { useEffect, useMemo, useState } from "react";

// ---------- types (mirror lib/regression.ts) ----------

interface JobDiffStick {
  name: string;
  oursLength: number;
  refLength: number;
  matchedCount: number;
  extras: string[];
  missing: string[];
}

interface JobDiffFrame {
  name: string;
  sticks: JobDiffStick[];
  matched: number;
  missing: number;
  extras: number;
}

interface JobCsvStats {
  fullPipeline: { exact: number; total: number; pct: number; missing: number; extra: number };
  emission:    { exact: number; total: number; pct: number };
  ruleGen:     { exact: number; total: number; pct: number };
}

interface JobResult {
  project: string;
  plan: string;
  xmlPath: string;
  rfyPath: string;
  csvPath?: string;
  matched: number;
  refOps: number;
  oursOps: number;
  missingTotal: number;
  extrasTotal: number;
  matchPercent: number;
  byOpType: Record<string, { matched: number; missing: number; extras: number }>;
  frames: JobDiffFrame[];
  setup: { id: string; name: string } | null;
  csv?: JobCsvStats;
  error?: string;
}

interface CategoryStat {
  category: string;
  count: number;
  matched: number;
  ref: number;
  matchPercent: number;
  csvFullExact?: number;
  csvFullTotal?: number;
  csvFullPct?: number;
}

interface RegressionSummary {
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
  csvJobs?: number;
  csvFullExact?: number;
  csvFullTotal?: number;
  csvFullPct?: number;
  csvEmissionPct?: number;
  csvRuleGenPct?: number;
}

interface RegressionReport {
  summary: RegressionSummary;
  jobs: JobResult[];
}

type SortKey = "name" | "match" | "refOps" | "missing" | "extras";

// ---------- helpers ----------

function pillClass(pct: number, hasError: boolean): string {
  if (hasError) return "bg-red-950 text-red-300 border-red-800";
  if (pct >= 99.999) return "bg-amber-400 text-black border-amber-300";
  if (pct >= 80) return "bg-emerald-900 text-emerald-200 border-emerald-700";
  if (pct >= 50) return "bg-yellow-900 text-yellow-200 border-yellow-700";
  return "bg-red-900 text-red-200 border-red-700";
}

function fmtPct(pct: number): string {
  if (pct >= 99.999) return "100%";
  return `${pct.toFixed(1)}%`;
}

function categoryBar(pct: number): string {
  // 10-segment bar visual, char-based so it survives any styling churn.
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

// ---------- component ----------

export default function RegressionPage() {
  const [report, setReport] = useState<RegressionReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("match");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [expandedFrame, setExpandedFrame] = useState<string | null>(null);

  // Initial load — pull cached or trigger first run.
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = force
        ? await fetch("/api/regression", { method: "POST" })
        : await fetch("/api/regression");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const data: RegressionReport = await res.json();
      setReport(data);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  // Filtered + sorted job rows.
  const visibleJobs = useMemo(() => {
    if (!report) return [];
    const ft = filterText.trim().toLowerCase();
    let rows = report.jobs;
    if (ft) {
      // Recognise a couple of quick filter shortcuts.
      const ltMatch = ft.match(/^<\s*(\d+)\s*%?$/);
      const gtMatch = ft.match(/^>\s*(\d+)\s*%?$/);
      if (ltMatch) {
        const n = parseFloat(ltMatch[1]);
        rows = rows.filter((j) => j.matchPercent < n);
      } else if (gtMatch) {
        const n = parseFloat(gtMatch[1]);
        rows = rows.filter((j) => j.matchPercent > n);
      } else {
        rows = rows.filter(
          (j) =>
            j.plan.toLowerCase().includes(ft) ||
            j.project.toLowerCase().includes(ft),
        );
      }
    }
    const dir = sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.plan.localeCompare(b.plan);
        case "match":
          return dir * (a.matchPercent - b.matchPercent);
        case "refOps":
          return dir * (a.refOps - b.refOps);
        case "missing":
          return dir * (a.missingTotal - b.missingTotal);
        case "extras":
          return dir * (a.extrasTotal - b.extrasTotal);
      }
    });
    return rows;
  }, [report, filterText, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "name" ? "asc" : "asc");
    }
  }

  function jobKey(j: JobResult) {
    return `${j.project}::${j.plan}`;
  }

  function frameKey(j: JobResult, f: JobDiffFrame) {
    return `${jobKey(j)}::${f.name}`;
  }

  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto bg-zinc-950 text-zinc-200">
      <header className="mb-6 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">
            <span className="text-amber-400">HYTEK</span> Match Regression Dashboard
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Op-level diff between our codec output and Detailer reference RFYs across the test corpus.{" "}
            Source of truth: <code className="text-amber-400">scripts/diff-vs-detailer.mjs</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/"
            className="text-sm px-3 py-1.5 rounded border border-zinc-700 hover:border-amber-400 hover:text-amber-400 text-zinc-300 transition"
          >
            ← Tools
          </a>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="text-sm px-3 py-1.5 rounded border border-amber-400 text-amber-400 hover:bg-amber-400 hover:text-black transition disabled:opacity-50 disabled:cursor-wait"
          >
            {loading ? "Running diff..." : "↻ Refresh"}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 text-red-300 p-4 mb-6 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {!report && loading && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center text-zinc-400">
          Running corpus diff... This typically takes 1-2 minutes (~1-3s per job × ~40 jobs).
        </div>
      )}

      {!report && !loading && !error && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-8 text-center text-zinc-400">
          No data yet. Click <strong>Refresh</strong> to run the corpus diff.
        </div>
      )}

      {report && (
        <>
          <SummaryPanel summary={report.summary} />
          <FilterBar
            filterText={filterText}
            setFilterText={setFilterText}
            visibleCount={visibleJobs.length}
            totalCount={report.jobs.length}
          />
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 uppercase text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <SortBtn k="name" cur={sortKey} dir={sortDir} onClick={toggleSort}>
                      Plan
                    </SortBtn>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <SortBtn k="match" cur={sortKey} dir={sortDir} onClick={toggleSort}>
                      Match %
                    </SortBtn>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <SortBtn k="refOps" cur={sortKey} dir={sortDir} onClick={toggleSort}>
                      Ops (matched / ref)
                    </SortBtn>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <SortBtn k="missing" cur={sortKey} dir={sortDir} onClick={toggleSort}>
                      Missing
                    </SortBtn>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <SortBtn k="extras" cur={sortKey} dir={sortDir} onClick={toggleSort}>
                      Extras
                    </SortBtn>
                  </th>
                  <th className="px-3 py-2 text-left">Setup</th>
                  <th className="px-3 py-2 text-left w-8"></th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.map((j) => {
                  const key = jobKey(j);
                  const isOpen = expandedJob === key;
                  return (
                    <JobRow
                      key={key}
                      job={j}
                      isOpen={isOpen}
                      expandedFrame={isOpen ? expandedFrame : null}
                      onToggle={() => {
                        setExpandedJob(isOpen ? null : key);
                        setExpandedFrame(null);
                      }}
                      onToggleFrame={(fName) => {
                        const fk = `${key}::${fName}`;
                        setExpandedFrame(expandedFrame === fk ? null : fk);
                      }}
                      makeFrameKey={(f) => frameKey(j, f)}
                    />
                  );
                })}
                {visibleJobs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                      No jobs match the filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500 mt-4">
            Generated {new Date(report.summary.generatedAt).toLocaleString()} · Corpus:{" "}
            <code className="text-zinc-400">{report.summary.corpusDir}</code>
          </p>
        </>
      )}
    </main>
  );
}

// ---------- summary panel ----------

function SummaryPanel({ summary }: { summary: RegressionSummary }) {
  return (
    <section className="rounded-xl border-2 border-amber-400/40 bg-zinc-900/60 p-5 mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <Stat
          label="Overall match"
          value={fmtPct(summary.overallMatchPercent)}
          hint={`${summary.totalMatched.toLocaleString()} / ${summary.totalRef.toLocaleString()} ops`}
          bigColor="text-amber-400"
        />
        <Stat
          label="Jobs"
          value={String(summary.totalJobs)}
          hint={`${summary.succeededJobs} succeeded`}
        />
        <Stat
          label="At 100%"
          value={String(summary.jobsAt100)}
          hint={`${summary.totalJobs - summary.jobsAt100} below`}
          bigColor={summary.jobsAt100 > 0 ? "text-amber-400" : "text-zinc-200"}
        />
        <Stat
          label="Errors"
          value={String(summary.errors.length)}
          hint={summary.errors.length === 0 ? "all jobs ran clean" : "see below"}
          bigColor={summary.errors.length > 0 ? "text-red-400" : "text-zinc-200"}
        />
      </div>
      {/* CSV-level diff stats. Only shown if at least one job had a paired
          .csv reference (most older corpus jobs don't, only HG260044+ have
          Detailer-emitted CSVs). The three percentages decompose the gap:
          full = ours-csv vs Detailer-csv; emit = decoder→csv accuracy;
          rule = synthesize→csv accuracy. */}
      {summary.csvJobs && summary.csvJobs > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 pt-3 border-t border-zinc-800">
          <Stat
            label="CSV full pipeline"
            value={fmtPct(summary.csvFullPct ?? 0)}
            hint={`${(summary.csvFullExact ?? 0).toLocaleString()} / ${(summary.csvFullTotal ?? 0).toLocaleString()} rows · ${summary.csvJobs} job${summary.csvJobs === 1 ? "" : "s"}`}
            bigColor="text-sky-400"
          />
          <Stat
            label="CSV emission"
            value={fmtPct(summary.csvEmissionPct ?? 0)}
            hint="decoder → CSV accuracy"
          />
          <Stat
            label="CSV rule-gen"
            value={fmtPct(summary.csvRuleGenPct ?? 0)}
            hint="synthesize → CSV accuracy"
          />
          <Stat
            label="CSV vs RFY"
            value={fmtPct(summary.overallMatchPercent - (summary.csvFullPct ?? 0))}
            hint="op-level lead over row-level"
          />
        </div>
      )}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">By category</h3>
        <div className="space-y-1 font-mono text-xs">
          {summary.byCategory.map((c) => (
            <div key={c.category} className="flex items-center gap-3">
              <span className="text-zinc-300 w-32 truncate">{c.category}</span>
              <span className="text-amber-400 w-14 text-right">
                {fmtPct(c.matchPercent)}
              </span>
              <span className="text-emerald-400">{categoryBar(c.matchPercent)}</span>
              <span className="text-zinc-500">
                {c.count} jobs · {c.matched.toLocaleString()}/{c.ref.toLocaleString()}
              </span>
              {c.csvFullPct !== undefined && (
                <span className="text-sky-400">
                  csv {fmtPct(c.csvFullPct)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      {summary.errors.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-red-400 cursor-pointer hover:text-red-300">
            Show {summary.errors.length} error(s)
          </summary>
          <ul className="mt-2 space-y-1 text-xs font-mono text-red-300">
            {summary.errors.map((e, i) => (
              <li key={i}>
                <strong>
                  {e.project}/{e.plan}:
                </strong>{" "}
                {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  bigColor = "text-zinc-200",
}: {
  label: string;
  value: string;
  hint?: string;
  bigColor?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`text-2xl font-bold ${bigColor}`}>{value}</span>
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </div>
  );
}

// ---------- filter bar ----------

function FilterBar({
  filterText,
  setFilterText,
  visibleCount,
  totalCount,
}: {
  filterText: string;
  setFilterText: (s: string) => void;
  visibleCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex items-center gap-3 mb-3 flex-wrap">
      <input
        type="text"
        placeholder="Filter (substring, or '<80', '>50' for match %)"
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        className="flex-1 min-w-[240px] px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-amber-400"
      />
      <span className="text-xs text-zinc-500">
        {visibleCount} of {totalCount} jobs
      </span>
    </div>
  );
}

// ---------- sort button ----------

function SortBtn({
  k,
  cur,
  dir,
  onClick,
  children,
}: {
  k: SortKey;
  cur: SortKey;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = cur === k;
  const arrow = active ? (dir === "asc" ? "↑" : "↓") : "";
  return (
    <button
      onClick={() => onClick(k)}
      className={`uppercase text-xs font-semibold ${
        active ? "text-amber-400" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children} {arrow}
    </button>
  );
}

// ---------- job row + drill-downs ----------

function JobRow({
  job,
  isOpen,
  expandedFrame,
  onToggle,
  onToggleFrame,
  makeFrameKey,
}: {
  job: JobResult;
  isOpen: boolean;
  expandedFrame: string | null;
  onToggle: () => void;
  onToggleFrame: (frameName: string) => void;
  makeFrameKey: (f: JobDiffFrame) => string;
}) {
  const pct = job.matchPercent;
  const hasError = !!job.error;
  return (
    <>
      <tr
        className="border-t border-zinc-800 hover:bg-zinc-900/60 cursor-pointer transition"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-mono text-zinc-200">
          <span className="text-zinc-500">{job.project} /</span> {job.plan}
        </td>
        <td className="px-3 py-2">
          <span
            className={`inline-block px-2 py-0.5 rounded border text-xs font-mono ${pillClass(pct, hasError)}`}
          >
            {hasError ? "ERROR" : fmtPct(pct)}
          </span>
        </td>
        <td className="px-3 py-2 font-mono text-xs text-zinc-400">
          {job.matched.toLocaleString()} / {job.refOps.toLocaleString()}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-yellow-300">
          {job.missingTotal.toLocaleString()}
        </td>
        <td className="px-3 py-2 font-mono text-xs text-orange-300">
          {job.extrasTotal.toLocaleString()}
        </td>
        <td className="px-3 py-2 text-xs text-zinc-400">
          {job.setup?.name ?? "-"}
        </td>
        <td className="px-3 py-2 text-zinc-500">{isOpen ? "▼" : "▶"}</td>
      </tr>
      {isOpen && (
        <tr className="bg-zinc-950">
          <td colSpan={7} className="px-3 py-3">
            {hasError ? (
              <div className="text-sm text-red-300 font-mono">{job.error}</div>
            ) : (
              <JobDrilldown
                job={job}
                expandedFrame={expandedFrame}
                onToggleFrame={onToggleFrame}
                makeFrameKey={makeFrameKey}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function JobDrilldown({
  job,
  expandedFrame,
  onToggleFrame,
  makeFrameKey,
}: {
  job: JobResult;
  expandedFrame: string | null;
  onToggleFrame: (frameName: string) => void;
  makeFrameKey: (f: JobDiffFrame) => string;
}) {
  const opTypes = useMemo(() => {
    return Object.entries(job.byOpType)
      .map(([opKey, v]) => ({ opKey, ...v }))
      .sort((a, b) => b.missing + b.extras - (a.missing + a.extras));
  }, [job.byOpType]);

  return (
    <div className="space-y-4">
      {opTypes.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">
            By op type
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 font-mono text-xs">
            {opTypes.map((o) => {
              const total = o.matched + o.missing;
              const cov = total > 0 ? (o.matched / total) * 100 : 0;
              return (
                <div
                  key={o.opKey}
                  className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 flex flex-col"
                >
                  <span className="text-zinc-200 truncate" title={o.opKey}>
                    {o.opKey}
                  </span>
                  <span className="text-zinc-500">
                    <span className="text-emerald-400">{o.matched}</span>{" "}
                    <span className="text-yellow-300">−{o.missing}</span>{" "}
                    <span className="text-orange-300">+{o.extras}</span>{" "}
                    <span className="text-zinc-500">({cov.toFixed(0)}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {job.frames.length === 0 ? (
        <div className="text-sm text-emerald-400">
          No frames have gaps — every stick matches the reference.
        </div>
      ) : (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">
            Frames with gaps ({job.frames.length})
          </h4>
          <div className="space-y-1">
            {job.frames.map((f) => {
              const fk = makeFrameKey(f);
              const open = expandedFrame === fk;
              return (
                <FrameRow
                  key={fk}
                  frame={f}
                  open={open}
                  onToggle={() => onToggleFrame(f.name)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FrameRow({
  frame,
  open,
  onToggle,
}: {
  frame: JobDiffFrame;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between gap-3 hover:bg-zinc-900/80 transition text-left"
      >
        <span className="font-mono text-sm text-zinc-200">{frame.name}</span>
        <span className="font-mono text-xs text-zinc-400">
          <span className="text-emerald-400">{frame.matched} matched</span> ·{" "}
          <span className="text-yellow-300">{frame.missing} missing</span> ·{" "}
          <span className="text-orange-300">{frame.extras} extras</span>{" "}
          <span className="text-zinc-500">· {frame.sticks.length} sticks</span>
        </span>
        <span className="text-zinc-500">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div className="px-3 py-3 border-t border-zinc-800 bg-zinc-950">
          <div className="space-y-2">
            {frame.sticks.map((s) => (
              <StickGapRow key={s.name} stick={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StickGapRow({ stick }: { stick: JobDiffStick }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/30 p-2">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="font-mono text-sm text-zinc-100">{stick.name}</span>
        <span className="font-mono text-xs text-zinc-500">
          ours {stick.oursLength}mm · ref {stick.refLength}mm · {stick.matchedCount} matched
        </span>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-yellow-300 mb-0.5">
            Missing ({stick.missing.length}) — ref has, we don&apos;t
          </div>
          <ul className="font-mono text-xs text-yellow-200 space-y-0.5">
            {stick.missing.length === 0 && <li className="text-zinc-600">none</li>}
            {stick.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-orange-300 mb-0.5">
            Extras ({stick.extras.length}) — we emit, ref doesn&apos;t
          </div>
          <ul className="font-mono text-xs text-orange-200 space-y-0.5">
            {stick.extras.length === 0 && <li className="text-zinc-600">none</li>}
            {stick.extras.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
