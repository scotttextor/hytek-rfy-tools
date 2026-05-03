// Geometry helpers — pure functions, no React, unit-testable.
//
// The viewer renders sticks in their elevation 2D coordinates (the
// `outlineCorners` data already on each RfyStick from the codec).
//
// Each stick has 4 outline corners in millimetre coords. We compute the
// stick's midline (centerline along its length axis) and use that as
// the local coordinate frame for placing tool ops along the length.

import type { RfyDocument, RfyFrame, RfyStick, RfyToolingOp, ToolType } from "@hytek/rfy-codec";

// RfyPoint is the elevation 2D point used by stick.outlineCorners. The
// codec exports it from format.ts but doesn't re-export from the main
// index, so we declare a structurally-compatible alias here.
type RfyPoint = { x: number; y: number };

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box across all sticks of a frame in elevation coords. */
export function frameBBox(frame: RfyFrame): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const stick of frame.sticks) {
    if (!stick.outlineCorners) continue;
    for (const c of stick.outlineCorners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
      any = true;
    }
  }
  if (!any) return null;
  return { minX, minY, maxX, maxY };
}

/** Pad a bounding box by a margin (mm) on each side. */
export function padBBox(b: BBox, margin: number): BBox {
  return { minX: b.minX - margin, minY: b.minY - margin, maxX: b.maxX + margin, maxY: b.maxY + margin };
}

/**
 * Stick midline derived from its 4 outline corners.
 *
 * The 4 corners form a parallelogram (rectangle in the common case).
 * Two opposite edges are the SHORT edges (the stick's ends); the other
 * two are the LONG edges (the stick's flange/web sides). Midline =
 * line from midpoint-of-short-edge-1 to midpoint-of-short-edge-2.
 *
 * Mirrors `midlineFromCorners()` in the codec's csv.ts (kept inline
 * here so the viewer doesn't need a new codec export).
 */
export interface Midline {
  start: RfyPoint;
  end: RfyPoint;
  thickness: number; // length of the short edge — the stick's profile depth in elevation
  length: number;    // distance start → end
  angle: number;     // radians, atan2(dy, dx) of (end − start)
}

export function stickMidline(stick: RfyStick): Midline | null {
  const corners = stick.outlineCorners;
  if (!corners || corners.length !== 4) return null;
  const edges = [0, 1, 2, 3].map(i => {
    const a = corners[i]!, b = corners[(i + 1) % 4]!;
    return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  const sorted = [...edges].sort((x, y) => x.len - y.len);
  const short1 = sorted[0]!, short2 = sorted[1]!;
  const mid = (e: typeof short1) => ({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
  const m1 = mid(short1), m2 = mid(short2);
  // Order: start = lower y (visual bottom for vertical sticks); ties → lower x.
  const [s, e] = m1.y < m2.y || (m1.y === m2.y && m1.x < m2.x) ? [m1, m2] : [m2, m1];
  const length = Math.hypot(e.x - s.x, e.y - s.y);
  const angle = Math.atan2(e.y - s.y, e.x - s.x);
  return { start: s, end: e, thickness: short1.len, length, angle };
}

/**
 * Convert a tool-op position (mm along the stick's length axis) into
 * elevation-space (x, y) coords.
 *
 * pos = 0 is the start of the stick; pos = length is the end.
 */
export function posAlongStick(midline: Midline, pos: number): RfyPoint {
  const t = midline.length === 0 ? 0 : pos / midline.length;
  return {
    x: midline.start.x + (midline.end.x - midline.start.x) * t,
    y: midline.start.y + (midline.end.y - midline.start.y) * t,
  };
}

/**
 * Expand a spanned tool op into discrete positions along the stick.
 * Mirrors the codec's `expandSpan` rules used by csv.ts so visual
 * output matches the CSV emission positions.
 */
interface SpanRule { offset: number; stride: number; }
const SPAN_RULES: Partial<Record<ToolType, SpanRule>> = {
  Swage:       { offset: 27.5, stride: 55 },
  LipNotch:    { offset: 24,   stride: 48 },
  InnerNotch:  { offset: 24,   stride: 48 },
  LeftFlange:  { offset: 24,   stride: 48 },
  RightFlange: { offset: 24,   stride: 48 },
  Web:         { offset: 27.5, stride: 55 },
};

export function expandSpan(start: number, end: number, type: ToolType, stickLength: number): number[] {
  const rule = SPAN_RULES[type];
  if (!rule) return [start, end];
  const first = start + rule.offset;
  const last = end - rule.offset;
  if (first >= last) {
    const isStartCap = start < 0.5;
    const isEndCap = stickLength > 0 && Math.abs(end - stickLength) < 0.5;
    if (isStartCap) return [first];
    if (isEndCap) return [last];
    return [(start + end) / 2];
  }
  const positions: number[] = [];
  let cursor = first;
  while (cursor < last - 0.001) {
    positions.push(cursor);
    cursor += rule.stride;
  }
  if (positions.length === 0 || Math.abs(positions[positions.length - 1]! - last) > 0.001) {
    positions.push(last);
  }
  return positions;
}

/**
 * Build a flat list of (op, pos) pairs to render for a stick. Spanned
 * ops are expanded into per-position entries. start/end ops are anchored
 * at pos=0 and pos=stickLength respectively.
 */
export interface RenderedOp {
  type: ToolType;
  pos: number;
  /** Whether this came from a spanned op (priority 1) or point op (2),
   *  start (0) or end (3). Used for SVG render ordering at same pos. */
  priority: number;
  /** Index back into the original tooling array — useful for selection. */
  sourceIdx: number;
}

export function renderedOpsFor(stick: RfyStick): RenderedOp[] {
  const out: RenderedOp[] = [];
  stick.tooling.forEach((op: RfyToolingOp, i: number) => {
    switch (op.kind) {
      case "point":
        out.push({ type: op.type, pos: op.pos, priority: 2, sourceIdx: i });
        break;
      case "start":
        out.push({ type: op.type, pos: 0, priority: 0, sourceIdx: i });
        break;
      case "end":
        out.push({ type: op.type, pos: stick.length, priority: 3, sourceIdx: i });
        break;
      case "spanned": {
        const positions = expandSpan(op.startPos, op.endPos, op.type, stick.length);
        for (const p of positions) {
          out.push({ type: op.type, pos: p, priority: 1, sourceIdx: i });
        }
        break;
      }
    }
  });
  out.sort((a, b) => a.pos - b.pos || a.priority - b.priority);
  return out;
}

/** Frame-summary helper for the sidebar. */
export function frameSummary(frame: RfyFrame) {
  let opCount = 0;
  for (const s of frame.sticks) opCount += s.tooling.length;
  return { stickCount: frame.sticks.length, opCount };
}

/** Document-level summary. */
export function docSummary(doc: RfyDocument) {
  let frames = 0, sticks = 0, ops = 0;
  for (const p of doc.project.plans) for (const f of p.frames) {
    frames++; sticks += f.sticks.length;
    for (const s of f.sticks) ops += s.tooling.length;
  }
  return { plans: doc.project.plans.length, frames, sticks, ops };
}
