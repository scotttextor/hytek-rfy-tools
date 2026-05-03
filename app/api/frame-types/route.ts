// GET /api/frame-types — return all HYTEK frame types from active ruleset.
// PUT /api/frame-types — save edited frame types back to the active ruleset.

import { NextResponse } from "next/server";
import { getActive, getRulesetFrameTypes, saveRuleset } from "@/lib/rulesets";

export const runtime = "nodejs";

interface FrameTypeSummary {
  id: string;
  name: string;
  guid: string;
  planLabelPrefix: string;
  defaultScriptName: string;
  defaultMachineSetupGuid?: string;
  scriptStudGuid?: string;
  scriptPlateGuid?: string;
  vrmlColor?: string;
  defaultKind?: string;
  drawElevationProfiles?: boolean;
  useDeflectionTrack?: boolean;
}

export async function GET() {
  try {
    const active = await getActive();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = await getRulesetFrameTypes(active) as any;

    const types: FrameTypeSummary[] = [];
    const fullTypes: Record<string, unknown> = {};

    for (const id of Object.keys(f.FrameTypes ?? {}).filter(k => k !== "Count")) {
      const t = f.FrameTypes[id];
      types.push({
        id,
        name: t.Name,
        guid: t.GUID,
        planLabelPrefix: t.PlanLabelPrefix,
        defaultScriptName: t.DefaultScriptName,
        defaultMachineSetupGuid: t.FrameOptions?.DefaultMachineSetupGUID,
        scriptStudGuid: t.ScriptStudGUID,
        scriptPlateGuid: t.ScriptPlateGUID,
        vrmlColor: t.FrameOptions?.VRMLColor,
        defaultKind: t.FrameOptions?.DefaultKind,
        drawElevationProfiles: String(t.FrameOptions?.DrawElevationProfiles ?? "").toLowerCase() === "true",
        useDeflectionTrack: String(t.FrameOptions?.UseDeflectionTrack ?? "").toLowerCase() === "true",
      });
      fullTypes[id] = t;
    }

    return NextResponse.json({
      types,
      full: fullTypes,
      count: types.length,
      ruleset: active,
      source: `data/rulesets/${active}/frame-types.json`,
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

export async function PUT(req: Request) {
  try {
    const active = await getActive();
    if (active === "default") {
      return NextResponse.json(
        { error: "Cannot save to the default ruleset. Use 'Save As' to create a new editable copy first." },
        { status: 403 },
      );
    }
    const body = await req.json() as { full?: Record<string, unknown> };
    if (!body || !body.full || typeof body.full !== "object") {
      return NextResponse.json({ error: "Body must contain { full: {...} }" }, { status: 400 });
    }
    const ids = Object.keys(body.full);
    const frameTypes = {
      FrameTypes: {
        ...body.full,
        Count: String(ids.length),
      },
    };
    await saveRuleset({ name: active, frameTypes });
    return NextResponse.json({ ok: true, saved: ids.length, ruleset: active });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
