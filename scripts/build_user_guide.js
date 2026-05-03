// Build the HYTEK RFY Tools user guide as a .docx file.
//
// Usage:  node scripts/build_user_guide.js
// Output: docs/HYTEK_RFY_Tools_User_Guide.docx
//
// The pattern matches scripts/build_invoicing_guide.js in the hytek-detailing
// repo: brand colors (yellow #FFCB05 / black #231F20), Arial typography,
// section headings, bullet/numbered lists, and tables for "what an edit
// changes" reference data. Logo banner at the top.

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, ImageRun,
} = require("docx");

// ---- HYTEK brand tokens (per memory/reference_hytek_brand.md) ----
const YELLOW = "FFCB05";
const BLACK = "231F20";
const DARK_GRAY = "333333";
const MID_GRAY = "666666";
const LIGHT_GRAY = "F5F5F5";
const WHITE = "FFFFFF";
const BLUE = "1E63D5"; // for warning callouts

// ---- Logo ----
let logoBuffer = null;
const logoPath = path.join(__dirname, "..", "public", "hytek-group-logo.png");
try { logoBuffer = fs.readFileSync(logoPath); } catch { /* no logo */ }

// ---- Cell + paragraph helpers ----
const border = { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: BLACK, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: WHITE, font: "Arial", size: 20 })] })],
  });
}

function cell(text, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({ text, font: "Arial", size: 20, bold: opts.bold, color: opts.color || DARK_GRAY })],
    })],
  });
}

function heading(text) {
  return new Paragraph({
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, bold: true, font: "Arial", size: 32, color: BLACK })],
  });
}

function subheading(text) {
  return new Paragraph({
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text, bold: true, font: "Arial", size: 26, color: BLACK })],
  });
}

function subsubheading(text) {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, font: "Arial", size: 22, color: BLACK })],
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after || 120 },
    children: [new TextRun({ text, font: "Arial", size: 21, color: opts.color || DARK_GRAY, bold: opts.bold })],
  });
}

function code(text) {
  return new Paragraph({
    spacing: { after: 120 },
    shading: { fill: LIGHT_GRAY, type: ShadingType.CLEAR },
    children: [new TextRun({ text, font: "Consolas", size: 19, color: DARK_GRAY })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: "Arial", size: 21, color: DARK_GRAY })],
  });
}

function bullets(items) { return items.map(t => bullet(t)); }

function numberedItem(text) {
  return new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text, font: "Arial", size: 21, color: DARK_GRAY })],
  });
}

function callout(text, color = YELLOW) {
  return new Paragraph({
    spacing: { before: 100, after: 200 },
    shading: { fill: color === YELLOW ? "FFF3C0" : "DDEAFF", type: ShadingType.CLEAR },
    children: [new TextRun({ text, bold: true, font: "Arial", size: 21, color: BLACK })],
  });
}

function pageBreak() { return new Paragraph({ children: [new PageBreak()] }); }

// Two-column reference table: "Field / Setting" → "What an edit changes"
function referenceTable(rows) {
  const W_KEY = 3000, W_VAL = 6500;
  return new Table({
    width: { size: W_KEY + W_VAL, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [headerCell("Field / Setting", W_KEY), headerCell("What an edit changes", W_VAL)] }),
      ...rows.map(([k, v], i) =>
        new TableRow({ children: [
          cell(k, W_KEY, { bold: true, shading: i % 2 === 0 ? LIGHT_GRAY : WHITE }),
          cell(v, W_VAL, { shading: i % 2 === 0 ? LIGHT_GRAY : WHITE }),
        ] }),
      ),
    ],
  });
}

// ---- Document content ----

const children = [];

// Cover banner
if (logoBuffer) {
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600, after: 240 },
    children: [new ImageRun({ data: logoBuffer, transformation: { width: 240, height: 80 } })],
  }));
}
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 240 },
  children: [new TextRun({ text: "HYTEK RFY Tools — User Guide", bold: true, font: "Arial", size: 44, color: BLACK })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 480 },
  children: [new TextRun({ text: "How to use the rule editor, regression dashboard, and what every edit actually changes", font: "Arial", size: 24, color: MID_GRAY, italics: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 480 },
  children: [new TextRun({ text: `Generated ${new Date().toLocaleDateString("en-AU")} · hytek-rfy-tools.vercel.app`, font: "Arial", size: 18, color: MID_GRAY })],
}));

