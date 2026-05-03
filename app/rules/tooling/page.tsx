"use client";

// Tooling-rules registry. Read-only viewer of every rule that drives
// the F300i rollformer output. Loads from /api/tooling-rules which
// reflects the codec's compiled-in rule table (single source of truth).
//
// This page exists so Scott (or future ops staff) can see EXACTLY what
// rules fire on each stick — without reading TS code. When a cut comes
// out wrong, this is where you look first to identify which rule is
// responsible.
import { useEffect, useMemo, useState } from "react";

interface RuleEntry {
  toolType: string;
  kind: string;
  anchor: { kind: string; offset?: number; firstOffset?: number; spacing?: number; lastOffset?: number; fraction?: number };
  spanLength: number | null;
  confidence: string;
  notes: string | null;
  hasPredicate: boolean;
  predicateSource: string | null;
}

interface RuleGroup {
  id: string;
  rolePattern: string;
  profilePattern: string;
  lengthRange: [number, string | number];
  ruleCount: number;
  rules: RuleEntry[];
}

interface FrameContextParam {
  type?: string;
  valueMm?: number | string;
  spanMm?: number;
  dimpleOffsetMm?: number;
  enabled?: boolean;
  note: string;
}

interface TrimRule {
  valueMm: number | string;
  appliesTo: string;
  note: string;
}

interface ToolingRulesResponse {
  version: number;
  description: string;
  summary: {
    groupCount: number;
    totalRules: number;
    profilesCovered: string[];
    rolesCovered: string[];
  };
  perStickRules: RuleGroup[];
  frameContextParams: Record<string, FrameContextParam>;
  trimRules: Record<string, TrimRule>;
}

type Section = "perStick" | "frameContext" | "trim";

function fmtAnchor(a: RuleEntry["anchor"]): string {
  switch (a.kind) {
    case "startAnchored": return `start + ${a.offset}mm`;
    case "endAnchored":   return `length − ${a.offset}mm`;
    case "centred":       return `length / 2 + ${a.offset ?? 0}mm`;
    case "fraction":      return `length × ${a.fraction}`;
    case "spaced":        return `every ${a.spacing}mm from offset ${a.firstOffset} to length−${a.lastOffset}`;
    default:              return JSON.stringify(a);
  }
}

function fmtRule(r: RuleEntry): string {
  let s = `${r.toolType} (${r.kind})`;
  if (r.spanLength != null) s += ` span ${r.spanLength}mm`;
  s += ` @ ${fmtAnchor(r.anchor)}`;
  return s;
}

