// RFY → CSV. Emits the plain-text rollformer CSV file as .csv.
// (For .txt + headers/comments output, use /api/decode-bundle.)
import { NextResponse } from "next/server";
import { decode, documentToCsvs } from "@hytek/rfy-codec";
import { readBody } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.rfy");
    const buf = await readBody(req);
    const doc = decode(buf);
    const csvs = documentToCsvs(doc);
    const entries = Object.entries(csvs);
    if (entries.length === 0) throw new Error("RFY contained no plans");

    const baseName = filename.replace(/\.rfy$/i, "");

    if (entries.length === 1) {
      const [name, content] = entries[0];
      return new NextResponse(content, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${baseName}_${name}.csv"`,
        },
      });
    }

    // Multi-plan: concat into a single CSV (no comments, no `# ===` headers).
    // For human-readable multi-plan with separators, use /api/decode-bundle.
    let combined = "";
    for (const [, content] of entries) combined += content + "\n";
    return new NextResponse(combined, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${baseName}.csv"`,
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
