// Returns the codec's complete tooling rule set as JSON.
//
// This is the SINGLE SOURCE OF TRUTH for what the codec does to each
// stick. The /rules/tooling UI reads from here. Future: a POST endpoint
// will accept overrides and save them to a database for versioned,
// editable rule sets.
//
// The rules surfaced here are:
//   1. Per-stick rules from RULE_TABLE — declarative, fire on each stick
//      based on role+profile+length matching. The bulk of tooling.
//   2. Frame-context rules — programmatic logic for crossings (stud-plate,
//      stud-nog, truss-web-chord) and B2B detection. Surfaced as
//      *parameters* (join gaps, suppression distances, etc.).
//   3. Trim rules — applied in framecad-import.ts before synthesis.
//
// The intent: anyone (Scott or future ops staff) can see EXACTLY what
// rules drive the rollformer output, without having to read TS code.
import { NextResponse } from "next/server";
import { RULE_TABLE } from "@hytek/rfy-codec";

export const runtime = "nodejs";

// Frame-context parameters (mirror the constants in
// hytek-rfy-codec/src/rules/frame-context.ts).
// These are not in RULE_TABLE because they're not per-stick rules — they
// describe how the geometry-based emission works. Surfaced here so the UI
// can show them alongside the per-stick rules.
const FRAME_CONTEXT_PARAMS = {
  studNogCrossing: {
    type: "LipNotch",
    note: "Always LipNotch on stud at nog crossing (HG260001 reference). Earlier 'Swage if nog passes through' rule was reverted 2026-05-02 after rollformer test cut showed wrong steel.",
    spanMm: 45,
    dimpleOffsetMm: 22.5,
  },
  wallLipNotchJoinGap: {
    valueMm: 0,
    note: "Walls NEVER join LipNotches. Detailer keeps every stud crossing as its own 45mm notch even when overlapping (verified vs HG260001 L2/T1 triple-stud cluster).",
  },
  trussLipNotchJoinGap: {
    valueMm: 8,
    note: "Truss chords DO join adjacent LipNotches at panel-point clusters (verified vs HG260044 TIN PC7-1/B1 — 4-web cluster joins to one 102mm-wide notch).",
  },
  kbVirtualSuppressionDistanceMm: {
    valueMm: 30,
    note: "Suppress Kb-edge virtual crossings within this distance of any real stud crossing. Eliminates phantom notches at door jambs where Kb bbox extends past adjacent stud's center.",
  },
  innerServiceFromXmlPanelPoints: {
    enabled: false,
    note: "Detailer's actual InnerService positions come from architectural drawing's panel-point grid (e.g. T1 InnerService @285.8, @780.5, @1286.5 — these are ALL stud-pair midpoints from the original wall design). Until we read that data from XML, we use a fixed 600mm spacing from offset 306mm which matches HG260001 and HG260044's wall T-plate ops. Frame-context midpoint approximation produced wrong positions on HG260001.",
  },
  studCrossingDedupQuantizeMm: {
    valueMm: 0.1,
    note: "Treat crossings within 0.1mm of each other as duplicates (skip subsequent emissions). Larger values would collapse B2B partner pairs into single emissions, which is wrong.",
  },
};

// Trim rules from framecad-import.ts. These run BEFORE per-stick rules
// fire, modifying the stick's start/end coordinates.
const TRIM_RULES = {
  endClearancePlate: {
    valueMm: 4,
    appliesTo: "TopPlate, BottomPlate, TopChord, BottomChord",
    note: "Trim plates and chords at each end by EndClearance from the F325iT machine setup. Verified vs HG260044 GF-TIN PC7-1/B1: input centerline 2640 → output 2632 (4mm/end).",
  },
  fullStudTrim: {
    valueMm: 2,
    appliesTo: "Stud, EndStud, JackStud, TrimStud",
    note: "Trim full-height studs by 2mm at each end. Verified vs HG260001/HG260044: every stud has outline range [4..length-4] for studs spanning the full wall height.",
  },
  headerTrim: {
    valueMm: 0,
    appliesTo: "H header sticks (above doors/windows)",
    note: "REMOVED 2026-05-02 — was 1mm/end but rollformer test cut showed headers came out 2mm short. Verified vs HG260001 H1: input 2266 → Detailer output 2266 (NO trim). The Kb cripple's own 2mm trim provides assembly clearance.",
  },
  kbStudEndTrim: {
    valueMm: 2,
    appliesTo: "Kb cripple/knee braces",
    note: "Stud-end is normalized to be 'start' (swap if needed for Chamfer-at-start rule) then trimmed 2mm along the diagonal toward end. Verified vs HG260001 Kb1-Kb4 — all match.",
  },
  wTrussWebVerticalExtend: {
    valueMm: "lipDepth (typically 11)",
    appliesTo: "Vertical truss web (W with usage='web' and no horizontal component)",
    note: "Detailer EXTENDS the W's length by its lip depth so the cut steel reaches THROUGH the chord's inner web face into the chord lip cavity. Verified vs HG260044 GF-TIN PC2-1/W3: input 606 → Detailer 617 (= 606 + r_lip 11).",
  },
  wTrussWebDiagonalTrim: {
    valueMm: 2,
    appliesTo: "Diagonal truss web (W with usage='web' AND horizontal component)",
    note: "Trim 2mm at end along the W's direction (Kb-style). Verified vs HG260044 TIN PC2-1/W4.",
  },
};

// Convert a rule entry to a JSON-friendly representation.
// Predicates (functions) can't be serialized — we mark them as opaque.
function ruleToJson(rule: any) {
  return {
    toolType: rule.toolType,
    kind: rule.kind,
    anchor: rule.anchor,
    spanLength: rule.spanLength ?? null,
    confidence: rule.confidence,
    notes: rule.notes ?? null,
    hasPredicate: typeof rule.predicate === "function",
    predicateSource: rule.predicate ? rule.predicate.toString() : null,
  };
}

function groupToJson(g: any, index: number) {
  return {
    id: `group-${index}`,
    rolePattern: g.rolePattern.source ?? String(g.rolePattern),
    profilePattern: g.profilePattern.source ?? String(g.profilePattern),
    lengthRange: [
      g.lengthRange[0],
      g.lengthRange[1] === Infinity ? "Infinity" : g.lengthRange[1],
    ],
    ruleCount: g.rules.length,
    rules: g.rules.map(ruleToJson),
  };
}

export async function GET() {
  const groups = (RULE_TABLE as any[]).map(groupToJson);
  return NextResponse.json({
    version: 2,
    description: "HYTEK RFY codec rule registry — all rules that drive the F300i rollformer output. See routes /rules/tooling for the editable view.",
    summary: {
      groupCount: groups.length,
      totalRules: groups.reduce((n, g) => n + g.ruleCount, 0),
      profilesCovered: [...new Set(groups.map(g => g.profilePattern))],
      rolesCovered: [...new Set(groups.map(g => g.rolePattern))],
    },
    perStickRules: groups,
    frameContextParams: FRAME_CONTEXT_PARAMS,
    trimRules: TRIM_RULES,
  });
}
