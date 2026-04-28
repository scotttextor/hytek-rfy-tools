// Plain text (XML) → RFY. Compresses + encrypts the input string back to RFY bytes.
import { NextResponse } from "next/server";
import { encryptRfy } from "@hytek/rfy-codec";
import { readBodyText } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.xml");
    const xml = (await readBodyText(req)).trim();
    if (!xml) throw new Error("Empty input");
    const rfy = encryptRfy(xml);
    const outName = filename.replace(/\.(xml|txt)$/i, ".rfy") || "output.rfy";
    return new NextResponse(new Uint8Array(rfy), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${outName}"`,
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
