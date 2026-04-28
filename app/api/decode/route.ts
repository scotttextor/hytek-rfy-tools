// RFY → plain text (XML). Decrypts + decompresses the input bytes.
import { NextResponse } from "next/server";
import { decryptRfy } from "@hytek/rfy-codec";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.rfy");
    const buf = Buffer.from(await req.arrayBuffer());
    const xml = decryptRfy(buf);
    const outName = filename.replace(/\.rfy$/i, ".xml") || "output.xml";
    return new NextResponse(xml, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "content-disposition": `attachment; filename="${outName}"`,
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