export default function ToolingRulesPage() {
  const [data, setData] = useState<ToolingRulesResponse | null>(null);
  const [section, setSection] = useState<Section>("perStick");
  const [filter, setFilter] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tooling-rules")
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData)
      .catch(e => setError(String(e)));
  }, []);

  const filteredGroups = useMemo(() => {
    if (!data) return [];
    const f = filter.toLowerCase().trim();
    if (!f) return data.perStickRules;
    return data.perStickRules.filter(g =>
      g.rolePattern.toLowerCase().includes(f) ||
      g.profilePattern.toLowerCase().includes(f) ||
      g.rules.some(r => r.toolType.toLowerCase().includes(f) || (r.notes ?? "").toLowerCase().includes(f))
    );
  }, [data, filter]);

  if (error) return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      <div className="rounded-xl border border-red-700 bg-red-950/40 p-6 text-red-200">
        <h1 className="text-xl font-semibold mb-2">Failed to load rules</h1>
        <pre className="text-sm">{error}</pre>
      </div>
    </main>
  );

  if (!data) return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto text-zinc-400">
      Loading rule registry...
    </main>
  );

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto">
      {/* HYTEK Group official logo — yellow on black, per brand manual. */}
      <div className="flex items-center gap-3 mb-4">
        <img src="/hytek-group-logo.png" alt="HYTEK GROUP" className="h-10" />
      </div>
      <header className="mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <h1 className="text-3xl font-bold">
            <span className="text-yellow-400">HYTEK</span> Tooling Rules Registry
          </h1>
          <a href="/" className="text-sm px-3 py-1.5 rounded border border-zinc-700 hover:border-yellow-400 hover:text-yellow-400 text-zinc-300 transition">
            ← Home
          </a>
        </div>
        <p className="text-zinc-400 text-sm max-w-3xl">
          Every rule that drives the F300i rollformer output. When the cut steel comes out
          wrong, look here FIRST — these are the rules that decide every notch, swage, dimple
          and bolt-hole. Read-only for now; edit support coming soon.
        </p>
        <p className="text-xs text-zinc-500 mt-2">
          {data.summary.groupCount} rule groups · {data.summary.totalRules} per-stick rules ·{" "}
          {Object.keys(data.frameContextParams).length} frame-context params ·{" "}
          {Object.keys(data.trimRules).length} trim rules · v{data.version}
        </p>
      </header>

      <div className="flex gap-2 mb-4 border-b border-zinc-800">
        {([
          { id: "perStick" as Section, label: `Per-stick rules (${data.summary.totalRules})` },
          { id: "frameContext" as Section, label: `Frame-context (${Object.keys(data.frameContextParams).length})` },
          { id: "trim" as Section, label: `Trim rules (${Object.keys(data.trimRules).length})` },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={`px-4 py-2 text-sm rounded-t transition ${
              section === t.id
                ? "bg-yellow-400 text-black font-semibold"
                : "text-zinc-400 hover:text-yellow-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === "perStick" && (
        <>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Filter by role, profile, op type, notes..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-yellow-400 outline-none"
            />
          </div>
          <div className="space-y-2">
            {filteredGroups.map(g => {
              const expanded = expandedGroupId === g.id;
              return (
                <div key={g.id} className="rounded border border-zinc-800 bg-zinc-900/50">
                  <button
                    onClick={() => setExpandedGroupId(expanded ? null : g.id)}
                    className="w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-zinc-800/50 transition"
                  >
                    <span className="text-zinc-500 text-xs">{expanded ? "▼" : "▶"}</span>
                    <span className="text-yellow-400 font-mono text-sm">role: {g.rolePattern}</span>
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-300 font-mono text-sm">profile: {g.profilePattern}</span>
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-400 text-sm">length {g.lengthRange[0]}…{g.lengthRange[1]}</span>
                    <span className="ml-auto text-zinc-500 text-xs">{g.ruleCount} rule{g.ruleCount === 1 ? "" : "s"}</span>
                  </button>
                  {expanded && (
                    <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
                      {g.rules.map((r, i) => (
                        <div key={i} className="rounded bg-zinc-950 border border-zinc-800 p-3">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="font-mono text-sm text-yellow-400">{fmtRule(r)}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              r.confidence === "high" ? "bg-green-900/50 text-green-300" :
                              r.confidence === "medium" ? "bg-yellow-900/50 text-yellow-300" :
                              "bg-red-900/50 text-red-300"
                            }`}>{r.confidence}</span>
                            {r.hasPredicate && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300">conditional</span>
                            )}
                          </div>
                          {r.notes && <div className="text-xs text-zinc-400 mt-1">{r.notes}</div>}
                          {r.hasPredicate && r.predicateSource && (
                            <details className="mt-1">
                              <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">predicate source</summary>
                              <pre className="text-xs text-zinc-400 mt-1 overflow-x-auto">{r.predicateSource}</pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {section === "frameContext" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400 mb-2">
            These parameters control how the codec emits ops at geometric crossings (stud-to-plate, stud-to-nog, truss-web-to-chord).
            They live in <code className="text-yellow-400">frame-context.ts</code> in the codec.
          </p>
          {Object.entries(data.frameContextParams).map(([key, param]) => (
            <div key={key} className="rounded border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-baseline gap-3 mb-1">
                <span className="font-mono text-sm text-yellow-400">{key}</span>
                {param.valueMm !== undefined && (
                  <span className="text-zinc-200 font-mono text-sm">= {String(param.valueMm)}{typeof param.valueMm === "number" ? " mm" : ""}</span>
                )}
                {param.type && <span className="text-zinc-200 font-mono text-sm">→ {param.type}</span>}
                {param.enabled !== undefined && (
                  <span className={`text-xs px-1.5 py-0.5 rounded ${param.enabled ? "bg-green-900/50 text-green-300" : "bg-zinc-800 text-zinc-400"}`}>
                    {param.enabled ? "enabled" : "disabled"}
                  </span>
                )}
                {param.spanMm !== undefined && <span className="text-zinc-300 font-mono text-xs">span {param.spanMm}mm</span>}
                {param.dimpleOffsetMm !== undefined && <span className="text-zinc-300 font-mono text-xs">dimple offset {param.dimpleOffsetMm}mm</span>}
              </div>
              <div className="text-xs text-zinc-400">{param.note}</div>
            </div>
          ))}
        </div>
      )}

      {section === "trim" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400 mb-2">
            Trim rules run BEFORE per-stick rules fire — they shorten or extend the stick's start/end coordinates.
            Source: <code className="text-yellow-400">framecad-import.ts</code>.
          </p>
          {Object.entries(data.trimRules).map(([key, rule]) => (
            <div key={key} className="rounded border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-baseline gap-3 mb-1">
                <span className="font-mono text-sm text-yellow-400">{key}</span>
                <span className="text-zinc-200 font-mono text-sm">= {String(rule.valueMm)}{typeof rule.valueMm === "number" ? " mm" : ""}</span>
              </div>
              <div className="text-xs text-zinc-300 mb-1">applies to: <span className="text-zinc-100">{rule.appliesTo}</span></div>
              <div className="text-xs text-zinc-400">{rule.note}</div>
            </div>
          ))}
        </div>
      )}

      <footer className="mt-12 text-xs text-zinc-500 border-t border-zinc-900 pt-4">
        <p>Source of truth: <code>hytek-rfy-codec/src/rules/table.ts</code> + <code>hytek-rfy-codec/src/rules/frame-context.ts</code> + <code>hytek-rfy-tools/lib/framecad-import.ts</code>.</p>
        <p className="mt-1">When you change a rule in code, this view updates on the next deploy. Editing in this UI (with persistence to a database) is Phase 2.</p>
      </footer>
    </main>
  );
}
