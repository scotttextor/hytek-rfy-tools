// Convert FrameCAD CNC import XML (<framecad_import> root) → RFY.
//
// Two output paths exist:
//   - framecadImportToRfy()  — preferred. Bypasses CSV; uses real 3D
//                              <envelope> + <start>/<end> coordinates so
//                              the rollformer can render correct elevation.
//   - framecadImportToCsv()  — legacy. Strips 3D, sticks collapse to y=0.
//                              Kept for callers that still need the CSV
//                              representation, but should NOT be fed back
//                              through synthesizeRfyFromCsv for rollformer
//                              consumption — it produces the green-screen
//                              bug (every stick at y∈[-20,20] in a 2765mm
//                              frame).

import { XMLParser } from "fast-xml-parser";
import {
  generateTooling,
  synthesizeRfyFromPlans,
  getMachineSetupForProfile,
  getDefaultMachineSetup,
  deriveFrameBasis,
  projectToFrameLocal,
  type StickContext,
  type MachineSetup,
  type ParsedProject, type ParsedPlan, type ParsedFrame, type ParsedStick,
  type FrameBasis,
  type Vec3,
} from "@hytek/rfy-codec";
import type { RfyToolingOp } from "@hytek/rfy-codec";

// Map RfyToolingOp.type → CSV type label (mirrors codec's TOOL_TO_CSV).
const RFY_TYPE_TO_CSV: Record<string, string> = {
  Bolt: "BOLT HOLES",
  Chamfer: "FULL CHAMFER",
  TrussChamfer: "FULL CHAMFER",
  InnerDimple: "INNER DIMPLE",
  InnerNotch: "WEB NOTCH",
  InnerService: "SERVICE HOLE",
  LeftFlange: "LIP NOTCH",
  LeftPartialFlange: "LIP NOTCH",
  LipNotch: "LIP NOTCH",
  RightFlange: "LIP NOTCH",
  RightPartialFlange: "LIP NOTCH",
  ScrewHoles: "ANCHOR",
  Swage: "SWAGE",
  Web: "WEB NOTCH",
};

interface RawStick {
  name: string;
  type: string;
  usage: string;
  gauge: number;
  start: Vec3;
  end: Vec3;
  profile: { web: number; l_flange: number; r_flange: number; l_lip: number; r_lip: number; shape: string };
  flipped: boolean;
}

interface RawFrame {
  name: string;
  type: string;
  envelope: [Vec3, Vec3, Vec3, Vec3] | null;
  sticks: RawStick[];
}

interface RawPlan {
  name: string;
  frames: RawFrame[];
}

function parseTriple(text: string): Vec3 {
  const nums = text.trim().split(/[ ,\t]+/).map(Number);
  return { x: nums[0] || 0, y: nums[1] || 0, z: nums[2] || 0 };
}

