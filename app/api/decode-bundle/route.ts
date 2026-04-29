// RFY → ZIP containing BOTH formats (.txt plain text + .xml).
// User can edit either one in Notepad and re-upload via /api/encode-auto.
import { NextResponse } from "next/server";
import { decode, decryptRfy, documentToCsvs } from "@hytek/rfy-codec";
import JSZip from "jszip";
import { readBody } from "@/lib/read-body";

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
      // Detect common wrong-file-type cases
      const head = buf.subarray(0, 8).toString("utf-8").trim();
      let hint = "";
      if (head.startsWith("<?xml") || head.startsWith("<sched")) {
        hint = `\nThis looks like a decrypted XML file, not an RFY. Use "Plain Text or XML → RFY" to re-encode it.`;
      } else if (head.startsWith("DETAILS") || head.startsWith("COMPONENT")) {
        hint = `\nThis looks like a CSV file, not an RFY. Use "CSV → RFY" or "Plain Text or XML → RFY" to encode it.`;
      } else if (head.startsWith("# HYTEK") || head.startsWith("#")) {
        hint = `\nThis looks like the .txt plain-text export. Use "Plain Text or XML → RFY" to re-encode it.`;
      } else {
        hint = `\nNot a valid FrameCAD RFY file. Make sure you're uploading an .rfy that came directly from Detailer, or one this app produced after the codec was last fixed.`;
      }
      throw new Error(
        `Invalid RFY length: got ${buf.length} bytes. ` +
        `RFY format requires 16-byte IV + N×16-byte AES-CBC ciphertext, ` +
        `so total file size must be ≥32 and ${"`(size-16) % 16 === 0`"}. ` +
        `Got remainder=${(buf.length - 16) % 16}.${hint}`
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

    const zip = new JSZip();
    zip.file(`${baseName}.txt`, txt);
    zip.file(`${baseName}.xml`, xml);
    zip.file(`README.txt`,
      `HYTEK RFY Tools — decoded bundle\n` +
      `=================================\n\n` +
      `${baseName}.txt   Plain-text rollformer CSV — easiest to edit in Notepad.\n` +
      `${baseName}.xml   Full FrameCAD XML schedule — also opens in Notepad.\n\n` +
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
    const detail = `received ${receivedBytes} bytes, encoding=${bodyEncoding ?? "none"}`;
    return new NextResponse(`${e instanceof Error ? e.message : e}\n[debug: ${detail}]`, { status: 400 });
  }
}
