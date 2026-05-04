// Legend — visual key showing the colour assigned to each tool-op type.
//
// Lives in the sidebar so users can:
//   1. Identify what each colored ring on the canvas means
//   2. See the CSV label for each op (BOLT HOLES vs ANCHOR vs SERVICE HOLE)
//   3. Read a one-line description of what the operation does physically
//
// Sticky at the bottom of the sidebar (collapsed by default to save
// vertical space — click the header to expand).

"use client";
import { useState } from "react";
import { TOOL_COLORS, ALL_TOOL_TYPES } from "../lib/tool-colors";

export function Legend() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 text-xs">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full px-4 py-2 text-left flex items-center justify-between hover:bg-zinc-900 transition"
      >
        <span className="text-xs uppercase tracking-wider text-yellow-400 font-medium">
          Tool legend
        </span>
        <span className="text-zinc-500">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-1 max-h-[40vh] overflow-y-auto">
          {ALL_TOOL_TYPES.map(t => {
            const meta = TOOL_COLORS[t];
            return (
              <div key={t} className="flex items-start gap-2 py-1 border-b border-zinc-900 last:border-0">
                <span
                  className="inline-block w-4 h-4 rounded-sm flex-shrink-0 mt-0.5 border border-zinc-700"
                  style={{ backgroundColor: meta.color }}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-zinc-200">{t}</span>
                    <span className="text-[10px] text-zinc-500 font-mono whitespace-nowrap">
                      {meta.csvLabel}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500 leading-tight">
                    {meta.description}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="pt-2 mt-2 text-[10px] text-zinc-600 leading-tight">
            Each colored ring around a marker on the canvas indicates the
            tool type. The realistic shape inside the ring shows what the
            cut/punch actually looks like physically.
          </div>
        </div>
      )}
    </div>
  );
}
