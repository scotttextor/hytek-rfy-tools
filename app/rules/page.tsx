"use client";

import { useEffect, useMemo, useState } from "react";

type Tab = "machines" | "frames";

// Loaded data from /api/setups and /api/frame-types — kept as the FULL JSON
// records so we can mutate them client-side and export back.
interface SetupsResponse { setups: SetupSummary[]; full: Record<string, FullSetup>; count: number; }
interface FrameTypesResponse { types: FrameTypeSummary[]; full: Record<string, FullFrameType>; count: number; }

interface SetupSummary { id: string; name: string; machineModel: string; machineSeries: string; chamferTolerance: number; endClearance: number; braceToDimple: number; braceToWebhole: number; toolClearance: number; dimpleToEnd: number; boltHoleToEnd: number; webHoleToEnd: number; minimumTagLength: number; tabToTabDistance: number; extraChamfers: boolean; endToEndChamfers: boolean; suppressFasteners: boolean; sectionCount: number; }
interface FrameTypeSummary { id: string; name: string; guid: string; planLabelPrefix: string; defaultScriptName: string; defaultMachineSetupGuid?: string; vrmlColor?: string; defaultKind?: string; }

// FullSetup / FullFrameType use string-keyed records since the .sups format
// stores everything as strings or nested objects. We treat them as opaque.
type FullSetup = Record<string, unknown>;
type FullFrameType = Record<string, unknown>;

