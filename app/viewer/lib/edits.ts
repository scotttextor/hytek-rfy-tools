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
