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
  /** Transient drag offset (mm in elevation coords). Applied on top of the
   *  stick's persisted outlineCorners during an active drag. Wall.tsx sets
   *  this to non-zero while dragging; the persisted edit happens on
   *  pointerup via store.moveStick. */
  dragOffset?: { dx: number; dy: number } | null;
  /** Pointer-down handlers passed in from Wall — body for move-drag,
   *  per-end handles for endpoint-drag. */
  onBodyPointerDown?: (e: React.PointerEvent, stickKey: string) => void;
  onEndPointerDown?: (e: React.PointerEvent, stickKey: string, endIdx: 0 | 1) => void;
}

export function Stick({ stick, stickKey, selected, onSelect, dragOffset, onBodyPointerDown, onEndPointerDown }: StickProps) {
  const m = stickMidline(stick);
  if (!m) return null;

  const length = m.length;
  const thickness = Math.max(20, m.thickness);

  const angleDeg = (m.angle * 180) / Math.PI;
  const tx = (dragOffset?.dx ?? 0);
  const ty = (dragOffset?.dy ?? 0);
  const transform = `translate(${m.start.x + tx} ${m.start.y + ty}) rotate(${angleDeg}) translate(0 ${-thickness / 2})`;

  const ops = renderedOpsFor(stick);

  return (
    <g
      transform={transform}
      style={{ cursor: selected ? "move" : "pointer" }}
    >
      {/* Stick body — steel gradient. Click selects; drag (when selected) moves. */}
      <rect
        x={0}
        y={0}
        width={length}
        height={thickness}
        fill="url(#steel)"
        stroke={selected ? "#FFCB05" : "#444"}
        strokeWidth={selected ? 2 : 0.6}
        onClick={(e) => { e.stopPropagation(); onSelect(stickKey); }}
        onPointerDown={(e) => { if (selected && onBodyPointerDown) onBodyPointerDown(e, stickKey); }}
      />
      <rect
        x={0}
        y={thickness - 4}
        width={length}
        height={4}
        fill="url(#flangeShadow)"
        opacity={0.85}
        pointerEvents="none"
      />
      {ops.map((op, i) => (
        <ToolOp key={i} type={op.type} pos={op.pos} thickness={thickness} />
      ))}
      {/* Endpoint resize handles — only on the selected stick. Drag to
          resize / re-orient the stick. */}
      {selected && onEndPointerDown && (
        <>
          <circle
            cx={0}
            cy={thickness / 2}
            r={8}
            fill="#FFCB05"
            stroke="#231F20"
            strokeWidth={1.5}
            style={{ cursor: "ew-resize" }}
            onPointerDown={(e) => { e.stopPropagation(); onEndPointerDown(e, stickKey, 0); }}
          />
          <circle
            cx={length}
            cy={thickness / 2}
            r={8}
            fill="#FFCB05"
            stroke="#231F20"
            strokeWidth={1.5}
            style={{ cursor: "ew-resize" }}
            onPointerDown={(e) => { e.stopPropagation(); onEndPointerDown(e, stickKey, 1); }}
          />
        </>
      )}
    </g>
  );
}