children.push(pageBreak());

// ===== 1. Overview =====
children.push(heading("1. What is HYTEK RFY Tools?"));
children.push(para("HYTEK RFY Tools is the standalone web app that replaces FrameCAD Detailer for HYTEK's F300i rollformer. It does three things:"));
children.push(bullet("Decodes encrypted .rfy files and emits readable XML, CSV, and op summaries."));
children.push(bullet("Encodes RFY files from input XML using HYTEK's own machine setups and frame-type rules — bypassing Detailer entirely."));
children.push(bullet("Lets you edit the rule sets that drive the encoder, save named templates, roll back, and verify output via a regression dashboard."));
children.push(para("Live URL: https://hytek-rfy-tools.vercel.app", { bold: true }));

children.push(subheading("Why this app exists"));
children.push(para("FrameCAD Detailer 5.3.4.0 is end-of-life — the licence on the workshop PC has already expired (showed \"01 Jan 1970\"). When it stops opening jobs, the F300i has no way to receive new RFY files unless we generate them ourselves. HYTEK RFY Tools is that fallback."));
children.push(para("Two of the bigger \"insurance policy\" features are the Rules Manager and the Regression Dashboard — between them, you can edit any rule HYTEK uses, prove the new rule still matches Detailer reference output, and revert if it goes wrong."));

children.push(subheading("The three apps you'll use most"));
children.push(referenceTable([
  ["/", "Home page. Drop RFY/XML/CSV files in to decode, re-encode, or convert. Doesn't change any rules — just runs the codec."],
  ["/rules", "Rules Manager. Edit machine setups (per-profile dimples, swages, lip notches) and frame types (which rule applies to LBW vs FJ vs LIN). Versioned templates with rollback."],
  ["/rules/tooling", "Tooling Rules Registry (read-only for now). Lists every per-stick rule the encoder runs — useful when you're trying to figure out \"why is this notch in the wrong place?\"."],
  ["/regression", "Match Regression Dashboard. Runs the codec across the test corpus and shows op-level + CSV-level match % vs Detailer reference. Use this to prove a rule edit didn't break anything."],
]));

children.push(pageBreak());

// ===== 2. Home / file conversion =====
children.push(heading("2. Home page (/) — File conversion"));
children.push(para("This is the default landing page. Use it for one-off file work — decoding a single .rfy to inspect its operations, or running a batch encode from XML."));

children.push(subheading("What the home page does"));
children.push(bullets([
  "Decode .rfy → XML, CSV, JSON: drag a single .rfy file in, get back the decrypted XML the way Detailer stored it, plus a friendly CSV summary.",
  "Encode XML → .rfy: drop a FrameCAD-import XML, get the encrypted .rfy back ready for the F300i.",
  "Bundle workflow: drop a whole job folder, get a production bundle (renamed to Detailer's filename convention so the rollformer recognises it).",
  "Job-folder importer: paste in a Detailer job folder structure, the app auto-detects the right plan / pack / profile and runs the full pipeline.",
]));

children.push(subheading("What an edit on the home page DOES NOT change"));
children.push(callout("⚠ Home page is read-only against the rules. Drag-and-dropping a file there NEVER edits a machine setup, frame type, or tooling rule. Only the Rules Manager (/rules) edits rules."));

children.push(pageBreak());

// ===== 3. Rules Manager =====
children.push(heading("3. Rules Manager (/rules) — the rule editor"));
children.push(para("This is the page where you change how the encoder behaves. Three concepts to keep straight:"));
children.push(numberedItem("Rulesets — named snapshots of the entire HYTEK rule set. \"default\" is read-only and shipped with the app (extracted from FrameCAD Detailer's .sups files). You can save named copies (e.g., \"experiment-2026-05-15\") to experiment without breaking anything."));
children.push(numberedItem("Machine types — per-profile rules: which dimples, swages, lip notches, anchor bolts go on a 70mm profile vs 89mm vs 89×0.95 etc. Driven by HYTEK MACHINE_FRAME TYPES on the Y: drive."));
children.push(numberedItem("Frame types — which rule profile applies to which frame name (LBW = load-bearing wall, NLBW = non-load-bearing, FJ = floor joist, LIN = linear truss, RP = roof panel, etc.)."));

