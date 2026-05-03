// Wall — the SVG canvas. Phase 0 renders a placeholder; Phase 1 will
// add the actual stick rendering with steel shading + tool ops.
//
// Pan/zoom is implemented as a CSS transform on the inner <g> — this
// runs on the GPU and stays smooth even with thousands of SVG nodes.

"use client";
import { useViewerStore } from "../store";

export function Wall() {
  const doc = useViewerStore((s) => s.doc);
  const selectedPlanIdx = useViewerStore((s) => s.selectedPlanIdx);
  const selectedFrameIdx = useViewerStore((s) => s.selectedFrameIdx);
  const zoom = useViewerStore((s) => s.zoom);
  const panX = useViewerStore((s) => s.panX);
  const panY = useViewerStore((s) => s.panY);

  const frame = doc?.project.plans[selectedPlanIdx]?.frames[selectedFrameIdx];

  return (
    <div className="flex-1 bg-zinc-950 relative overflow-hidden">
      {/* Empty-state hint — only shown when no doc loaded */}
      {!doc && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-zinc-600 text-sm uppercase tracking-wider mb-2">Wall Viewer</div>
            <div className="text-zinc-400">Drop a .rfy or .xml file anywhere on this page</div>
            <div className="text-zinc-600 text-xs mt-1">Phase 0 — file load + frame switch wired up</div>
          </div>
        </div>
      )}

      {/* SVG canvas — exists once a doc is loaded so the pan/zoom infrastructure is in place */}
      {doc && (
        <svg
          className="w-full h-full block"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="xMidYMid meet"
          viewBox="0 0 1000 600"
        >
          <defs>
            {/* Steel gradient — used by Stick.tsx in Phase 1 */}
            <linearGradient id="steel" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#dcdce4" />
              <stop offset="40%" stopColor="#a8a8b0" />
              <stop offset="100%" stopColor="#7a7a82" />
            </linearGradient>
            {/* Flange shadow — used to show C-section depth */}
            <linearGradient id="flangeShadow" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#3a3a40" />
              <stop offset="100%" stopColor="#6a6a72" />
            </linearGradient>
          </defs>

          {/* Pan/zoom group — Phase 1+ wires interactive pan/zoom */}
          <g transform={`translate(${panX} ${panY}) scale(${zoom})`}>
            {/* Phase 0 placeholder — confirms the frame data is reaching the canvas */}
            <rect x="20" y="20" width="960" height="560" fill="none" stroke="#1a1a20" strokeWidth="1" rx="4" />
            <text x="40" y="50" fill="#FFCB05" fontFamily="Arial" fontSize="14" fontWeight="bold">
              {frame?.name ?? "(no frame)"}
            </text>
            <text x="40" y="72" fill="#888" fontFamily="Arial" fontSize="11">
              {frame ? `${frame.sticks.length} sticks · ${frame.sticks.reduce((sum, s) => sum + s.tooling.length, 0)} ops` : ""}
            </text>
            <text x="40" y="120" fill="#666" fontFamily="Arial" fontSize="10">
              Phase 1 will render every stick + tool op here in real-world steel style.
            </text>
          </g>
        </svg>
      )}
    </div>
  );
}
