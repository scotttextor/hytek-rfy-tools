// GET /api/setups — return all HYTEK machine setups + frame types
// from data/hytek-machine-types.json and data/hytek-frame-types.json.
//
// These files are the authoritative source-of-truth for HYTEK's tooling
// rules. Master copies live on Y:\(08) DETAILING\(13) FRAMECAD\FrameCAD
// DETAILER\HYTEK MACHINE_FRAME TYPES\ — when HYTEK updates them, copy
// the .sups files into data/ as .json and redeploy.
//
// The codec auto-resolves which setup to use based on the input XML's
// profile web (e.g. 70S41 → setup [2] F325iT 70mm).

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

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
    const dataDir = path.join(process.cwd(), "data");
    const machineRaw = await fs.readFile(path.join(dataDir, "hytek-machine-types.json"), "utf8");
    const m = JSON.parse(machineRaw.replace(/^﻿/, ""));

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
      source: "data/hytek-machine-types.json",
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
