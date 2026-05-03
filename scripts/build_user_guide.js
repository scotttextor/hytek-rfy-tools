// Build the HYTEK RFY Tools user guide as a .docx file.
//
// Usage:  node scripts/build_user_guide.js
// Output: docs/HYTEK_RFY_Tools_User_Guide.docx
//
// Uses ONLY the docx package primitives that are confirmed to work in
// Word: Document + Paragraph + TextRun + AlignmentType. No tables, no
// numbering, no headers/footers, no images. The full set of advanced
// features (tables, numbering) was triggering "Word found unreadable
// content" / "Word experienced an error" — verified 2026-05-03 by
// Scott. Switching to plain-text formatting with bold/size/color
// styling delivers the same content reliably.

const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun, AlignmentType } = require("docx");

const YELLOW = "FFCB05";
const BLACK = "231F20";
const DARK = "333333";
const MID = "666666";

const children = [];

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0 },
    alignment: opts.align ?? AlignmentType.LEFT,
    children: [new TextRun({
      text,
      font: "Arial",
      size: opts.size ?? 21,
      bold: opts.bold,
      italics: opts.italic,
      color: opts.color ?? DARK,
    })],
  });
}

function blank(after = 80) { return p("", { after }); }
function h1(t) { return p(t, { size: 36, bold: true, color: BLACK, before: 360, after: 200 }); }
function h2(t) { return p(t, { size: 28, bold: true, color: BLACK, before: 280, after: 160 }); }
function h3(t) { return p(t, { size: 24, bold: true, color: BLACK, before: 200, after: 120 }); }
function body(t, opts = {}) { return p(t, { size: 21, color: DARK, ...opts }); }
function bullet(t) { return p("• " + t, { size: 21, color: DARK, after: 60 }); }
function num(n, t) { return p(n + ". " + t, { size: 21, color: DARK, after: 80 }); }
function callout(t) { return p("⚠ " + t, { size: 21, color: BLACK, bold: true, before: 100, after: 200 }); }

// Two-column "field → effect" presented as paragraph pairs (title bold,
// body indented in italics). Without tables we lose the box-and-grid
// look, but the content stays clear and structured.
function ref(rows) {
  const out = [];
  for (const [k, v] of rows) {
    out.push(p(k, { size: 21, bold: true, color: BLACK, after: 30 }));
    out.push(p("    " + v, { size: 21, color: DARK, after: 140 }));
  }
  return out;
}

// === Cover ===
children.push(p("HYTEK RFY Tools", { size: 56, bold: true, color: BLACK, align: AlignmentType.CENTER, before: 600, after: 120 }));
children.push(p("User Guide", { size: 44, bold: true, color: YELLOW, align: AlignmentType.CENTER, after: 240 }));
children.push(p("How to use the rule editor, regression dashboard,", { size: 24, italic: true, color: MID, align: AlignmentType.CENTER, after: 0 }));
children.push(p("and what every edit actually changes", { size: 24, italic: true, color: MID, align: AlignmentType.CENTER, after: 480 }));
children.push(p(`Generated ${new Date().toLocaleDateString("en-AU")}  ·  hytek-rfy-tools.vercel.app`, { size: 18, color: MID, align: AlignmentType.CENTER, after: 600 }));
children.push(blank(800));

// === 1. Overview ===
children.push(h1("1. What is HYTEK RFY Tools?"));
children.push(body("HYTEK RFY Tools is the standalone web app that replaces FrameCAD Detailer for HYTEK's F300i rollformer. It does three things:"));
children.push(bullet("Decodes encrypted .rfy files and emits readable XML, CSV, and op summaries."));
children.push(bullet("Encodes RFY files from input XML using HYTEK's own machine setups and frame-type rules — bypassing Detailer entirely."));
children.push(bullet("Lets you edit the rule sets that drive the encoder, save named templates, roll back, and verify output via a regression dashboard."));
children.push(body("Live URL:  https://hytek-rfy-tools.vercel.app", { bold: true }));

