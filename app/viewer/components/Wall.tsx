// Wall — the SVG canvas for one frame.
//
// Auto-fits the frame to the viewport on load. Pan: drag empty area.
// Zoom: mouse wheel (centred on cursor). Selection: click a stick.
//
// Pan/zoom is implemented as a viewBox transform — no CSS scale, so
// stroke widths stay crisp at any zoom level.

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useViewerStore } from "../store";
import { Stick } from "./Stick";
import { frameBBox, padBBox } from "../lib/geometry";

interface ActiveDrag {
  kind: "stick-body" | "stick-end";
  stickKey: string;
  endIdx?: 0 | 1;
  /** Pointer screen coords at drag-start. */
  startClientX: number;
  startClientY: number;
  /** Live cumulative offset in elevation coords. */
  dx: number;
  dy: number;
}

export function Wall() {
  const doc = useViewerStore((s) => s.doc);
  const selectedPlanIdx = useViewerStore((s) => s.selectedPlanIdx);
  const selectedFrameIdx = useViewerStore((s) => s.selectedFrameIdx);
  const selectedStickKey = useViewerStore((s) => s.selectedStickKey);
  const selectStick = useViewerStore((s) => s.selectStick);
  const moveStickAction = useViewerStore((s) => s.moveStick);
  const moveStickEndAction = useViewerStore((s) => s.moveStickEnd);

  const frame = doc?.project.plans[selectedPlanIdx]?.frames[selectedFrameIdx];

  // Compute viewBox from the frame's bounding box, padded for breathing
  // room. Recomputed only when the frame changes (memoised).
  const initialView = useMemo(() => {
    if (!frame) return { x: 0, y: 0, w: 1000, h: 600 };
    const bb = frameBBox(frame);
    if (!bb) return { x: 0, y: 0, w: 1000, h: 600 };
    const padded = padBBox(bb, Math.max(100, (bb.maxX - bb.minX) * 0.05));
    return {
      x: padded.minX,
      y: padded.minY,
      w: padded.maxX - padded.minX,
      h: padded.maxY - padded.minY,
    };
  }, [frame]);

  // Live view state — supports pan/zoom by mutating offset+scale.
  const [view, setView] = useState(initialView);
  useEffect(() => { setView(initialView); }, [initialView]);

  // Pan: drag with primary button on empty area.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // Active stick drag (move-body or end-resize). Lives in component state
  // so the dragging stick re-renders each frame with a transient offset.
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  // Convert screen pixel delta → elevation-coord delta using the
  // current viewBox-to-element scale.
  function screenToElevationDelta(dxPx: number, dyPx: number): { dx: number; dy: number } {
    if (!svgRef.current) return { dx: 0, dy: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    return {
      dx: dxPx * (view.w / rect.width),
      dy: dyPx * (view.h / rect.height),
    };
  }

  const onPanStart = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if (activeDrag) return; // stick drag has priority
    panRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeDrag) {
      const { dx, dy } = screenToElevationDelta(e.clientX - activeDrag.startClientX, e.clientY - activeDrag.startClientY);
      setActiveDrag({ ...activeDrag, dx, dy });
      return;
    }
    if (!panRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = view.w / rect.width;
    const scaleY = view.h / rect.height;
    const dx = (e.clientX - panRef.current.x) * scaleX;
    const dy = (e.clientY - panRef.current.y) * scaleY;
    setView(v => ({ ...v, x: panRef.current!.vx - dx, y: panRef.current!.vy - dy }));
  };
  const onMouseUp = () => {
    panRef.current = null;
    if (activeDrag) {
      // Commit the drag as a single edit (one history entry).
      if (activeDrag.kind === "stick-body") {
        if (Math.abs(activeDrag.dx) > 0.5 || Math.abs(activeDrag.dy) > 0.5) {
          moveStickAction(activeDrag.stickKey, activeDrag.dx, activeDrag.dy);
        }
      } else if (activeDrag.kind === "stick-end" && activeDrag.endIdx !== undefined) {
        if (Math.abs(activeDrag.dx) > 0.5 || Math.abs(activeDrag.dy) > 0.5) {
          moveStickEndAction(activeDrag.stickKey, activeDrag.endIdx, activeDrag.dx, activeDrag.dy);
        }
      }
      setActiveDrag(null);
    }
  };

  const onBodyPointerDown = (e: React.PointerEvent, stickKey: string) => {
    e.stopPropagation();
    setActiveDrag({ kind: "stick-body", stickKey, startClientX: e.clientX, startClientY: e.clientY, dx: 0, dy: 0 });
  };
  const onEndPointerDown = (e: React.PointerEvent, stickKey: string, endIdx: 0 | 1) => {
    e.stopPropagation();
    setActiveDrag({ kind: "stick-end", stickKey, endIdx, startClientX: e.clientX, startClientY: e.clientY, dx: 0, dy: 0 });
  };

  // Zoom: mouse-wheel, centred on cursor position.
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = view.x + (e.clientX - rect.left) * (view.w / rect.width);
    const cy = view.y + (e.clientY - rect.top) * (view.h / rect.height);
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView(v => ({
      x: cx - (cx - v.x) * factor,
      y: cy - (cy - v.y) * factor,
      w: v.w * factor,
      h: v.h * factor,
    }));
  };

  // Click empty canvas → deselect stick
  const onCanvasClick = () => selectStick(null);

  return (
    <div className="flex-1 bg-zinc-950 relative overflow-hidden">
      {!doc && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-zinc-600 text-sm uppercase tracking-wider mb-2">Wall Viewer</div>
            <div className="text-zinc-400">Drop a .rfy file anywhere on this page</div>
          </div>
        </div>
      )}

      {doc && frame && (
        <>
          <svg
            ref={svgRef}
            className="w-full h-full block select-none"
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="xMidYMid meet"
            onMouseDown={onPanStart}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            onClick={onCanvasClick}
            style={{ cursor: activeDrag ? "grabbing" : panRef.current ? "grabbing" : "grab" }}
          >
            <defs>
              <linearGradient id="steel" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#dcdce4" />
                <stop offset="40%" stopColor="#a8a8b0" />
                <stop offset="100%" stopColor="#7a7a82" />
              </linearGradient>
              <linearGradient id="flangeShadow" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#3a3a40" />
                <stop offset="100%" stopColor="#6a6a72" />
              </linearGradient>
            </defs>

            {/* Sticks — each rendered in elevation coords by Stick.tsx.
                The active drag's stickKey gets a transient (dx, dy) offset
                so it follows the cursor in real-time without dirtying the
                store until pointerup commits the edit. */}
            {frame.sticks.map((stick, i) => {
              const key = `${selectedFrameIdx}-${i}`;
              const isDragging = activeDrag?.stickKey === key && activeDrag.kind === "stick-body";
              return (
                <Stick
                  key={key}
                  stick={stick}
                  stickKey={key}
                  selected={selectedStickKey === key}
                  onSelect={selectStick}
                  dragOffset={isDragging ? { dx: activeDrag.dx, dy: activeDrag.dy } : null}
                  onBodyPointerDown={onBodyPointerDown}
                  onEndPointerDown={onEndPointerDown}
                />
              );
            })}
          </svg>

          {/* Status bar — bottom of the canvas, gives feedback that
              the data parsed and tells the user how to interact. */}
          <div className="absolute bottom-0 left-0 right-0 px-4 py-2 bg-zinc-900/80 border-t border-zinc-800 text-xs text-zinc-400 flex items-center justify-between pointer-events-none">
            <span>
              <span className="text-yellow-400 font-mono">{frame.name}</span>
              {" · "}
              {frame.sticks.length} sticks · {frame.sticks.reduce((s, x) => s + x.tooling.length, 0)} ops
            </span>
            <span>drag empty area = pan · wheel = zoom · click stick = select · drag selected stick = move · drag yellow handles = resize</span>
          </div>
        </>
      )}
    </div>
  );
}