export default function RulesPage() {
  const [tab, setTab] = useState<Tab>("machines");

  // Machine setups state
  const [setupsFull, setSetupsFull] = useState<Record<string, FullSetup>>({});
  const [setupOrder, setSetupOrder] = useState<string[]>([]);
  const [setupsDirty, setSetupsDirty] = useState(false);

  // Frame types state
  const [frameTypesFull, setFrameTypesFull] = useState<Record<string, FullFrameType>>({});
  const [frameTypeOrder, setFrameTypeOrder] = useState<string[]>([]);
  const [frameTypesDirty, setFrameTypesDirty] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset selection when tab changes — IDs are namespaced by tab
  useEffect(() => { setSelectedId(null); setEditingId(null); }, [tab]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/setups").then(r => r.json() as Promise<SetupsResponse | { error: string }>),
      fetch("/api/frame-types").then(r => r.json() as Promise<FrameTypesResponse | { error: string }>),
    ]).then(([s, f]) => {
      if ("error" in s) { setError(s.error); return; }
      if ("error" in f) { setError(f.error); return; }
      setSetupsFull(s.full);
      setSetupOrder(Object.keys(s.full));
      setFrameTypesFull(f.full);
      setFrameTypeOrder(Object.keys(f.full));
    }).catch(e => setError(String(e))).finally(() => setLoading(false));
  }, []);

  // Derived: the summary array for current tab's table
  const setupSummaries = useMemo(() => {
    return setupOrder.map(id => setupSummaryFromFull(id, setupsFull[id]));
  }, [setupOrder, setupsFull]);

  const frameTypeSummaries = useMemo(() => {
    return frameTypeOrder.map(id => frameTypeSummaryFromFull(id, frameTypesFull[id]));
  }, [frameTypeOrder, frameTypesFull]);

  // ---------------------- CRUD operations -------------------------

  function nextId(orderedIds: string[]): string {
    const nums = orderedIds.map(id => parseInt(id, 10)).filter(n => Number.isFinite(n));
    return String((nums.length ? Math.max(...nums) : -1) + 1);
  }

  function actionCreateNew() {
    if (tab === "machines") {
      const newId = nextId(setupOrder);
      const blank = blankSetup(newId);
      setSetupsFull({ ...setupsFull, [newId]: blank });
      setSetupOrder([...setupOrder, newId]);
      setSelectedId(newId);
      setEditingId(newId);
      setSetupsDirty(true);
    } else {
      const newId = nextId(frameTypeOrder);
      const blank = blankFrameType(newId);
      setFrameTypesFull({ ...frameTypesFull, [newId]: blank });
      setFrameTypeOrder([...frameTypeOrder, newId]);
      setSelectedId(newId);
      setEditingId(newId);
      setFrameTypesDirty(true);
    }
  }

  function actionCopy() {
    if (!selectedId) return;
    if (tab === "machines") {
      const src = setupsFull[selectedId];
      if (!src) return;
      const newId = nextId(setupOrder);
      const copy = JSON.parse(JSON.stringify(src)) as FullSetup;
      copy.Name = `${(src.Name as string) ?? "Setup"} Copy`;
      copy.DefaultName = copy.Name;
      copy.InstanceGUID = newGuid();
      copy.DefaultGUID = newGuid();
      // Insert right after the selected entry (matches Detailer's behaviour)
      const idx = setupOrder.indexOf(selectedId);
      const newOrder = [...setupOrder];
      newOrder.splice(idx + 1, 0, newId);
      setSetupsFull({ ...setupsFull, [newId]: copy });
      setSetupOrder(newOrder);
      setSelectedId(newId);
      setEditingId(newId);
      setSetupsDirty(true);
    } else {
      const src = frameTypesFull[selectedId];
      if (!src) return;
      const newId = nextId(frameTypeOrder);
      const copy = JSON.parse(JSON.stringify(src)) as FullFrameType;
      copy.Name = `${(src.Name as string) ?? "Frame Type"} Copy`;
      copy.GUID = newGuid();
      const idx = frameTypeOrder.indexOf(selectedId);
      const newOrder = [...frameTypeOrder];
      newOrder.splice(idx + 1, 0, newId);
      setFrameTypesFull({ ...frameTypesFull, [newId]: copy });
      setFrameTypeOrder(newOrder);
      setSelectedId(newId);
      setEditingId(newId);
      setFrameTypesDirty(true);
    }
  }

  function actionDeleteSelected() {
    if (!selectedId) return;
    const target = tab === "machines"
      ? (setupsFull[selectedId]?.Name as string)
      : (frameTypesFull[selectedId]?.Name as string);
    if (!confirm(`Delete "${target}"? This cannot be undone (until you re-load the page).`)) return;

    if (tab === "machines") {
      const next = { ...setupsFull };
      delete next[selectedId];
      setSetupsFull(next);
      setSetupOrder(setupOrder.filter(id => id !== selectedId));
      setSetupsDirty(true);
    } else {
      const next = { ...frameTypesFull };
      delete next[selectedId];
      setFrameTypesFull(next);
      setFrameTypeOrder(frameTypeOrder.filter(id => id !== selectedId));
      setFrameTypesDirty(true);
    }
    setSelectedId(null);
  }

  function actionDeleteAll() {
    const noun = tab === "machines" ? "machine setups" : "frame types";
    if (!confirm(`Delete ALL ${noun}? This wipes the table. Use "Reset" to undo (re-fetches from server).`)) return;
    if (tab === "machines") {
      setSetupsFull({});
      setSetupOrder([]);
      setSetupsDirty(true);
    } else {
      setFrameTypesFull({});
      setFrameTypeOrder([]);
      setFrameTypesDirty(true);
    }
    setSelectedId(null);
  }

  function actionResetFromServer() {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/setups").then(r => r.json() as Promise<SetupsResponse | { error: string }>),
      fetch("/api/frame-types").then(r => r.json() as Promise<FrameTypesResponse | { error: string }>),
    ]).then(([s, f]) => {
      if ("error" in s) { setError(s.error); return; }
      if ("error" in f) { setError(f.error); return; }
      setSetupsFull(s.full);
      setSetupOrder(Object.keys(s.full));
      setFrameTypesFull(f.full);
      setFrameTypeOrder(Object.keys(f.full));
      setSetupsDirty(false);
      setFrameTypesDirty(false);
      setSelectedId(null);
    }).catch(e => setError(String(e))).finally(() => setLoading(false));
  }

  function actionSaveEdits(id: string, updated: FullSetup | FullFrameType) {
    if (tab === "machines") {
      setSetupsFull({ ...setupsFull, [id]: updated as FullSetup });
      setSetupsDirty(true);
    } else {
      setFrameTypesFull({ ...frameTypesFull, [id]: updated as FullFrameType });
      setFrameTypesDirty(true);
    }
    setEditingId(null);
  }

  function actionExportJson() {
    if (tab === "machines") exportMachineTypes(setupsFull, setupOrder);
    else exportFrameTypes(frameTypesFull, frameTypeOrder);
  }

  // ---------------------- Render -------------------------

  const isDirty = (tab === "machines" ? setupsDirty : frameTypesDirty);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <header className="mb-4">
        <div className="flex items-baseline gap-4 mb-2">
          <h1 className="text-2xl font-bold">HYTEK Rules Manager</h1>
          <a href="/" className="text-sm text-zinc-400 hover:text-zinc-200">← Back to RFY tools</a>
        </div>
        <p className="text-sm text-zinc-400">
          Source-of-truth tooling rules. Master copies on{" "}
          <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-xs">Y:\(08) DETAILING\(13) FRAMECAD\FrameCAD DETAILER\HYTEK MACHINE_FRAME TYPES\</code>.
        </p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-zinc-800">
        {(["machines", "frames"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t ? "text-amber-400 border-b-2 border-amber-400" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t === "machines" ? `Machine Setups (${setupSummaries.length})` : `Frame Types (${frameTypeSummaries.length})`}
            {((t === "machines" && setupsDirty) || (t === "frames" && frameTypesDirty)) && (
              <span className="ml-2 text-amber-400">●</span>
            )}
          </button>
        ))}
      </div>

      {/* Action bar (mirrors Detailer's Frame Type Manager buttons) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={actionCreateNew} className="action-btn action-primary">+ Create New</button>
        <button onClick={actionCopy} disabled={!selectedId} className="action-btn">Copy</button>
        <button onClick={() => selectedId && setEditingId(selectedId)} disabled={!selectedId} className="action-btn">Edit</button>
        <button onClick={actionDeleteSelected} disabled={!selectedId} className="action-btn action-danger">Delete Selected</button>
        <button onClick={actionDeleteAll} className="action-btn action-danger">Delete All</button>
        <span className="flex-1" />
        <button onClick={actionResetFromServer} className="action-btn">Reset from Server</button>
        <button
          onClick={actionExportJson}
          disabled={!isDirty}
          className={`action-btn ${isDirty ? "action-export" : ""}`}
          title={isDirty ? "Download the modified JSON to commit to the repo" : "No changes to export"}
        >
          Export Modified JSON ↓
        </button>
        <style jsx>{`
          .action-btn {
            padding: 0.4rem 0.85rem;
            font-size: 0.875rem;
            border-radius: 0.375rem;
            border: 1px solid #3f3f46;
            background: #18181b;
            color: #e4e4e7;
            transition: all 0.1s;
          }
          .action-btn:hover:not(:disabled) { background: #27272a; border-color: #52525b; }
          .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
          .action-primary { border-color: #f59e0b; color: #fbbf24; }
          .action-primary:hover:not(:disabled) { background: rgba(251, 191, 36, 0.1); }
          .action-danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.15); border-color: #b91c1c; color: #fca5a5; }
          .action-export { border-color: #22c55e; color: #4ade80; }
          .action-export:hover:not(:disabled) { background: rgba(74, 222, 128, 0.1); }
        `}</style>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-200 p-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}
      {loading && <div className="text-zinc-400 text-sm">Loading…</div>}

      {/* Tables */}
      {!loading && tab === "machines" && (
        <MachineSetupsTable
          summaries={setupSummaries}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onEdit={(id) => setEditingId(id)}
        />
      )}
      {!loading && tab === "frames" && (
        <FrameTypesTable
          summaries={frameTypeSummaries}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onEdit={(id) => setEditingId(id)}
        />
      )}

      {/* Edit modals */}
      {editingId && tab === "machines" && setupsFull[editingId] && (
        <MachineSetupEditor
          id={editingId}
          data={setupsFull[editingId]}
          onSave={(updated) => actionSaveEdits(editingId, updated)}
          onCancel={() => setEditingId(null)}
        />
      )}
      {editingId && tab === "frames" && frameTypesFull[editingId] && (
        <FrameTypeEditor
          id={editingId}
          data={frameTypesFull[editingId]}
          onSave={(updated) => actionSaveEdits(editingId, updated)}
          onCancel={() => setEditingId(null)}
        />
      )}
    </main>
  );
}

