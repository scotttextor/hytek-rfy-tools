// LegendStrip — horizontal one-row legend that sits between the page
// header and the sidebar+canvas. Always visible, gives quick visual key
// to every tool-op type — showing the ACTUAL shape (rendered via the
// ToolOp component on a mini stick segment) with its colored outline
// ring + the type name + CSV label.
//
// Hover any chip → tooltip with the description.

"use client";
import { TOOL_COLORS, ALL_TOOL_TYPES } from "../lib/tool-colors";
import { ToolOp } from "./ToolOp";
import type { ToolType } from "@hytek/rfy-codec";

const CHIP_W = 60;
const CHIP_THICKNESS = 20;
// Padding above/below the stick so LipNotch V-cuts (which extend up to
// 14mm beyond the stick edges) don't get clipped.
const VPAD = 16;

function ToolChip({ type }: { type: ToolType }) {
  const meta = TOOL_COLORS[type];
  return (
    <div className="flex items-center gap-1.5 cursor-help" title={`${type} (${meta.csvLabel})\n${meta.description}`}>
      <svg
        width={CHIP_W}
        height={CHIP_THICKNESS + VPAD * 2}
        viewBox={`0 ${-VPAD} ${CHIP_W} ${CHIP_THICKNESS + VPAD * 2}`}
        className="flex-shrink-0"
      >
        <defs>
          <linearGradient id={`mini-steel-${type}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#dcdce4" />
            <stop offset="40%" stopColor="#a8a8b0" />
            <stop offset="100%" stopColor="#7a7a82" />
          </linearGradient>
          <linearGradient id={`mini-flangeShadow-${type}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#3a3a40" />
            <stop offset="100%" stopColor="#6a6a72" />
          </linearGradient>
        </defs>
        {/* Mini stick segment — full chip width, fixed thickness */}
        <rect x={0} y={0} width={CHIP_W} height={CHIP_THICKNESS} fill={`url(#mini-steel-${type})`} stroke="#444" strokeWidth={0.4} />
        <rect x={0} y={CHIP_THICKNESS - 4} width={CHIP_W} height={4} fill={`url(#mini-flangeShadow-${type})`} opacity={0.85} />
        {/* The tool op itself, centered at pos = chip_width / 2 */}
        <ToolOp type={type} pos={CHIP_W / 2} thickness={CHIP_THICKNESS} />
      </svg>
      <span className="text-zinc-200 font-medium leading-tight">{type}</span>
      <span className="text-zinc-500 font-mono text-[10px] hidden lg:inline leading-tight">
        {meta.csvLabel}
      </span>
    </div>
  );
}

export function LegendStrip() {
  return (
    <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/60 flex items-center gap-x-5 gap-y-2 text-xs flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-yellow-400 font-medium pr-2 border-r border-zinc-800 self-stretch flex items-center">
        Tool legend
      </span>
      {ALL_TOOL_TYPES.map((t) => (
        <ToolChip key={t} type={t} />
      ))}
    </div>
  );
}
