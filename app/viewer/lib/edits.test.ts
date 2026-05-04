// Unit tests for the pure edit transforms in edits.ts.
//
// These lock the contract that the wall viewer's UI relies on:
// every edit returns a NEW RfyDocument with only the targeted slice
// changed, and each transform's invariants (length recompute, span
// preservation, name uniqueness) hold.

import { describe, it, expect } from "vitest";
import type { RfyDocument, RfyProfile, RfyStick, RfyToolingOp } from "@hytek/rfy-codec";
import {
  addOp,
  removeOp,
  updateOpPos,
  moveStick,
  moveStickEnd,
  addStick,
  defaultOpForType,
} from "./edits";

// ---------- Test helpers ----------

const PROFILE: RfyProfile = {
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

/** Build a simple stick. Defaults to a 2400mm vertical stud at x=0,
 *  starting at y=0 going up to y=2400. Outline corners are a rectangle
 *  with profile.web (70mm) thickness. */
function makeStick(opts?: Partial<RfyStick> & { x?: number; y0?: number; y1?: number }): RfyStick {
  const x = opts?.x ?? 0;
  const y0 = opts?.y0 ?? 0;
  const y1 = opts?.y1 ?? 2400;
  const length = Math.abs(y1 - y0);
  return {
    name: opts?.name ?? "S1",
    length: opts?.length ?? length,
    type: opts?.type ?? "stud",
    flipped: opts?.flipped ?? false,
    profile: opts?.profile ?? PROFILE,
    tooling: opts?.tooling ?? [],
    outlineCorners: opts?.outlineCorners ?? [
      { x: x - 35, y: y0 },
      { x: x + 35, y: y0 },
      { x: x + 35, y: y1 },
      { x: x - 35, y: y1 },
    ],
  };
}

/** Build a one-plan, one-frame, one-stick doc by default. */
function makeDoc(sticks: RfyStick[] = [makeStick()]): RfyDocument {
  return {
    scheduleVersion: "11.1",
    project: {
      name: "TestProj",
      jobNum: "TEST-001",
      client: "Test Client",
      date: "2026-05-03",
      plans: [
        {
          name: "Plan1",
          frames: [
            { name: "F1", weight: 0, length: 1000, height: 2400, sticks },
          ],
        },
      ],
    },
  };
}

const ADDR0 = { planIdx: 0, frameIdx: 0, stickIdx: 0 };

// ---------- addOp ----------

describe("addOp", () => {
  it("appends a point op leaving other ops untouched", () => {
    const op0: RfyToolingOp = { kind: "point", type: "Web", pos: 100 };
    const doc = makeDoc([makeStick({ tooling: [op0] })]);
    const newOp: RfyToolingOp = { kind: "point", type: "InnerDimple", pos: 500 };
    const next = addOp(doc, ADDR0, newOp);
    const tooling = next.project.plans[0]!.frames[0]!.sticks[0]!.tooling;
    expect(tooling.length).toBe(2);
    expect(tooling[0]).toEqual(op0);
    expect(tooling[1]).toEqual(newOp);
  });

  it("appends a spanned op", () => {
    const doc = makeDoc();
    const newOp: RfyToolingOp = { kind: "spanned", type: "Swage", startPos: 100, endPos: 1000 };
    const next = addOp(doc, ADDR0, newOp);
    const tooling = next.project.plans[0]!.frames[0]!.sticks[0]!.tooling;
    expect(tooling.length).toBe(1);
    expect(tooling[0]).toEqual(newOp);
  });

  it("returns a new RfyDocument; original is untouched", () => {
    const doc = makeDoc();
    const next = addOp(doc, ADDR0, { kind: "point", type: "Web", pos: 100 });
    expect(next).not.toBe(doc);
    expect(doc.project.plans[0]!.frames[0]!.sticks[0]!.tooling.length).toBe(0);
  });

  it("returns the original doc when the address is invalid (no crash)", () => {
    const doc = makeDoc();
    const bad = { planIdx: 99, frameIdx: 0, stickIdx: 0 };
    const next = addOp(doc, bad, { kind: "point", type: "Web", pos: 100 });
    expect(next).toBe(doc);
  });
});

// ---------- removeOp ----------

describe("removeOp", () => {
  it("removes by index, leaving others intact", () => {
    const ops: RfyToolingOp[] = [
      { kind: "point", type: "Web", pos: 100 },
      { kind: "point", type: "InnerDimple", pos: 200 },
      { kind: "point", type: "Bolt", pos: 300 },
    ];
    const doc = makeDoc([makeStick({ tooling: ops })]);
    const next = removeOp(doc, ADDR0, 1);
    const tooling = next.project.plans[0]!.frames[0]!.sticks[0]!.tooling;
    expect(tooling.length).toBe(2);
    expect(tooling[0]).toEqual(ops[0]);
    expect(tooling[1]).toEqual(ops[2]);
  });

  it("returns a new doc and doesn't mutate the input tooling array", () => {
    const ops: RfyToolingOp[] = [{ kind: "point", type: "Web", pos: 100 }];
    const doc = makeDoc([makeStick({ tooling: ops })]);
    const next = removeOp(doc, ADDR0, 0);
    expect(next).not.toBe(doc);
    expect(doc.project.plans[0]!.frames[0]!.sticks[0]!.tooling.length).toBe(1);
    expect(next.project.plans[0]!.frames[0]!.sticks[0]!.tooling.length).toBe(0);
  });
});

// ---------- updateOpPos ----------

describe("updateOpPos", () => {
  it("updates a point op's pos, preserves type and kind", () => {
    const ops: RfyToolingOp[] = [{ kind: "point", type: "InnerDimple", pos: 100 }];
    const doc = makeDoc([makeStick({ tooling: ops })]);
    const next = updateOpPos(doc, ADDR0, 0, 750);
    const op = next.project.plans[0]!.frames[0]!.sticks[0]!.tooling[0]!;
    expect(op.kind).toBe("point");
    expect(op.type).toBe("InnerDimple");
    if (op.kind === "point") expect(op.pos).toBe(750);
  });

  it("preserves span length when start moves on a spanned op", () => {
    const ops: RfyToolingOp[] = [
      { kind: "spanned", type: "Swage", startPos: 100, endPos: 880 },
    ];
    const doc = makeDoc([makeStick({ tooling: ops })]);
    const next = updateOpPos(doc, ADDR0, 0, 500);
    const op = next.project.plans[0]!.frames[0]!.sticks[0]!.tooling[0]!;
    expect(op.kind).toBe("spanned");
    if (op.kind === "spanned") {
      expect(op.startPos).toBe(500);
      expect(op.endPos).toBe(500 + (880 - 100)); // 1280 — length 780 preserved
      expect(op.endPos - op.startPos).toBe(780);
      expect(op.type).toBe("Swage");
    }
  });

  it("does not affect other ops on the same stick", () => {
    const ops: RfyToolingOp[] = [
      { kind: "point", type: "Web", pos: 100 },
      { kind: "point", type: "InnerDimple", pos: 200 },
    ];
    const doc = makeDoc([makeStick({ tooling: ops })]);
    const next = updateOpPos(doc, ADDR0, 0, 999);
    const tooling = next.project.plans[0]!.frames[0]!.sticks[0]!.tooling;
    expect(tooling[1]).toEqual(ops[1]);
  });
});

// ---------- moveStick ----------

describe("moveStick", () => {
  it("translates all 4 outline corners by (dx, dy)", () => {
    const doc = makeDoc();
    const before = doc.project.plans[0]!.frames[0]!.sticks[0]!.outlineCorners!;
    const next = moveStick(doc, ADDR0, 100, 200);
    const after = next.project.plans[0]!.frames[0]!.sticks[0]!.outlineCorners!;
    expect(after.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(after[i]!.x).toBeCloseTo(before[i]!.x + 100);
      expect(after[i]!.y).toBeCloseTo(before[i]!.y + 200);
    }
  });

  it("does not change stick length, profile, or tooling", () => {
    const ops: RfyToolingOp[] = [{ kind: "point", type: "Web", pos: 100 }];
    const doc = makeDoc([makeStick({ tooling: ops })]);
    const beforeStick = doc.project.plans[0]!.frames[0]!.sticks[0]!;
    const next = moveStick(doc, ADDR0, 50, 50);
    const afterStick = next.project.plans[0]!.frames[0]!.sticks[0]!;
    expect(afterStick.length).toBe(beforeStick.length);
    expect(afterStick.profile).toEqual(beforeStick.profile);
    expect(afterStick.tooling).toEqual(beforeStick.tooling);
  });
});

// ---------- moveStickEnd ----------

describe("moveStickEnd", () => {
  it("translates only the start endpoint's two corners (endIdx 0)", () => {
    // Vertical stud y=0..2400. Start = y=0 (lower y by tie-break).
    // Moving start by dy=+100 → start corners now at y=100; end stays at 2400.
    const doc = makeDoc();
    const next = moveStickEnd(doc, ADDR0, 0, 0, 100);
    const cs = next.project.plans[0]!.frames[0]!.sticks[0]!.outlineCorners!;
    // Two corners had y=0; should now be y=100.
    const ysAtStart = cs.map((c) => c.y).filter((y) => y > 50 && y < 150);
    expect(ysAtStart.length).toBe(2);
    // The two corners that were at y=2400 should still be there.
    const ysAtEnd = cs.map((c) => c.y).filter((y) => y > 2350 && y < 2450);
    expect(ysAtEnd.length).toBe(2);
  });

  it("translates only the end endpoint's two corners (endIdx 1)", () => {
    const doc = makeDoc();
    const next = moveStickEnd(doc, ADDR0, 1, 0, 200);
    const cs = next.project.plans[0]!.frames[0]!.sticks[0]!.outlineCorners!;
    const ysAtStart = cs.map((c) => c.y).filter((y) => y > -1 && y < 1);
    expect(ysAtStart.length).toBe(2);
    const ysAtEnd = cs.map((c) => c.y).filter((y) => y > 2599 && y < 2601);
    expect(ysAtEnd.length).toBe(2);
  });

  it("recomputes stick length to the new midline distance", () => {
    // Original 2400mm stick. Move end by dy=+200 → length now 2600.
    const doc = makeDoc();
    const next = moveStickEnd(doc, ADDR0, 1, 0, 200);
    const newLen = next.project.plans[0]!.frames[0]!.sticks[0]!.length;
    expect(newLen).toBeCloseTo(2600);
  });
});

// ---------- addStick ----------

describe("addStick", () => {
  it("creates a new stick with name S<N+1> for an N-stick frame", () => {
    const doc = makeDoc([makeStick({ name: "S1" }), makeStick({ name: "S2" })]);
    const next = addStick(doc, 0, 0, {
      start: { x: 1000, y: 0 },
      end: { x: 1000, y: 2400 },
    });
    const sticks = next.project.plans[0]!.frames[0]!.sticks;
    expect(sticks.length).toBe(3);
    expect(sticks[2]!.name).toBe("S3");
  });

  it("bumps to next-free name if S<N+1> already exists", () => {
    // Frame has S1, S3 (skipping S2). N=2 so default would be S3, which is taken.
    const doc = makeDoc([makeStick({ name: "S1" }), makeStick({ name: "S3" })]);
    const next = addStick(doc, 0, 0, {
      start: { x: 1000, y: 0 },
      end: { x: 1000, y: 2400 },
    });
    const sticks = next.project.plans[0]!.frames[0]!.sticks;
    expect(sticks[2]!.name).toBe("S4");
  });

  it("computes length from the start→end distance", () => {
    const doc = makeDoc();
    const next = addStick(doc, 0, 0, {
      start: { x: 0, y: 0 },
      end: { x: 300, y: 400 }, // 3-4-5 triangle → length 500
    });
    const sticks = next.project.plans[0]!.frames[0]!.sticks;
    expect(sticks[1]!.length).toBeCloseTo(500);
  });

  it("produces 4 outline corners forming a rectangle around the midline", () => {
    // Horizontal stick from (0, 0) to (1000, 0). Default profile has
    // lFlange=41, rFlange=38; max(lFlange, rFlange) = 41 → halfThickness 20.5.
    // (Detailer convention — verified vs codec synthesize-plans.ts:496.
    //  This is NOT profile.web — that's the depth into the page.)
    const doc = makeDoc([]);
    const next = addStick(doc, 0, 0, {
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 0 },
    });
    const stick = next.project.plans[0]!.frames[0]!.sticks[0]!;
    expect(stick.outlineCorners).toBeDefined();
    expect(stick.outlineCorners!.length).toBe(4);
    // Two corners at y=+20.5 and two at y=-20.5 (perpendicular to length axis).
    // Don't assume ordering.
    const ys = stick.outlineCorners!.map((c) => c.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-20.5);
    expect(ys[1]).toBeCloseTo(-20.5);
    expect(ys[2]).toBeCloseTo(20.5);
    expect(ys[3]).toBeCloseTo(20.5);
  });

  it("respects the optional profile override", () => {
    const customProfile: RfyProfile = { ...PROFILE, metricLabel: "89 S 41", web: 89, gauge: "0.95" };
    const doc = makeDoc([]);
    const next = addStick(doc, 0, 0, {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 2400 },
      profile: customProfile,
    });
    const stick = next.project.plans[0]!.frames[0]!.sticks[0]!;
    expect(stick.profile.metricLabel).toBe("89 S 41");
    expect(stick.profile.web).toBe(89);
    expect(stick.profile.gauge).toBe("0.95");
  });

  it("returns the original doc for a zero-length draw", () => {
    const doc = makeDoc();
    const next = addStick(doc, 0, 0, {
      start: { x: 100, y: 100 },
      end: { x: 100, y: 100 },
    });
    expect(next).toBe(doc);
  });
});