// ============================================================================
// Tables
// ============================================================================

function MachineSetupsTable({
  summaries,
  selectedId,
  onSelect,
  onEdit,
}: {
  summaries: SetupSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  if (summaries.length === 0) {
    return <div className="text-zinc-500 text-sm border border-zinc-800 rounded p-6 text-center">No machine setups. Click + Create New.</div>;
  }
  return (
    <div className="overflow-x-auto border border-zinc-800 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900 text-zinc-300">
          <tr>
            <th className="px-3 py-2 text-left font-medium">ID</th>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Series</th>
            <th className="px-3 py-2 text-right font-medium" title="Chamfer Tolerance — corner interference threshold (mm) before chamfer kicks in">ChamferTol</th>
            <th className="px-3 py-2 text-right font-medium" title="EndClearance — plate trim at each end">EndClear</th>
            <th className="px-3 py-2 text-right font-medium">Brace→Dimple</th>
            <th className="px-3 py-2 text-right font-medium">Tool Clear</th>
            <th className="px-3 py-2 text-right font-medium">Dimple→End</th>
            <th className="px-3 py-2 text-right font-medium">Min Tag</th>
            <th className="px-3 py-2 text-right font-medium">Sections</th>
            <th className="px-3 py-2 text-center font-medium">ExtraCham</th>
            <th className="px-3 py-2 text-center font-medium">EndToEnd</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => (
            <tr
              key={s.id}
              className={`border-t border-zinc-800 cursor-pointer ${
                selectedId === s.id ? "bg-amber-950/40" : "hover:bg-zinc-900/50"
              }`}
              onClick={() => onSelect(s.id)}
              onDoubleClick={() => onEdit(s.id)}
              title="Click to select · Double-click to edit"
            >
              <td className="px-3 py-2 text-zinc-500 font-mono">{s.id}</td>
              <td className="px-3 py-2 font-medium">{s.name}</td>
              <td className="px-3 py-2 text-zinc-400">{s.machineSeries}</td>
              <td className="px-3 py-2 text-right">{s.chamferTolerance}</td>
              <td className="px-3 py-2 text-right">{s.endClearance}</td>
              <td className="px-3 py-2 text-right">{s.braceToDimple}</td>
              <td className="px-3 py-2 text-right">{s.toolClearance}</td>
              <td className="px-3 py-2 text-right">{s.dimpleToEnd}</td>
              <td className="px-3 py-2 text-right">{s.minimumTagLength}</td>
              <td className="px-3 py-2 text-right">{s.sectionCount}</td>
              <td className="px-3 py-2 text-center">{s.extraChamfers ? "✓" : "—"}</td>
              <td className="px-3 py-2 text-center">{s.endToEndChamfers ? "✓" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FrameTypesTable({
  summaries,
  selectedId,
  onSelect,
  onEdit,
}: {
  summaries: FrameTypeSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  if (summaries.length === 0) {
    return <div className="text-zinc-500 text-sm border border-zinc-800 rounded p-6 text-center">No frame types. Click + Create New.</div>;
  }
  return (
    <div className="overflow-x-auto border border-zinc-800 rounded-lg">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900 text-zinc-300">
          <tr>
            <th className="px-3 py-2 text-left font-medium">ID</th>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="px-3 py-2 text-left font-medium">Prefix</th>
            <th className="px-3 py-2 text-left font-medium">Kind</th>
            <th className="px-3 py-2 text-left font-medium">Default Script</th>
            <th className="px-3 py-2 text-left font-medium">Color</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((t) => (
            <tr
              key={t.id}
              className={`border-t border-zinc-800 cursor-pointer ${
                selectedId === t.id ? "bg-amber-950/40" : "hover:bg-zinc-900/50"
              }`}
              onClick={() => onSelect(t.id)}
              onDoubleClick={() => onEdit(t.id)}
              title="Click to select · Double-click to edit"
            >
              <td className="px-3 py-2 text-zinc-500 font-mono">{t.id}</td>
              <td className="px-3 py-2 font-medium">{t.name}</td>
              <td className="px-3 py-2 font-mono text-amber-400">{t.planLabelPrefix}</td>
              <td className="px-3 py-2 text-zinc-400">{t.defaultKind ?? "—"}</td>
              <td className="px-3 py-2 text-zinc-400">{t.defaultScriptName}</td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block w-4 h-4 rounded border border-zinc-600"
                    style={{ background: delphiColorToCss(t.vrmlColor) }}
                    title={t.vrmlColor}
                  />
                  <span className="text-zinc-500 text-xs font-mono">{t.vrmlColor ?? "—"}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Editors
// ============================================================================

function MachineSetupEditor({
  id,
  data,
  onSave,
  onCancel,
}: {
  id: string;
  data: FullSetup;
  onSave: (updated: FullSetup) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<FullSetup>(() => JSON.parse(JSON.stringify(data)));

  const numericFields: { key: string; label: string; tooltip?: string }[] = [
    { key: "ChamferTolerance", label: "Chamfer Tolerance (mm)", tooltip: "Corner-into-web threshold before a chamfer is auto-applied" },
    { key: "EndClearance", label: "End Clearance (mm)", tooltip: "Plate trim at each end" },
    { key: "BraceToDimple", label: "Brace → Dimple (mm)" },
    { key: "BraceToWebhole", label: "Brace → Web Hole (mm)" },
    { key: "ToolClearance", label: "Tool Clearance (mm)" },
    { key: "DimpleToEnd", label: "Dimple → End (mm)" },
    { key: "BoltHoleToEnd", label: "Bolt Hole → End (mm)" },
    { key: "WebHoleToEnd", label: "Web Hole → End (mm)" },
    { key: "B2BStickClearance", label: "B2B Stick Clearance (mm)" },
    { key: "MinimumTagLength", label: "Minimum Tag Length (mm)" },
    { key: "TabToTabDistance", label: "Tab → Tab Distance (mm)" },
    { key: "EndToTabDistance", label: "End → Tab Distance (mm)" },
    { key: "FlangeSlotHeight", label: "Flange Slot Height (mm)" },
    { key: "Web2Web", label: "Web ↔ Web (mm)" },
    { key: "FPlateWidthDifferential", label: "Plate Width Differential (mm)" },
    { key: "DoubleBoltSpacing", label: "Double Bolt Spacing (mm)" },
    { key: "MaxBoxToBoxHoleDelta", label: "Max Box→Box Hole Delta (mm)" },
    { key: "MaxSplicingLength", label: "Max Splicing Length (mm)" },
    { key: "SplicingDimpleSpacing", label: "Splicing Dimple Spacing (mm)" },
    { key: "BoxedEndLength", label: "Boxed End Length (mm)" },
    { key: "BoxedFirstDimpleOffset", label: "Boxed First Dimple Offset (mm)" },
    { key: "BoxDimpleSpacing", label: "Box Dimple Spacing (mm)" },
    { key: "DoorSillNotchOffset", label: "Door Sill Notch Offset (mm)" },
    { key: "ExtraFlangeHoleOffset", label: "Extra Flange Hole Offset (mm)" },
    { key: "ExtraFlangeHoleOffsetAt90", label: "Extra Flange Hole Offset @ 90° (mm)" },
    { key: "LargeServiceToLeadingEdgeDistance", label: "Large Service → Leading Edge (mm)" },
    { key: "LargeServiceToTrailingEdgeDistance", label: "Large Service → Trailing Edge (mm)" },
  ];

  const boolFields: { key: string; label: string }[] = [
    { key: "ExtraChamfers", label: "Place Extra Chamfers" },
    { key: "EndToEndChamfers", label: "End-to-End Chamfers" },
    { key: "BraceAsStud", label: "Treat Braces As Studs" },
    { key: "FDualSection", label: "Dual Section" },
    { key: "FixedWeb2Web", label: "Fixed Web↔Web" },
    { key: "InvertDimpleFlangeFastenings", label: "Invert Dimple/Flange Fastenings" },
    { key: "OnEdgeLipNotches", label: "On-Edge Lip Notches" },
    { key: "OnFlySwage", label: "On-Fly Swage" },
    { key: "SuppressFasteners", label: "Suppress Fasteners" },
    { key: "UseMaleFemaleDimples", label: "Use Male/Female Dimples" },
  ];

  function setField(key: string, value: string | boolean) {
    setDraft({ ...draft, [key]: typeof value === "boolean" ? String(value) : value });
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-5xl max-h-[90vh] w-full overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">
            Edit Machine Setup <span className="text-zinc-500 text-sm font-mono">id={id}</span>
          </h2>
          <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-200 text-2xl leading-none" aria-label="Close">×</button>
        </header>
        <div className="overflow-auto flex-1 p-4 space-y-6">
          {/* Identity */}
          <Section title="Identity">
            <Field label="Name">
              <input
                type="text"
                value={String(draft.Name ?? "")}
                onChange={(e) => setDraft({ ...draft, Name: e.target.value, DefaultName: e.target.value })}
                className="form-input"
              />
            </Field>
            <Field label="Machine Model">
              <input type="text" value={String(draft.FMachineModel ?? "")} onChange={(e) => setField("FMachineModel", e.target.value)} className="form-input" />
            </Field>
            <Field label="Machine Series">
              <input type="text" value={String(draft.FMachineSeries ?? "")} onChange={(e) => setField("FMachineSeries", e.target.value)} className="form-input" />
            </Field>
          </Section>

          {/* Tolerances */}
          <Section title="Tolerances & Clearances (mm)">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {numericFields.map(f => (
                <Field key={f.key} label={f.label} tooltip={f.tooltip}>
                  <input
                    type="text"
                    value={String(draft[f.key] ?? "")}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="form-input"
                  />
                </Field>
              ))}
            </div>
          </Section>

          {/* Booleans */}
          <Section title="Boolean Flags">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {boolFields.map(f => (
                <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-800/50 px-2 py-1 rounded">
                  <input
                    type="checkbox"
                    checked={String(draft[f.key]).toLowerCase() === "true"}
                    onChange={(e) => setField(f.key, e.target.checked)}
                    className="form-checkbox"
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
          </Section>

          {/* Advanced JSON */}
          <Section title="Advanced (raw JSON for nested objects)">
            <p className="text-xs text-zinc-500 mb-2">
              ToolSetup, SectionSetups, Fasteners, ServiceHoleOptions, DesignChecks — edit as JSON.
              Invalid JSON will refuse to save.
            </p>
            <AdvancedJsonEditor
              draft={draft}
              setDraft={setDraft}
              keys={["ToolSetup", "SectionSetups", "Fasteners", "ServiceHoleOptions", "DesignChecks", "ImportToolMapping", "DefaultSectionOptions"]}
            />
          </Section>
        </div>
        <footer className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-500">Changes are local until you click <strong>Export Modified JSON</strong> on the main page.</span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm rounded border border-zinc-700 hover:bg-zinc-800">Cancel</button>
            <button onClick={() => onSave(draft)} className="px-4 py-2 text-sm rounded border border-amber-500 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">Save Changes</button>
          </div>
        </footer>
        <style jsx global>{`
          .form-input {
            width: 100%;
            padding: 0.4rem 0.6rem;
            font-size: 0.875rem;
            background: #18181b;
            border: 1px solid #3f3f46;
            border-radius: 0.25rem;
            color: #e4e4e7;
            font-family: ui-monospace, monospace;
          }
          .form-input:focus { outline: none; border-color: #f59e0b; }
          .form-checkbox {
            width: 1rem;
            height: 1rem;
            accent-color: #f59e0b;
          }
        `}</style>
      </div>
    </div>
  );
}

function FrameTypeEditor({
  id,
  data,
  onSave,
  onCancel,
}: {
  id: string;
  data: FullFrameType;
  onSave: (updated: FullFrameType) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<FullFrameType>(() => JSON.parse(JSON.stringify(data)));
  const fo = (draft.FrameOptions ?? {}) as Record<string, unknown>;

  function setFrameOpt(key: string, value: string | boolean) {
    const newFo = { ...fo, [key]: typeof value === "boolean" ? String(value) : value };
    setDraft({ ...draft, FrameOptions: newFo });
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-3xl max-h-[90vh] w-full overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">
            Edit Frame Type <span className="text-zinc-500 text-sm font-mono">id={id}</span>
          </h2>
          <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-200 text-2xl leading-none" aria-label="Close">×</button>
        </header>
        <div className="overflow-auto flex-1 p-4 space-y-4">
          <Section title="General">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <input type="text" value={String(draft.Name ?? "")} onChange={(e) => setDraft({ ...draft, Name: e.target.value })} className="form-input" />
              </Field>
              <Field label="Plan Label Prefix">
                <input type="text" value={String(draft.PlanLabelPrefix ?? "")} onChange={(e) => setDraft({ ...draft, PlanLabelPrefix: e.target.value })} className="form-input" />
              </Field>
              <Field label="Default Script Name">
                <input type="text" value={String(draft.DefaultScriptName ?? "")} onChange={(e) => setDraft({ ...draft, DefaultScriptName: e.target.value })} className="form-input" />
              </Field>
              <Field label="Default Kind">
                <input type="text" value={String(fo.DefaultKind ?? "")} onChange={(e) => setFrameOpt("DefaultKind", e.target.value)} className="form-input" />
              </Field>
              <Field label="VRML Color (Delphi name or $00BBGGRR)">
                <input type="text" value={String(fo.VRMLColor ?? "")} onChange={(e) => setFrameOpt("VRMLColor", e.target.value)} className="form-input" />
              </Field>
              <Field label="Default Machine Setup GUID">
                <input type="text" value={String(fo.DefaultMachineSetupGUID ?? "")} onChange={(e) => setFrameOpt("DefaultMachineSetupGUID", e.target.value)} className="form-input" />
              </Field>
            </div>
          </Section>

          <Section title="Booleans">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { k: "DrawElevationProfiles", l: "Draw End Profiles" },
                { k: "UseDeflectionTrack", l: "Use Deflection Track" },
                { k: "AllowAutoTripleDetection", l: "Auto-detect triples" },
              ].map(f => (
                <label key={f.k} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-800/50 px-2 py-1 rounded">
                  <input
                    type="checkbox"
                    checked={String(fo[f.k] ?? "").toLowerCase() === "true"}
                    onChange={(e) => setFrameOpt(f.k, e.target.checked)}
                    className="form-checkbox"
                  />
                  <span>{f.l}</span>
                </label>
              ))}
            </div>
          </Section>

          <Section title="Advanced (raw JSON)">
            <AdvancedJsonEditor
              draft={draft as Record<string, unknown>}
              setDraft={(v) => setDraft(v as FullFrameType)}
              keys={["FrameOptions"]}
            />
          </Section>
        </div>
        <footer className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-500">Changes are local until you click <strong>Export Modified JSON</strong>.</span>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm rounded border border-zinc-700 hover:bg-zinc-800">Cancel</button>
            <button onClick={() => onSave(draft)} className="px-4 py-2 text-sm rounded border border-amber-500 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">Save Changes</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function AdvancedJsonEditor({
  draft,
  setDraft,
  keys,
}: {
  draft: Record<string, unknown>;
  setDraft: (next: Record<string, unknown>) => void;
  keys: string[];
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  function startEdit(key: string) {
    setOpenKey(key);
    setText(JSON.stringify(draft[key] ?? {}, null, 2));
    setParseError(null);
  }
  function commit() {
    if (!openKey) return;
    try {
      const parsed = JSON.parse(text);
      setDraft({ ...draft, [openKey]: parsed });
      setOpenKey(null);
      setParseError(null);
    } catch (e) {
      setParseError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {keys.map(k => (
          <button
            key={k}
            onClick={() => startEdit(k)}
            className={`text-xs px-2 py-1 rounded border ${
              openKey === k ? "border-amber-500 text-amber-300 bg-amber-500/10" : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            {k} {draft[k] ? `(${Object.keys((draft[k] ?? {}) as object).length} keys)` : "(empty)"}
          </button>
        ))}
      </div>
      {openKey && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-72 p-2 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded text-zinc-300"
            spellCheck={false}
          />
          {parseError && <div className="text-xs text-red-400">{parseError}</div>}
          <div className="flex gap-2">
            <button onClick={commit} className="px-3 py-1 text-xs rounded border border-amber-500 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">
              Apply {openKey}
            </button>
            <button onClick={() => setOpenKey(null)} className="px-3 py-1 text-xs rounded border border-zinc-700 hover:bg-zinc-800">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 border-b border-zinc-800 pb-1">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, tooltip, children }: { label: string; tooltip?: string; children: React.ReactNode }) {
  return (
    <label className="block" title={tooltip}>
      <span className="text-xs text-zinc-400 block mb-1">{label}</span>
      {children}
    </label>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function setupSummaryFromFull(id: string, s: FullSetup | undefined): SetupSummary {
  const r = (s ?? {}) as Record<string, unknown>;
  const sectionsObj = (r.SectionSetups ?? {}) as Record<string, unknown>;
  return {
    id,
    name: String(r.Name ?? "(unnamed)"),
    machineModel: String(r.FMachineModel ?? ""),
    machineSeries: String(r.FMachineSeries ?? ""),
    chamferTolerance: Number(r.ChamferTolerance ?? 0),
    endClearance: Number(r.EndClearance ?? 0),
    braceToDimple: Number(r.BraceToDimple ?? 0),
    braceToWebhole: Number(r.BraceToWebhole ?? 0),
    toolClearance: Number(r.ToolClearance ?? 0),
    dimpleToEnd: Number(r.DimpleToEnd ?? 0),
    boltHoleToEnd: Number(r.BoltHoleToEnd ?? 0),
    webHoleToEnd: Number(r.WebHoleToEnd ?? 0),
    minimumTagLength: Number(r.MinimumTagLength ?? 0),
    tabToTabDistance: Number(r.TabToTabDistance ?? 0),
    extraChamfers: String(r.ExtraChamfers).toLowerCase() === "true",
    endToEndChamfers: String(r.EndToEndChamfers).toLowerCase() === "true",
    suppressFasteners: String(r.SuppressFasteners).toLowerCase() === "true",
    sectionCount: Object.keys(sectionsObj).filter(k => k !== "Count").length,
  };
}

function frameTypeSummaryFromFull(id: string, t: FullFrameType | undefined): FrameTypeSummary {
  const r = (t ?? {}) as Record<string, unknown>;
  const fo = (r.FrameOptions ?? {}) as Record<string, unknown>;
  return {
    id,
    name: String(r.Name ?? "(unnamed)"),
    guid: String(r.GUID ?? ""),
    planLabelPrefix: String(r.PlanLabelPrefix ?? ""),
    defaultScriptName: String(r.DefaultScriptName ?? ""),
    defaultMachineSetupGuid: String(fo.DefaultMachineSetupGUID ?? ""),
    vrmlColor: String(fo.VRMLColor ?? ""),
    defaultKind: String(fo.DefaultKind ?? ""),
  };
}

function blankSetup(id: string): FullSetup {
  return {
    Name: `New Machine Setup ${id}`,
    DefaultName: `New Machine Setup ${id}`,
    FMachineModel: "F325iT",
    FMachineSeries: "F300i",
    InstanceGUID: newGuid(),
    DefaultGUID: newGuid(),
    ChamferTolerance: "4",
    BraceToDimple: "50",
    BraceToWebhole: "100",
    ToolClearance: "2",
    DimpleToEnd: "10",
    BoltHoleToEnd: "20",
    WebHoleToEnd: "16",
    B2BStickClearance: "2",
    EndClearance: "4",
    MinimumTagLength: "20",
    TabToTabDistance: "295",
    EndToTabDistance: "400",
    BoxedEndLength: "70",
    BoxedFirstDimpleOffset: "50",
    BoxDimpleSpacing: "1200",
    DoorSillNotchOffset: "0",
    DoubleBoltSpacing: "30",
    ExtraFlangeHoleOffset: "9",
    ExtraFlangeHoleOffsetAt90: "15",
    FPlateWidthDifferential: "3",
    FlangeSlotHeight: "11.1",
    LargeServiceToLeadingEdgeDistance: "600",
    LargeServiceToTrailingEdgeDistance: "700",
    MaxBoxToBoxHoleDelta: "2",
    MaxSplicingLength: "500",
    SplicingDimpleSpacing: "100",
    Web2Web: "50.4",
    BraceAsStud: "False",
    ExtraChamfers: "False",
    EndToEndChamfers: "False",
    FDualSection: "False",
    FixedWeb2Web: "False",
    InvertDimpleFlangeFastenings: "False",
    OnEdgeLipNotches: "True",
    OnFlySwage: "False",
    SuppressFasteners: "False",
    UseMaleFemaleDimples: "False",
    EndClearanceReference: "ecrOutsideWeb",
    ExtraFlangeHoles: "efhNone",
    FB2BTooling: "b2bNone",
    FastenerMating: "fmNone",
    PlateBoxingPieceType: "bptSelf",
    StudBoxingPieceType: "bptSelf",
    ImportTransforms: "",
    ToolSetup: { ChamferDetail: { Count: "0" }, TrussChamferDetail: { Count: "0" }, WebChamferDetail: { WebDetailCount: "0" }, FixedTools: { Count: "0" }, OptionalOnTools: { Count: "0" }, OptionalOffTools: { Count: "0" } },
    DefaultSectionOptions: {},
    Fasteners: { Count: "0" },
    ServiceHoleOptions: { Count: "0" },
    SectionSetups: { Count: "0" },
    DesignChecks: { Count: "0" },
    ImportToolMapping: { CSV: {}, OTHER: {} },
  };
}

function blankFrameType(id: string): FullFrameType {
  return {
    Name: `New Frame Type ${id}`,
    GUID: newGuid(),
    PlanLabelPrefix: "X",
    DefaultScriptName: "Auto Frame",
    DeflectionTrackGUID: "{00000000-0000-0000-0000-000000000000}",
    ScriptStudGUID: "{00000000-0000-0000-0000-000000000000}",
    ScriptPlateGUID: "{00000000-0000-0000-0000-000000000000}",
    FrameOptions: {
      AllowAutoTripleDetection: "True",
      AutoTripleMaxDistance: "5",
      DefaultMachineSetupGUID: "{00000000-0000-0000-0000-000000000000}",
      DrawElevationProfiles: "True",
      DefaultKind: "Wall",
      DefaultToolingFile: "",
      UseDeflectionTrack: "False",
      VRMLColor: "clGray",
    },
  };
}

function newGuid(): string {
  // Pseudo-GUID v4 — not cryptographically secure, but matches Detailer's
  // {XXXXXXXX-XXXX-4XXX-YXXX-XXXXXXXXXXXX} format.
  const hex = (n: number) => Math.floor(Math.random() * n).toString(16).padStart(8, "0").toUpperCase();
  return `{${hex(0xFFFFFFFF)}-${hex(0xFFFF).slice(0, 4)}-4${hex(0xFFF).slice(0, 3)}-${"89AB".charAt(Math.floor(Math.random() * 4))}${hex(0xFFF).slice(0, 3)}-${hex(0xFFFFFFFF)}${hex(0xFFFF).slice(0, 4)}}`;
}

const DELPHI_COLORS: Record<string, string> = {
  clBlack: "#000000", clWhite: "#ffffff", clRed: "#dc2626", clBlue: "#2563eb",
  clGreen: "#16a34a", clYellow: "#facc15", clFuchsia: "#d946ef", clTeal: "#0d9488",
  clMaroon: "#7f1d1d", clNavy: "#1e3a8a", clOlive: "#65a30d", clPurple: "#7c3aed",
  clGray: "#6b7280", clSilver: "#cbd5e1", clLime: "#84cc16", clAqua: "#06b6d4",
};

function delphiColorToCss(raw: string | undefined): string {
  if (!raw) return "#374151";
  if (raw.startsWith("$")) {
    const hex = raw.replace(/^\$/, "").padStart(8, "0");
    const bb = hex.slice(2, 4), gg = hex.slice(4, 6), rr = hex.slice(6, 8);
    return `#${rr}${gg}${bb}`;
  }
  return DELPHI_COLORS[raw] ?? "#374151";
}

function exportMachineTypes(full: Record<string, FullSetup>, order: string[]) {
  const machineSetups: Record<string, unknown> = { Count: String(order.length) };
  order.forEach((id, idx) => { machineSetups[String(idx)] = full[id]; });
  const payload = {
    FrameTypes: { Count: "0" },
    MachineSetups: machineSetups,
    SteelSpecSetups: { Count: "0" },
  };
  downloadJson(payload, "HYTEK-MACHINE-TYPES.sups");
}

function exportFrameTypes(full: Record<string, FullFrameType>, order: string[]) {
  const frameTypes: Record<string, unknown> = { Count: String(order.length) };
  order.forEach((id, idx) => { frameTypes[String(idx)] = full[id]; });
  const payload = {
    FrameTypes: frameTypes,
    MachineSetups: { Count: "0" },
    SteelSpecSetups: { Count: "0" },
  };
  downloadJson(payload, "HYTEK-FRAME-TYPES.sups");
}

function downloadJson(data: unknown, filename: string) {
  // UTF-8 BOM at start to match Detailer's .sups file format
  const bom = "﻿";
  // Detailer uses tab-indent + CRLF; we'll use 2-space + LF (still valid JSON, easier for diffs)
  const text = bom + JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
