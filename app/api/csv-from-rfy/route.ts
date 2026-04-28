// RFY → Plain Text (.txt). Decodes RFY → document, then emits one human-readable
// text file containing the rollformer CSV for each plan, separated by headers.
// Output is a .txt file (not .csv) so Windows opens it in Notepad by default.
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

    let text = "";
    text += `# HYTEK RFY Tools — decoded ${filename}\n`;
    text += `# Plans in this file: ${entries.map(([n]) => n).join(", ")}\n`;
    text += `# Edit any value below in Notepad, then re-upload via "Plain Text → RFY".\n`;
    text += `#\n\n`;

    if (entries.length === 1) {
      const [name, content] = entries[0];
      text += `# === ${name} ===\n${content}\n`;
    } else {
      for (const [name, content] of entries) {
        text += `# === ${name} ===\n${content}\n\n`;
      }
    }

    return new NextResponse(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${baseName}.txt"`,
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
