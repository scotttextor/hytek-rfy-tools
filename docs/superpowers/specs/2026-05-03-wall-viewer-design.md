# Wall Viewer / Editor Design — `/viewer` route

**Status:** approved, ready to build
**Date:** 2026-05-03
**Owner:** Scott (decisions) + Claude (implementation)

## Problem

HYTEK has no way to visualise an imported XML or `.rfy` as the actual wall it
represents. To check whether the codec is producing correct output, you have
to read raw text or open Detailer (which is end-of-life). We need a real-world
visual representation so HYTEK can:

1. See what an imported XML / `.rfy` actually looks like as a wall.
2. Inspect every stick's tool ops without reading XML.
3. Eventually edit walls — add tool ops, move sticks, add sticks — like
   Detailer does, but in our own app.

## Decisions made (locked in by Scott 2026-05-03)

| Question | Decision |
|---|---|
| **Scope** | Option 2 — full editor parity with Detailer (viewer + add ops + move sticks + add sticks + undo/redo + save back to `.rfy`) |
| **Visual fidelity** | Option B — 2D realistic. Sticks rendered with steel shading + visible C-section flange shadow. Tool ops drawn as their actual physical shape (real notch geometry, real holes, real swage bumps). |
| **Build approach** | Approach A — Pure SVG + React + Zustand. No 3rd-party drawing library. Light dep footprint, full control over rendering, debuggable text-based output. |
| **Isolation from existing app** | Brand-new route `/viewer`. Zero changes to `/`, `/rules`, `/rules/tooling`, `/regression`. Hidden from nav until v1 ships. |
| **Performance** | Render one frame at a time (~600 SVG elements). Pan/zoom via CSS transform — GPU accelerated. Frame-switching is instant from in-memory model. |

## Architecture

```
.xml or .rfy file dropped on /viewer
        ↓
   codec decode  (existing — @hytek/rfy-codec)
        ↓
   RfyDocument  (existing typed object)
        ↓
   Zustand store  (NEW — mirrors RfyDocument + selection + undo history + dirty flag)
        ↓
   React components  (NEW — render sticks + tool ops as SVG)
        ↓
   user interaction → store mutation → re-render
        ↓
   "Save" button: store → codec encode → .rfy file download
```

### File layout — everything new under `app/viewer/`

- `app/viewer/page.tsx` — top-level page: file drop zone + frame switcher + sidebar + canvas
- `app/viewer/store.ts` — Zustand store with undo/redo history
- `app/viewer/components/Wall.tsx` — SVG canvas, pan/zoom container
- `app/viewer/components/Stick.tsx` — single stick renderer (steel shading + C-section flange shadow)
- `app/viewer/components/ToolOp.tsx` — single tool op renderer (real shape per type)
- `app/viewer/components/Sidebar.tsx` — frame list + selected-stick property panel
- `app/viewer/lib/geometry.ts` — pure helpers (outline corners → SVG path, op pos → coords)
- `app/viewer/lib/edits.ts` — pure functions: addOp, moveStick, deleteOp (called by store actions)

### Critical isolation rule

`app/viewer/lib/edits.ts` only knows about `RfyDocument` types. Every edit produces a valid `RfyDocument` that the existing codec encoder already knows how to ship to the F300i. **The wall editor never touches rule files.** Save in `/viewer` writes a per-job `.rfy` for download — it does NOT modify default rulesets, named rulesets, or anything in `data/rulesets/`. Two completely separate save targets.

## Visual rendering model

### Stick rendering

Each stick is one SVG `<g>` containing:
- A `<rect>` for the web body (filled with a steel gradient: light at top, mid-grey middle, darker at bottom — gives a 3D illusion of curved sheet metal)
- A thin `<rect>` overlay on the left edge filled with a horizontal gradient (light → dark) — this is the **flange shadow** showing the stick has C-section depth and isn't a flat strip
- A child `<g>` containing all tool op `<g>` elements at their positions

Stick orientation: horizontal sticks render horizontally, vertical sticks vertically, diagonal sticks rotated to match `outlineCorners` from the RFY data.

### Tool op rendering — real shapes per type

