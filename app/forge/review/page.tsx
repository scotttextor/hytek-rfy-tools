// Forge operator-review UI — drop XML, see codec ops per stick with
// confidence scores derived from the 66K-record truth corpus.
//
// Use case: post-Detailer-EOL world. Estimating produces an XML, codec
// produces an RFY, but the codec is at ~75% parity. Operator drops the
// XML here, scans red-flagged sticks first, edits any genuinely-wrong ops
// (manual override route TBD), then downloads the approved RFY for the
// rollformer.
"use client";

import { useState } from "react";

type Confidence = "high" | "medium" | "low" | "unknown";

interface Stick {
  name: string;
  length: number;
  profile: string;
  role: string;
  tooling: any[];
  confidence: Confidence;
  reasons: string[];
  bucket: string;
  bucket_count: number;
}

interface FrameOut {
  plan_name: string;
  name: string;
  sticks: Stick[];
}

interface ReviewResponse {
  jobnum: string;
  project_name: string;
  counts: Record<Confidence, number>;
  total_sticks: number;
  frames: FrameOut[];
  rfy_base64: string;
  rfy_size: number;
}

function confColor(c: Confidence): string {
  switch (c) {
    case "high": return "bg-green-900/30 border-green-500 text-green-300";
    case "medium": return "bg-yellow-900/30 border-yellow-500 text-yellow-200";
    case "low": return "bg-red-900/30 border-red-500 text-red-200";
    default: return "bg-zinc-800 border-zinc-600 text-zinc-300";
  }
}

function opSummary(ops: any[]): string {
  if (!ops || ops.length === 0) return "(no ops)";
  const counts: Record<string, number> = {};
  for (const op of ops) counts[op.type] = (counts[op.type] || 0) + 1;
  return Object.entries(counts).map(([t, c]) => `${t}×${c}`).join(", ");
}

export default function ForgeReviewPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [filterConf, setFilterConf] = useState<Confidence | "all">("all");

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setData(null);
    setFilename(file.name);
    try {
      const text = await file.text();
      const r = await fetch("/api/forge/review", { method: "POST", body: text });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Server: ${t.slice(0, 300)}`);
      }
      const json: ReviewResponse = await r.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadRfy() {
    if (!data) return;
    const bytes = Uint8Array.from(atob(data.rfy_base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (filename ?? "review").replace(/\.xml$/i, "") + ".rfy";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-black text-zinc-100 p-6 font-mono">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-yellow-400">Forge — Operator Review</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Drop a FrameCAD <code>&lt;framecad_import&gt;</code> XML. The codec runs and
          each stick is scored against the 66,262-record historical corpus.
          Red sticks deviate ≥2σ from typical or are missing common op types —
          review these manually before sending the RFY to the rollformer.
        </p>
      </header>

      <section
        className={`border-2 border-dashed border-zinc-600 rounded-xl p-8 mb-6 cursor-pointer hover:border-yellow-400 transition-colors ${busy ? "opacity-50" : ""}`}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onClick={() => document.getElementById("forge-review-input")?.click()}
      >
        <input
          id="forge-review-input"
          type="file"
          accept=".xml"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <div className="text-center text-zinc-400">
          {busy ? "Running codec + scoring…" : filename ? `Loaded: ${filename}` : "Click or drop a .xml file"}
        </div>
      </section>

      {error && (
        <div className="mb-6 p-4 border border-red-500 bg-red-900/30 rounded text-red-200">
          {error}
        </div>
      )}

      {data && (
        <>
          <section className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
            <div className="p-3 rounded bg-zinc-800">
              <div className="text-zinc-400 text-xs">JOB</div>
              <div className="font-bold text-lg">{data.jobnum}</div>
            </div>
            <div className="p-3 rounded bg-zinc-800">
              <div className="text-zinc-400 text-xs">TOTAL STICKS</div>
              <div className="font-bold text-lg">{data.total_sticks}</div>
            </div>
            <div className="p-3 rounded bg-green-900/30 border border-green-500">
              <div className="text-green-300 text-xs">HIGH</div>
              <div className="font-bold text-lg">{data.counts.high}</div>
            </div>
            <div className="p-3 rounded bg-yellow-900/30 border border-yellow-500">
              <div className="text-yellow-200 text-xs">MEDIUM</div>
              <div className="font-bold text-lg">{data.counts.medium}</div>
            </div>
            <div className="p-3 rounded bg-red-900/30 border border-red-500">
              <div className="text-red-200 text-xs">LOW (REVIEW)</div>
              <div className="font-bold text-lg">{data.counts.low}</div>
            </div>
          </section>

          <section className="mb-4 flex items-center justify-between">
            <div className="text-sm">
              Show:{" "}
              {(["all", "low", "medium", "high", "unknown"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setFilterConf(c)}
                  className={`mx-1 px-3 py-1 text-xs rounded ${
                    filterConf === c ? "bg-yellow-400 text-black font-bold" : "bg-zinc-800 hover:bg-zinc-700"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              onClick={downloadRfy}
              className="px-4 py-2 bg-yellow-400 text-black font-bold rounded hover:bg-yellow-300"
            >
              Download RFY ({(data.rfy_size / 1024).toFixed(1)} kB)
            </button>
          </section>

          <section className="space-y-4">
            {data.frames.map((f) => {
              const visible = filterConf === "all"
                ? f.sticks
                : f.sticks.filter((s) => s.confidence === filterConf);
              if (visible.length === 0) return null;
              return (
                <div key={`${f.plan_name}-${f.name}`} className="border border-zinc-700 rounded">
                  <div className="bg-zinc-800 px-3 py-2 text-xs font-bold">
                    {f.plan_name} / {f.name}
                  </div>
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-900 text-zinc-400">
                      <tr>
                        <th className="text-left px-2 py-1">Stick</th>
                        <th className="text-left px-2 py-1">Role</th>
                        <th className="text-right px-2 py-1">Length</th>
                        <th className="text-left px-2 py-1">Profile</th>
                        <th className="text-left px-2 py-1">Ops</th>
                        <th className="text-left px-2 py-1">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((s) => (
                        <tr key={s.name} className={`border-t border-zinc-800 ${confColor(s.confidence)}`}>
                          <td className="px-2 py-1 font-bold">{s.name}</td>
                          <td className="px-2 py-1">{s.role}</td>
                          <td className="px-2 py-1 text-right">{s.length.toFixed(0)}</td>
                          <td className="px-2 py-1">{s.profile}</td>
                          <td className="px-2 py-1">{opSummary(s.tooling)}</td>
                          <td className="px-2 py-1">
                            <div className="font-bold">{s.confidence.toUpperCase()}</div>
                            {s.reasons.length > 0 && (
                              <div className="text-[10px] opacity-80 mt-0.5">{s.reasons.join("; ")}</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
