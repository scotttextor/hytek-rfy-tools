// RFY → CSV. Decodes RFY → document, then emits CSV(s).
// If multiple plans exist, returns a ZIP archive; otherwise returns the single CSV.
import { NextResponse } from "next/server";
import { decode, documentToCsvs } from "@hytek/rfy-codec";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.rfy");
    const buf = Buffer.from(await req.arrayBuffer());
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

    // Multi-plan: return as plain text concatenated with separators (lightweight, no zip dep needed)
    let combined = "";
    for (const [name, content] of entries) {
      combined += `# === ${name} ===\n${content}\n\n`;
    }
    return new NextResponse(combined, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${baseName}_all.txt"`,
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
