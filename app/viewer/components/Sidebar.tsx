// Sidebar — left panel.
//
// Top half: project / plan dropdown / frame list.
// Bottom half (when a stick is selected): stick property panel showing
//   profile, dimensions, full op list, role, orientation.

"use client";
import { useState } from "react";
import { useViewerStore } from "../store";
import { frameSummary, docSummary } from "../lib/geometry";
import { AddOpDialog } from "./AddOpDialog";
import type { RfyToolingOp } from "@hytek/rfy-codec";

function opLabel(op: RfyToolingOp, stickLength: number): string {
  switch (op.kind) {
    case "point":   return `${op.type} @ ${op.pos.toFixed(1)}`;
    case "spanned": return `${op.type} [${op.startPos.toFixed(1)}..${op.endPos.toFixed(1)}]`;
    case "start":   return `${op.type} @ start`;
    case "end":     return `${op.type} @ end (${stickLength.toFixed(1)})`;
  }
}

export function Sidebar() {
  const doc = useViewerStore((s) => s.doc);
  const selectedPlanIdx = useViewerStore((s) => s.selectedPlanIdx);
  const selectedFrameIdx = useViewerStore((s) => s.selectedFrameIdx);
  const selectedStickKey = useViewerStore((s) => s.selectedStickKey);
  const selectPlan = useViewerStore((s) => s.selectPlan);
  const selectFrame = useViewerStore((s) => s.selectFrame);
  const selectStick = useViewerStore((s) => s.selectStick);
  const removeOp = useViewerStore((s) => s.removeOp);
  const [showAddOp, setShowAddOp] = useState(false);

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
  const currentFrame = frames[selectedFrameIdx];

  // Resolve the selected stick (key format: "<frameIdx>-<stickIdx>")
  let selectedStick = null;
  let selectedStickIdx = -1;
  if (selectedStickKey && currentFrame) {
    const [, stickIdxStr] = selectedStickKey.split("-");
    selectedStickIdx = parseInt(stickIdxStr, 10);
    selectedStick = currentFrame.sticks[selectedStickIdx] ?? null;
  }

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

      {/* Selected-stick panel */}
      {selectedStick && (
        <div className="border-t-2 border-yellow-400/60 bg-zinc-950 max-h-[50vh] overflow-y-auto">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-yellow-400">Selected stick</div>
              <div className="font-mono text-sm text-zinc-100 mt-0.5">
                {currentFrame?.name}-{selectedStick.name}
              </div>
            </div>
            <button
              onClick={() => selectStick(null)}
              className="text-zinc-500 hover:text-zinc-200 text-sm"
              aria-label="Deselect"
            >
              ✕
            </button>
          </div>

          <div className="px-4 py-3 border-b border-zinc-800">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <span className="text-zinc-500">Type</span>
              <span className="text-zinc-200">{selectedStick.type}</span>
              <span className="text-zinc-500">Length</span>
              <span className="text-zinc-200 font-mono">{selectedStick.length.toFixed(1)} mm</span>
              <span className="text-zinc-500">Profile</span>
              <span className="text-zinc-200">{selectedStick.profile.metricLabel}</span>
              <span className="text-zinc-500">Gauge</span>
              <span className="text-zinc-200 font-mono">{selectedStick.profile.gauge} mm</span>
              <span className="text-zinc-500">Orientation</span>
              <span className="text-zinc-200">{selectedStick.flipped ? "RIGHT" : "LEFT"}</span>
              {selectedStick.usage && (
                <>
                  <span className="text-zinc-500">Usage</span>
                  <span className="text-zinc-200">{selectedStick.usage}</span>
                </>
              )}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-zinc-500">
                Tool ops ({selectedStick.tooling.length})
              </div>
              <button
                onClick={() => setShowAddOp(true)}
                className="text-xs px-2 py-1 rounded bg-yellow-400 text-black font-medium hover:bg-yellow-300 transition"
              >
                + Add op
              </button>
            </div>
            <ul className="space-y-1 text-xs font-mono">
              {selectedStick.tooling.map((op, i) => (
                <li
                  key={i}
                  className="text-zinc-300 px-2 py-1 rounded hover:bg-zinc-900 flex items-center justify-between gap-2 group"
                >
                  <span>{opLabel(op, selectedStick.length)}</span>
                  <button
                    onClick={() => selectedStickKey && removeOp(selectedStickKey, i)}
                    className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                    aria-label="Delete op"
                    title="Delete this op"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {showAddOp && selectedStickKey && (
            <AddOpDialog
              stickKey={selectedStickKey}
              stickLength={selectedStick.length}
              onClose={() => setShowAddOp(false)}
            />
          )}
        </div>
      )}
    </aside>
  );
}