function distance3D(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
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

interface ProjectMeta {
  jobnum: string;
  projectName: string;
  client: string;
  date: string;
}

function parsePlans(xmlText: string): ProjectMeta & { plans: RawPlan[] } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: true,
    parseTagValue: false,
    isArray: (name) => ["plan", "frame", "stick", "vertex"].includes(name),
  });
  const doc = parser.parse(xmlText);
  const root = doc.framecad_import;
  if (!root) throw new Error("Not a <framecad_import> XML document");
  const jobnum = String(root.jobnum ?? "JOB").replace(/["\s]/g, "");
  const projectName = String(root["@_name"] ?? jobnum).replace(/^"\s*|\s*"$/g, "").trim();
  const client = String(root.client ?? "").replace(/["\s]/g, " ").trim();
  // datedrawn is "DD-MM-YYYY"; FrameCAD output uses "YYYY-MM-DD"
  const dateRaw = String(root.drawing_info?.datedrawn ?? "").replace(/["\s]/g, "");
  const dateMatch = dateRaw.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]!.padStart(2,"0")}-${dateMatch[1]!.padStart(2,"0")}` : new Date().toISOString().slice(0, 10);

  const plans: RawPlan[] = [];
  for (const planNode of root.plan ?? []) {
    const plan: RawPlan = { name: String(planNode["@_name"] ?? "PLAN"), frames: [] };
    for (const frameNode of planNode.frame ?? []) {
      // Parse <envelope><vertex>x,y,z</vertex>...</envelope>. Required for
      // the rollformer to render the frame outline; missing envelope means
      // we can't compute a transformationmatrix or project sticks.
      const envelopeRaw: Vec3[] = [];
      const envNode = frameNode.envelope;
      if (envNode && Array.isArray(envNode.vertex)) {
        for (const v of envNode.vertex as unknown[]) {
          // Each <vertex> has text content like "50897.540,20592.252,0.000"
          const text = typeof v === "string" ? v : (v as { "#text"?: string })["#text"] ?? String(v);
          envelopeRaw.push(parseTriple(text));
        }
      }
      const envelope: [Vec3, Vec3, Vec3, Vec3] | null =
        envelopeRaw.length === 4
          ? [envelopeRaw[0]!, envelopeRaw[1]!, envelopeRaw[2]!, envelopeRaw[3]!]
          : null;

      const frame: RawFrame = {
        name: String(frameNode["@_name"] ?? "F1"),
        type: String(frameNode["@_type"] ?? ""),
        envelope,
        sticks: [],
      };
      // Frame z range — used to detect plate-end vs stud-end of Kb braces.
      const envZs = envelopeRaw.map(v => v.z);
      const frameZmin = envZs.length ? Math.min(...envZs) : 0;
      const frameZmax = envZs.length ? Math.max(...envZs) : 0;

      // Resolve machine setup ONCE per frame based on first stick's profile web.
      // All sticks in a frame share the same profile size in HYTEK's workflow.
      let frameSetup: MachineSetup | undefined = undefined;
      const firstSticks = frameNode.stick ?? [];
      if (firstSticks.length > 0) {
        const firstWeb = Number(firstSticks[0].profile?.["@_web"] ?? 0);
        if (firstWeb > 0) frameSetup = getMachineSetupForProfile(firstWeb);
      }
      if (!frameSetup) frameSetup = getDefaultMachineSetup();
      const endClearance = frameSetup.endClearance;  // mm — plate trim at each end

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
        const stickName = String(stickNode["@_name"] ?? "");
        const inputFlipped = String(stickNode.flipped ?? "").trim().toLowerCase() === "true";
        // Detailer normalisation rule (verified 2026-04-30 against
        // HG260001_PK5-GF-LBW-70.075.rfy reference): for diagonal brace sticks
        // (Kb = cripple/knee brace, W = truss web member), Detailer always
        // forces flipped=false in its RFY output regardless of what the input
        // XML says. Match this behaviour so our `flipped` attribute and the
        // downstream tooling-rule context agree with Detailer's reference for
        // every stick of these types.
        //   Kb: 8/8 mismatched cases all forced to false
        //   W : 26/26 mismatched cases all forced to false
        //   All other prefixes (B/H/L/N/S/T): 0 mismatches (preserve input)
        const isDiagonalBrace = /^(Kb|W)\d/.test(stickName);
        const flipped = isDiagonalBrace ? false : inputFlipped;

        let start = parseTriple(String(stickNode.start ?? "0,0,0"));
        let end = parseTriple(String(stickNode.end ?? "0,0,0"));

        // Detailer's `EndClearance` rule (machine-setup-driven):
        // for sticks classified as plates (Top/Bottom plate), trim both ends
        // by EndClearance mm along the stick's diagonal. Verified empirically:
        // F325iT 70mm setup has EndClearance=4mm and Detailer's reference
        // RFY shows plate outlines at x=[4..length-4] vs our untrimmed
        // x=[0..length]. Without this trim, the cut steel is 8mm too long
        // for the wall to assemble. The trim does NOT apply to nogs (which
        // are a different `usage` even though they share `type="Plate"` in
        // the input XML — Detailer doesn't trim nogs).
        const usageLower = String(stickNode["@_usage"] ?? "").toLowerCase();
        // Truss chords (TopChord/BottomChord) get the same EndClearance trim
        // as wall plates. Verified 2026-05-01 against HG260044 GF-TIN PC7-1/B1:
        // input length 2640 → Detailer emits length 2632 (= 8mm trim total =
        // 4mm/end, matching the F325iT 70mm setup's EndClearance=4).
        const isFullWidthPlate = usageLower === "topplate" || usageLower === "bottomplate"
                              || usageLower === "topchord" || usageLower === "bottomchord";
        if (isFullWidthPlate && endClearance > 0) {
          const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
          const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (len > endClearance * 2 + 1) {
            const ux = dx / len, uy = dy / len, uz = dz / len;
            start = {
              x: start.x + ux * endClearance,
              y: start.y + uy * endClearance,
              z: start.z + uz * endClearance,
            };
            end = {
              x: end.x - ux * endClearance,
              y: end.y - uy * endClearance,
              z: end.z - uz * endClearance,
            };
          }
        }

        // Detailer also trims STUDS by 2mm at each end (verified 2026-04-30
        // against HG260001 + HG260044 references: every Detailer stud has
        // outline range [4..length-4] for studs that span the full wall
        // height, so the cut steel is 4mm shorter than the input centerline
        // span). Without this, every end-anchored op (Swage, Dimple) on every
        // stud drifts by 4mm — accounts for ~30% of all op-position mismatches
        // in the diff against reference.
        //
        // The 2mm value isn't directly in setup; it's a separate factory
        // convention (likely related to ToolClearance=2 or B2BStickClearance=2,
        // both of which equal 2mm for the F325iT 70mm setup).
        const isFullStud = usageLower === "stud" || usageLower === "endstud" ||
                           usageLower === "jackstud" || usageLower === "trimstud";
        // Headers (H prefix) also get end-trim, but ONLY 1mm/end (not 2mm
        // like studs). Verified 2026-05-01: input H length 3106 → Detailer
        // emits length 3104 (2mm total = 1mm/end), vs studs which trim 4mm
        // total (2mm/end).
        const isHeader = /^H\d/.test(String(stickNode["@_name"] ?? ""));
        const trimAmount = isFullStud ? 2.0 : isHeader ? 1.0 : 0;
        if (trimAmount > 0) {
          const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
          const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (len > trimAmount * 2 + 1) {
            const ux = dx / len, uy = dy / len, uz = dz / len;
            start = {
              x: start.x + ux * trimAmount,
              y: start.y + uy * trimAmount,
              z: start.z + uz * trimAmount,
            };
            end = {
              x: end.x - ux * trimAmount,
              y: end.y - uy * trimAmount,
              z: end.z - uz * trimAmount,
            };
          }
        }

        // Detailer Kb stud-end normalisation (verified 2026-04-30):
        //
        //   1. Stud-end always becomes "start" of the stick (swap if needed).
        //      This makes the rules engine's "Chamfer at start" rule fire on
        //      the correct physical end. Without this, Kb3/Kb4 (whose stud-end
        //      is input's `<end>`) get no Chamfer where they meet the corner
        //      stud, producing a square cut that won't seat against the stud.
        //
        //   2. After the swap, trim 2mm off the stud-end along the diagonal.
        //      Detailer shortens Kb sticks by 2mm at the stud-end so the cut
        //      steel fits between corner stud and plate. Without this trim,
        //      the outline pokes ~0.55mm past the stud's outer face AND the
        //      cut steel is 2mm too long for the wall to assemble.
        //
        // Detection: stud-end = whichever endpoint has the LARGER distance
        // from both frame Z-min and Z-max (i.e., farther from horizontal
        // plates).
        //
        // Applied to Kb only (not W) — W truss-web sticks have a different
        // trim profile that hasn't been characterised yet.
        const KB_STUD_END_TRIM_MM = 2.0;
        if (/^Kb\d/.test(stickName) && envZs.length === 4) {
          const startBoundaryDist = Math.min(start.z - frameZmin, frameZmax - start.z);
          const endBoundaryDist = Math.min(end.z - frameZmin, frameZmax - end.z);
          if (endBoundaryDist > startBoundaryDist) {
            // Stud-end is END — swap so it becomes start.
            const tmp = start;
            start = end;
            end = tmp;
          }
          // Now start IS the stud-end. Trim 2mm along diagonal toward end.
          const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
          const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (len > KB_STUD_END_TRIM_MM * 2) {
            const ux = dx / len, uy = dy / len, uz = dz / len;
            start = {
              x: start.x + ux * KB_STUD_END_TRIM_MM,
              y: start.y + uy * KB_STUD_END_TRIM_MM,
              z: start.z + uz * KB_STUD_END_TRIM_MM,
            };
          }
        }

        const stick: RawStick = {
          name: stickName,
          type: String(stickNode["@_type"] ?? ""),
          usage: String(stickNode["@_usage"] ?? ""),
          gauge: Number(stickNode["@_gauge"] ?? 0),
          start,
          end,
          profile,
          flipped,
        };
        frame.sticks.push(stick);
      }
      plan.frames.push(frame);
    }
    plans.push(plan);
  }
  return { jobnum, projectName, client, date, plans };
}

/** Map a usage attribute to a stick role used by the rules engine. */
function roleForUsage(usage: string, type: string, name: string): string {
  // Detailer's RFY uses single-letter prefixes (S, T, B, N, Kb, etc.).
  // For diagonal-brace sticks, the input XML's `usage` attribute is unreliable:
  //   Kb cripple/knee braces have usage="Brace" — but Detailer treats as Kb role
  //   W truss-web sticks have usage="Stud"      — but Detailer treats as W role
  // Both verified 2026-04-30 against PK5 reference. Without this override, Kb
  // sticks are routed to Br rules (no Chamfer at stud-end) and W sticks to S
  // rules (wrong span dimensions).
  const prefix = (name || "").replace(/[0-9_].*$/, "");
  if (prefix === "Kb" || prefix === "W") return prefix;

  const u = (usage || "").toLowerCase();
  if (u === "topplate") return "T";
  if (u === "bottomplate") return "B";
  if (u === "headplate" || u === "head") return "H";
  if (u === "nog" || u === "noggin") return "N";
  if (u === "endstud" || u === "stud") return "S";
  if (u === "jackstud" || u === "trimstud") return "J";
  if (u === "brace") return "Br";
  if (prefix) return prefix;
  if (type === "plate") return "T";
  return "S";
}

/** Generate per-stick tooling ops via the rules engine, sorted by position. */
function generateStickTooling(stick: RawStick, plan: RawPlan, frame: RawFrame, basis: FrameBasis | null = null): RfyToolingOp[] {
  const length = Math.round(distance3D(stick.start, stick.end) * 10) / 10;
  const profile = profileCode(stick.profile.web, stick.profile.l_flange, stick.profile.r_flange, stick.gauge);
  const role = roleForUsage(stick.usage, stick.type, stick.name);
  const profileFamily = profile.split("_")[0]!;
  const ctx: StickContext = {
    role, length,
    profileFamily,
    gauge: String(stick.gauge),
    flipped: stick.flipped,
    planName: plan.name,
    frameName: frame.name,
    usage: stick.usage,
  };
  const ops = generateTooling(ctx);

  // Web holes — Detailer's selectivity rule isn't yet derived. Sample data
  // shows Web ops on ~30% of studs (only S3 and S4 in L2, none in L4 and
  // others). Could be: boxed-stud partners, jamb studs at openings, or
  // structural-marker driven. Skipping for now — when we find the predicate,
  // emit (length - 76) / 446.83 + 1 evenly-spaced Web holes.

  // Truss W: angle-dependent tooling pattern (verified 2026-05-01 against
  // HG260044 GF-TIN reference):
  //
  //   VERTICAL W (post, dxL ~= 0): stud-style — Dimple @16.5, Swage 0..39
  //                                 (= what the W rule already emits)
  //   DIAGONAL W (any non-zero dxL): Kb-style — Dimple @10, Swage variable
  //                                 span + Chamfer at BOTH ends
  //
  // For diagonal W, swap the Dimple@16.5 ops (from rule) → Dimple@10 ops
  // and add the Chamfer pair. Swage span correction (variable) is deferred —
  // the dimple swap alone fixes ~184 missing ops on the LBW corpus.
  if (/^W\d/.test(stick.name) && basis) {
    const startL = projectToFrameLocal(stick.start, basis);
    const endL = projectToFrameLocal(stick.end, basis);
    const dxL = Math.abs(endL.x - startL.x);
    if (dxL > 1.0) {  // diagonal — any non-zero horizontal component
      // Remove the stud-style dimples (offset 16.5) emitted by the W rule
      const dimpleStart = 16.5;
      const dimpleEnd = length - 16.5;
      const tol = 0.5;
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        if (op.kind === "point" && op.type === "InnerDimple" &&
            (Math.abs(op.pos - dimpleStart) < tol || Math.abs(op.pos - dimpleEnd) < tol)) {
          ops.splice(i, 1);
        }
      }
      // Add Kb-style dimples (offset 10)
      ops.push({ kind: "point", type: "InnerDimple", pos: 10 });
      ops.push({ kind: "point", type: "InnerDimple", pos: Math.round((length - 10) * 10) / 10 });
      // Add chamfer at both ends
      ops.push({ kind: "start", type: "Chamfer" });
      ops.push({ kind: "end", type: "Chamfer" });
    }
  }

  // Nog InnerService: position varies by stick context (not just midpoint).
  // Data shows short nogs (<1000mm) often have 1 hole at midpoint, but
  // intermediate sizes have offset positions, and long nogs have multiple
  // holes at standard service-hole heights translated along the nog.
  // Predicate not yet derived — skip.

  // Kb-specific: add an InnerService hole at the midpoint of each Kb brace.
  // Detailer's actual algorithm is height-based (1 hole on top diagonals,
  // 3 holes on bottom diagonals — positioned where the diagonal crosses
  // configured service-hole heights in the wall). We don't have the wall's
  // service-hole height list in the input XML, so for a reasonable starter
  // we emit a single mid-stick hole. This matches Detailer's count for
  // top-diagonal Kb sticks (Kb1/Kb3) and gives bottom-diagonal Kb sticks
  // (Kb2/Kb4) at least one hole instead of zero. Refine when we extract
  // the per-frame-type service-hole heights from the .sups data.
  if (/^Kb\d/.test(stick.name) && length > 100) {
    ops.push({
      kind: "point",
      type: "InnerService",
      pos: Math.round((length / 2) * 10) / 10,
    });
  }

  return ops.slice().sort((a, b) => {
    const pa = a.kind === "spanned" ? a.startPos : (a.kind === "point" ? a.pos : (a.kind === "start" ? 0 : length));
    const pb = b.kind === "spanned" ? b.startPos : (b.kind === "point" ? b.pos : (b.kind === "start" ? 0 : length));
    return pa - pb;
  });
}

// ---------------------------------------------------------------------------
// Public exports — RFY (preferred) and CSV (legacy)
// ---------------------------------------------------------------------------

/**
 * Convert a framecad_import XML directly to a structured ParsedProject suitable
 * for `synthesizeRfyFromPlans`. Carries the real 3D envelope and stick coords
 * through to the codec.
 */
export function framecadImportToParsedProject(xmlText: string): ParsedProject {
  const { jobnum, projectName, client, date, plans } = parsePlans(xmlText);
  const outPlans: ParsedPlan[] = [];
  for (const plan of plans) {
    const outFrames: ParsedFrame[] = [];
    for (const frame of plan.frames) {
      if (!frame.envelope) {
        throw new Error(`Frame "${plan.name}/${frame.name}": missing <envelope> (4 vertices required for projection)`);
      }
      // Derive frame basis once per frame so per-stick rules can use it
      // (e.g. truss W angle-detection for conditional chamfer).
      let basis: FrameBasis | null = null;
      try {
        basis = deriveFrameBasis(frame.envelope, true /* lenient */);
      } catch { /* leave null — rules that need basis will skip */ }

      const outSticks: ParsedStick[] = [];
      for (const stick of frame.sticks) {
        const tooling = generateStickTooling(stick, plan, frame, basis);
        outSticks.push({
          name: stick.name,
          start: stick.start,
          end: stick.end,
          flipped: stick.flipped,
          profile: {
            web: stick.profile.web,
            lFlange: stick.profile.l_flange,
            rFlange: stick.profile.r_flange,
            lLip: stick.profile.l_lip,
            rLip: stick.profile.r_lip,
            shape: stick.profile.shape,
            gauge: String(stick.gauge),
          },
          usage: stick.usage,
          tooling,
        });
      }
      outFrames.push({
        name: frame.name,
        envelope: frame.envelope,
        sticks: outSticks,
      });
    }
    outPlans.push({ name: plan.name, frames: outFrames });
  }
  return { name: projectName, jobNum: jobnum, client, date, plans: outPlans };
}

/**
 * One-shot: framecad_import XML → encrypted RFY buffer. Preferred entry point
 * for the rollformer pipeline.
 */
export function framecadImportToRfy(xmlText: string, options: { lenient?: boolean } = {}): {
  rfy: Buffer;
  xml: string;
  planCount: number;
  frameCount: number;
  stickCount: number;
  projectName: string;
  jobnum: string;
  client: string;
  date: string;
} {
  const project = framecadImportToParsedProject(xmlText);
  const result = synthesizeRfyFromPlans(project, { lenient: options.lenient });
  return {
    rfy: result.rfy,
    xml: result.xml,
    planCount: result.planCount,
    frameCount: result.frameCount,
    stickCount: result.stickCount,
    projectName: project.name,
    jobnum: project.jobNum,
    client: project.client,
    date: project.date,
  };
}

// ---------------------------------------------------------------------------
// Legacy CSV path (preserved for backwards compatibility with the CSV-only
// route /api/csv-from-framecad-xml etc. — DO NOT use for rollformer files).
// ---------------------------------------------------------------------------

/** Convert a single plan's frames+sticks into CSV rows (with tooling).
 *  ⚠ Strips 3D coordinates — the resulting CSV cannot produce correct
 *  elevation graphics if fed to synthesizeRfyFromCsv. */
function planToCsv(jobnum: string, plan: RawPlan): string {
  const lines: string[] = [`DETAILS,${jobnum},${plan.name}`];
  for (const frame of plan.frames) {
    for (const stick of frame.sticks) {
      const length = Math.round(distance3D(stick.start, stick.end) * 10) / 10;
      const profile = profileCode(stick.profile.web, stick.profile.l_flange, stick.profile.r_flange, stick.gauge);
      const type = csvTypeForUsage(stick.usage, stick.type);
      const direction = stick.flipped ? "LEFT" : "RIGHT";
      const sx = 0, sy = 0, ex = length, ey = 0;
      const flange = Math.round((stick.profile.l_flange + stick.profile.r_flange) / 2);

      const ops = generateStickTooling(stick, plan, frame);
      const toolingCells: string[] = [];
      for (const op of ops) {
        const csvType = RFY_TYPE_TO_CSV[op.type];
        if (!csvType) continue;
        if (op.kind === "spanned") {
          toolingCells.push(csvType, String(op.startPos));
          toolingCells.push(csvType, String(op.endPos));
        } else if (op.kind === "point") {
          toolingCells.push(csvType, String(op.pos));
        } else if (op.kind === "start") {
          toolingCells.push(csvType, "0");
        } else if (op.kind === "end") {
          toolingCells.push(csvType, String(length));
        }
      }

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
        ...toolingCells,
      ];
      lines.push(cells.join(","));
    }
  }
  return lines.join("\n");
}

/** Top-level: parse a framecad_import XML and emit a multi-plan CSV. ⚠ Legacy. */
export function framecadImportToCsv(xmlText: string): {
  csv: string;
  planCount: number;
  frameCount: number;
  stickCount: number;
  projectName: string;
  jobnum: string;
  client: string;
  date: string;
} {
  const { jobnum, projectName, client, date, plans } = parsePlans(xmlText);
  let frameCount = 0, stickCount = 0;
  const planCsvs: string[] = [];
  for (const plan of plans) {
    frameCount += plan.frames.length;
    for (const f of plan.frames) stickCount += f.sticks.length;
    planCsvs.push(planToCsv(jobnum, plan));
  }
  return { csv: planCsvs.join("\n"), planCount: plans.length, frameCount, stickCount, projectName, jobnum, client, date };
}
