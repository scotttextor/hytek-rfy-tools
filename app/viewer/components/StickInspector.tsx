// StickInspector — separate panel that shows the selected stick's
// properties + ordered op list. Mounts BESIDE the frames sidebar
// (not below it) so the user can browse frames AND inspect a stick
// at the same time without scrolling between them.
//
// Only renders when a stick is selected; the panel is invisible
// otherwise so the canvas gets the full remaining width.

"use client";
import { useState } from "react";
import { useViewerStore } from "../store";
import { AddOpDialog } from "./AddOpDialog";
import { TOOL_COLORS } from "../lib/tool-colors";
import type { RfyToolingOp } from "@hytek/rfy-codec";

function opLabel(op: RfyToolingOp, stickLength: number): string {
  switch (op.kind) {
    case "point":   return `${op.type} @ ${op.pos.toFixed(1)}`;
    case "spanned": return `${op.type} [${op.startPos.toFixed(1)}..${op.endPos.toFixed(1)}]`;
    case "start":   return `${op.type} @ start`;
    case "end":     return `${op.type} @ end (${stickLength.toFixed(1)})`;
  }
}

export function StickInspector() {
  const doc = useViewerStore((s) => s.doc);
  const selectedPlanIdx = useViewerStore((s) => s.selectedPlanIdx);
  const selectedFrameIdx = useViewerStore((s) => s.selectedFrameIdx);
  const selectedStickKey = useViewerStore((s) => s.selectedStickKey);
  const selectStick = useViewerStore((s) => s.selectStick);
  const removeOp = useViewerStore((s) => s.removeOp);
  const [showAddOp, setShowAddOp] = useState(false);

  if (!doc || !selectedStickKey) return null;

  const currentFrame = doc.project.plans[selectedPlanIdx]?.frames[selectedFrameIdx];
  if (!currentFrame) return null;
  const [, stickIdxStr] = selectedStickKey.split("-");
  const stickIdx = parseInt(stickIdxStr ?? "", 10);
  if (Number.isNaN(stickIdx)) return null;
  const selectedStick = currentFrame.sticks[stickIdx];
  if (!selectedStick) return null;

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header — yellow accent + close button */}
      <div className="px-4 py-3 border-b-2 border-yellow-400/60 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-yellow-400">Selected stick</div>
          <div className="font-mono text-sm text-zinc-100 mt-0.5">
            {currentFrame.name}-{selectedStick.name}
          </div>
        </div>
        <button
          onClick={() => selectStick(null)}
          className="text-zinc-500 hover:text-zinc-200 text-sm"
          aria-label="Deselect"
          title="Close (deselect stick)"
        >
          ✕
        </button>
      </div>

      {/* Property grid */}
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

      {/* Ops list — scrollable, fills remaining vertical space */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
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
        <ul className="space-y-1 text-xs font-mono px-4 pb-3 overflow-y-auto flex-1 min-h-0">
          {selectedStick.tooling.map((op, i) => {
            const meta = TOOL_COLORS[op.type];
            return (
              <li
                key={i}
                className="text-zinc-300 px-2 py-1 rounded hover:bg-zinc-900 flex items-center justify-between gap-2 group"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0 border border-zinc-700"
                    style={{ backgroundColor: meta?.color ?? "#888" }}
                    aria-hidden
                  />
                  <span className="truncate">{opLabel(op, selectedStick.length)}</span>
                </span>
                <button
                  onClick={() => removeOp(selectedStickKey, i)}
                  className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition flex-shrink-0"
                  aria-label="Delete op"
                  title="Delete this op"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {showAddOp && (
        <AddOpDialog
          stickKey={selectedStickKey}
          stickLength={selectedStick.length}
          onClose={() => setShowAddOp(false)}
        />
      )}
    </aside>
  );
}