| Op type | Visual shape |
|---|---|
| InnerDimple | Small filled circle (4px) with lighter inner highlight — looks like a dome |
| Swage | Filled ellipse 14×6 with lighter highlight — looks like an oval bump |
| LipNotch | Two V-cut paths, one on each lip edge of the stick — actual notch geometry |
| LeftFlange / RightFlange | Same V-cut but only on one side |
| LeftPartialFlange / RightPartialFlange | Half-depth V-cut on one side |
| InnerNotch (WEB NOTCH) | Filled rectangle in the web — actual rectangular cut |
| Web (BOLT HOLES) | Filled circle 4px — actual hole through web |
| Bolt (ANCHOR) | Larger filled circle 7px with darker inner ring — anchor bolt hole |
| ScrewHoles | Cluster of 3 small filled circles at fixed spacing |
| InnerService (SERVICE HOLE) | Filled ellipse 10×5 — oval slot for cables/pipes |
| Chamfer / TrussChamfer | Filled triangle at the stick corner — actual diagonal cut |

Spanned ops (LipNotch [start..end], etc.) render as multiple op shapes at the
positions returned by the existing `expandSpan()` helper from the codec.

## Phasing — independent shipping milestones

| Phase | Scope | Estimate | Ships independently |
|---|---|---|---|
| **0** | Scaffold `/viewer` route with file drop zone + frame switcher + empty canvas | 0.5 wk | yes |
| **1** | Read-only viewer: render sticks + tool ops in real-world style. Click to inspect. Pan/zoom. | 2 wk | yes |
| **2** | Add tool op editor — click stick → add op menu, edit positions, delete ops | 2 wk | yes |
| **3** | Move/resize sticks via drag handles | 1.5 wk | yes |
| **4** | Add new sticks (click empty wall area, draw, profile picker) | 1.5 wk | yes |
| **5** | Undo/redo + save back to `.rfy` (codec encode → download) | 0.5 wk | yes |
| | **Total: ~7-8 weeks** | | |

Each phase is hidden behind the same `/viewer` route — no separate URL needed. Phase N's UI elements simply don't appear until that phase ships. Production `/`, `/rules`, `/rules/tooling`, `/regression` are unaffected throughout.

## State management

Zustand store shape:

```ts
interface ViewerStore {
  // Loaded document
  doc: RfyDocument | null;
  filename: string | null;

  // Navigation
  selectedPlanIdx: number;
  selectedFrameIdx: number;
  selectedStickKey: string | null;  // `${frameIdx}-${stickIdx}`
  selectedOpIdx: number | null;

  // Camera
  zoom: number;
  panX: number;
  panY: number;

  // Edit state
  history: RfyDocument[];   // past states for undo
  future: RfyDocument[];    // states for redo
  dirty: boolean;

  // Actions
  loadDoc(doc: RfyDocument, filename: string): void;
  selectStick(key: string | null): void;
  addOp(stickKey: string, op: RfyToolingOp): void;
  removeOp(stickKey: string, opIdx: number): void;
  moveStick(stickKey: string, dx: number, dy: number): void;
  // ... etc
  undo(): void;
  redo(): void;
  exportRfy(): Promise<Blob>;
}
```

Every edit action snapshots the current `doc` to `history` before mutating, enabling unlimited undo. `future` is cleared on any new edit.

## Testing strategy

- **Pure functions in `lib/edits.ts`** — unit tested directly. Given input `RfyDocument` + edit op, assert exact output `RfyDocument`. No React, no DOM.
- **Geometry helpers in `lib/geometry.ts`** — unit tested. Outline corners → SVG path; op position → screen coords.
- **React components** — visual smoke tests (Playwright) to confirm a stick renders, a click selects it, etc. No detailed snapshot tests since SVG output is verbose; we test behaviour, not DOM structure.

## Out of scope (explicit)

- 3D rendering — picked the 2D realistic approach instead. Can add later if useful.
- Multi-frame editing — only one frame visible at a time. Frame switcher in sidebar.
- Drag-and-drop new sticks across frames — sticks belong to one frame, can be moved within it but not between frames.
- Editing the project metadata (name, jobNum, etc.) — the file drop zone displays it but it's read-only.

## Risks

| Risk | Mitigation |
|---|---|
| SVG performance hit on huge frames (>5000 elements per frame) | Render one frame at a time. If a single frame hits this scale, virtualise the stick list (only render sticks visible in the viewport). |
| Drag interaction conflicting with pan-zoom | Use a clear stick-vs-canvas hit-test order: stick clicks bubble to stick handlers, empty-canvas clicks reach the pan handler. |
| Save-back encoder produces invalid RFY for hand-edited docs | Reuse the existing codec encoder + decoder round-trip test. Every save runs `decode(encode(doc))` and checks the round-trip is identical. |
| Scope creep on Phase 2 (op editing) — too many op types to edit cleanly | Ship with the most common 5 op types (InnerDimple, Swage, LipNotch, Bolt, Web) editable. Rarer types (TrussChamfer etc.) get a generic "raw" editor that lets you set type+pos manually. |
