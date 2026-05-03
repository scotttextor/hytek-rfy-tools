// GET /api/setups — return all HYTEK machine setups from the ACTIVE ruleset.
//
// Reads from data/rulesets/<active>/machine-types.json. The active ruleset
// is set via POST /api/rulesets/active. Default ruleset is read-only and
// represents factory HYTEK rules (extracted from FrameCAD Detailer .sups).
//
// The codec auto-resolves which setup to use based on the input XML's
// profile web (e.g. 70S41 → setup [2] F325iT 70mm).

import { NextResponse } from "next/server";
import { getActive, getRulesetMachineTypes } from "@/lib/rulesets";

export const runtime = "nodejs";

interface MachineSetupSummary {
  id: string;
  name: string;
  machineModel: string;
  machineSeries: string;
  defaultGuid: string;
  // Only the most-asked-about tooling values, full record returned in details
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
  // Booleans
  extraChamfers: boolean;
  endToEndChamfers: boolean;
  suppressFasteners: boolean;
  // Section count for table display
  sectionCount: number;
}

function toNum(s: unknown): number { return Number(s); }
function toBool(s: unknown): boolean { return String(s).toLowerCase() === "true"; }

export async function GET() {
  try {
    const active = await getActive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = await getRulesetMachineTypes(active) as any;

    const setups: MachineSetupSummary[] = [];
    const fullSetups: Record<string, unknown> = {};

    for (const id of Object.keys(m.MachineSetups ?? {}).filter(k => k !== "Count")) {
      const s = m.MachineSetups[id];
      const sectionsKeys = Object.keys(s.SectionSetups ?? {}).filter(k => k !== "Count");
      setups.push({
        id,
        name: s.Name,
        machineModel: s.FMachineModel,
        machineSeries: s.FMachineSeries,
        defaultGuid: s.DefaultGUID,
        chamferTolerance: toNum(s.ChamferTolerance),
        endClearance: toNum(s.EndClearance),
        braceToDimple: toNum(s.BraceToDimple),
        braceToWebhole: toNum(s.BraceToWebhole),
        toolClearance: toNum(s.ToolClearance),
        dimpleToEnd: toNum(s.DimpleToEnd),
        boltHoleToEnd: toNum(s.BoltHoleToEnd),
        webHoleToEnd: toNum(s.WebHoleToEnd),
        minimumTagLength: toNum(s.MinimumTagLength),
        tabToTabDistance: toNum(s.TabToTabDistance),
        extraChamfers: toBool(s.ExtraChamfers),
        endToEndChamfers: toBool(s.EndToEndChamfers),
        suppressFasteners: toBool(s.SuppressFasteners),
        sectionCount: sectionsKeys.length,
      });
      fullSetups[id] = s;
    }

    return NextResponse.json({
      setups,
      full: fullSetups,
      count: setups.length,
      ruleset: active,
      source: `data/rulesets/${active}/machine-types.json`,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 500 },
    );
  }
}

// PUT /api/setups — save edited machine types back to the active ruleset.
//   body: { full: { <id>: <setup>, ... } } — the same shape as `full` returned by GET
import { saveRuleset, isDefaultName } from "@/lib/rulesets";

export async function PUT(req: Request) {
  try {
    const active = await getActive();
    // Reject any default* ruleset (default, default.1, default.2 ...)
    // — see lib/rulesets.ts for the full standing-directive rationale.
    if (isDefaultName(active)) {
      return NextResponse.json(
        { error: `Cannot save to the protected factory default "${active}". Click 'Save As' to create a new editable copy first.` },
        { status: 403 },
      );
    }
    const body = await req.json() as { full?: Record<string, unknown> };
    if (!body || !body.full || typeof body.full !== "object") {
      return NextResponse.json({ error: "Body must contain { full: {...} }" }, { status: 400 });
    }
    // Reconstruct the original .sups-style envelope: { MachineSetups: { ...full, Count: N } }
    const ids = Object.keys(body.full);
    const machineTypes = {
      FrameTypes: { Count: "0" },
      MachineSetups: {
        ...body.full,
        Count: String(ids.length),
      },
    };
    await saveRuleset({ name: active, machineTypes });
    return NextResponse.json({ ok: true, saved: ids.length, ruleset: active });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