children.push(subheading("3.1  The ruleset selector (top of page)"));
children.push(para("This is the band at the top with the active ruleset name + four buttons:"));
children.push(referenceTable([
  ["Active ruleset", "The ruleset currently being used by the encoder. The name appears next to a READ-ONLY badge if it's \"default\"."],
  ["Save As New", "Clones the active ruleset to a new named copy. You give it a name (e.g., \"experiment-2026-05-15\") and an optional description. The new copy becomes editable — original stays untouched."],
  ["Revert", "Discards in-memory edits and re-loads the active ruleset from disk. Use this if you've made changes you don't want to keep but haven't saved yet."],
  ["Delete", "Permanently deletes a NON-default named ruleset. Default cannot be deleted. The currently-active ruleset cannot be deleted (switch to another first)."],
  ["Switch", "Changes which ruleset is active. The encoder immediately uses the newly-selected ruleset for any subsequent encode/decode."],
]));

children.push(callout("Rule of thumb: don't edit \"default\". Click Save As New first, name your experiment, then edit the copy. If anything goes wrong, switch back to \"default\" and you're restored to factory rules."));

children.push(subheading("3.2  Machine Types tab — per-profile rules"));
children.push(para("Each machine type is a profile (70S41 0.75, 89S41 1.15, etc.) with these editable settings:"));
children.push(referenceTable([
  ["Profile name", "The display name. Cosmetic — doesn't change behaviour. Good for adding context like \"70S41 0.75 — exterior load-bearing\"."],
  ["End Clearance", "How much steel is trimmed from each end of plates and chords. Default is 4mm on 70mm and 89mm. Editing this CHANGES every plate/chord stick length output by the encoder by ±delta on each end."],
  ["Stud End Trim", "Trim from each end of full studs (default 2mm). Editing changes stud lengths in the encoded RFY and all derived tool positions (the InnerDimple at 16.5mm shifts with this)."],
  ["Header Trim", "Trim from each end of H-prefix headers (default 1mm). Same effect as Stud End Trim but only for headers."],
  ["Nog Trim", "Trim from each end of nog/noggin sticks. Conditional — uses 4mm if the nog spans the full plate width, 1mm otherwise."],
  ["Service Hole positions", "List of fixed offsets (e.g., 296mm, 446mm) where SERVICE HOLE punches go on studs. Editing the list changes which positions appear in every stud's tooling."],
  ["Swage cap rule", "Spans where a Swage gets emitted at each stick end (default [0..39] start cap and [length-39..length] end cap). Affects every stud, plate, nog, brace."],
  ["Inner Dimple positions", "Fixed-offset dimples on plates and studs (e.g., 16.5mm cap dimple). Editing reshapes the cap pattern."],
  ["Lip Notch span rules", "Where LipNotch spans appear (offsets, strides). Affects how many LIP NOTCH cells appear at each crossing in the CSV."],
  ["Bolt offsets (anchor bolts)", "Where ANCHOR holes go on bottom plates of ground-floor walls. 70mm: 62mm offset. 89mm: 62mm offset gauge<1.0 only."],
  ["Web Bolt holes", "Where BOLT HOLES (Web tool) go on plates. Ground-floor only on 70mm; ground-floor + gauge<1.0 only on 89mm."],
]));

children.push(callout("Every number you change here propagates to EVERY stick that uses that profile. A 1mm change in End Clearance shifts every cap dimple, every swage start/end, and every cell position in the CSV by 1mm."));

children.push(subheading("3.3  Frame Types tab — which rule profile to use"));
children.push(para("Frame types map a frame's NAME PATTERN to a rule profile. The encoder looks at the frame name (\"GF-LBW-70.075\", \"PC7-1\", \"L1101\") and decides which set of rules applies."));
children.push(referenceTable([
  ["Frame type code", "The category prefix in the frame name. LBW, NLBW, FJ, LIN, RP, TIN, CP, MH, TB2B, etc."],
  ["Display name", "Cosmetic. \"Load-Bearing Wall\" vs \"Non-Load-Bearing Wall\" etc."],
  ["Rule profile assignment", "Which machine-type profile the frame uses. Editing this changes which dimples/swages/notches get emitted for every frame matching this code."],
  ["Trim rules", "Frame-level trim overrides — e.g., LIN frames don't trim chord ends (verified vs LINEAR_TRUSS_TESTING reference). Editing here lets you flip whether a frame type gets the standard 4mm trim or skips it."],
  ["Special-case flags", "Booleans like \"isShearWall\", \"hasContinuousNog\". These gate empirical rules added during the 75% match push."],
]));

