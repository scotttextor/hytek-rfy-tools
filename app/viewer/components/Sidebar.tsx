// Sidebar — left panel.
//
// Top half: project / plan dropdown / frame list.
// Bottom half (when a stick is selected): stick property panel showing
//   profile, dimensions, full op list, role, orientation.

"use client";
import { useViewerStore } from "../store";
import { frameSummary, docSummary } from "../lib/geometry";

export function Sidebar() {
  const doc = useViewerStore((s) => s.doc);
  const selectedPlanIdx = useViewerStore((s) => s.selectedPlanIdx);
  const selectedFrameIdx = useViewerStore((s) => s.selectedFrameIdx);
  const selectPlan = useViewerStore((s) => s.selectPlan);
  const selectFrame = useViewerStore((s) => s.selectFrame);

  if (!doc) {
    return (
      <aside className="w-72 shrink-0 border-r border-zinc-800 p-4 text-sm text-zinc-500">
        Drop a <code className="text-yellow-400">.rfy</code> file on the canvas to load a job.
      </aside>
    );
  }

  const plans = doc.project.plans;
  const currentPlan = plans[selectedPlanIdx];
  const frames = currentPlan?.frames ?? [];
  // Selected-stick UI lives in StickInspector (separate panel beside this
  // one) — Sidebar only has frames + plan list now.
  const ds = docSummary(doc);

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto flex flex-col">
      {/* Project header */}
      <div className="p-4 border-b border-zinc-800">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Project</div>
        <div className="text-sm font-medium text-zinc-200 truncate" title={doc.project.name}>
          {doc.project.name}
        </div>
        <div className="text-xs text-zinc-500 mt-1">
          {doc.project.jobNum} · {ds.frames} frames · {ds.sticks} sticks · {ds.ops} ops
        </div>
      </div>

      {/* Plan selector */}
      {plans.length > 1 && (
        <div className="p-4 border-b border-zinc-800">
          <label className="text-xs uppercase tracking-wider text-zinc-500 block mb-2">Plan</label>
          <select
            value={selectedPlanIdx}
            onChange={(e) => selectPlan(Number(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
          >
            {plans.map((p, i) => (
              <option key={i} value={i}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Frame list */}
      <div className="p-4 border-b border-zinc-800 flex-1 min-h-0 overflow-y-auto">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
          Frames ({frames.length})
        </div>
        <ul className="space-y-1">
          {frames.map((f, i) => {
            const summary = frameSummary(f);
            return (
              <li key={i}>
                <button
                  onClick={() => selectFrame(i)}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm transition ${
                    i === selectedFrameIdx
                      ? "bg-yellow-400 text-black font-medium"
                      : "text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <span className="font-mono">{f.name}</span>
                  <span className={`ml-2 text-xs ${i === selectedFrameIdx ? "text-zinc-700" : "text-zinc-500"}`}>
                    {summary.stickCount}s · {summary.opCount}o
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

    </aside>
  );
}
