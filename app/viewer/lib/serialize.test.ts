// Unit tests for the schedule-XML serializer.
//
// The viewer's save path goes:
//   RfyDocument
//     -> documentToScheduleXml(doc)   (this file's subject)
//     -> POST to /api/encode (server applies encryptRfy)
//     -> .rfy bytes
//
// The codec's decodeXml() is the inverse. If
//   decodeXml(documentToScheduleXml(doc)) ≈ doc
// for the data RfyDocument captures, then the round-trip is lossless.
//
// Lossiness is expected on metadata not in RfyDocument
// (transformationmatrix, design_hash on inner elements, vertices /
// triangles inside elevation-graphics) — we don't assert those.
//
// This mirrors scripts/test_viewer_save_roundtrip.mjs but operates on
// a small synthetic doc rather than real .rfy files, so the test suite
// can run without external fixtures.

import { describe, it, expect } from "vitest";
import { decodeXml } from "@hytek/rfy-codec";
import type { RfyDocument, RfyProfile, RfyStick, RfyToolingOp } from "@hytek/rfy-codec";
import { documentToScheduleXml } from "./serialize";

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

/** Tolerance for float-coord equality after round-trip through XML.
 *  Same threshold as scripts/test_viewer_save_roundtrip.mjs. */
const TOL = 0.5;

function close(a: number, b: number): boolean {
  return Math.abs(a - b) < TOL;
}

function makeStick(name: string, ops: RfyToolingOp[]): RfyStick {
  return {
    name,
    length: 2400,
    type: "stud",
    flipped: false,
    profile: PROFILE,
    tooling: ops,
    outlineCorners: [
      { x: 0, y: 0 },
      { x: 70, y: 0 },
      { x: 70, y: 2400 },
      { x: 0, y: 2400 },
    ],
  };
}

function makeDoc(): RfyDocument {
  // Cover every op kind. Order matches the canonical ordering the
  // codec's decoder emits (start → point → spanned → end), so a strict
  // index-by-index round-trip comparison passes. Real Detailer XML
  // groups ops this way too.
  const ops: RfyToolingOp[] = [
    { kind: "start", type: "Chamfer" },
    { kind: "point", type: "InnerDimple", pos: 100 },
    { kind: "point", type: "Bolt", pos: 200 },
    { kind: "spanned", type: "Swage", startPos: 300, endPos: 1500 },
    { kind: "spanned", type: "LipNotch", startPos: 400, endPos: 1400 },
    { kind: "end", type: "Chamfer" },
  ];
  return {
    scheduleVersion: "11.1",
    project: {
      name: "Round-trip Test",
      jobNum: "RT-001",
      client: "Test Client",
      date: "2026-05-03",
      plans: [
        {
          name: "PlanA",
          frames: [
            {
              name: "F1",
              weight: 12.34,
              length: 1000,
              height: 2400,
              sticks: [makeStick("S1", ops), makeStick("S2", [])],
            },
            {
              name: "F2",
              weight: 5,
              length: 800,
              height: 2400,
              sticks: [makeStick("S1", [{ kind: "point", type: "Web", pos: 1200 }])],
            },
          ],
        },
      ],
    },
  };
}

