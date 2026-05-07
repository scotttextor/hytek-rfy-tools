// Tests for the /api/encode-auto route's optional ?withConfidence=1 mode.
//
// Strategy: invoke POST() directly with a constructed Request — no HTTP server
// needed. Uses one of the test-corpus framecad_import XMLs from the codec
// repo as input. If that corpus isn't available in this checkout, the test
// gracefully skips so CI never depends on a sibling repo being present.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { POST } from "./route";

const CORPUS_XML = resolve(
  __dirname,
  "../../../../hytek-rfy-codec/test-corpus/HG250082_FLAGSTONE_OSHC/UPPER-GF-LBW-89.075.xml",
);

function makeReq(xml: string, opts: { withConfidence?: boolean; filename?: string } = {}): Request {
  const url = new URL("http://localhost/api/encode-auto");
  if (opts.withConfidence) url.searchParams.set("withConfidence", "1");
  return new Request(url.toString(), {
    method: "POST",
    body: xml,
    headers: {
      "content-type": "application/xml",
      ...(opts.filename ? { "x-filename": opts.filename } : {}),
    },
  });
}

describe("/api/encode-auto", () => {
  if (!existsSync(CORPUS_XML)) {
    it.skip(`needs ${CORPUS_XML} to run`, () => undefined);
    return;
  }
  const xml = readFileSync(CORPUS_XML, "utf-8");

  it("returns binary RFY by default (existing contract)", async () => {
    const res = await POST(makeReq(xml, { filename: "UPPER-GF-LBW-89.075.xml" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    const body = Buffer.from(await res.arrayBuffer());
    // RFY files start with the encrypted-blob magic; we don't assert the magic
    // (cipher impl detail) but we DO assert it's non-trivial in size.
    expect(body.length).toBeGreaterThan(1000);
    // Important: content-disposition has the suggested filename.
    expect(res.headers.get("content-disposition")).toContain(".rfy");
  });

  it("returns JSON with confidence when ?withConfidence=1", async () => {
    const res = await POST(makeReq(xml, { withConfidence: true, filename: "UPPER-GF-LBW-89.075.xml" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    // Shape contract checks
    expect(typeof body.rfy_base64).toBe("string");
    expect(body.rfy_base64.length).toBeGreaterThan(100);
    expect(typeof body.rfy_size).toBe("number");
    expect(body.rfy_size).toBeGreaterThan(1000);
    expect(body.detected_format).toBe("framecad-import");
    expect(typeof body.oracle_hit).toBe("boolean");
    // Confidence: codec OR cached path — both have a `source` field.
    expect(["codec", "cached", "skipped"]).toContain(body.confidence.source);
    if (body.confidence.source === "codec") {
      expect(body.confidence).toHaveProperty("counts");
      expect(body.confidence).toHaveProperty("total_sticks");
      expect(body.confidence).toHaveProperty("frames");
      const { counts, total_sticks, frames } = body.confidence;
      expect(counts.high + counts.medium + counts.low + counts.unknown).toBe(total_sticks);
      expect(Array.isArray(frames)).toBe(true);
      expect(frames.length).toBeGreaterThan(0);
      // Sanity: every stick has a confidence label.
      for (const f of frames) {
        for (const s of f.sticks) {
          expect(["high", "medium", "low", "unknown"]).toContain(s.confidence);
        }
      }
    } else if (body.confidence.source === "cached") {
      expect(body.oracle_hit).toBe(true);
      expect(typeof body.confidence.note).toBe("string");
    }
    // base64 should round-trip to the same byte count
    const decoded = Buffer.from(body.rfy_base64, "base64");
    expect(decoded.length).toBe(body.rfy_size);
  });

  it("rejects empty body with 400", async () => {
    const res = await POST(makeReq(""));
    expect(res.status).toBe(400);
  });
});
