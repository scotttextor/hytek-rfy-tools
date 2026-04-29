// RFY → ZIP containing BOTH formats (.txt plain text + .xml).
// User can edit either one in Notepad and re-upload via /api/encode-auto.
import { NextResponse } from "next/server";
import { decode, decryptRfy, documentToCsvs } from "@hytek/rfy-codec";
import JSZip from "jszip";
import { readBody } from "@/lib/read-body";
import { csvsToHtml } from "@/lib/html-format";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let receivedBytes = 0;
  let bodyEncoding: string | null = null;
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.rfy");
    bodyEncoding = req.headers.get("x-body-encoding") ?? req.headers.get("content-encoding");
    const buf = await readBody(req);
    receivedBytes = buf.length;
    if (buf.length < 32 || (buf.length - 16) % 16 !== 0) {
      throw new Error(
        `Invalid RFY length: got ${buf.length} bytes (encoding=${bodyEncoding ?? "none"}). ` +
        `RFY format requires 16-byte IV + N×16-byte AES-CBC ciphertext, ` +
        `so total file size must be ≥32 and ${"`(size-16) % 16 === 0`"}. ` +
        `Got remainder=${(buf.length - 16) % 16}.`
      );
    }
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

    // Format 3 — HTML (editable table view, opens in any browser)
    const html = csvsToHtml(csvs, filename);

    const zip = new JSZip();
    zip.file(`${baseName}.txt`, txt);
    zip.file(`${baseName}.xml`, xml);
    zip.file(`${baseName}.html`, html);
    zip.file(`README.txt`,
      `HYTEK RFY Tools — decoded bundle\n` +
      `=================================\n\n` +
      `${baseName}.txt    Plain-text rollformer CSV — easiest to edit in Notepad.\n` +
      `${baseName}.xml    Full FrameCAD XML schedule — opens in Notepad too.\n` +
      `${baseName}.html   Editable table view — opens in any browser.\n\n` +
      `Edit any of the three then re-upload via "Plain Text / XML / HTML → RFY".\n` +
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
    const detail = `received ${receivedBytes} bytes, encoding=${bodyEncoding ?? "none"}`;
    return new NextResponse(`${e instanceof Error ? e.message : e}\n[debug: ${detail}]`, { status: 400 });
  }
}
