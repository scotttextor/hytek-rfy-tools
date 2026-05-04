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
  // perpendicular to the length axis. Thickness = max(lFlange, rFlange)
  // — the SAME convention Detailer uses (verified vs codec
  // synthesize-plans.ts:496). Using profile.web here was wrong: web is
  // the depth INTO the page (70mm for 70S41), not the visible elevation
  // height (which is the flange dimension, 41mm). New sticks were
  // rendering ~70% taller than existing sticks before this fix.
  const ux = (args.end.x - args.start.x) / length;
  const uy = (args.end.y - args.start.y) / length;
  // Perpendicular unit vector (rotate 90°)
  const px = -uy;
  const py = ux;
  const halfW = Math.max(profile.lFlange, profile.rFlange) / 2;
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

  // Auto-generate connection ops at crossings with existing sticks in
  // the frame. Mirrors the codec's frame-context-ops behavior in a
  // simplified inline form: at each pairwise stick-on-stick crossing we
  // add an InnerDimple at the crossing point + a LipNotch span centred
  // on it (45mm wide — Detailer's standard cap-width). Both the new
  // stick AND the existing stick get the ops added.
  //
  // This isn't a full reimplementation of frame-context.ts (which
  // handles role-aware variants like web-bolt-holes, anchors,
  // chord-screw clusters etc.) — it just handles the single most common
  // case (stud crossing plate / nog crossing stud / W crossing chord).
  // For everything else, the user can manually add ops, OR re-import
  // the edited .rfy through the home page's encode-bundle endpoint
  // which will re-run the full rule engine.
  for (const other of frame.sticks) {
    const cross = midlineIntersection(
      { x: args.start.x, y: args.start.y }, { x: args.end.x, y: args.end.y },
      other,
    );
    if (!cross) continue;
    // Position along the new stick: project cross point onto new midline
    const newPos = (cross.x - args.start.x) * ux + (cross.y - args.start.y) * uy;
    if (newPos < 1 || newPos > length - 1) continue;
    const otherMidline = midlineFromOutline(other);
    if (!otherMidline) continue;
    const otherDx = otherMidline.end.x - otherMidline.start.x;
    const otherDy = otherMidline.end.y - otherMidline.start.y;
    const otherLen = Math.hypot(otherDx, otherDy);
    if (otherLen < 1) continue;
    const otherUx = otherDx / otherLen;
    const otherUy = otherDy / otherLen;
    const otherPos = (cross.x - otherMidline.start.x) * otherUx + (cross.y - otherMidline.start.y) * otherUy;
    if (otherPos < 1 || otherPos > otherLen - 1) continue;
    // 45mm-wide LipNotch span (Detailer cap convention) clamped to length
    const halfSpan = 22.5;
    const newSpanStart = Math.max(0, newPos - halfSpan);
    const newSpanEnd = Math.min(length, newPos + halfSpan);
    const otherSpanStart = Math.max(0, otherPos - halfSpan);
    const otherSpanEnd = Math.min(otherLen, otherPos + halfSpan);
    newStick.tooling.push({ kind: "spanned", type: "LipNotch", startPos: newSpanStart, endPos: newSpanEnd });
    newStick.tooling.push({ kind: "point", type: "InnerDimple", pos: newPos });
    other.tooling = [
      ...other.tooling,
      { kind: "spanned", type: "LipNotch", startPos: otherSpanStart, endPos: otherSpanEnd },
      { kind: "point", type: "InnerDimple", pos: otherPos },
    ];
  }

  frame.sticks = [...frame.sticks, newStick];
  return next;
}

/** Compute midline endpoints from a stick's outlineCorners. */
function midlineFromOutline(stick: RfyStick): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const cs = stick.outlineCorners;
  if (!cs || cs.length !== 4) return null;
  const edges = [0, 1, 2, 3].map(i => ({
    a: cs[i]!, b: cs[(i + 1) % 4]!,
    len: Math.hypot(cs[(i + 1) % 4]!.x - cs[i]!.x, cs[(i + 1) % 4]!.y - cs[i]!.y),
  }));
  const sorted = [...edges].sort((x, y) => x.len - y.len);
  const short1 = sorted[0]!, short2 = sorted[1]!;
  const mid = (e: typeof short1) => ({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
  const m1 = mid(short1);
  const m2 = mid(short2);
  return m1.y < m2.y || (m1.y === m2.y && m1.x < m2.x) ? { start: m1, end: m2 } : { start: m2, end: m1 };
}

/** 2D line-segment intersection between two midlines. Returns the
 *  intersection point if the segments cross, else null. */
function midlineIntersection(
  aStart: { x: number; y: number },
  aEnd: { x: number; y: number },
  otherStick: RfyStick,
): { x: number; y: number } | null {
  const o = midlineFromOutline(otherStick);
  if (!o) return null;
  const x1 = aStart.x, y1 = aStart.y, x2 = aEnd.x, y2 = aEnd.y;
  const x3 = o.start.x, y3 = o.start.y, x4 = o.end.x, y4 = o.end.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-6) return null;  // parallel
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;  // outside both segments
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
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
