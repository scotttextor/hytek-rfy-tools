// Wall viewer save-round-trip test.
//
// Mirrors the viewer's exact save path:
//   1. decode(rfy bytes) → RfyDocument
//   2. documentToScheduleXml(doc) → schedule XML
//   3. encryptRfy(xml) → new rfy bytes
//   4. decode(new rfy bytes) → RfyDocument'
//   5. compare doc vs doc' deep-equal (with float tolerance)
//
// If round-trip is lossless on the data RfyDocument captures, the
// viewer's save button works for unedited docs. Lossiness is expected
// on metadata not in RfyDocument (transformationmatrix, design_hash,
// vertices/triangles in elevation-graphics) — we accept those losses.
//
// Usage:
//   node scripts/test_viewer_save_roundtrip.mjs <input.rfy> [...]
//
// Exit codes: 0 on lossless, 1 on lossy mismatch.

import fs from "node:fs";
import path from "node:path";
import { decode, encryptRfy } from "@hytek/rfy-codec";

// Load the serializer the same way the viewer does. Since
// documentToScheduleXml lives in the Next.js app folder, we read it
// directly via the TS file and let Node's built-in TS support handle
// it. (Node 24+ supports .ts via --experimental-strip-types; for
// safety we re-import via dynamic import.)
import { documentToScheduleXml } from "../app/viewer/lib/serialize.ts";

const TOLERANCE = 0.5; // mm — allow Float32 round-trip drift on positions

function close(a, b) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < TOLERANCE;
  return a === b;
}

function compareOps(a, b, path) {
  if (a.length !== b.length) {
    return [`${path}: ops count differs (${a.length} vs ${b.length})`];
  }
  const errs = [];
  for (let i = 0; i < a.length; i++) {
    const oa = a[i], ob = b[i];
    if (oa.kind !== ob.kind) errs.push(`${path}[${i}]: kind ${oa.kind} vs ${ob.kind}`);
    if (oa.type !== ob.type) errs.push(`${path}[${i}]: type ${oa.type} vs ${ob.type}`);
    if (oa.kind === "point" && !close(oa.pos, ob.pos)) errs.push(`${path}[${i}]: pos ${oa.pos} vs ${ob.pos}`);
    if (oa.kind === "spanned") {
      if (!close(oa.startPos, ob.startPos)) errs.push(`${path}[${i}]: startPos ${oa.startPos} vs ${ob.startPos}`);
      if (!close(oa.endPos, ob.endPos)) errs.push(`${path}[${i}]: endPos ${oa.endPos} vs ${ob.endPos}`);
    }
  }
  return errs;
}

function compareSticks(a, b, path) {
  if (a.length !== b.length) return [`${path}: sticks count ${a.length} vs ${b.length}`];
  const errs = [];
  for (let i = 0; i < a.length; i++) {
    const sa = a[i], sb = b[i];
    const p = `${path}/sticks[${i}:${sa.name}]`;
    if (sa.name !== sb.name) errs.push(`${p}: name`);
    if (!close(sa.length, sb.length)) errs.push(`${p}: length ${sa.length} vs ${sb.length}`);
    if (sa.type !== sb.type) errs.push(`${p}: type ${sa.type} vs ${sb.type}`);
    if (sa.flipped !== sb.flipped) errs.push(`${p}: flipped`);
    // Profile fields
    if (sa.profile.metricLabel !== sb.profile.metricLabel) errs.push(`${p}: metricLabel "${sa.profile.metricLabel}" vs "${sb.profile.metricLabel}"`);
    if (sa.profile.gauge !== sb.profile.gauge) errs.push(`${p}: gauge`);
    if (sa.profile.web !== sb.profile.web) errs.push(`${p}: web`);
    if (sa.profile.lFlange !== sb.profile.lFlange) errs.push(`${p}: lFlange`);
    if (sa.profile.rFlange !== sb.profile.rFlange) errs.push(`${p}: rFlange`);
    // Tooling
    errs.push(...compareOps(sa.tooling, sb.tooling, `${p}/tooling`));
    // Outline corners
    if (!!sa.outlineCorners !== !!sb.outlineCorners) {
      errs.push(`${p}: outlineCorners present mismatch`);
    } else if (sa.outlineCorners) {
      if (sa.outlineCorners.length !== sb.outlineCorners.length) {
        errs.push(`${p}: outlineCorners count`);
      } else {
        for (let j = 0; j < sa.outlineCorners.length; j++) {
          if (!close(sa.outlineCorners[j].x, sb.outlineCorners[j].x)) errs.push(`${p}/outline[${j}]: x ${sa.outlineCorners[j].x} vs ${sb.outlineCorners[j].x}`);
          if (!close(sa.outlineCorners[j].y, sb.outlineCorners[j].y)) errs.push(`${p}/outline[${j}]: y ${sa.outlineCorners[j].y} vs ${sb.outlineCorners[j].y}`);
        }
      }
    }
  }
  return errs;
}

