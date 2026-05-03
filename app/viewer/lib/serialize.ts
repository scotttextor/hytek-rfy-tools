// Serialise an RfyDocument back to schedule XML — the inverse of
// codec.decodeXml(). Mirrors the schema parsed by the codec's
// decode.ts so the round-trip schedule XML is parseable by both our
// codec and Detailer/F300i.
//
// Phase 5 v1 — lossy on metadata not stored in RfyDocument
// (transformationmatrix, design_hash, vertices/triangles in elevation-
// graphics). Lossless on the data we care about: project meta, plans,
// frames, sticks, profiles, tooling, outline corners.

import type { RfyDocument, RfyStick } from "@hytek/rfy-codec";

function attr(name: string, value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "";
  return ` ${name}="${escapeXml(String(value))}"`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(v: number): string {
  // Match decode.ts's tolerance — emit Float32-rounded values to avoid
  // FP-noise diffs on round-trip.
  if (Number.isInteger(v)) return v.toString();
  return Number(v.toFixed(6)).toString();
}

function emitProfile(p: RfyStick["profile"]): string {
  const attrs =
    attr("metric-label", p.metricLabel) +
    attr("imperial-label", p.imperialLabel) +
    attr("gauge", p.gauge) +
    attr("yield", p.yield) +
    attr("machine-series", p.machineSeries);
  return `      <profile${attrs}>
        <shape>${escapeXml(p.shape)}</shape>
        <web>${num(p.web)}</web>
        <l-flange>${num(p.lFlange)}</l-flange>
        <r-flange>${num(p.rFlange)}</r-flange>
        <lip>${num(p.lip)}</lip>
      </profile>`;
}

function emitTooling(stick: RfyStick): string {
  if (stick.tooling.length === 0) return "      <tooling/>";
  const parts: string[] = [];
  for (const op of stick.tooling) {
    switch (op.kind) {
      case "start":   parts.push(`        <start-tool type="${op.type}"/>`); break;
      case "end":     parts.push(`        <end-tool type="${op.type}"/>`); break;
      case "point":   parts.push(`        <point-tool type="${op.type}" pos="${num(op.pos)}"/>`); break;
      case "spanned": parts.push(`        <spanned-tool type="${op.type}" start-pos="${num(op.startPos)}" end-pos="${num(op.endPos)}"/>`); break;
    }
  }
  return `      <tooling>\n${parts.join("\n")}\n      </tooling>`;
}

function emitOutline(stick: RfyStick): string {
  if (!stick.outlineCorners || stick.outlineCorners.length < 3) return "";
  const pts = stick.outlineCorners
    .map((p) => `          <pt x="${num(p.x)}" y="${num(p.y)}"/>`)
    .join("\n");
  return `      <elevation-graphics>
        <poly closed="1">
${pts}
        </poly>
      </elevation-graphics>`;
}

function emitStick(stick: RfyStick): string {
  const attrs =
    attr("name", stick.name) +
    attr("length", num(stick.length)) +
    attr("type", stick.type) +
    attr("flipped", stick.flipped ? "1" : "0") +
    attr("design_hash", stick.designHash);
  return `    <stick${attrs}>
${emitProfile(stick.profile)}
${emitTooling(stick)}${stick.outlineCorners ? "\n" + emitOutline(stick) : ""}
    </stick>`;
}

export function documentToScheduleXml(doc: RfyDocument): string {
  const proj = doc.project;
  const projAttrs =
    attr("name", proj.name) +
    attr("jobnum", proj.jobNum) +
    attr("client", proj.client) +
    attr("date", proj.date) +
    attr("design_id", proj.designId);

  const plans = proj.plans.map((plan) => {
    const planAttrs = attr("name", plan.name) + attr("design_id", plan.designId);
    const frames = plan.frames.map((frame) => {
      const frameAttrs =
        attr("name", frame.name) +
        attr("design_id", frame.designId) +
        attr("weight", num(frame.weight)) +
        attr("length", num(frame.length)) +
        attr("height", num(frame.height));
      const stickXml = frame.sticks.map(emitStick).join("\n");
      return `  <frame${frameAttrs}>
${stickXml}
  </frame>`;
    }).join("\n");
    const elevPart = plan.elevation !== undefined ? `<elevation>${num(plan.elevation)}</elevation>\n  ` : "";
    return ` <plan${planAttrs}>
  ${elevPart}${frames}
 </plan>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<schedule version="${escapeXml(doc.scheduleVersion)}">
 <project${projAttrs}>
${plans}
 </project>
</schedule>`;
}