children.push(subheading("3.4  Save flow"));
children.push(para("Two save buttons:"));
children.push(numberedItem("💾 Save to Active Ruleset — writes your in-memory edits to the active ruleset's machine-types.json or frame-types.json on disk. Default ruleset is read-only and will reject this with a 403."));
children.push(numberedItem("Save As New (in the ruleset selector) — creates a new ruleset by cloning the active one + applying your edits."));
children.push(callout("If you forget to click Save, your edits are lost on a page refresh. Look for the dirty indicator (highlighted Save button) — it's the only signal that there's unsaved work."));

children.push(pageBreak());

// ===== 4. Tooling Rules Registry =====
children.push(heading("4. Tooling Rules Registry (/rules/tooling)"));
children.push(para("This page lists every PER-STICK rule the encoder applies. It's currently read-only — useful when you're debugging \"why is this notch at the wrong position?\" — but the data lives in src/rules/table.ts in the codec repo and you can edit it there."));

children.push(subheading("What's in the registry"));
children.push(bullets([
  "Per-stick rules grouped by role (Stud, Plate, Nog, Brace, Web, etc.) and by profile family (70mm, 89mm).",
  "Each rule lists the tool type it emits (Bolt, Web, Swage, LipNotch, InnerDimple, etc.), the anchor (start-anchored, end-anchored, span), the offset, the predicate (when it fires), and the confidence level (high/medium/low).",
  "Frame-context parameters — values like elevation thresholds (\"only on ground-floor walls\", \"only on gauge < 1.0\") that gate certain rules.",
  "Trim rules — how much to shave off each stick by usage type.",
]));

children.push(subheading("Why look here"));
children.push(para("When the cut steel comes out wrong, this is the first place to look. Find the rule that emitted the wrong op, then either:"));
children.push(bullets([
  "Edit the rule in src/rules/table.ts and rebuild the codec, or",
  "Edit the relevant Machine Type setting in /rules to change the offset / span globally,",
  "Or roll back to a previously-saved ruleset that was last known good.",
]));

children.push(pageBreak());

// ===== 5. Regression dashboard =====
children.push(heading("5. Match Regression Dashboard (/regression)"));
children.push(para("The regression dashboard runs the codec against the entire test corpus and shows how many operations match the Detailer reference output. Use it AFTER editing rules to verify the change didn't break anything."));

children.push(subheading("5.1  Reading the summary tiles"));
children.push(referenceTable([
  ["Overall match %", "Op-level match across the whole corpus. Currently 75.45% on 40 jobs (target: 100% via Frida capture once Detailer reinstalls)."],
  ["Jobs", "Total number of XML/RFY pairs the harness ran. Each pair = one frame + one expected RFY."],
  ["At 100%", "Number of jobs that match Detailer exactly. CP-89.075 currently sits at 100% (96 ops). Goal is to get every category there."],
  ["Errors", "Jobs that failed to run (codec crash, malformed input). 0 = clean run."],
  ["CSV full pipeline %", "NEW. Row-level CSV match: ours-csv vs Detailer-csv. Currently 25.1% on HG260044 (full pipeline). Lower than op-level because CSV reordering + FILLER rules add row-level differences not visible in the RFY."],
  ["CSV emission %", "Decoder→csv accuracy alone — measures whether documentToCsvs() correctly emits Detailer's CSV format from a known-good RFY. Currently 48.9%."],
  ["CSV rule-gen %", "Synthesize→csv accuracy — measures the rule generation through the CSV lens. Currently 30.6%."],
]));

children.push(subheading("5.2  By-category view"));
children.push(para("Below the tiles is a per-category breakdown (CP-89.075, NLBW-89.075, LBW-89.075, etc.). The bar chart shows the match % visually; numbers next to it are matched / total ops in that category."));
children.push(para("CSV match % appears in sky-blue beside each category when a paired .csv reference is available."));

children.push(subheading("5.3  Job-list view + drill-down"));
children.push(para("Below the categories is a sortable job list. Click any job to expand:"));
children.push(bullets([
  "Per-frame breakdown — which frames in this job have gaps.",
  "Per-stick breakdown — which sticks have missing/extra ops.",
  "By-op-type counts — how many LipNotch ops matched vs missed, how many Swage spans extra, etc.",
]));