children.push(h2("Why this app exists"));
children.push(body("FrameCAD Detailer 5.3.4.0 is end-of-life — the licence on the workshop PC has already expired (showed \"01 Jan 1970\"). When it stops opening jobs, the F300i has no way to receive new RFY files unless we generate them ourselves. HYTEK RFY Tools is that fallback."));
children.push(body("Two of the bigger \"insurance policy\" features are the Rules Manager and the Regression Dashboard — between them, you can edit any rule HYTEK uses, prove the new rule still matches Detailer reference output, and revert if it goes wrong."));

children.push(h2("The four pages you'll use most"));
children.push(...ref([
  ["/  (home)", "File conversion. Drop RFY/XML/CSV files in to decode, re-encode, or convert. Doesn't change any rules — just runs the codec."],
  ["/rules", "Rules Manager. Edit machine setups (per-profile dimples, swages, lip notches) and frame types (which rule applies to LBW vs FJ vs LIN). Versioned templates with rollback."],
  ["/rules/tooling", "Tooling Rules Registry (read-only for now). Lists every per-stick rule the encoder runs — useful when you're trying to figure out \"why is this notch in the wrong place?\"."],
  ["/regression", "Match Regression Dashboard. Runs the codec across the test corpus and shows op-level + CSV-level match % vs Detailer reference. Use this to prove a rule edit didn't break anything."],
]));

// === 2. Home ===
children.push(h1("2. Home page (/) — File conversion"));
children.push(body("This is the default landing page. Use it for one-off file work — decoding a single .rfy to inspect its operations, or running a batch encode from XML."));

children.push(h2("What the home page does"));
children.push(bullet("Decode .rfy → XML, CSV, JSON: drag a single .rfy file in, get back the decrypted XML the way Detailer stored it, plus a friendly CSV summary."));
children.push(bullet("Encode XML → .rfy: drop a FrameCAD-import XML, get the encrypted .rfy back ready for the F300i."));
children.push(bullet("Bundle workflow: drop a whole job folder, get a production bundle (renamed to Detailer's filename convention so the rollformer recognises it)."));
children.push(bullet("Job-folder importer: paste in a Detailer job folder structure, the app auto-detects the right plan / pack / profile and runs the full pipeline."));

children.push(h2("What an edit on the home page DOES NOT change"));
children.push(callout("Home page is read-only against the rules. Drag-and-dropping a file there NEVER edits a machine setup, frame type, or tooling rule. Only the Rules Manager (/rules) edits rules."));

// === 3. Rules Manager ===
children.push(h1("3. Rules Manager (/rules) — the rule editor"));
children.push(body("This is the page where you change how the encoder behaves. Three concepts to keep straight:"));
children.push(num(1, "Rulesets — named snapshots of the entire HYTEK rule set. \"default\" is read-only and shipped with the app (extracted from FrameCAD Detailer's .sups files). You can save named copies (e.g., \"experiment-2026-05-15\") to experiment without breaking anything."));
children.push(num(2, "Machine types — per-profile rules: which dimples, swages, lip notches, anchor bolts go on a 70mm profile vs 89mm vs 89×0.95 etc. Driven by HYTEK MACHINE_FRAME TYPES on the Y: drive."));
children.push(num(3, "Frame types — which rule profile applies to which frame name (LBW = load-bearing wall, NLBW = non-load-bearing, FJ = floor joist, LIN = linear truss, RP = roof panel, etc.)."));

children.push(h2("3.1  The ruleset selector (top of page)"));
children.push(body("This is the band at the top with the active ruleset name + four buttons:"));
children.push(...ref([
  ["Active ruleset", "The ruleset currently being used by the encoder. The name appears next to a READ-ONLY badge if it's \"default\" (or any default.N version — see below)."],
  ["Save As New", "Clones the active ruleset to a new named copy. You give it a name (e.g., \"experiment-2026-05-15\") and an optional description. The new copy becomes editable — original stays untouched."],
  ["Revert", "Discards in-memory edits and re-loads the active ruleset from disk. Use this if you've made changes you don't want to keep but haven't saved yet."],
  ["Delete", "Permanently deletes a NON-default named ruleset. Default cannot be deleted. The currently-active ruleset cannot be deleted (switch to another first)."],
  ["Switch", "Changes which ruleset is active. The encoder immediately uses the newly-selected ruleset for any subsequent encode/decode."],
]));