// ---------- defaultOpForType ----------

describe("defaultOpForType", () => {
  it("returns a point op for point types", () => {
    const op = defaultOpForType("InnerDimple", 500, 2400);
    expect(op.kind).toBe("point");
    expect(op.type).toBe("InnerDimple");
    if (op.kind === "point") expect(op.pos).toBe(500);
  });

  it("returns a 39mm spanned op centred on pos for spanned types", () => {
    const op = defaultOpForType("Swage", 500, 2400);
    expect(op.kind).toBe("spanned");
    if (op.kind === "spanned") {
      expect(op.startPos).toBe(500 - 19.5);
      expect(op.endPos).toBe(500 + 19.5);
      expect(op.endPos - op.startPos).toBe(39);
    }
  });

  it("clamps the spanned op to [0, stickLength]", () => {
    // Pos near the start clamps startPos to 0.
    const at0 = defaultOpForType("LipNotch", 5, 2400);
    expect(at0.kind).toBe("spanned");
    if (at0.kind === "spanned") {
      expect(at0.startPos).toBe(0); // max(0, 5 - 19.5) = 0
      expect(at0.endPos).toBe(5 + 19.5);
    }
    // Pos near the end clamps endPos to stickLength.
    const atEnd = defaultOpForType("LipNotch", 2395, 2400);
    expect(atEnd.kind).toBe("spanned");
    if (atEnd.kind === "spanned") {
      expect(atEnd.startPos).toBe(2395 - 19.5);
      expect(atEnd.endPos).toBe(2400); // min(2400, 2395 + 19.5) = 2400
    }
  });

  it("treats InnerNotch / LeftFlange / RightFlange / Web etc. as spanned types", () => {
    const types = ["Swage", "InnerNotch", "LipNotch", "LeftFlange", "RightFlange", "LeftPartialFlange", "RightPartialFlange", "Web"] as const;
    for (const t of types) {
      const op = defaultOpForType(t, 500, 2400);
      expect(op.kind).toBe("spanned");
    }
  });

  it("treats Bolt / ScrewHoles / InnerDimple / Chamfer / TrussChamfer / InnerService as point types", () => {
    const types = ["Bolt", "ScrewHoles", "InnerDimple", "Chamfer", "TrussChamfer", "InnerService"] as const;
    for (const t of types) {
      const op = defaultOpForType(t, 100, 2400);
      expect(op.kind).toBe("point");
    }
  });
});
