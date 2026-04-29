// Plain Text OR XML → RFY. Auto-detects format from content:
// - Starts with `<?xml` → XML path → encryptRfy
// - Otherwise → strip `# ===` headers/comments → synthesizeRfyFromCsv
import { NextResponse } from "next/server";
import { encryptRfy, synthesizeRfyFromCsv } from "@hytek/rfy-codec";
import { readBodyText } from "@/lib/read-body";
import { htmlToCsv } from "@/lib/html-format";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const filename = decodeURIComponent(req.headers.get("x-filename") ?? "input.txt");
    const raw = (await readBodyText(req)).trim();
    if (!raw) throw new Error("Empty input");

    // Detect format from the first non-whitespace bytes of the body.
    const lower = raw.toLowerCase();
    const isXml = lower.startsWith("<?xml") || lower.startsWith("<schedule");
    const isHtml = lower.startsWith("<!doctype html") || lower.startsWith("<html");
    const outName = filename.replace(/\.(txt|csv|xml|html|htm)$/i, "") + ".rfy";

    let rfy: Buffer;
    let detectedFormat: string;

    if (isXml) {
      detectedFormat = "xml";
      rfy = encryptRfy(raw);
    } else if (isHtml) {
      detectedFormat = "html-table";
      const csv = htmlToCsv(raw);
      const result = synthesizeRfyFromCsv(csv);
      rfy = result.rfy;
    } else {
      detectedFormat = "plain-text-csv";
      // Strip `# ===` section markers and `#` comments, then synth from first plan.
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
        if (line.trim().startsWith("#")) continue;
        if (!current) {
          current = { name: "single-plan", lines: [] };
          sections.push(current);
        }
        current.lines.push(line);
      }
      const useSection = sections.find(s => s.lines.some(l => l.trim().length > 0));
      if (!useSection) throw new Error("No CSV rows found in plain-text input");
      const csv = useSection.lines.join("\n").trim();
      const result = synthesizeRfyFromCsv(csv);
      rfy = result.rfy;
    }

    return new NextResponse(new Uint8Array(rfy), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${outName}"`,
        "x-detected-format": detectedFormat,
      },
    });
  } catch (e) {
    return new NextResponse(String(e instanceof Error ? e.message : e), { status: 400 });
  }
}
