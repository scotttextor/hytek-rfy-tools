// Color metadata per tool-op type — used by ToolOp.tsx to add a colored
// outline ring around each marker, and by Legend.tsx to display the
// swatch + label table.
//
// Design principle: the realistic shape (steel grey body, black hole,
// etc.) stays as-is so the wall still LOOKS like steel. The colored
// outline is layered ON TOP as a thin stroke ring so users can scan
// the wall and identify what each mark is at a glance.

import type { ToolType } from "@hytek/rfy-codec";

export interface ToolColorMeta {
  /** Hex color for the outline ring + the legend swatch. */
  color: string;
  /** CSV-style human-readable label (matches what's emitted in the CSV file). */
  csvLabel: string;
  /** One-line description of what the tool does physically. */
  description: string;
}

/**
 * Color palette: distinct hues per tool type, arranged so semantically
 * similar tools share a colour family:
 *   - Reds / pinks  → cuts on the LIP edges (LipNotch, flange variants)
 *   - Yellow / orange → SHAPE deformation (Dimple bumps, Swage ribs)
 *   - Purple → cuts in the WEB face (InnerNotch / WEB NOTCH)
 *   - Blues → HOLES through the web (Web/BOLT, Bolt/ANCHOR)
 *   - Greens → SCREW / ANCHOR clusters + corner cuts (Chamfer)
 *   - Teal → SERVICE slots (cable / pipe pass-through)
 */
export const TOOL_COLORS: Record<ToolType, ToolColorMeta> = {
  LipNotch: {
    color: "#ef4444",  // red — cuts in lip
    csvLabel: "LIP NOTCH",
    description: "V-cut on each lip edge — emitted at every stud crossing on plates",
  },
  LeftFlange: {
    color: "#f97316",  // orange-red
    csvLabel: "LIP NOTCH",
    description: "Single-side V-cut on the left lip",
  },
  RightFlange: {
    color: "#ec4899",  // pink
    csvLabel: "LIP NOTCH",
    description: "Single-side V-cut on the right lip",
  },
  LeftPartialFlange: {
    color: "#fb7185",  // light pink
    csvLabel: "LIP NOTCH",
    description: "Half-depth V-cut on the left lip",
  },
  RightPartialFlange: {
    color: "#fda4af",  // coral
    csvLabel: "LIP NOTCH",
    description: "Half-depth V-cut on the right lip",
  },
  InnerDimple: {
    color: "#facc15",  // brand-adjacent yellow
    csvLabel: "INNER DIMPLE",
    description: "Pre-punched dome bump — interior alignment / connection point",
  },
  Swage: {
    color: "#f59e0b",  // amber
    csvLabel: "SWAGE",
    description: "Oval bump — stiffening rib on web face",
  },
  InnerNotch: {
    color: "#a855f7",  // purple
    csvLabel: "WEB NOTCH",
    description: "Rectangular notch IN the web face — fitment cutout",
  },
  Web: {
    color: "#06b6d4",  // cyan
    csvLabel: "BOLT HOLES",
    description: "Hole through the web for bolting fasteners",
  },
  Bolt: {
    color: "#3b82f6",  // blue
    csvLabel: "ANCHOR",
    description: "Anchor bolt hole — bottom plate into slab",
  },
  ScrewHoles: {
    color: "#22c55e",  // green
    csvLabel: "ANCHOR",
    description: "Cluster of small screw holes — chord-pair connection",
  },
  InnerService: {
    color: "#14b8a6",  // teal
    csvLabel: "SERVICE HOLE",
    description: "Oval slot for cables / pipes pass-through",
  },
  Chamfer: {
    color: "#84cc16",  // lime
    csvLabel: "FULL CHAMFER",
    description: "Triangular corner cut at stick end — diagonal sticks (Kb / W)",
  },
  TrussChamfer: {
    color: "#84cc16",  // same lime — same physical operation
    csvLabel: "FULL CHAMFER",
    description: "Truss variant of corner chamfer",
  },
};

export const ALL_TOOL_TYPES: ToolType[] = [
  "LipNotch", "LeftFlange", "RightFlange", "LeftPartialFlange", "RightPartialFlange",
  "InnerDimple", "Swage",
  "InnerNotch",
  "Web", "Bolt", "ScrewHoles",
  "InnerService",
  "Chamfer", "TrussChamfer",
];