children.push(h2("3.1a  The default master file — STANDING DIRECTIVE"));
children.push(body("The \"default\" ruleset is the factory baseline — the original HYTEK rules extracted from FrameCAD Detailer's .sups files. It is intentionally sacred."));
children.push(body("The default master can ONLY ever be changed by editing source files in the git repo and pushing new code. There is NO path through the running app — no UI button, no API call, no admin override — that can modify it. This is enforced at every layer:"));
children.push(bullet("UI: \"Save\" button is hidden when the active ruleset is read-only."));
children.push(bullet("API: /api/setups PUT and /api/frame-types PUT both return 403 if the active ruleset is default."));
children.push(bullet("Library: lib/rulesets.ts rejects saveRuleset() calls with \"Ruleset is read-only\"."));
children.push(bullet("File: meta.json has readonly: true; the deletion endpoint specifically excludes \"default\"."));

children.push(h2("3.1b  Versioned defaults — when a fault is found"));
children.push(body("If we ever identify a fault in the default rules, we do NOT edit the original. We create a NEW versioned default that incorporates the fix, and the original stays on disk forever."));
children.push(body("How it works:"));
children.push(num(1, "Developer regenerates or fixes the JSON in data/rulesets/default.N/ (where N is the next free version number — default.1, default.2, etc.)."));
children.push(num(2, "Pushes the change to git. The app now ships with BOTH the original default AND default.N — both visible in the ruleset selector, both read-only, both preserved permanently."));
children.push(num(3, "The \"preferred default\" pointer flips to default.N (also a code change). The encoder uses default.N by default for new sessions."));
children.push(num(4, "Anyone wanting the original behavior can switch back to plain \"default\" anytime — it's still there, untouched, exactly as shipped."));
children.push(callout("Rule of thumb: never edit a default* ruleset. Click Save As New to clone, then edit the copy. If your experiment goes wrong, switch back to any default version and you're restored to that factory baseline. Full restorability — no factory version is ever lost."));

