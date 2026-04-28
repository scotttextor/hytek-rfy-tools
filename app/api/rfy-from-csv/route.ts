// Plain Text → RFY. Accepts the .txt produced by /api/csv-from-rfy
// (with `# ===` separators and # comments) OR a raw single-plan .csv.
// Strips any non-CSV preamble before passing to the codec.
import { NextResponse } from "next/server";
import { synthesizeRfyFromCsv } from "@hytek/rfy-codec";
import { readBodyText } from "@/lib/read-body";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.txt");
    const raw = (await readBodyText(req)).trim();
    if (!raw) throw new Error("Empty input");

    // Drop comment lines (#...) and split on `# === <plan> ===` markers.
    // For now we synthesize from the FIRST plan's CSV — multi-plan synthesis
    // would require per-plan synthesis + manual assembly, which the codec
    // doesn't yet expose.
    const lines = raw.split(/\r?\n/);
    const sections: { name: string; lines: string[] }[] = [];
    let current: { name: string; lines: string[] } | null = null;
    for (const line of lines) {
      const sectionMatch = line.match(/^#\s*===\s*(.+?)\s*===\s*$/);
      if (sectionMatch) {
        current = { name: sectionMatch[1], lines: [] };
        sections.push(current);
        continue;
      }
      if (line.trim().startsWith("#")) continue;             // skip other comments
      if (!current) {
        current = { name: "single-plan", lines: [] };
        sections.push(current);
      }
      current.lines.push(line);
    }

    if (sections.length === 0) throw new Error("No CSV content found in file");

    // Use the first non-empty section
    const useSection = sections.find(s => s.lines.some(l => l.trim().length > 0));
    if (!useSection) throw new Error("No CSV rows found");
    const csv = useSection.lines.join("\n").trim();

    const result = synthesizeRfyFromCsv(csv);
    const outName = filename.replace(/\.(txt|csv)$/i, "") + ".rfy";

    return new NextResponse(new Uint8Array(result.rfy), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${outName}"`,
        "x-plan-count": String(result.planCount),
        "x-frame-count": String(result.frameCount),
        "x-stick-count": String(result.stickCount),
        "x-sections-found": String(sections.length),
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
