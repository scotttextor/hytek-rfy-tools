"use client";

import { useEffect, useState } from "react";

interface SetupSummary {
  id: string;
  name: string;
  machineModel: string;
  machineSeries: string;
  chamferTolerance: number;
  endClearance: number;
  braceToDimple: number;
  braceToWebhole: number;
  toolClearance: number;
  dimpleToEnd: number;
  boltHoleToEnd: number;
  webHoleToEnd: number;
  minimumTagLength: number;
  tabToTabDistance: number;
  extraChamfers: boolean;
  endToEndChamfers: boolean;
  suppressFasteners: boolean;
  sectionCount: number;
}

interface FrameTypeSummary {
  id: string;
  name: string;
  guid: string;
  planLabelPrefix: string;
  defaultScriptName: string;
  defaultMachineSetupGuid?: string;
  vrmlColor?: string;
  defaultKind?: string;
}

type Tab = "machines" | "frames";

export default function RulesPage() {
  const [tab, setTab] = useState<Tab>("machines");
  const [setups, setSetups] = useState<SetupSummary[] | null>(null);
  const [setupsFull, setSetupsFull] = useState<Record<string, unknown>>({});
  const [frameTypes, setFrameTypes] = useState<FrameTypeSummary[] | null>(null);
  const [frameTypesFull, setFrameTypesFull] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/setups").then(r => r.json()),
      fetch("/api/frame-types").then(r => r.json()),
    ]).then(([s, f]) => {
      if (s.error) { setError(s.error); return; }
      if (f.error) { setError(f.error); return; }
      setSetups(s.setups);
      setSetupsFull(s.full);
      setFrameTypes(f.types);
      setFrameTypesFull(f.full);
    }).catch(e => setError(String(e)));
  }, []);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <header className="mb-6">
        <div className="flex items-baseline gap-4 mb-2">
          <h1 className="text-2xl font-bold">HYTEK Rules Manager</h1>
          <a href="/" className="text-sm text-zinc-400 hover:text-zinc-200">← Back to RFY tools</a>
        </div>
        <p className="text-sm text-zinc-400">
          Source-of-truth tooling rules from HYTEK&apos;s FrameCAD Detailer setup files.
          Master copies live on <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-xs">Y:\(08) DETAILING\(13) FRAMECAD\FrameCAD DETAILER\HYTEK MACHINE_FRAME TYPES\</code>.
          To add or edit rules, modify the <code className="bg-zinc-900 px-1.5 py-0.5 rounded text-xs">.sups</code> file in Detailer, export, then replace
          {" "}<code className="bg-zinc-900 px-1.5 py-0.5 rounded text-xs">data/hytek-{tab === "machines" ? "machine" : "frame"}-types.json</code>.
        </p>
      </header>

      <div className="flex gap-1 mb-4 border-b border-zinc-800">
        <button
          onClick={() => setTab("machines")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "machines"
              ? "text-amber-400 border-b-2 border-amber-400"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Machine Setups {setups ? `(${setups.length})` : ""}
        </button>
        <button
          onClick={() => setTab("frames")}
          className={`px-4 py-2 text-sm font-medium ${
            tab === "frames"
              ? "text-amber-400 border-b-2 border-amber-400"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Frame Types {frameTypes ? `(${frameTypes.length})` : ""}
        </button>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-200 p-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {tab === "machines" && (
        <MachineSetupsTable
          setups={setups}
          full={setupsFull}
          detailId={detailId}
          onDetail={setDetailId}
        />
      )}

      {tab === "frames" && (
        <FrameTypesTable
          types={frameTypes}
          full={frameTypesFull}
          detailId={detailId}
          onDetail={setDetailId}
        />
      )}
    </main>
  );
}

function MachineSetupsTable({
  setups,
  full,
  detailId,
  onDetail,
}: {
  setups: SetupSummary[] | null;
  full: Record<string, unknown>;
  detailId: string | null;
  onDetail: (id: string | null) => void;
}) {
  if (!setups) return <div className="text-zinc-400 text-sm">Loading…</div>;

  return (
    <>
      <div className="overflow-x-auto border border-zinc-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-300">
            <tr>
              <th className="px-3 py-2 text-left font-medium">ID</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Series</th>
              <th className="px-3 py-2 text-right font-medium" title="Chamfer Tolerance — corner interference threshold (mm) before chamfer kicks in">Chamfer Tol</th>
              <th className="px-3 py-2 text-right font-medium" title="EndClearance — plate trim at each end">End Clear</th>
              <th className="px-3 py-2 text-right font-medium">Brace→Dimple</th>
              <th className="px-3 py-2 text-right font-medium">Tool Clear</th>
              <th className="px-3 py-2 text-right font-medium">Dimple→End</th>
              <th className="px-3 py-2 text-right font-medium">Min Tag Len</th>
              <th className="px-3 py-2 text-right font-medium">Sections</th>
              <th className="px-3 py-2 text-center font-medium">ExtraCham</th>
              <th className="px-3 py-2 text-center font-medium">EndToEnd</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {setups.map((s) => (
              <tr
                key={s.id}
                className="border-t border-zinc-800 hover:bg-zinc-900/50 cursor-pointer"
                onClick={() => onDetail(s.id)}
              >
                <td className="px-3 py-2 text-zinc-500">{s.id}</td>
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
                <td className="px-3 py-2 text-right">
                  <span className="text-amber-400 text-xs">View →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailId && full[detailId] && (
        <DetailModal
          title={`Machine Setup: ${(full[detailId] as { Name?: string }).Name ?? detailId}`}
          data={full[detailId]}
          onClose={() => onDetail(null)}
        />
      )}
    </>
  );
}

function FrameTypesTable({
  types,
  full,
  detailId,
  onDetail,
}: {
  types: FrameTypeSummary[] | null;
  full: Record<string, unknown>;
  detailId: string | null;
  onDetail: (id: string | null) => void;
}) {
  if (!types) return <div className="text-zinc-400 text-sm">Loading…</div>;

  // Color preview from Delphi color names
  const colorMap: Record<string, string> = {
    clBlack: "#000000",
    clWhite: "#ffffff",
    clRed: "#dc2626",
    clBlue: "#2563eb",
    clGreen: "#16a34a",
    clYellow: "#facc15",
    clFuchsia: "#d946ef",
    clTeal: "#0d9488",
    clMaroon: "#7f1d1d",
    clNavy: "#1e3a8a",
    clOlive: "#65a30d",
    clPurple: "#7c3aed",
    clGray: "#6b7280",
    clSilver: "#cbd5e1",
    clLime: "#84cc16",
    clAqua: "#06b6d4",
  };

  const getColor = (raw: string | undefined): string => {
    if (!raw) return "#374151";
    if (raw.startsWith("$")) {
      // Delphi BGR format: $00BBGGRR
      const hex = raw.replace(/^\$/, "").padStart(8, "0");
      const bb = hex.slice(2, 4), gg = hex.slice(4, 6), rr = hex.slice(6, 8);
      return `#${rr}${gg}${bb}`;
    }
    return colorMap[raw] ?? "#374151";
  };

  return (
    <>
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
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr
                key={t.id}
                className="border-t border-zinc-800 hover:bg-zinc-900/50 cursor-pointer"
                onClick={() => onDetail(t.id)}
              >
                <td className="px-3 py-2 text-zinc-500">{t.id}</td>
                <td className="px-3 py-2 font-medium">{t.name}</td>
                <td className="px-3 py-2 font-mono text-amber-400">{t.planLabelPrefix}</td>
                <td className="px-3 py-2 text-zinc-400">{t.defaultKind ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-400">{t.defaultScriptName}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block w-4 h-4 rounded border border-zinc-600"
                      style={{ background: getColor(t.vrmlColor) }}
                      title={t.vrmlColor}
                    />
                    <span className="text-zinc-500 text-xs font-mono">{t.vrmlColor ?? "—"}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="text-amber-400 text-xs">View →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detailId && full[detailId] && (
        <DetailModal
          title={`Frame Type: ${(full[detailId] as { Name?: string }).Name ?? detailId}`}
          data={full[detailId]}
          onClose={() => onDetail(null)}
        />
      )}
    </>
  );
}

function DetailModal({
  title,
  data,
  onClose,
}: {
  title: string;
  data: unknown;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-5xl max-h-[85vh] w-full overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="overflow-auto flex-1 p-4">
          <pre className="text-xs text-zinc-300 font-mono whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
        <footer className="px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500">
          Read-only view. To edit: modify in FrameCAD Detailer → export .sups → replace the corresponding file in <code>data/</code>.
        </footer>
      </div>
    </div>
  );
}
