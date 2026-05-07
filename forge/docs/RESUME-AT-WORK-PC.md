# Resume at Work-PC — 7-day codec push (handover 2026-05-07)

You're picking this up at the work PC where Detailer's license activates
cleanly. The home-PC session hit a license-blocked state mid-run.

## Open Claude Code with full autonomy

```powershell
claude --dangerously-skip-permissions
```

That removes click-to-approve prompts so the run can go all night.

## Pickup checklist (paste into Claude after launch)

```
Resume the 7-day non-Detailer codec push on this work PC. State as of last
session:

- 388 XML↔RFY pairs indexed in hytek-rfy-codec/scripts/y-drive-pairs.json
  (whole Y: drive scan, all builders, 2025+2026)
- 66,262 stick×ops truth records in hytek-rfy-codec/scripts/truth-corpus.jsonl
- Codec wide-corpus baseline ~80% (full 388-pair run was at 353/388 when
  session paused — re-run to get final number)
- Forge cache: 383 entries (22 Detailer-fresh + ~360 Y-drive references
  bulk-imported via forge/cache/import-y-drive-pairs.py)
- Gap concentrated in RP (47%), TIN (60%), TB2B (58%); LBW/NLBW are 77-90%

First three things to do:
1. git pull both repos:
     cd "$env:USERPROFILE\CLAUDE CODE\hytek-rfy-codec"; git pull --ff-only
     cd "$env:USERPROFILE\CLAUDE CODE\hytek-rfy-tools"; git pull --ff-only
2. Confirm Detailer activates (no VPN block here):
     python forge/worker/license_watcher.py --interval 30 --max-hours 0.05
   (should email + exit 0 within ~1 min)
3. Then continue building the targeted RP simplifier per
   forge/docs/SESSION-LOG-2026-05-06-OVERNIGHT.md plus the corpus mining
   notes in this file below.

Goal: codec at 90%+ in 7 days, with cache covering all historical jobs and
operator-review workflow for the residual gap. Read
hytek-rfy-tools/forge/docs/HANDOVER-PHASE-1-3-COMPLETE.md and
forge/docs/SESSION-LOG-2026-05-06-OVERNIGHT.md for full context.
```

## State at handover

### Cache (synced via OneDrive — already on work PC)

`%USERPROFILE%\OneDrive - Textor Metal Industries\CLAUDE DATA FILE\detailer-oracle-cache`

```
383 entries, all validated.
```

Run `python forge/cache/store.py index` to list. Run
`python forge/cache/validate.py` to confirm integrity.

### What's in each repo

**hytek-rfy-codec (master, fully pushed)**
- `scripts/build-y-drive-pairs.mjs` — walks Y: drive, builds XML↔RFY pair index
- `scripts/y-drive-pairs.json` — 388 paired entries
- `scripts/extract-truth-corpus.mjs` — turns pairs into stick×ops records
- `scripts/truth-corpus.jsonl` — 66,262 records (63 MB)
- `scripts/analyze-corpus-fingerprints.mjs` — fingerprint reliability analysis
- `scripts/diff-vs-y-pairs.mjs` — codec vs all 388 Y-drive pairs (THE baseline)
- `scripts/baselines/y-pairs-baseline.{json,md}` — partial run output

**hytek-rfy-tools (master, fully pushed)**
- `forge/cache/import-y-drive-pairs.py` — bulk-import the 388 pairs into Forge cache
- `forge/notify/email_scott.py` — emails scott@textor.com.au when stuck (proven working)
- All Phase 1-4 work from prior session intact

### Gap signal — what to attack first

From the partial baseline (first 30 + spot-check pairs):

| Plan | Parity | Action |
|------|-------:|--------|
| NLBW | 89.8% | Marginal — leave for last |
| CP | 92.4% | Small sample, leave |
| LBW | 76.7% | Targeted edge fixes |
| TIN | 59.9% | Existing simplify-tin-truss.ts can be tightened |
| TB2B | 57.7% | Linear-truss-style simplifier needed |
| **RP** | **47.4%** | **Worst — biggest improvement headroom** |

Sample RP gap (HG250068 R1 T2):

| Op | Codec emits | Detailer emits |
|----|-------------|----------------|
| @0..39 cap | Swage 0..39 | LipNotch 0..39 |
| @369..414 mid | LipNotch 352..412 | LipNotch 369..414 |
| @1463..1502 cap | Swage 1459..1498 | LipNotch 1463..1502 |
| @391 dimple | InnerDimple @375.1 | InnerDimple @391.5 |

Two systematic issues for RP:
1. **Swage→LipNotch** at cap positions on TopPlate
2. **Position offset ~5-15mm** on InnerDimple — different reference point

Plus on RP BottomPlate: missing `Chamfer @start`, missing `Web @<position>`
(anchor holes), wrong cap ops.

A targeted `src/simplify-rp.ts` (or RP path inside an existing simplifier)
that reads the source XML's plan_type → "RP" and applies these rewrites
should close most of the 47% → high-80s gap.

### Why I stopped here

Detailer license-blocked when the auto-cache pipeline tried to roll a new
job (VPN was on or licensing server briefly unreachable on home PC). On the
work PC this isn't an issue. License watcher will email when it's clear.

## What NOT to do at the work PC

- Don't restart from rule-engine first principles. The 13-session plateau is
  real. Use the truth corpus as ground truth and add targeted rules.
- Don't try to teach the codec everything from scratch. Cache covers
  historical, codec only needs to handle novel inputs.
- Don't email yourself for every small decision. The email channel is for
  genuine "I'm stuck" moments, not progress reports.

## End-state target (Day 7)

- Codec at 90%+ (RP/TIN/TB2B closed up; LBW/NLBW edges polished)
- Cache covers everything historical (DONE — 383 entries)
- Auto-cache pipeline runs whenever Detailer's reachable, capturing every new
  estimating-system XML
- Operator-review workflow flags any low-confidence stick before it goes to
  the rollformer
- Documentation + handover for post-Detailer life
