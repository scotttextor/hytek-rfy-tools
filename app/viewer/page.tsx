// Wall Viewer — /viewer route
//
// Phase 0 (this commit): scaffold — drop a file, see frame list, switch
// frames. Renders a placeholder canvas. Confirms the file → codec →
// store → component data flow before adding any visual rendering.
//
// Phase 1 will render actual sticks + tool ops in real-world style.
// See docs/superpowers/specs/2026-05-03-wall-viewer-design.md.

"use client";
import { useCallback, useState } from "react";
import { decode } from "@hytek/rfy-codec";
import { useViewerStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Wall } from "./components/Wall";

export default function ViewerPage() {
  const loadDoc = useViewerStore((s) => s.loadDoc);
  const reset = useViewerStore((s) => s.reset);
  const doc = useViewerStore((s) => s.doc);
  const filename = useViewerStore((s) => s.filename);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Drop handler — accepts .rfy (binary, codec decodes) or .xml
  // (FrameCAD-import XML). Phase 0 just supports .rfy; XML support
  // requires plumbing the same XML→RfyDocument path the home page uses,
  // which we add in Phase 1.
  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setError(null);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      if (file.name.toLowerCase().endsWith(".rfy")) {
        const buf = Buffer.from(await file.arrayBuffer());
        const decoded = decode(buf);
        loadDoc(decoded, file.name);
      } else if (file.name.toLowerCase().endsWith(".xml")) {
        // Phase 1: wire the input-XML → synthesizeRfyFromPlans pipeline
        // the home page's encode-bundle endpoint uses, so the viewer can
        // load the same XML files the home page accepts.
        setError("XML import lands in Phase 1. For now, drop a .rfy file.");
      } else {
        setError(`Unsupported file type: ${file.name}. Drop a .rfy file.`);
      }
    } catch (err) {
      setError(`Failed to load ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [loadDoc]);

  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col"
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
    >
      {/* HYTEK Group official logo — yellow on black, per brand manual. */}
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center gap-4">
        <img src="/hytek-group-logo.png" alt="HYTEK GROUP" className="h-9" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            <span className="text-yellow-400">HYTEK</span> Wall Viewer
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Visualise an imported XML or .rfy as the actual wall.{" "}
            <span className="text-amber-400">Phase 0 — file load wired</span>
          </p>
        </div>
        {filename && (
          <div className="text-xs text-zinc-500">
            <span className="text-zinc-300 font-mono">{filename}</span>
            <button
              onClick={() => { reset(); setError(null); }}
              className="ml-3 px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:border-yellow-400 hover:text-yellow-400 transition"
            >
              Close
            </button>
          </div>
        )}
        <a
          href="/"
          className="text-xs px-3 py-1.5 rounded border border-zinc-700 hover:border-yellow-400 hover:text-yellow-400 text-zinc-300 transition"
        >
          ← Tools
        </a>
      </header>

      {error && (
        <div className="px-6 py-3 border-b border-red-900 bg-red-950/40 text-red-300 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 relative">
          <Wall />
          {/* Drop overlay — visible while dragging a file in */}
          {dragOver && !doc && (
            <div className="absolute inset-0 bg-yellow-400/10 border-2 border-dashed border-yellow-400 flex items-center justify-center pointer-events-none">
              <div className="text-yellow-400 text-lg font-medium">Drop the .rfy here</div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
