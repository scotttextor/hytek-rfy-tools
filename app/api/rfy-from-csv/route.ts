// CSV → RFY. Synthesizes a fresh RFY from a CSV machine file.
import { NextResponse } from "next/server";
import { synthesizeRfyFromCsv } from "@hytek/rfy-codec";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.csv");
    const csv = (await req.text()).trim();
    if (!csv) throw new Error("Empty CSV");
    const result = synthesizeRfyFromCsv(csv);
    const outName = filename.replace(/\.csv$/i, ".rfy") || "output.rfy";
    return new NextResponse(new Uint8Array(result.rfy), {
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