children.push(subheading("5.4  Refresh button"));
children.push(para("The dashboard caches results in memory. Click Refresh to re-run the corpus diff after a rule edit. Takes 1-3 minutes for the full 40-job run on a warm machine."));

children.push(callout("Workflow: edit rules → Save → click Refresh on /regression → check the overall match % went UP not DOWN. If it dropped, revert the ruleset and try again."));

children.push(subheading("5.5  Local-only"));
children.push(para("The dashboard can only run on a machine where the test corpus is on disk. On Vercel and other hosted environments it shows an amber info card explaining this — that's not an error, just informational."));

children.push(pageBreak());

// ===== 6. What an edit changes — quick reference =====
children.push(heading("6. \"What does editing X change?\" — quick reference"));
children.push(para("Use this as a lookup before you change anything in /rules. Every entry tells you exactly what downstream effect to expect."));

children.push(subheading("6.1  Edits that change EVERY stick of a profile"));
children.push(referenceTable([
  ["End Clearance (mm)", "Every plate/chord on every frame using this profile gets ±delta in length. All cap dimple/swage/notch positions shift by the same delta. SERVICE HOLE positions are absolute and don't shift."],
  ["Stud End Trim (mm)", "Every stud's length and every position-from-stick-end op (e.g., end-cap Swage at length-27.5, end-cap LipNotch at length-24)."],
  ["Service Hole positions list", "Every stud and topplate gets these exact positions emitted as SERVICE HOLE cells. Adding 596 to the list = a new SERVICE HOLE,596 in every relevant stick. Removing one = that hole disappears."],
  ["InnerDimple offsets", "Cap dimple positions on plates/studs (16.5mm = standard). Changing this shifts the visible cap pattern for every stick."],
  ["Swage span offset", "Default 27.5mm = SWAGE,27.5 at start, SWAGE,length-27.5 at end. Changing it changes the LEADING and TRAILING swage positions on every stick."],
  ["Lip Notch stride", "Affects how dense the LIP NOTCH cells are along long spans. Default stride 48mm = positions every 48mm. Wider stride = fewer notches per span."],
  ["Anchor Bolt offset (70mm)", "Position of ANCHOR holes on ground-floor bottom plates. Edit this and every ground-floor B-plate at this profile changes where it gets anchored."],
  ["Web Bolt offset", "Position of BOLT HOLES (Web tool) on plates. Same gating as ANCHOR — ground-floor walls only."],
]));

children.push(subheading("6.2  Edits that change a SUBSET of frames"));
children.push(referenceTable([
  ["Frame type → Profile mapping", "Reassigns which machine-type rules fire for an entire frame category. Changing LBW from 70S41_0.75 to 89S41_0.75 makes every load-bearing wall use the heavier profile rules — which adds anchor bolts, changes cap pattern, etc."],
  ["LIN trim override", "LIN (Linear Truss) frames don't trim chord ends. Toggling this on/off adds or removes 4mm/end on every LIN chord stick."],
  ["Raking-frame Chamfer rule", "Sloped-top-plate walls get Chamfer@end on full studs and Chamfer@start/end on the high side of the top plate. Disabling this skips chamfers on raking walls."],
  ["RP no-Chamfer override", "Roof panels (RP frames) don't get Chamfers, despite their sloped top plates. This rule prevents the raking-frame logic from firing on RP."],
  ["FJ short-stub paired notch", "Short FJ chord stubs (length ≤ 250mm) get paired InnerNotch alongside their LipNotch caps. Toggling this changes cap patterns on every short FJ stub."],
  ["Continuous-nog Swage rule", "Swages on interior S studs at nog crossings. Disabling this removes ~10-30 ops per LBW frame."],
]));

children.push(subheading("6.3  Edits that ONLY affect CSV output"));
children.push(referenceTable([
  ["Tool-type CSV label mapping", "How RFY tool types render in the CSV. Bolt → ANCHOR, Web → BOLT HOLES, InnerNotch → WEB NOTCH. Swapping these changes the CSV but NOT the encoded RFY (the F300i reads RFY directly)."],
  ["Length-column precision", "2-decimal vs 1-decimal for the length column in the CSV. Detailer uses 2-decimal for diagonal Kb braces (1377.73). 1-decimal everywhere else."],
  ["FILLER row insertion", "FILLER rows separate W/Kb groups from default sticks in the CSV. Disabling this removes ~141 rows per LBW job in our output (Detailer always emits them)."],
  ["DETAILS-per-frame", "Detailer emits a DETAILS,job#1-1,plan header before every frame. Disabling this drops to one DETAILS row per file (legacy behavior)."],
]));

