// AddOpDialog — lightweight modal for choosing a tool op type to add
// to the currently-selected stick. Shown by Sidebar's "+ Add tool op"
// button.
//
// Picks a sensible default position and span for the chosen type via
// defaultOpForType() and dispatches store.addOp().

"use client";
import { useState } from "react";
import { useViewerStore } from "../store";
import { defaultOpForType } from "../lib/edits";
import type { ToolType } from "@hytek/rfy-codec";

const ALL_OP_TYPES: ToolType[] = [
  "InnerDimple", "Swage", "LipNotch", "InnerNotch", "InnerService",
  "Web", "Bolt", "ScrewHoles", "Chamfer", "TrussChamfer",
  "LeftFlange", "RightFlange", "LeftPartialFlange", "RightPartialFlange",
];

interface AddOpDialogProps {
  stickKey: string;
  stickLength: number;
  onClose: () => void;
}

export function AddOpDialog({ stickKey, stickLength, onClose }: AddOpDialogProps) {
  const addOp = useViewerStore((s) => s.addOp);
  const [type, setType] = useState<ToolType>("InnerDimple");
  const [posStr, setPosStr] = useState((stickLength / 2).toFixed(1));

  function commit() {
    const pos = parseFloat(posStr);
    if (Number.isNaN(pos)) return;
    const op = defaultOpForType(type, pos, stickLength);
    addOp(stickKey, op);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-yellow-400/40 rounded-lg w-96 p-6 text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">
          Add tool op <span className="text-yellow-400">·</span> {stickKey}
        </h2>
        <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ToolType)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm mb-4"
        >
          {ALL_OP_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">
          Position (mm from start, stick length: {stickLength.toFixed(1)})
        </label>
        <input
          type="number"
          step="0.1"
          value={posStr}
          onChange={(e) => setPosStr(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm mb-6 font-mono"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-sm hover:border-zinc-500 transition"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="px-3 py-1.5 rounded bg-yellow-400 text-black text-sm font-medium hover:bg-yellow-300 transition"
          >
            Add op
          </button>
        </div>
      </div>
    </div>
  );
}
