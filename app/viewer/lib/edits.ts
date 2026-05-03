// Pure edit transforms — given an RfyDocument and an edit, return a new
// RfyDocument. No React, no DOM, no I/O. Unit-testable in isolation.
//
// Every edit returns a NEW document object. Inner arrays are cloned via
// shallow copy where mutations happen so React's referential-equality
// checks still work and the store can snapshot via structuredClone.

import type { RfyDocument, RfyToolingOp } from "@hytek/rfy-codec";

/** Address a stick by (planIdx, frameIdx, stickIdx). */
export interface StickAddr {
  planIdx: number;
  frameIdx: number;
  stickIdx: number;
}

/** Parse a stickKey from the store ("frameIdx-stickIdx") into a StickAddr,
 *  using the currently-active planIdx. */
export function parseStickKey(key: string, planIdx: number): StickAddr | null {
  const parts = key.split("-");
  if (parts.length !== 2) return null;
  const fi = parseInt(parts[0]!, 10);
  const si = parseInt(parts[1]!, 10);
  if (Number.isNaN(fi) || Number.isNaN(si)) return null;
  return { planIdx, frameIdx: fi, stickIdx: si };
}

/** Deep-clone a RfyDocument via structuredClone (works because everything
 *  in the type is JSON-serialisable). */
export function cloneDoc(doc: RfyDocument): RfyDocument {
  return structuredClone(doc);
}

/** Add a tool op to a stick. Returns a new RfyDocument. */
export function addOp(doc: RfyDocument, addr: StickAddr, op: RfyToolingOp): RfyDocument {
  const next = cloneDoc(doc);
  const stick = next.project.plans[addr.planIdx]?.frames[addr.frameIdx]?.sticks[addr.stickIdx];
  if (!stick) return doc;
  stick.tooling = [...stick.tooling, op];
  return next;
}

/** Remove a tool op by index. */
export function removeOp(doc: RfyDocument, addr: StickAddr, opIdx: number): RfyDocument {
  const next = cloneDoc(doc);
  const stick = next.project.plans[addr.planIdx]?.frames[addr.frameIdx]?.sticks[addr.stickIdx];
  if (!stick) return doc;
  stick.tooling = stick.tooling.filter((_, i) => i !== opIdx);
  return next;
}

/** Update an existing op's position (point ops only) or span (spanned ops). */
export function updateOpPos(
  doc: RfyDocument,
  addr: StickAddr,
  opIdx: number,
  newPos: number,
): RfyDocument {
  const next = cloneDoc(doc);
  const stick = next.project.plans[addr.planIdx]?.frames[addr.frameIdx]?.sticks[addr.stickIdx];
  if (!stick) return doc;
  const op = stick.tooling[opIdx];
  if (!op) return doc;
  if (op.kind === "point") {
    stick.tooling[opIdx] = { ...op, pos: newPos };
  } else if (op.kind === "spanned") {
    // Treat newPos as the new start; preserve the span's length.
    const len = op.endPos - op.startPos;
    stick.tooling[opIdx] = { ...op, startPos: newPos, endPos: newPos + len };
  }
  return next;
}

/**
 * Move a stick by translating its outline corners by (dx, dy) in
 * elevation coords. Length, profile, tooling are unchanged.
 */
export function moveStick(
  doc: RfyDocument,
  addr: StickAddr,
  dx: number,
  dy: number,
): RfyDocument {
  const next = cloneDoc(doc);
  const stick = next.project.plans[addr.planIdx]?.frames[addr.frameIdx]?.sticks[addr.stickIdx];
  if (!stick || !stick.outlineCorners) return doc;
  stick.outlineCorners = stick.outlineCorners.map(c => ({ x: c.x + dx, y: c.y + dy }));
  return next;
}

/**
 * Move a single endpoint of a stick (one of the two short edges' midpoint).
 * Resizes the stick to a new length while preserving the profile depth.
 *
 * `endIdx`: 0 = start endpoint, 1 = end endpoint.
 *
 * The two outline corners on that end are moved by (dx, dy) — this both
 * translates the endpoint AND rotates the stick if (dx, dy) is not
 * along the existing length axis.
 */
