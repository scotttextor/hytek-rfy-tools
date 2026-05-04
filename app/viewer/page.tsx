// Wall Viewer — /viewer route
//
// Phase 0 (this commit): scaffold — drop a file, see frame list, switch
// frames. Renders a placeholder canvas. Confirms the file → codec →
// store → component data flow before adding any visual rendering.
//
// Phase 1 will render actual sticks + tool ops in real-world style.
// See docs/superpowers/specs/2026-05-03-wall-viewer-design.md.

"use client";
import { useCallback, useEffect, useState } from "react";
import { decode } from "@hytek/rfy-codec";
import { useViewerStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Wall } from "./components/Wall";
import { LegendStrip } from "./components/LegendStrip";
import { documentToScheduleXml } from "./lib/serialize";

export default function ViewerPage() {
  const loadDoc = useViewerStore((s) => s.loadDoc);
  const reset = useViewerStore((s) => s.reset);
  const doc = useViewerStore((s) => s.doc);
  const filename = useViewerStore((s) => s.filename);
  const dirty = useViewerStore((s) => s.dirty);
  const undo = useViewerStore((s) => s.undo);
  const redo = useViewerStore((s) => s.redo);
  const canUndo = useViewerStore((s) => s.canUndo());
  const canRedo = useViewerStore((s) => s.canRedo());
  const tool = useViewerStore((s) => s.tool);
  const setTool = useViewerStore((s) => s.setTool);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z (or Y) = redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Drop handler — accepts .rfy (binary, codec decodes) or .xml
  // (FrameCAD-import XML). Phase 0 just supports .rfy; XML support
  // requires plumbing the same XML→RfyDocument path the home page uses,
  // which we add in Phase 1.
  // Save back to .rfy. Round-trip:
  //   1. serialize RfyDocument → schedule XML  (lib/serialize.ts)
  //   2. POST XML to /api/encode → server encrypts → returns .rfy bytes
  //   3. trigger download
  // The /api/encode endpoint takes the inner schedule XML directly and
  // applies encryptRfy() — no synthesis or rule re-application happens,
  // so what comes out is exactly what's in the doc state.
  const onSave = useCallback(async () => {
    if (!doc) return;
    setError(null);
    setSaving(true);
    try {
      const xml = documentToScheduleXml(doc);
      const outName = (filename ?? "edited.rfy").replace(/\.(xml|rfy)$/i, ".rfy");
      const res = await fetch("/api/encode", {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-filename": encodeURIComponent(outName) },
        body: xml,
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server rejected XML: ${errText.slice(0, 300)}`);
      }
      const blob = await res.blob();
      // Trigger browser download.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [doc, filename]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setError(null);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const lname = file.name.toLowerCase();
      if (lname.endsWith(".rfy")) {
        // .rfy = encrypted bytes. Decode client-side.
        const buf = Buffer.from(await file.arrayBuffer());
        const decoded = decode(buf);
        loadDoc(decoded, file.name);
      } else if (lname.endsWith(".xml")) {
        // Input XML (FrameCAD <framecad_import>) requires server-side
        // synthesis through the existing /api/encode-auto pipeline,
        // because the codec's framecadImportToRfy uses Node-only deps.
        // Round-trip: POST XML → server returns encrypted RFY bytes →
        // client decodes with codec.decode → RfyDocument.
        const xml = await file.text();
        const res = await fetch("/api/encode-auto", {
          method: "POST",
          headers: { "content-type": "application/octet-stream", "x-filename": encodeURIComponent(file.name) },
          body: xml,
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Server rejected XML: ${errText.slice(0, 300)}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const decoded = decode(buf);
        loadDoc(decoded, file.name);
      } else {
        setError(`Unsupported file type: ${file.name}. Drop a .rfy or .xml file.`);
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
          <div className="flex items-center gap-2">
            {/* Edit toolbar — only visible when a doc is loaded */}
            <button
              onClick={() => setTool(tool === "draw-stick" ? "select" : "draw-stick")}
              className={`px-2 py-1 rounded text-xs transition ${
                tool === "draw-stick"
                  ? "bg-yellow-400 text-black font-medium"
                  : "border border-zinc-700 text-zinc-300 hover:border-yellow-400 hover:text-yellow-400"
              }`}
              title="Toggle Draw Stick mode (drag on empty area to add a new stick)"
            >
              ✏ Draw stick
            </button>
            <button
              onClick={undo}
              disabled={!canUndo}
              className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 text-xs hover:border-yellow-400 hover:text-yellow-400 transition disabled:opacity-30 disabled:cursor-not-allowed"
              title="Undo (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 text-xs hover:border-yellow-400 hover:text-yellow-400 transition disabled:opacity-30 disabled:cursor-not-allowed"
              title="Redo (Ctrl+Shift+Z)"
            >
              ↷ Redo
            </button>
            <button
              onClick={onSave}
              disabled={!dirty || saving}
              className="px-3 py-1 rounded bg-yellow-400 text-black text-xs font-medium hover:bg-yellow-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="Save edits back to .rfy"
            >
              {saving ? "Saving…" : dirty ? "💾 Save" : "💾 Saved"}
            </button>
            <span className="text-xs text-zinc-500 mx-2">
              <span className="text-zinc-300 font-mono">{filename}</span>
              {dirty && <span className="text-yellow-400 ml-2">●</span>}
            </span>
            <button
              onClick={() => { reset(); setError(null); }}
              className="px-2 py-1 rounded border border-zinc-700 text-zinc-400 text-xs hover:border-yellow-400 hover:text-yellow-400 transition"
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

      {/* Tool-op color legend strip — always visible. Lives between the
          header and the canvas/sidebar so users can scan it without
          opening anything. Each chip shows the type's color + name +
          CSV label; hover for the description tooltip. */}
      <LegendStrip />

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
