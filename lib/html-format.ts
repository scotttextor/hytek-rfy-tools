// HTML round-trip helpers.
// The RFY → HTML output renders each plan's CSV as a styled table inside a
// single self-contained HTML document. Each <td> holds one CSV cell's value.
// HTML → RFY parses the table cells back into CSV and feeds it to
// synthesizeRfyFromCsv.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render a multi-plan CSV map to a single editable HTML document. */
export function csvsToHtml(csvs: Record<string, string>, sourceFilename: string): string {
  const tables = Object.entries(csvs).map(([planName, csv]) => {
    const rows = csv.split(/\r?\n/).filter(line => line.trim().length > 0);
    const tableRows = rows
      .map((row, rowIdx) => {
        const cells = row.split(",");
        const cellHtml = cells
          .map(cell => `<td contenteditable="true">${escapeHtml(cell)}</td>`)
          .join("");
        return `      <tr data-row="${rowIdx}">${cellHtml}</tr>`;
      })
      .join("\n");
    return `  <section class="plan" data-plan="${escapeHtml(planName)}">
    <h2>${escapeHtml(planName)}</h2>
    <table>
${tableRows}
    </table>
  </section>`;
  }).join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HYTEK RFY — ${escapeHtml(sourceFilename)}</title>
  <meta name="generator" content="HYTEK RFY Tools" />
  <meta name="hytek-rfy-source" content="${escapeHtml(sourceFilename)}" />
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; background: #fafafa; color: #111; }
    h1 { color: #FFCB05; background: #231F20; padding: 12px 16px; border-radius: 8px; margin: 0 0 16px; }
    h2 { color: #231F20; border-bottom: 2px solid #FFCB05; padding-bottom: 4px; }
    section.plan { margin-bottom: 32px; }
    table { border-collapse: collapse; width: 100%; font-family: ui-monospace, "Cascadia Mono", "Consolas", monospace; font-size: 12px; }
    td { border: 1px solid #ddd; padding: 4px 6px; vertical-align: top; }
    td:focus { outline: 2px solid #FFCB05; background: #fffbe6; }
    tr:nth-child(odd) td { background: #fff; }
    tr:nth-child(even) td { background: #f6f6f6; }
    .note { background: #FFF8E1; border-left: 4px solid #FFCB05; padding: 8px 12px; margin-bottom: 16px; }
    .note code { background: #fff; padding: 1px 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>HYTEK RFY — ${escapeHtml(sourceFilename)}</h1>
  <div class="note">
    Edit any cell directly in the browser, then save the page as <code>.html</code>
    and re-upload via "Plain Text or XML → RFY" in HYTEK RFY Tools.
    Each <code>&lt;td&gt;</code> represents one CSV cell — keep the columns aligned.
  </div>
${tables}
</body>
</html>
`;
}

/** Parse an HTML document back into a single concatenated CSV string. */
export function htmlToCsv(html: string): string {
  // Use a tolerant regex-based extractor — we don't need a full HTML parser.
  // Strip script/style tags first.
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;

  const csvLines: string[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(cleaned)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      const inner = cellMatch[1]
        .replace(/<[^>]+>/g, "")           // strip nested tags
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      cells.push(inner);
    }
    if (cells.length > 0) csvLines.push(cells.join(","));
  }
  if (csvLines.length === 0) {
    throw new Error("No <table>/<tr>/<td> rows found in HTML — did you upload a valid HYTEK RFY HTML file?");
  }
  return csvLines.join("\n");
}
