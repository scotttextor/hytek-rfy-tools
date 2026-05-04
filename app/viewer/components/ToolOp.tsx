// ToolOp — renders a single tool operation as its actual physical shape.
//
// The shape is drawn in the stick's LOCAL frame (origin at midline-start,
// x axis along length, y axis perpendicular through web). The parent
// Stick component handles the rotation/translation into elevation
// space.
//
// Op shapes follow the design spec (docs/superpowers/specs/2026-05-03):
//   InnerDimple        small dome circle
//   Swage              oval bump
//   LipNotch           V-cuts in both lips
//   InnerNotch         rectangular notch in web
//   Web (BOLT HOLES)   small hole through web
//   Bolt (ANCHOR)      bigger hole with darker ring (anchor bolt)
//   InnerService       oval slot
//   Chamfer            triangular corner cut
//   ScrewHoles         three small holes
//   Left/RightFlange   single-side V-cut
//   Left/RightPartial  half-depth V-cut

"use client";
import type { ToolType } from "@hytek/rfy-codec";
import { TOOL_COLORS } from "../lib/tool-colors";

interface ToolOpProps {
  type: ToolType;
  /** Position along stick length (mm from start) */
  pos: number;
  /** Stick thickness (mm — distance from web-front to web-back in the elevation rendering) */
  thickness: number;
}

export function ToolOp({ type, pos, thickness }: ToolOpProps) {
  const half = thickness / 2;
  // Colored outline ring per tool type — overlaid on the realistic shape so
  // users can identify the operation at a glance. See app/viewer/lib/tool-colors.ts
  // for the palette + Legend component for the visual key.
  const ring = TOOL_COLORS[type]?.color ?? "#888";
  const ringW = 1.0;

  switch (type) {
    case "InnerDimple":
      return (
        <g transform={`translate(${pos} ${half})`}>
          <circle r={3} fill="#666" stroke={ring} strokeWidth={ringW} />
          <circle r={1.5} cy={-0.5} fill="#bbb" />
        </g>
      );

    case "Swage":
      return (
        <g transform={`translate(${pos} ${half})`}>
          <ellipse rx={14} ry={6} fill="#999" stroke={ring} strokeWidth={ringW} />
          <ellipse rx={9} ry={3} cy={-1.5} fill="#cccccc" />
        </g>
      );

    case "LipNotch":
      // V-cut in both lips (top and bottom edges of the elevation rect)
      return (
        <g transform={`translate(${pos} 0)`}>
          <path d={`M -10,0 L 10,5 L 10,12 L -10,14 Z`} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
          <path
            d={`M -10,${thickness} L 10,${thickness - 5} L 10,${thickness - 12} L -10,${thickness - 14} Z`}
            fill="#0a0a0a" stroke={ring} strokeWidth={ringW}
          />
        </g>
      );

    case "LeftFlange":
      return (
        <g transform={`translate(${pos} 0)`}>
          <path d={`M -10,0 L 10,5 L 10,12 L -10,14 Z`} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
        </g>
      );

    case "RightFlange":
      return (
        <g transform={`translate(${pos} 0)`}>
          <path
            d={`M -10,${thickness} L 10,${thickness - 5} L 10,${thickness - 12} L -10,${thickness - 14} Z`}
            fill="#0a0a0a" stroke={ring} strokeWidth={ringW}
          />
        </g>
      );

    case "LeftPartialFlange":
      return (
        <g transform={`translate(${pos} 0)`}>
          <path d={`M -8,0 L 8,3 L 8,8 L -8,9 Z`} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
        </g>
      );

    case "RightPartialFlange":
      return (
        <g transform={`translate(${pos} 0)`}>
          <path
            d={`M -8,${thickness} L 8,${thickness - 3} L 8,${thickness - 8} L -8,${thickness - 9} Z`}
            fill="#0a0a0a" stroke={ring} strokeWidth={ringW}
          />
        </g>
      );

    case "InnerNotch":
      return (
        <g transform={`translate(${pos} ${half})`}>
          <rect x={-8} y={-6} width={16} height={12} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
        </g>
      );

    case "Web":
      // BOLT HOLES — straight hole through the web
      return (
        <g transform={`translate(${pos} ${half})`}>
          <circle r={4} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
        </g>
      );

    case "Bolt":
      // ANCHOR — bigger hole with darker inner ring
      return (
        <g transform={`translate(${pos} ${half})`}>
          <circle r={6} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
          <circle r={3} fill="#1a1a1a" />
        </g>
      );

    case "ScrewHoles":
      // Cluster of three small holes
      return (
        <g transform={`translate(${pos} ${half})`}>
          <circle cx={-8} r={2.5} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
          <circle cx={0} r={2.5} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
          <circle cx={8} r={2.5} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
        </g>
      );

    case "InnerService":
      // Oval slot for cables/pipes
      return (
        <g transform={`translate(${pos} ${half})`}>
          <ellipse rx={10} ry={5} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
        </g>
      );

    case "Chamfer":
    case "TrussChamfer": {
      // Triangular corner cut. pos < 0 means at start; pos near
      // stick-length means at end. We render at the local pos with a
      // simple triangle shape — proper shape depends on stick-end
      // direction which is handled by the caller positioning.
      return (
        <g transform={`translate(${pos} 0)`}>
          <path d={`M -6,0 L 6,0 L 6,6 Z`} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
          <path d={`M -6,${thickness} L 6,${thickness} L 6,${thickness - 6} Z`} fill="#0a0a0a" stroke={ring} strokeWidth={ringW} />
        </g>
      );
    }

    default:
      // Unknown op type — fall back to a magenta marker so missed
      // shapes are immediately visible during debugging.
      return (
        <g transform={`translate(${pos} ${half})`}>
          <circle r={3} fill="#ff00ff" />
        </g>
      );
  }
}
