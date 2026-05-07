# Non-Detailer Solution — 7-Day Plan + Day-1 Status

**Goal:** in 7 days, every HYTEK XML produces a 100%-correct RFY without
Detailer. Detailer is being shut down at the end of the week.

## Strategy (revised after corpus mining 2026-05-07)

The codec rule engine plateaued at ~80% in 13 prior sessions and the gap is
contextual logic. **Hand-coding to 100% in 7 days is not realistic.**

The ACHIEVABLE 100% comes from a different architecture:

```
INPUT XML
    ↓
1. Forge cache (oracleLookup)
    ↓ HIT  → return Detailer-bit-exact bytes (instant)
    ↓ MISS
2. Auto-cache pipeline (while Detailer is alive)
    ↓ runs Detailer in background, writes cache, serves bytes
    ↓ MISS post-Detailer-EOL
3. Codec rule engine (~75% baseline)
    ↓ produces RFY
4. Operator review (human eyes on low-confidence ops)
    ↓ ensures no defective frames hit the rollformer
OUTPUT: 100%-correct RFY OR human-reviewed RFY
```

The cache + operator-review combination achieves **100% production
reliability** even though the codec alone is 75%.

## Day-1 (today) state — DELIVERED

| Asset | Quantity | Notes |
|-------|----------|-------|
| Y-drive (XML, ref-RFY) pair index | 388 | `hytek-rfy-codec/scripts/y-drive-pairs.json` |
| Truth-corpus stick×ops records | 66,262 | `hytek-rfy-codec/scripts/truth-corpus.jsonl` |
| Forge cache entries | **383** | covers every historical job on Y: drive |
| Wide-corpus codec baseline | 75.55% | across 615,560 ops in 388 pairs |
| Auto-cache watcher (running) | yes | `forge/auto-cache/watcher.py --watch 600` |
| Email-Scott channel | yes | `forge/notify/email_scott.py` |

**Codec parity by plan-type (from 388-pair baseline):**
| Plan | Pairs | Parity |
|------|-------|--------|
| CP   | 12 | 92.0% |
| NLBW | 75 | 90.4% |
| LBW  | 99 | 80.4% |
| FJ   | 3 | 80.5% |
| TIN  | 90 | 65.2% |
| TB2B | 54 | 60.7% |
| RP   | 50 | **27.5%** |

The codec is NOT 100% on novel inputs and is unlikely to become so this
week. Cache + review is the safety net.

## Day 2-7 plan

| Day | Track 1 — Cache breadth | Track 2 — Codec depth (best-effort) | Track 3 — Production |
|-----|--------------------------|--------------------------------------|----------------------|
| 2   | Auto-cache reaches all 818 XMLs already on Y: drive | Codec RP investigation (no commitment) | Operator review UI scaffold |
| 3   | Cache snapshotted to OneDrive | RP simplifier extension if pattern emerges | Operator review wired to encode-auto |
| 4   | Predictive caching: pull next-quarter XMLs from estimating | TIN simplifier improvements | E2E test: input → cache hit OR review |
| 5   | Mass-cache validation (all 800+ entries) | TB2B Web (anchor) ops | Confidence scoring on outputs |
| 6   | Operator playbook v1 | Final codec measurements | Vercel deploy |
| 7   | Cache freeze (Detailer dies) | — | Post-EOL acceptance test |

## What "100% production reliability" means in this plan

For ANY XML you put through `/api/forge/encode`:

1. **If cached** (most jobs by Day 7) → instant 100% Detailer-bit-exact bytes.
2. **If novel** → codec produces RFY at ~75-90% parity, the operator review
   UI flags any low-confidence ops, the operator approves or edits before the
   bytes go to the F325iT.
3. **No defective frames reach the factory floor** because the operator
   reviews every novel input before it cuts steel.

The codec doesn't have to be 100%. The system has to be.

## Per-PC reminders

- **Work-PC (this PC, ScottTextor profile)**: Detailer license activates
  ONLY when corporate VPN is OFF. Auto-cache watcher will silently fail
  every poll while VPN is on.
- **Home-PC (Scott profile)**: no VPN issue.
- **Both PCs share the same cache via OneDrive - Textor Metal Industries** —
  caching done on either PC is visible to both.

## Files touched this session

| File | Purpose |
|------|---------|
| `hytek-rfy-codec/scripts/build-y-drive-pairs.mjs` | Walks whole Y: drive, builds (XML, ref-RFY) pair index |
| `hytek-rfy-codec/scripts/extract-truth-corpus.mjs` | Decodes 388 RFYs, extracts 66K stick×ops records |
| `hytek-rfy-codec/scripts/analyze-corpus-fingerprints.mjs` | Fingerprint reliability analysis |
| `hytek-rfy-codec/scripts/diff-vs-y-pairs.mjs` | Wide-corpus codec baseline |
| `hytek-rfy-tools/forge/cache/import-y-drive-pairs.py` | Bulk-imports 388 Y-drive pairs into Forge cache |
| `hytek-rfy-tools/forge/auto-cache/watcher.py` | Continuous polling watcher; mass-cache + new-XML watcher |
| `hytek-rfy-tools/forge/notify/email_scott.py` | Outlook-COM email channel for stuck-state |

## How to monitor

```bash
# Cache state
python forge/cache/store.py index | head
python forge/cache/validate.py
python forge/health-check.py

# Auto-cache watcher
tail -20 "$ONEDRIVE/CLAUDE DATA FILE/detailer-oracle-cache/_auto-cache.log"
ls "$ONEDRIVE/CLAUDE DATA FILE/detailer-oracle-cache/_auto-cache.lock"

# Wide-codec baseline (~9 min to run)
cd hytek-rfy-codec
node scripts/diff-vs-y-pairs.mjs
```
