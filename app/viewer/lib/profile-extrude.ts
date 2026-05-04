// Generate the 2D cross-section polyline for a HYTEK C-section profile.
//
// HYTEK steel sticks are C-sections — like a "[" bracket from the end:
//
//                  lLip
//                  ┌──┐
//                  │  │
//          lFlange │
//                  │
//   web    ────────┘
//                  ┌────────
//                  │
//          rFlange │
//                  │
//                  │  │
//                  └──┘
//                  rLip
//
// In our extrusion coordinate frame:
//   • +x = outwards from the web face (towards the flanges/lips)
//   • +y = perpendicular to the web (across the flange depth)
//   • the stick's length axis is the EXTRUSION direction (+z later)
//
// We trace the OUTSIDE perimeter of the section as a closed polygon.
// THREE.ExtrudeGeometry then extrudes this 2D shape along the stick's
// length axis to produce a solid 3D mesh.
//
// Profile dimensions (in mm):
//   • web: total height of the back face (e.g. 70 for 70S41)
//   • lFlange: depth of the upper (left) flange (e.g. 41)
//   • rFlange: depth of the lower (right) flange (e.g. 38)
//   • lip: turned-in lip length on each flange (typically 12)
//   • t: gauge / wall thickness in mm (e.g. 0.75)
//
// HYTEK's actual sections are roll-formed from a single ribbon of steel,
// so the wall thickness is uniform. We model that by tracing the outer
// perimeter then offsetting inwards by `t` to get the inner perimeter,
// producing a hollow C ⌐ shape suitable for ExtrudeGeometry.holes.

import type { RfyProfile } from "@hytek/rfy-codec";

export interface ProfileShape {
  /** Outer perimeter as ordered points (closed loop). */
  outer: { x: number; y: number }[];
  /** Inner perimeter (hole) — null if the profile should be solid. */
  inner: { x: number; y: number }[] | null;
  /** Bounding box of the outer perimeter — useful for camera framing. */
  bbox: { width: number; height: number };
}

/**
 * Build the cross-section shape for an HYTEK C-section profile.
 *
 * Returns ordered points in mm. Origin is at the centre of the web
 * face (so the section is centred about y=0 across its web). The
 * flanges extend in +x; the back of the web is at x=0.
 *
 * Layout (using 70S41 / lip=12 / t=0.75 as the example):
 *
 *   y =  +35  ───────────────────────────────────►  outer top
 *               │                              │
 *               │   ┌─ lLip turn               │
 *               │  ┌┘                           │
 *               │  │                            │
 *   y =  ~+23  ─┤  └────────────                │  inner top of flange
 *               │                               │
 *   y =    0   ─┤ web face                      │
 *               │                               │
 *   y = ~-23   ─┤  ┌─────                        │  inner bottom
 *               │  │                            │
 *               │  └┐                           │
 *               │   └─ rLip turn                │
 *               │                              │
 *   y =  -35  ───────────────────────────────────►  outer bottom
 *
 *               x = 0          x = lFlange/rFlange
 */
export function profileShape(profile: RfyProfile): ProfileShape {
  const w = profile.web;       // 70 — total web height
  const lf = profile.lFlange;  // 41 — upper flange depth
  const rf = profile.rFlange;  // 38 — lower flange depth (often differs slightly from lf)
  const lip = profile.lip || 12;
  // Wall thickness from gauge string (e.g. "0.75" → 0.75mm). Clamped to
  // a small minimum so the inner hole isn't degenerate.
  const t = Math.max(0.4, parseFloat(profile.gauge) || 0.75);

  const yTop = +w / 2;
  const yBot = -w / 2;

  // Outer perimeter — clockwise from top-left of web back face.
  // Goes: web back → up to top, along top flange to lip start, down lip,
  // back inwards (lip inner), along flange inner side, down web inside,
  // along bottom flange inner, out the bottom lip... but that's the
  // INNER perimeter. The OUTER perimeter is just the outline of the
  // C-shape including the lip turns.
  //
  // Tracing OUTER (anti-clockwise looking down +z):
  //   1. (0, yBot)             — bottom-left web corner
  //   2. (rf, yBot)            — bottom-right (end of bottom flange)
  //   3. (rf, yBot + lip)      — top of bottom lip (lip points inwards)
  //   4. (rf - t, yBot + lip)  — inside top of bottom lip
  //   5. (rf - t, yBot + t)    — inside lip-flange corner
  //   6. (t, yBot + t)         — inside web-flange corner (bottom)
  //   7. (t, yTop - t)         — inside web-flange corner (top)
  //   8. (lf - t, yTop - t)    — inside top flange-lip corner
  //   9. (lf - t, yTop - lip)  — inside top of upper lip
  //  10. (lf, yTop - lip)      — outside top of upper lip
  //  11. (lf, yTop)             — top-right (end of top flange)
  //  12. (0, yTop)              — top-left (back of web)
  //  back to (0, yBot)
  //
  // That's a single closed polygon with no hole — the C-shape is
  // already represented by the perimeter (wall thickness is implicit
  // in the path, since we go around BOTH the outer and inner edges).
  const outer: { x: number; y: number }[] = [
    { x: 0,       y: yBot },
    { x: rf,      y: yBot },
    { x: rf,      y: yBot + lip },
    { x: rf - t,  y: yBot + lip },
    { x: rf - t,  y: yBot + t },
    { x: t,       y: yBot + t },
    { x: t,       y: yTop - t },
    { x: lf - t,  y: yTop - t },
    { x: lf - t,  y: yTop - lip },
    { x: lf,      y: yTop - lip },
    { x: lf,      y: yTop },
    { x: 0,       y: yTop },
  ];

  return {
    outer,
    inner: null,  // single closed perimeter — no hole needed
    bbox: { width: Math.max(lf, rf), height: w },
  };
}