describe("documentToScheduleXml + decodeXml round-trip", () => {
  it("preserves project metadata", () => {
    const doc = makeDoc();
    const xml = documentToScheduleXml(doc);
    const out = decodeXml(xml);
    expect(out.scheduleVersion).toBe(doc.scheduleVersion);
    expect(out.project.name).toBe(doc.project.name);
    expect(out.project.jobNum).toBe(doc.project.jobNum);
    expect(out.project.client).toBe(doc.project.client);
    expect(out.project.date).toBe(doc.project.date);
  });

  it("preserves plan + frame structure", () => {
    const doc = makeDoc();
    const out = decodeXml(documentToScheduleXml(doc));
    expect(out.project.plans.length).toBe(1);
    expect(out.project.plans[0]!.name).toBe("PlanA");
    expect(out.project.plans[0]!.frames.length).toBe(2);
    expect(out.project.plans[0]!.frames[0]!.name).toBe("F1");
    expect(out.project.plans[0]!.frames[1]!.name).toBe("F2");
  });

  it("preserves frame dimensions", () => {
    const doc = makeDoc();
    const out = decodeXml(documentToScheduleXml(doc));
    const f1 = out.project.plans[0]!.frames[0]!;
    expect(close(f1.weight, 12.34)).toBe(true);
    expect(close(f1.length, 1000)).toBe(true);
    expect(close(f1.height, 2400)).toBe(true);
  });

  it("preserves stick name, length, type, flipped", () => {
    const doc = makeDoc();
    const out = decodeXml(documentToScheduleXml(doc));
    const s1 = out.project.plans[0]!.frames[0]!.sticks[0]!;
    expect(s1.name).toBe("S1");
    expect(close(s1.length, 2400)).toBe(true);
    expect(s1.type).toBe("stud");
    expect(s1.flipped).toBe(false);
  });

  it("preserves stick profile fields", () => {
    const doc = makeDoc();
    const out = decodeXml(documentToScheduleXml(doc));
    const p = out.project.plans[0]!.frames[0]!.sticks[0]!.profile;
    expect(p.metricLabel).toBe("70 S 41");
    expect(p.gauge).toBe("0.75");
    expect(p.web).toBe(70);
    expect(p.lFlange).toBe(41);
    expect(p.rFlange).toBe(38);
    expect(p.lip).toBe(12);
  });

  it("preserves all tool-op kinds (start, end, point, spanned)", () => {
    const doc = makeDoc();
    const out = decodeXml(documentToScheduleXml(doc));
    const ops = out.project.plans[0]!.frames[0]!.sticks[0]!.tooling;
    const before = doc.project.plans[0]!.frames[0]!.sticks[0]!.tooling;
    expect(ops.length).toBe(before.length);

    // Each op should round-trip its kind + type.
    for (let i = 0; i < before.length; i++) {
      const a = before[i]!;
      const b = ops[i]!;
      expect(b.kind).toBe(a.kind);
      expect(b.type).toBe(a.type);
      if (a.kind === "point" && b.kind === "point") {
        expect(close(a.pos, b.pos)).toBe(true);
      }
      if (a.kind === "spanned" && b.kind === "spanned") {
        expect(close(a.startPos, b.startPos)).toBe(true);
        expect(close(a.endPos, b.endPos)).toBe(true);
      }
    }
  });

  it("preserves outline corners", () => {
    const doc = makeDoc();
    const out = decodeXml(documentToScheduleXml(doc));
    const before = doc.project.plans[0]!.frames[0]!.sticks[0]!.outlineCorners!;
    const after = out.project.plans[0]!.frames[0]!.sticks[0]!.outlineCorners!;
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(close(before[i]!.x, after[i]!.x)).toBe(true);
      expect(close(before[i]!.y, after[i]!.y)).toBe(true);
    }
  });

  it("escapes XML-special characters in project name + client", () => {
    const doc: RfyDocument = {
      ...makeDoc(),
      project: {
        ...makeDoc().project,
        name: 'Job <A&B> "test"',
        client: "Client & Partners",
      },
    };
    const out = decodeXml(documentToScheduleXml(doc));
    expect(out.project.name).toBe('Job <A&B> "test"');
    expect(out.project.client).toBe("Client & Partners");
  });

  it("emits empty <tooling/> when stick has no ops", () => {
    const doc = makeDoc();
    const xml = documentToScheduleXml(doc);
    // S2 in F1 has empty tooling. The serializer emits a self-closing
    // <tooling/> tag in that case.
    expect(xml).toContain("<tooling/>");
    // Decoder still parses it back as empty.
    const out = decodeXml(xml);
    const s2 = out.project.plans[0]!.frames[0]!.sticks[1]!;
    expect(s2.tooling.length).toBe(0);
  });
});
