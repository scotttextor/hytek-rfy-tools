// RFY → ZIP containing BOTH formats (.txt plain text + .xml).
// User can edit either one in Notepad and re-upload via /api/encode-auto.
import { NextResponse } from "next/server";
import { decode, decryptRfy, documentToCsvs } from "@hytek/rfy-codec";
import JSZip from "jszip";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.rfy");
    const buf = Buffer.from(await req.arrayBuffer());
    const baseName = filename.replace(/\.rfy$/i, "");

    // Format 1 — full XML (decrypt only, no parsing)
    const xml = decryptRfy(buf);

    // Format 2 — plain-text rollformer CSV (one .txt with all plans)
    const doc = decode(buf);
    const csvs = documentToCsvs(doc);
    const csvEntries = Object.entries(csvs);

    let txt = "";
    txt += `# HYTEK RFY Tools — decoded ${filename}\n`;
    txt += `# Plans in this file: ${csvEntries.map(([n]) => n).join(", ")}\n`;
    txt += `# Edit any value below in Notepad, then re-upload via "Plain Text → RFY".\n#\n\n`;
    for (const [name, content] of csvEntries) {
      txt += `# === ${name} ===\n${content}\n\n`;
    }

    const zip = new JSZip();
    zip.file(`${baseName}.txt`, txt);
    zip.file(`${baseName}.xml`, xml);
    zip.file(`README.txt`,
      `HYTEK RFY Tools — decoded bundle\n` +
      `=================================\n\n` +
      `${baseName}.txt   Plain-text rollformer CSV — easiest to edit in Notepad.\n` +
      `${baseName}.xml   Full FrameCAD XML schedule — more detail, also opens in Notepad.\n\n` +
      `Edit either file then re-upload via "Plain Text or XML → RFY".\n` +
      `The app auto-detects the format by content.\n`,
    );

    const zipBuf = await zip.generateAsync({ type: "uint8array" });

    return new NextResponse(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${baseName}_decoded.zip"`,
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