children.push(pageBreak());

// ===== 7. Common workflows =====
children.push(heading("7. Common workflows"));

children.push(subheading("7.1  \"The cut steel came out wrong on this frame\""));
children.push(numberedItem("Open /rules/tooling. Find the rule for the role + profile combo (e.g., Stud, 70mm, gauge 0.75)."));
children.push(numberedItem("Identify which rule fired the wrong op. Note the offset, predicate, and tool type."));
children.push(numberedItem("Open /rules. Click Save As New to clone the active ruleset to \"fix-2026-05-XX\"."));
children.push(numberedItem("Edit the relevant Machine Type setting (e.g., Service Hole positions, Swage offset)."));
children.push(numberedItem("Click Save to Active Ruleset."));
children.push(numberedItem("Open /regression. Click Refresh."));
children.push(numberedItem("Compare the new overall match % to the previous one (75.45%). UP = good. DOWN = revert and try again."));
children.push(numberedItem("If it's good, drill into the original problem job to confirm the specific stick is now correct."));

children.push(subheading("7.2  \"I want to experiment without breaking anything\""));
children.push(numberedItem("Open /rules. Click Save As New. Name it \"experiment-YYYY-MM-DD\"."));
children.push(numberedItem("Click that ruleset to make it active."));
children.push(numberedItem("Edit anything you like."));
children.push(numberedItem("Save. Test on /regression."));
children.push(numberedItem("If it goes wrong, click \"default\" in the ruleset selector — you're restored to factory rules."));
children.push(numberedItem("If it goes right, leave the ruleset as-is. The default ruleset is untouched and always available as a fallback."));

children.push(subheading("7.3  \"I need to roll back a change I made yesterday\""));
children.push(numberedItem("Open /rules."));
children.push(numberedItem("In the ruleset selector dropdown, switch back to \"default\" or to whichever named ruleset was last good."));
children.push(numberedItem("Encoder immediately uses the older rules — no rebuild, no restart needed."));
children.push(numberedItem("If the bad ruleset is no longer wanted, click Delete on it (cannot delete default, cannot delete active — switch first)."));

children.push(subheading("7.4  \"I want to verify that ruleset X still produces correct output\""));
children.push(numberedItem("Open /rules. Switch to ruleset X via the selector."));
children.push(numberedItem("Open /regression. Click Refresh — wait 1-3 minutes."));
children.push(numberedItem("Read the overall match %. 75.45% is the current factory baseline."));
children.push(numberedItem("Drill into any category that dropped to find the regression."));

children.push(pageBreak());

// ===== 8. Troubleshooting =====
children.push(heading("8. Troubleshooting"));

children.push(subheading("\"Unexpected token '﻿' is not valid JSON\""));
children.push(para("Cause: A ruleset JSON file has a UTF-8 byte-order mark (BOM) at the start. The BOM-stripping reader in lib/rulesets.ts handles this transparently as of 2026-05-03, but if you see this error after restoring an older ruleset, run:"));
children.push(code("cd hytek-rfy-tools && node -e \"['frame-types.json','machine-types.json'].forEach(f=>{const fs=require('fs');const p='data/rulesets/default/'+f;let r=fs.readFileSync(p,'utf8');if(r.charCodeAt(0)===0xFEFF){fs.writeFileSync(p,r.slice(1),'utf8');console.log('stripped',p)}})\""));

children.push(subheading("\"Corpus directory not found\" on /regression"));
children.push(para("Expected on Vercel and other hosted environments. The dashboard runs the diff harness against a local Windows path and can only work on a machine that has the corpus on disk. Set the CORPUS_DIR environment variable to point at the corpus folder, or run the dashboard locally."));

children.push(subheading("\"Ruleset is read-only\" when trying to save"));
children.push(para("You're trying to save to the \"default\" ruleset, which is protected. Click Save As New first to create an editable copy, then save into that copy."));