children.push(h2("3.2  Machine Types tab — per-profile rules"));
children.push(body("Each machine type is a profile (70S41 0.75, 89S41 1.15, etc.) with these editable settings:"));
children.push(...ref([
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

children.push(h2("3.3  Frame Types tab — which rule profile to use"));
children.push(body("Frame types map a frame's NAME PATTERN to a rule profile. The encoder looks at the frame name (\"GF-LBW-70.075\", \"PC7-1\", \"L1101\") and decides which set of rules applies."));
children.push(...ref([
  ["Frame type code", "The category prefix in the frame name. LBW, NLBW, FJ, LIN, RP, TIN, CP, MH, TB2B, etc."],
  ["Display name", "Cosmetic. \"Load-Bearing Wall\" vs \"Non-Load-Bearing Wall\" etc."],
  ["Rule profile assignment", "Which machine-type profile the frame uses. Editing this changes which dimples/swages/notches get emitted for every frame matching this code."],
  ["Trim rules", "Frame-level trim overrides — e.g., LIN frames don't trim chord ends (verified vs LINEAR_TRUSS_TESTING reference). Editing here lets you flip whether a frame type gets the standard 4mm trim or skips it."],
  ["Special-case flags", "Booleans like \"isShearWall\", \"hasContinuousNog\". These gate empirical rules added during the 75% match push."],
]));

children.push(h2("3.4  Save flow"));
children.push(body("Two save buttons:"));
children.push(num(1, "Save to Active Ruleset — writes your in-memory edits to the active ruleset's machine-types.json or frame-types.json on disk. Default ruleset is read-only and will reject this with a 403."));
children.push(num(2, "Save As New (in the ruleset selector) — creates a new ruleset by cloning the active one + applying your edits."));
children.push(callout("If you forget to click Save, your edits are lost on a page refresh. Look for the dirty indicator (highlighted Save button) — it's the only signal that there's unsaved work."));

// === 4. Tooling Rules Registry ===
children.push(h1("4. Tooling Rules Registry (/rules/tooling)"));
children.push(body("This page lists every PER-STICK rule the encoder applies. It's currently read-only — useful when you're debugging \"why is this notch at the wrong position?\" — but the data lives in src/rules/table.ts in the codec repo and you can edit it there."));
children.push(h2("What's in the registry"));
children.push(bullet("Per-stick rules grouped by role (Stud, Plate, Nog, Brace, Web, etc.) and by profile family (70mm, 89mm)."));
children.push(bullet("Each rule lists the tool type it emits (Bolt, Web, Swage, LipNotch, InnerDimple, etc.), the anchor (start-anchored, end-anchored, span), the offset, the predicate (when it fires), and the confidence level (high/medium/low)."));
children.push(bullet("Frame-context parameters — values like elevation thresholds (\"only on ground-floor walls\", \"only on gauge < 1.0\") that gate certain rules."));
children.push(bullet("Trim rules — how much to shave off each stick by usage type."));
children.push(h2("Why look here"));
children.push(body("When the cut steel comes out wrong, this is the first place to look. Find the rule that emitted the wrong op, then either:"));
children.push(bullet("Edit the rule in src/rules/table.ts and rebuild the codec, or"));
children.push(bullet("Edit the relevant Machine Type setting in /rules to change the offset / span globally,"));
children.push(bullet("Or roll back to a previously-saved ruleset that was last known good."));

// === 5. Regression dashboard ===
children.push(h1("5. Match Regression Dashboard (/regression)"));
children.push(body("The regression dashboard runs the codec against the entire test corpus and shows how many operations match the Detailer reference output. Use it AFTER editing rules to verify the change didn't break anything."));

children.push(h2("5.1  Reading the summary tiles"));
children.push(...ref([
  ["Overall match %", "Op-level match across the whole corpus. Currently 75.45% on 40 jobs (target: 100% via Frida capture once Detailer reinstalls)."],
  ["Jobs", "Total number of XML/RFY pairs the harness ran. Each pair = one frame + one expected RFY."],
  ["At 100%", "Number of jobs that match Detailer exactly. CP-89.075 currently sits at 100% (96 ops). Goal is to get every category there."],
  ["Errors", "Jobs that failed to run (codec crash, malformed input). 0 = clean run."],
  ["CSV full pipeline %", "NEW. Row-level CSV match: ours-csv vs Detailer-csv. Currently 25.1% on HG260044 (full pipeline). Lower than op-level because CSV reordering + FILLER rules add row-level differences not visible in the RFY."],
  ["CSV emission %", "Decoder→csv accuracy alone — measures whether documentToCsvs() correctly emits Detailer's CSV format from a known-good RFY. Currently 48.9%."],
  ["CSV rule-gen %", "Synthesize→csv accuracy — measures the rule generation through the CSV lens. Currently 30.6%."],
]));

children.push(h2("5.2  By-category view"));
children.push(body("Below the tiles is a per-category breakdown (CP-89.075, NLBW-89.075, LBW-89.075, etc.). The bar chart shows the match % visually; numbers next to it are matched / total ops in that category."));
children.push(body("CSV match % appears in sky-blue beside each category when a paired .csv reference is available."));

children.push(h2("5.3  Job-list view + drill-down"));
children.push(body("Below the categories is a sortable job list. Click any job to expand:"));
children.push(bullet("Per-frame breakdown — which frames in this job have gaps."));
children.push(bullet("Per-stick breakdown — which sticks have missing/extra ops."));
children.push(bullet("By-op-type counts — how many LipNotch ops matched vs missed, how many Swage spans extra, etc."));

children.push(h2("5.4  Refresh button"));
children.push(body("The dashboard caches results in memory. Click Refresh to re-run the corpus diff after a rule edit. Takes 1-3 minutes for the full 40-job run on a warm machine."));
children.push(callout("Workflow: edit rules → Save → click Refresh on /regression → check the overall match % went UP not DOWN. If it dropped, revert the ruleset and try again."));

children.push(h2("5.5  Local-only"));
children.push(body("The dashboard can only run on a machine where the test corpus is on disk. On Vercel and other hosted environments it shows an amber info card explaining this — that's not an error, just informational."));

// === 6. What an edit changes ===
children.push(h1("6. \"What does editing X change?\" — quick reference"));
children.push(body("Use this as a lookup before you change anything in /rules. Every entry tells you exactly what downstream effect to expect."));

children.push(h2("6.1  Edits that change EVERY stick of a profile"));
children.push(...ref([
  ["End Clearance (mm)", "Every plate/chord on every frame using this profile gets ±delta in length. All cap dimple/swage/notch positions shift by the same delta. SERVICE HOLE positions are absolute and don't shift."],
  ["Stud End Trim (mm)", "Every stud's length and every position-from-stick-end op (e.g., end-cap Swage at length-27.5, end-cap LipNotch at length-24)."],
  ["Service Hole positions list", "Every stud and topplate gets these exact positions emitted as SERVICE HOLE cells. Adding 596 to the list = a new SERVICE HOLE,596 in every relevant stick. Removing one = that hole disappears."],
  ["InnerDimple offsets", "Cap dimple positions on plates/studs (16.5mm = standard). Changing this shifts the visible cap pattern for every stick."],
  ["Swage span offset", "Default 27.5mm = SWAGE,27.5 at start, SWAGE,length-27.5 at end. Changing it changes the LEADING and TRAILING swage positions on every stick."],
  ["Lip Notch stride", "Affects how dense the LIP NOTCH cells are along long spans. Default stride 48mm = positions every 48mm. Wider stride = fewer notches per span."],
  ["Anchor Bolt offset (70mm)", "Position of ANCHOR holes on ground-floor bottom plates. Edit this and every ground-floor B-plate at this profile changes where it gets anchored."],
  ["Web Bolt offset", "Position of BOLT HOLES (Web tool) on plates. Same gating as ANCHOR — ground-floor walls only."],
]));

children.push(h2("6.2  Edits that change a SUBSET of frames"));
children.push(...ref([
  ["Frame type → Profile mapping", "Reassigns which machine-type rules fire for an entire frame category. Changing LBW from 70S41_0.75 to 89S41_0.75 makes every load-bearing wall use the heavier profile rules — which adds anchor bolts, changes cap pattern, etc."],
  ["LIN trim override", "LIN (Linear Truss) frames don't trim chord ends. Toggling this on/off adds or removes 4mm/end on every LIN chord stick."],
  ["Raking-frame Chamfer rule", "Sloped-top-plate walls get Chamfer@end on full studs and Chamfer@start/end on the high side of the top plate. Disabling this skips chamfers on raking walls."],
  ["RP no-Chamfer override", "Roof panels (RP frames) don't get Chamfers, despite their sloped top plates. This rule prevents the raking-frame logic from firing on RP."],
  ["FJ short-stub paired notch", "Short FJ chord stubs (length ≤ 250mm) get paired InnerNotch alongside their LipNotch caps. Toggling this changes cap patterns on every short FJ stub."],
  ["Continuous-nog Swage rule", "Swages on interior S studs at nog crossings. Disabling this removes ~10-30 ops per LBW frame."],
]));

children.push(h2("6.3  Edits that ONLY affect CSV output"));
children.push(...ref([
  ["Tool-type CSV label mapping", "How RFY tool types render in the CSV. Bolt → ANCHOR, Web → BOLT HOLES, InnerNotch → WEB NOTCH. Swapping these changes the CSV but NOT the encoded RFY (the F300i reads RFY directly)."],
  ["Length-column precision", "2-decimal vs 1-decimal for the length column in the CSV. Detailer uses 2-decimal for diagonal Kb braces (1377.73). 1-decimal everywhere else."],
  ["FILLER row insertion", "FILLER rows separate W/Kb groups from default sticks in the CSV. Disabling this removes ~141 rows per LBW job in our output (Detailer always emits them)."],
  ["DETAILS-per-frame", "Detailer emits a DETAILS,job#1-1,plan header before every frame. Disabling this drops to one DETAILS row per file (legacy behavior)."],
]));

// === 7. Workflows ===
children.push(h1("7. Common workflows"));

children.push(h2("7.1  \"The cut steel came out wrong on this frame\""));
children.push(num(1, "Open /rules/tooling. Find the rule for the role + profile combo (e.g., Stud, 70mm, gauge 0.75)."));
children.push(num(2, "Identify which rule fired the wrong op. Note the offset, predicate, and tool type."));
children.push(num(3, "Open /rules. Click Save As New to clone the active ruleset to \"fix-2026-05-XX\"."));
children.push(num(4, "Edit the relevant Machine Type setting (e.g., Service Hole positions, Swage offset)."));
children.push(num(5, "Click Save to Active Ruleset."));
children.push(num(6, "Open /regression. Click Refresh."));
children.push(num(7, "Compare the new overall match % to the previous one (75.45%). UP = good. DOWN = revert and try again."));
children.push(num(8, "If it's good, drill into the original problem job to confirm the specific stick is now correct."));

children.push(h2("7.2  \"I want to experiment without breaking anything\""));
children.push(num(1, "Open /rules. Click Save As New. Name it \"experiment-YYYY-MM-DD\"."));
children.push(num(2, "Click that ruleset to make it active."));
children.push(num(3, "Edit anything you like."));
children.push(num(4, "Save. Test on /regression."));
children.push(num(5, "If it goes wrong, click \"default\" in the ruleset selector — you're restored to factory rules."));
children.push(num(6, "If it goes right, leave the ruleset as-is. The default ruleset is untouched and always available as a fallback."));

children.push(h2("7.3  \"I need to roll back a change I made yesterday\""));
children.push(num(1, "Open /rules."));
children.push(num(2, "In the ruleset selector dropdown, switch back to \"default\" or to whichever named ruleset was last good."));
children.push(num(3, "Encoder immediately uses the older rules — no rebuild, no restart needed."));
children.push(num(4, "If the bad ruleset is no longer wanted, click Delete on it (cannot delete default, cannot delete active — switch first)."));

children.push(h2("7.4  \"I want to verify that ruleset X still produces correct output\""));
children.push(num(1, "Open /rules. Switch to ruleset X via the selector."));
children.push(num(2, "Open /regression. Click Refresh — wait 1-3 minutes."));
children.push(num(3, "Read the overall match %. 75.45% is the current factory baseline."));
children.push(num(4, "Drill into any category that dropped to find the regression."));

// === 8. Troubleshooting ===
children.push(h1("8. Troubleshooting"));

children.push(h2("\"Unexpected token, is not valid JSON\" with a strange first character"));
children.push(body("Cause: A ruleset JSON file has a UTF-8 byte-order mark (BOM) at the start. The BOM-stripping reader in lib/rulesets.ts handles this transparently as of 2026-05-03. If you see this error after restoring an older ruleset, run the rebuild script in scripts/."));

children.push(h2("\"Corpus directory not found\" on /regression"));
children.push(body("Expected on Vercel and other hosted environments. The dashboard runs the diff harness against a local Windows path and can only work on a machine that has the corpus on disk. Set the CORPUS_DIR environment variable to point at the corpus folder, or run the dashboard locally."));

children.push(h2("\"Ruleset is read-only\" when trying to save"));
children.push(body("You're trying to save to the \"default\" ruleset, which is protected. Click Save As New first to create an editable copy, then save into that copy."));

children.push(h2("Dirty indicator stays on after saving"));
children.push(body("Refresh the page. The save endpoint returned 200 but the local React state didn't reset — known minor bug."));

children.push(h2("Encoded RFY rejected by F300i"));
children.push(body("Most common cause: profile metric label says \"70 C 41\" instead of \"70 S 41\". Detailer always normalises shape to \"S\" — the encoder now does the same as of 2026-05-03. If you have older RFY files generated before that fix, re-encode them."));

// === 9. Reference ===
children.push(h1("9. Reference"));

children.push(h2("Brand colors (per HYTEK Group Brand Manual)"));
children.push(...ref([
  ["Yellow", "#FFCB05 — primary brand color"],
  ["Black", "#231F20 — primary background"],
  ["Logo", "/hytek-group-logo.png in public/ — yellow on transparent for dark backgrounds"],
  ["Logo, inverted", "/hytek-group-logo-inverted.png — for light backgrounds"],
  ["Logo, monochrome", "/hytek-group-logo-bw.png — print, faxes, low-color contexts"],
]));

children.push(h2("Repos"));
children.push(...ref([
  ["hytek-rfy-tools", "https://github.com/scotttextor/hytek-rfy-tools — this app (Next.js)"],
  ["hytek-rfy-codec", "https://github.com/scotttextor/hytek-rfy-codec — the codec library (decoder/encoder/rules)"],
  ["Live URL", "https://hytek-rfy-tools.vercel.app — auto-deploys from master"],
]));

children.push(h2("Source-of-truth files"));
children.push(...ref([
  ["Machine setups (factory)", "Y:\\(08) DETAILING\\(13) FRAMECAD\\FrameCAD DETAILER\\HYTEK MACHINE_FRAME TYPES\\"],
  ["Machine setups (default ruleset)", "data/rulesets/default/machine-types.json (in repo)"],
  ["Frame types (default ruleset)", "data/rulesets/default/frame-types.json (in repo)"],
  ["Per-stick rule table", "src/rules/table.ts in hytek-rfy-codec (the encoder's rule registry)"],
  ["Frame-context rules", "src/rules/frame-context.ts in hytek-rfy-codec"],
]));

children.push(h2("Diff harness scripts"));
children.push(...ref([
  ["scripts/diff-vs-detailer.mjs", "Op-level diff: input.xml + ref.rfy → matched/missing/extra ops report."],
  ["scripts/diff-sweep.mjs", "Op-level corpus sweep — runs diff-vs-detailer over every paired job in a folder."],
  ["scripts/csv-diff-roundtrip.mjs", "Round-trip CSV diff: decode ref.rfy → CSV vs Detailer's emitted CSV."],
  ["scripts/csv-diff-vs-detailer.mjs", "Full-pipeline CSV diff: ours-csv vs ref-from-rfy-csv vs Detailer-csv."],
  ["scripts/csv-diff-pipeline.mjs", "One-shot wrapper running both RFY and CSV diffs."],
  ["scripts/csv-diff-sweep.mjs", "CSV-level corpus sweep with 3-way summary table."],
]));

// === 10. Wall Editor — LIVE ===
children.push(h1("10. Wall Editor (/viewer) — LIVE"));
children.push(body("All five build phases shipped 2026-05-03. The Wall Editor is now the primary yellow button in the home-page navigation."));
children.push(body("Live URL:  https://hytek-rfy-tools.vercel.app/viewer", { bold: true }));

children.push(h2("10.1  How to use it"));
children.push(num(1, "Drop a .rfy or input .xml file anywhere on the /viewer page. The wall renders in real-world style — sticks drawn as actual steel sections with visible C-section flange depth, tool ops drawn as their actual physical shape (real notch geometry, real holes, real swage bumps)."));
children.push(num(2, "Sidebar lists every frame in the imported file. Click a frame to render it on the canvas. The wall auto-fits the viewport."));
children.push(num(3, "Drag empty canvas to pan. Mouse wheel to zoom — both crisp at any zoom level."));
children.push(num(4, "Click a stick to select it (highlights in HYTEK yellow). The sidebar's bottom panel shows the stick's profile, length, role, and full ordered op list."));
children.push(num(5, "+ Add op: opens a dialog with the tool-type dropdown (all 14 types) and a position input. Sensible defaults — spanned types get a 39mm centred span, point types get the position you specify."));
children.push(num(6, "Hover any op in the side list → red ✕ to delete it. Logged to undo history."));
children.push(num(7, "Drag the body of a SELECTED stick to move it. Drag the yellow circle handles at each end to resize/reorient."));
children.push(num(8, "✏ Draw stick mode: click the toolbar button (cursor becomes crosshair), drag on the canvas to define a new stick by start → end midline. Releases commits via addStick. Default profile: 70 S 41 / 0.75mm."));
children.push(num(9, "Undo/redo: ↶ Undo and ↷ Redo buttons in the header, or Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts. Up to 100 steps of history per session."));
children.push(num(10, "💾 Save: when the document is dirty (yellow ● marker next to filename), click Save to download an updated .rfy file ready for the F300i. The save round-trips through /api/encode — your edited document gets serialised back to schedule XML and re-encrypted."));

children.push(h2("10.2  What it edits — and what it doesn't"));
children.push(callout("The Wall Editor edits PER-JOB data — the .rfy file for ONE specific job. It does NOT edit any rules. Saving in the Wall Editor never touches default*, never touches your named rulesets, never changes what the encoder does next time you import a different XML. Two completely separate save targets."));

children.push(h2("10.3  Tool-op shapes (visual key)"));
children.push(body("Each tool-op type is drawn as its actual physical shape so you can read the wall picture at a glance:"));
children.push(...ref([
  ["InnerDimple", "Small dome circle with a lighter highlight — pre-punched indent."],
  ["Swage", "Oval bump 14mm × 6mm with highlight — stiffening rib."],
  ["LipNotch", "V-cut on each lip edge — appears at every stud crossing."],
  ["LeftFlange / RightFlange", "Single-side V-cut variant of LipNotch."],
  ["LeftPartialFlange / RightPartialFlange", "Half-depth V-cut on one side."],
  ["InnerNotch (WEB NOTCH)", "Rectangular notch in the web — fitment cutout."],
  ["Web (BOLT HOLES)", "Filled circle through the web — pass-through bolt hole."],
  ["Bolt (ANCHOR)", "Larger filled circle with darker inner ring — anchor bolt into slab."],
  ["ScrewHoles (ANCHOR cluster)", "Three small filled circles — chord-pair screw cluster."],
  ["InnerService (SERVICE HOLE)", "Oval slot 10mm × 5mm — cable / pipe pass-through."],
  ["Chamfer / TrussChamfer", "Triangular corner cut — diagonal stick ends."],
]));

children.push(h2("10.4  Build approach (locked in)"));
children.push(...ref([
  ["Stack", "Pure SVG + React + Zustand. No 3rd-party drawing library — full control over how steel and tool ops render."],
  ["Visual fidelity", "2D realistic — sticks drawn with steel shading + C-section flange shadow visible. Tool ops drawn as actual punch geometry, not abstract symbols. Looks like a manufacturing drawing."],
  ["Performance", "Renders one frame at a time (~600 SVG elements). Pan/zoom via SVG viewBox math (not CSS scale) so stroke widths stay crisp at any zoom. Frame switching is instant from in-memory model."],
  ["Isolation", "Lives entirely under app/viewer/. Zero changes to /, /rules, /rules/tooling, /regression. The wall editor's save action only touches the downloaded .rfy file — never any rule files on disk."],
  ["Save round-trip", "doc → documentToScheduleXml(doc) → POST /api/encode → encryptRfy → .rfy bytes → browser download. Existing /api/encode is reused — no new server endpoint needed."],
]));

// ---- Build & write ----
const doc = new Document({
  creator: "HYTEK Group",
  title: "HYTEK RFY Tools User Guide",
  description: "How to use HYTEK RFY Tools — rules, regression, and what every edit changes",
  styles: { default: { document: { run: { font: "Arial", size: 21 } } } },
  sections: [{ children }],
});

const docsDir = path.join(__dirname, "..", "docs");
let outPath = path.join(docsDir, "HYTEK_RFY_Tools_User_Guide.docx");

function pickWritablePath(base) {
  if (!fs.existsSync(base)) return base;
  try {
    const fd = fs.openSync(base, "r+"); fs.closeSync(fd);
    return base;
  } catch {
    const dir = path.dirname(base);
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    for (let v = 2; v < 50; v++) {
      const c = path.join(dir, `${stem}-v${v}${ext}`);
      if (!fs.existsSync(c)) return c;
    }
    return base;
  }
}

Packer.toBuffer(doc).then(buf => {
  outPath = pickWritablePath(outPath);
  fs.writeFileSync(outPath, buf);
  console.log("Wrote", outPath, `(${buf.length.toLocaleString()} bytes)`);
}).catch(e => { console.error("Failed:", e); process.exit(1); });