function compareDocs(a, b) {
  const errs = [];
  if (a.scheduleVersion !== b.scheduleVersion) errs.push(`scheduleVersion ${a.scheduleVersion} vs ${b.scheduleVersion}`);
  if (a.project.name !== b.project.name) errs.push(`project.name "${a.project.name}" vs "${b.project.name}"`);
  if (a.project.jobNum !== b.project.jobNum) errs.push(`project.jobNum`);
  if (a.project.plans.length !== b.project.plans.length) errs.push(`plans count`);
  for (let i = 0; i < a.project.plans.length; i++) {
    const pa = a.project.plans[i], pb = b.project.plans[i];
    const p = `plan[${i}:${pa.name}]`;
    if (pa.name !== pb.name) errs.push(`${p}: name`);
    if (pa.frames.length !== pb.frames.length) errs.push(`${p}: frames count`);
    for (let j = 0; j < pa.frames.length; j++) {
      const fa = pa.frames[j], fb = pb.frames[j];
      const fp = `${p}/frame[${j}:${fa.name}]`;
      if (fa.name !== fb.name) errs.push(`${fp}: name`);
      if (!close(fa.length, fb.length)) errs.push(`${fp}: length`);
      if (!close(fa.height, fb.height)) errs.push(`${fp}: height`);
      errs.push(...compareSticks(fa.sticks, fb.sticks, fp));
    }
  }
  return errs;
}

function summarize(doc) {
  let frames = 0, sticks = 0, ops = 0;
  for (const p of doc.project.plans) for (const f of p.frames) {
    frames++;
    sticks += f.sticks.length;
    for (const s of f.sticks) ops += s.tooling.length;
  }
  return { plans: doc.project.plans.length, frames, sticks, ops };
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error("Usage: node test_viewer_save_roundtrip.mjs <input.rfy> [...]");
  process.exit(1);
}

let allLossless = true;
for (const inputPath of inputs) {
  console.log(`\n=== ${path.basename(inputPath)} ===`);
  const buf1 = fs.readFileSync(inputPath);
  const doc1 = decode(buf1);
  const sum = summarize(doc1);
  console.log(`  decoded: ${sum.plans} plans · ${sum.frames} frames · ${sum.sticks} sticks · ${sum.ops} ops`);

  const xml = documentToScheduleXml(doc1);
  console.log(`  serialized XML: ${xml.length.toLocaleString()} chars`);

  const buf2 = encryptRfy(xml);
  console.log(`  re-encrypted: ${buf2.length.toLocaleString()} bytes (orig ${buf1.length.toLocaleString()})`);

  const doc2 = decode(buf2);
  const errs = compareDocs(doc1, doc2);

  if (errs.length === 0) {
    console.log("  ✓ LOSSLESS — viewer save round-trip preserves all RfyDocument fields");
  } else {
    allLossless = false;
    console.log(`  ✗ ${errs.length} mismatches:`);
    for (const e of errs.slice(0, 20)) console.log(`      ${e}`);
    if (errs.length > 20) console.log(`      … +${errs.length - 20} more`);
  }
}

console.log(allLossless ? "\n✓ All round-trips lossless" : "\n✗ Some round-trips lost data");
process.exit(allLossless ? 0 : 1);
