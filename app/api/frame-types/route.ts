// GET /api/frame-types — return all HYTEK frame types from
// data/hytek-frame-types.json.

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

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
    const dataDir = path.join(process.cwd(), "data");
    const ftRaw = await fs.readFile(path.join(dataDir, "hytek-frame-types.json"), "utf8");
    const f = JSON.parse(ftRaw.replace(/^﻿/, ""));

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
      source: "data/hytek-frame-types.json",
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
