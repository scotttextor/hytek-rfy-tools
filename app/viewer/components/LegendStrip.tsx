// LegendStrip — horizontal one-row legend that sits between the page
// header and the sidebar+canvas. Always visible, gives quick visual key
// to every tool-op type and its color.
//
// Hover any chip → tooltip with the description.
//
// Hosts the page header's tool-op vocabulary so it's always at hand
// regardless of what's selected on the canvas. Distinct from the
// collapsible Legend in the sidebar (which shows the same colors but
// with full multi-line descriptions and CSV labels).

"use client";
import { TOOL_COLORS, ALL_TOOL_TYPES } from "../lib/tool-colors";

export function LegendStrip() {
  return (
    <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/60 flex items-center gap-x-4 gap-y-1.5 text-xs flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-yellow-400 font-medium pr-2 border-r border-zinc-800">
        Tool legend
      </span>
      {ALL_TOOL_TYPES.map((t) => {
        const meta = TOOL_COLORS[t];
        return (
          <div
            key={t}
            className="flex items-center gap-1.5 cursor-help"
            title={`${t} (${meta.csvLabel})\n${meta.description}`}
          >
            <span
              className="inline-block w-3 h-3 rounded-sm border border-zinc-700 flex-shrink-0"
              style={{ backgroundColor: meta.color }}
              aria-hidden
            />
            <span className="text-zinc-200 font-medium">{t}</span>
            <span className="text-zinc-500 font-mono text-[10px] hidden md:inline">
              {meta.csvLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
