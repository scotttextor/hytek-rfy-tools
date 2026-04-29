// Convert FrameCAD CNC import XML (<framecad_import> root) → rollformer CSV →
// (callable through synthesizeRfyFromCsv) → RFY.
//
// FrameCAD Detailer normally does this conversion when a job is imported. We
// replicate just enough of it for rollformer consumption: the machine cares
// about profile + length + the order of operations along the length, NOT the
// 3D layout. We fill the elev (X,Y) columns with conservative defaults.

import { XMLParser } from "fast-xml-parser";

interface Stick {
  name: string;
  type: string;
  usage: string;
  gauge: number;
  start: [number, number, number];
  end: [number, number, number];
  profile: { web: number; l_flange: number; r_flange: number; l_lip: number; r_lip: number; shape: string };
  flipped: boolean;
}

interface Frame {
  name: string;
  type: string;
  sticks: Stick[];
}

interface Plan {
  name: string;
  frames: Frame[];
}

function parseTriple(text: string): [number, number, number] {
  const nums = text.trim().split(/[ ,\t]+/).map(Number);
  return [nums[0] || 0, nums[1] || 0, nums[2] || 0];
}

function distance3D(a: [number, number, number], b: [number, number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Map FrameCAD usage attribute → CSV TYPE label used by HYTEK rollformer files. */
function csvTypeForUsage(usage: string, type: string): string {
  const u = (usage || "").toLowerCase();
  const t = (type || "").toLowerCase();
  if (u === "topplate") return "TOPPLATE";
  if (u === "bottomplate") return "BOTTOMPLATE";
  if (u === "headplate" || u === "head") return "HEADPLATE";
  if (u === "sill") return "SILL";
  if (u === "nog" || u === "noggin") return "NOG";
  if (u === "endstud") return "ENDSTUD";
  if (u === "jackstud") return "JACKSTUD";
  if (u === "trimstud") return "TRIMSTUD";
  if (u === "brace") return "BRACE";
  if (u === "stud") return "STUD";
  if (t === "plate") return "TOPPLATE";
  if (t === "stud") return "STUD";
  if (t === "brace") return "BRACE";
  return type.toUpperCase() || "STUD";
}

/** Build the CSV profile code: 70S41_0.75 = web 70mm, flange = max(l,r), gauge 0.75.
 *  Detailer uses the LARGER flange (the asymmetric C is named after its longer side). */
function profileCode(web: number, lFlange: number, rFlange: number, gauge: number): string {
  const flange = Math.round(Math.max(lFlange, rFlange));
  return `${web}S${flange}_${gauge.toFixed(2)}`;
}

function parsePlans(xmlText: string): { jobnum: string; plans: Plan[] } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: true,
    parseTagValue: false,
    isArray: (name) => ["plan", "frame", "stick"].includes(name),
  });
  const doc = parser.parse(xmlText);
  const root = doc.framecad_import;
  if (!root) throw new Error("Not a <framecad_import> XML document");
  const jobnum = String(root.jobnum ?? "JOB").replace(/["\s]/g, "");

  const plans: Plan[] = [];
  for (const planNode of root.plan ?? []) {
    const plan: Plan = { name: String(planNode["@_name"] ?? "PLAN"), frames: [] };
    for (const frameNode of planNode.frame ?? []) {
      const frame: Frame = { name: String(frameNode["@_name"] ?? "F1"), type: String(frameNode["@_type"] ?? ""), sticks: [] };
      for (const stickNode of frameNode.stick ?? []) {
        const profileAttrs = (stickNode.profile && (stickNode.profile.$ ?? stickNode.profile)) ?? {};
        const profile = {
          web: Number(stickNode.profile?.["@_web"] ?? profileAttrs["@_web"] ?? 0),
          l_flange: Number(stickNode.profile?.["@_l_flange"] ?? profileAttrs["@_l_flange"] ?? 0),
          r_flange: Number(stickNode.profile?.["@_r_flange"] ?? profileAttrs["@_r_flange"] ?? 0),
          l_lip: Number(stickNode.profile?.["@_l_lip"] ?? profileAttrs["@_l_lip"] ?? 0),
          r_lip: Number(stickNode.profile?.["@_r_lip"] ?? profileAttrs["@_r_lip"] ?? 0),
          shape: String(stickNode.profile?.["@_shape"] ?? profileAttrs["@_shape"] ?? "C"),
        };
        const stick: Stick = {
          name: String(stickNode["@_name"] ?? ""),
          type: String(stickNode["@_type"] ?? ""),
          usage: String(stickNode["@_usage"] ?? ""),
          gauge: Number(stickNode["@_gauge"] ?? 0),
          start: parseTriple(String(stickNode.start ?? "0,0,0")),
          end: parseTriple(String(stickNode.end ?? "0,0,0")),
          profile,
          flipped: String(stickNode.flipped ?? "").trim().toLowerCase() === "true",
        };
        frame.sticks.push(stick);
      }
      plan.frames.push(frame);
    }
    plans.push(plan);
  }
  return { jobnum, plans };
}

/** Convert a single plan's frames+sticks into CSV rows. */
function planToCsv(jobnum: string, plan: Plan): string {
  const lines: string[] = [`DETAILS,${jobnum},${plan.name}`];
  for (const frame of plan.frames) {
    for (const stick of frame.sticks) {
      const length = Math.round(distance3D(stick.start, stick.end) * 10) / 10;
      const profile = profileCode(stick.profile.web, stick.profile.l_flange, stick.profile.r_flange, stick.gauge);
      const type = csvTypeForUsage(stick.usage, stick.type);
      const direction = stick.flipped ? "LEFT" : "RIGHT";
      // Elev coords: the rollformer doesn't strictly need them; use sensible
      // defaults so the synthesizer can place the stick. (We use 0 for the
      // "off-axis" coordinate and length for the "along-axis" end.)
      const sx = 0, sy = 0, ex = length, ey = 0;
      const flange = Math.round((stick.profile.l_flange + stick.profile.r_flange) / 2);
      const cells = [
        "COMPONENT",
        `${frame.name}-${stick.name}`,
        profile,
        type,
        direction,
        "1",
        "",
        length.toString(),
        sx.toString(),
        sy.toString(),
        ex.toString(),
        ey.toString(),
        flange.toString(),
      ];
      lines.push(cells.join(","));
    }
  }
  return lines.join("\n");
}

/** Top-level: parse a framecad_import XML and emit a multi-plan CSV. */
export function framecadImportToCsv(xmlText: string): { csv: string; planCount: number; frameCount: number; stickCount: number } {
  const { jobnum, plans } = parsePlans(xmlText);
  let frameCount = 0, stickCount = 0;
  const planCsvs: string[] = [];
  for (const plan of plans) {
    frameCount += plan.frames.length;
    for (const f of plan.frames) stickCount += f.sticks.length;
    planCsvs.push(planToCsv(jobnum, plan));
  }
  return { csv: planCsvs.join("\n"), planCount: plans.length, frameCount, stickCount };
}
