// Stick — renders a single stick as a real-world steel section in
// elevation view. The stick is drawn in its OWN local coordinate frame
// (origin at midline-start, +x along length, +y across width) and then
// transformed into elevation-space via translate+rotate.
//
// Visual layers (bottom to top):
//   1. Stick body — filled rect with steel gradient (id="steel")
//   2. Flange shadow — thin rect overlay on the +y edge showing C-section depth
//   3. Tool ops — each rendered by <ToolOp> at its position along length

"use client";
import type { RfyStick } from "@hytek/rfy-codec";
import { stickMidline, renderedOpsFor } from "../lib/geometry";
import { ToolOp } from "./ToolOp";

interface StickProps {
  stick: RfyStick;
  stickKey: string;
  selected: boolean;
  onSelect: (key: string) => void;
}

export function Stick({ stick, stickKey, selected, onSelect }: StickProps) {
  const m = stickMidline(stick);
  if (!m) return null;

  const length = m.length;
  // Visual thickness of the stick in the elevation drawing — derived
  // from the outline's short-edge length so it matches the actual data.
  // Clamped to a minimum so very thin profiles still show as a visible
  // band on screen.
  const thickness = Math.max(20, m.thickness);

  // Transform: place the local-frame origin at midline.start, rotate
  // the local +x axis to align with the midline direction, and shift
  // the rect up by half-thickness so the midline runs through the
  // centre of the rect.
  const angleDeg = (m.angle * 180) / Math.PI;
  const transform = `translate(${m.start.x} ${m.start.y}) rotate(${angleDeg}) translate(0 ${-thickness / 2})`;

  const ops = renderedOpsFor(stick);

  return (
    <g
      transform={transform}
      onClick={(e) => { e.stopPropagation(); onSelect(stickKey); }}
      style={{ cursor: "pointer" }}
    >
      {/* Stick body — steel gradient */}
      <rect
        x={0}
        y={0}
        width={length}
        height={thickness}
        fill="url(#steel)"
        stroke={selected ? "#FFCB05" : "#444"}
        strokeWidth={selected ? 2 : 0.6}
      />
      {/* Flange shadow — thin band along the bottom (+y) edge giving the
          C-section a sense of depth. The gradient runs left→right so the
          start end looks darker (interior corner). */}
      <rect
        x={0}
        y={thickness - 4}
        width={length}
        height={4}
        fill="url(#flangeShadow)"
        opacity={0.85}
      />
      {/* Tool ops — rendered in local-frame; ToolOp does the per-type shape */}
      {ops.map((op, i) => (
        <ToolOp key={i} type={op.type} pos={op.pos} thickness={thickness} />
      ))}
    </g>
  );
}
