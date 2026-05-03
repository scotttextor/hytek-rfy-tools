// Sidebar — frame list (left) and selected-stick property panel (right
// when a stick is selected). Phase 0 only renders the frame list; the
// stick panel arrives in Phase 1 alongside the rendering.

"use client";
import { useViewerStore } from "../store";

export function Sidebar() {
  const doc = useViewerStore((s) => s.doc);
  const selectedPlanIdx = useViewerStore((s) => s.selectedPlanIdx);
  const selectedFrameIdx = useViewerStore((s) => s.selectedFrameIdx);
  const selectPlan = useViewerStore((s) => s.selectPlan);
  const selectFrame = useViewerStore((s) => s.selectFrame);

  if (!doc) {
    return (
      <aside className="w-72 shrink-0 border-r border-zinc-800 p-4 text-sm text-zinc-500">
        Drop a <code className="text-yellow-400">.rfy</code> or <code className="text-yellow-400">.xml</code> file
        on the canvas to load a job.
      </aside>
    );
  }

  const plans = doc.project.plans;
  const currentPlan = plans[selectedPlanIdx];
  const frames = currentPlan?.frames ?? [];

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto">
      <div className="p-4 border-b border-zinc-800">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Project</div>
        <div className="text-sm font-medium text-zinc-200">{doc.project.name}</div>
        <div className="text-xs text-zinc-500 mt-1">{doc.project.jobNum}</div>
      </div>

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

      <div className="p-4">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
          Frames ({frames.length})
        </div>
        <ul className="space-y-1">
          {frames.map((f, i) => (
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
                  {f.sticks.length} sticks
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