children.push(subheading("Dirty indicator stays on after saving"));
children.push(para("Refresh the page. The save endpoint returned 200 but the local React state didn't reset — known minor bug, will be fixed in a follow-up."));

children.push(subheading("Encoded RFY rejected by F300i"));
children.push(para("Most common cause: profile metric label says \"70 C 41\" instead of \"70 S 41\". Detailer always normalises shape to \"S\" — the encoder now does the same as of 2026-05-03. If you have older RFY files generated before that fix, re-encode them."));

children.push(pageBreak());

// ===== 9. Reference =====
children.push(heading("9. Reference"));

children.push(subheading("Brand colors (per HYTEK Group Brand Manual)"));
children.push(referenceTable([
  ["Yellow", "#FFCB05 — primary brand color"],
  ["Black", "#231F20 — primary background"],
  ["Logo file", "/hytek-group-logo.png (yellow on transparent — for dark backgrounds)"],
  ["Logo, inverted", "/hytek-group-logo-inverted.png (for light backgrounds)"],
  ["Logo, monochrome", "/hytek-group-logo-bw.png (print, faxes, low-color contexts)"],
]));

children.push(subheading("Repos"));
children.push(referenceTable([
  ["hytek-rfy-tools", "https://github.com/scotttextor/hytek-rfy-tools — this app (Next.js)."],
  ["hytek-rfy-codec", "https://github.com/scotttextor/hytek-rfy-codec — the codec library (decoder/encoder/rules)."],
  ["Live URL", "https://hytek-rfy-tools.vercel.app — auto-deploys from master."],
]));

children.push(subheading("Source-of-truth files"));
children.push(referenceTable([
  ["Machine setups (factory)", "Y:\\(08) DETAILING\\(13) FRAMECAD\\FrameCAD DETAILER\\HYTEK MACHINE_FRAME TYPES\\"],
  ["Machine setups (default ruleset)", "data/rulesets/default/machine-types.json (in repo)"],
  ["Frame types (factory)", "Y:\\(08) DETAILING\\(13) FRAMECAD\\FrameCAD DETAILER\\HYTEK MACHINE_FRAME TYPES\\"],
  ["Frame types (default ruleset)", "data/rulesets/default/frame-types.json (in repo)"],
  ["Per-stick rule table", "src/rules/table.ts in hytek-rfy-codec (the encoder's rule registry)"],
  ["Frame-context rules", "src/rules/frame-context.ts in hytek-rfy-codec"],
]));

children.push(subheading("Diff harness scripts"));
children.push(referenceTable([
  ["scripts/diff-vs-detailer.mjs", "Op-level diff: input.xml + ref.rfy → matched/missing/extra ops report."],
  ["scripts/diff-sweep.mjs", "Op-level corpus sweep — runs diff-vs-detailer over every paired job in a folder."],
  ["scripts/csv-diff-roundtrip.mjs", "Round-trip CSV diff: decode ref.rfy → CSV vs Detailer's emitted CSV."],
  ["scripts/csv-diff-vs-detailer.mjs", "Full-pipeline CSV diff: ours-csv vs ref-from-rfy-csv vs Detailer-csv."],
  ["scripts/csv-diff-pipeline.mjs", "One-shot wrapper running both RFY and CSV diffs."],
  ["scripts/csv-diff-sweep.mjs", "CSV-level corpus sweep with 3-way summary table."],
]));

// ---- Build document ----
const doc = new Document({
  creator: "HYTEK Group",
  title: "HYTEK RFY Tools User Guide",
  description: "How to use HYTEK RFY Tools — rules, regression, and what every edit changes",
  styles: { default: { document: { run: { font: "Arial", size: 21 } } } },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 240 } } } },
        ],
      },
      {
        reference: "numbers",
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 240 } } } },
        ],
      },
    ],
  },
  sections: [{
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "HYTEK RFY Tools — User Guide", font: "Arial", size: 16, color: MID_GRAY })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: "Arial", size: 16, color: MID_GRAY })],
      })] }),
    },
    properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
    children,
  }],
});

const outPath = path.join(__dirname, "..", "docs", "HYTEK_RFY_Tools_User_Guide.docx");
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log("Wrote", outPath, `(${buf.length.toLocaleString()} bytes)`);
}).catch(e => {
  console.error("Failed to build user guide:", e);
  process.exit(1);
});