export function moveStickEnd(
  doc: RfyDocument,
  addr: StickAddr,
  endIdx: 0 | 1,
  dx: number,
  dy: number,
): RfyDocument {
  const next = cloneDoc(doc);
  const stick = next.project.plans[addr.planIdx]?.frames[addr.frameIdx]?.sticks[addr.stickIdx];
  if (!stick || !stick.outlineCorners || stick.outlineCorners.length !== 4) return doc;
  // Find the two SHORT edges by length; their corner-pairs are the
  // start (lower y) and end (higher y) endpoints respectively. Moving
  // an endpoint = translating the two corners that share that short edge.
  const cs = stick.outlineCorners;
  const edges = [0, 1, 2, 3].map(i => ({
    a: i, b: (i + 1) % 4,
    len: Math.hypot(cs[(i + 1) % 4]!.x - cs[i]!.x, cs[(i + 1) % 4]!.y - cs[i]!.y),
  }));
  const sorted = [...edges].sort((x, y) => x.len - y.len);
  const short1 = sorted[0]!, short2 = sorted[1]!;
  const m1y = (cs[short1.a]!.y + cs[short1.b]!.y) / 2;
  const m2y = (cs[short2.a]!.y + cs[short2.b]!.y) / 2;
  const startEdge = m1y < m2y ? short1 : short2;
  const endEdge = m1y < m2y ? short2 : short1;
  const target = endIdx === 0 ? startEdge : endEdge;
  cs[target.a] = { x: cs[target.a]!.x + dx, y: cs[target.a]!.y + dy };
  cs[target.b] = { x: cs[target.b]!.x + dx, y: cs[target.b]!.y + dy };
  // Update stick length to match the new midline distance.
  const newM1 = { x: (cs[short1.a]!.x + cs[short1.b]!.x) / 2, y: (cs[short1.a]!.y + cs[short1.b]!.y) / 2 };
  const newM2 = { x: (cs[short2.a]!.x + cs[short2.b]!.x) / 2, y: (cs[short2.a]!.y + cs[short2.b]!.y) / 2 };
  stick.length = Math.hypot(newM2.x - newM1.x, newM2.y - newM1.y);
  return next;
}

/**
 * Add a new stick to a frame. Caller supplies start (x1, y1) and end
 * (x2, y2) midline endpoints in elevation coords plus a profile to
 * inherit. The stick is constructed with a default outline (rectangle
 * with profile.web as thickness) and zero tooling — user adds ops via
 * the existing addOp action.
 *
 * Profile defaults: if `inheritFrom` is provided, copies the profile
 * from that stick. Otherwise uses 70S41/0.75 (HYTEK's most common
 * profile — same default as the home page).
 */
import type { RfyStick, RfyProfile } from "@hytek/rfy-codec";

const DEFAULT_PROFILE: RfyProfile = {
  metricLabel: "70 S 41",
  imperialLabel: "275 S 161",
  gauge: "0.75",
  yield: "550",
  machineSeries: "F300i",
  shape: "S",
  web: 70,
  lFlange: 41,
  rFlange: 38,
  lip: 12,
};

export function addStick(
  doc: RfyDocument,
  planIdx: number,
  frameIdx: number,
  args: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    name?: string;
    profile?: RfyProfile;
    type?: "stud" | "plate";
  },
): RfyDocument {
  const next = cloneDoc(doc);
  const frame = next.project.plans[planIdx]?.frames[frameIdx];
  if (!frame) return doc;
  const profile = args.profile ?? DEFAULT_PROFILE;
  const length = Math.hypot(args.end.x - args.start.x, args.end.y - args.start.y);
  if (length < 1) return doc;
  // Build a 4-corner outline rectangle for the stick. Two short edges =
  // perpendicular to the length axis, scaled to profile.web (in mm).
  const ux = (args.end.x - args.start.x) / length;
  const uy = (args.end.y - args.start.y) / length;
  // Perpendicular unit vector (rotate 90°)
  const px = -uy;
  const py = ux;
  const halfW = profile.web / 2;
  const corners = [
    { x: args.start.x + px * halfW, y: args.start.y + py * halfW },
    { x: args.start.x - px * halfW, y: args.start.y - py * halfW },
    { x: args.end.x   - px * halfW, y: args.end.y   - py * halfW },
    { x: args.end.x   + px * halfW, y: args.end.y   + py * halfW },
  ];
  // Pick a unique stick name. If none provided, use S<N+1>.
  const existing = new Set(frame.sticks.map(s => s.name));
  let name = args.name?.trim();
  if (!name) {
    let i = frame.sticks.length + 1;
    while (existing.has(`S${i}`)) i++;
    name = `S${i}`;
  }
  const newStick: RfyStick = {
    name,
    length,
    type: args.type ?? "stud",
    flipped: false,
    profile,
    tooling: [],
    outlineCorners: corners,
  };
  frame.sticks = [...frame.sticks, newStick];
  return next;
}

/** Default new-op factory — given a tool type and stick context, return a
 *  sensible default op shape. Spanned types get a default 39mm span; point
 *  types get a position the caller supplies. */
export function defaultOpForType(
  type: RfyToolingOp["type"],
  pos: number,
  stickLength: number,
): RfyToolingOp {
  const spannedTypes: ReadonlyArray<RfyToolingOp["type"]> = [
    "Swage", "InnerNotch", "LipNotch", "LeftFlange", "RightFlange",
    "LeftPartialFlange", "RightPartialFlange", "Web",
  ];
  if (spannedTypes.includes(type)) {
    // Default a 39mm span centred on the click position, clamped to
    // [0..stickLength]. For start/end caps the user can drag handles
    // later to shift to the actual cap range.
    const halfSpan = 19.5;
    const startPos = Math.max(0, pos - halfSpan);
    const endPos = Math.min(stickLength, pos + halfSpan);
    return { kind: "spanned", type, startPos, endPos };
  }
  // Edge ops (Chamfer at start/end) fall through to point with pos=0
  // or pos=length being meaningful — caller can promote via an explicit
  // start/end op kind if they want.
  return { kind: "point", type, pos };
}
