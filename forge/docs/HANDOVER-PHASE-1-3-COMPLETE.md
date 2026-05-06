# Forge Handover — Phases 1–3 COMPLETE

**Session:** 2026-05-06 (overnight, work-PC, Scott left it running autonomously)
**Predecessor doc:** `HANDOVER-2026-05-06.md` (Phase 1.1 was blocked there)
**Current head:** see `git log -5` — last commits start with `forge/`

## What's working

The full **XML → Detailer → cached RFY → Next.js route** loop is live.

```
input XML
  ↓
forge/orchestrator/detailer-orchestrator.py     (Phase 1.2)
  ↓ subprocess per job, retry, CREATE_NEW_CONSOLE for foreground rights
forge/worker/detailer-worker.py                 (Phase 1.1)
  ↓ ~45 s end-to-end Detailer GUI drive (import → export RFY)
forge/cache/store.py cache_put()                (Phase 2)
  ↓ writes  <cache_root>/<job>/<plan>.rfy + .meta.json + _index.json
lib/oracle-cache.ts oracleLookup()              (Phase 3)
  ↓ env-resolved cache_root, indexed at first lookup
app/api/encode-auto/route.ts
  ↓ already calls oracleLookup; bit-exact bytes when hit
client gets RFY
```

## How to use it (cookbook)

```bash
# 1. Run Detailer over a batch of jobs (writes cache entries):
python forge/orchestrator/detailer-orchestrator.py \
  --jobs HG260017,HG260023,HG260040 \
  --out-dir C:/tmp/forge-out --resume

# 2. Inspect the cache:
python forge/cache/store.py index

# 3. Verify the encode route would hit the cache:
npx vitest run forge/cache/oracle-cache-hit.test.ts
```

## Verified state (this session, work-PC, license OK)

| What | Where | Notes |
|------|-------|-------|
| Smoke test passes | HG260017 GF-LBW-70.075 | 75,536 B RFY in ~45 s, reproducible |
| Multi-job batch | HG260017 + HG260023 | both produce distinct RFYs (75 K + 76 K) in ~95 s |
| Resume mode | re-run with `--resume` | RESUME-SKIP for cached, RUN for new |
| Cross-PC cache root | OneDrive - Textor Metal Industries | env-resolved, syncs via OneDrive |
| Cache integration test | `forge/cache/oracle-cache-hit.test.ts` | passes in 22 s (Y: drive XML index dominates) |

## Why Phase 1.1 was blocked in the predecessor handover

Two compounding bugs in `worker/detailer-worker.py` Save-dialog handling:

1. **Filename via clipboard paste + Enter didn't stick.** The Save dialog's
   ComboBoxEx32 / inner Edit was pasted, but Enter triggered folder navigation
   instead of save. Detailer fell back to the auto-suggested project filename,
   saving a stray RFY in `Desktop/`. We never saw it because the worker only
   looked at the requested target path. Fix: `set_edit_text()` directly on the
   inner Edit + click `&Save` button explicitly.
2. **Default machine setup ≠ HYTEK.** First runs failed because the work-PC's
   Detailer install hadn't yet imported the HYTEK `.sups` files
   (`Y:\(08) DETAILING\(13) FRAMECAD\FrameCAD DETAILER\HYTEK MACHINE_FRAME TYPES\HYTEK MACHINE TYPES 20260402.sups`).
   With "Demo Machine Setup" selected, Rollformer-RFY export silently does
   nothing. Scott set the default to "70mm machine" manually mid-session and
   the export worked.

Once both fixed: 45 s/job, deterministic, no retries needed for the test fixture.

## Per-PC gotchas

- **Work PC** (`USERPROFILE=C:\Users\ScottTextor`): corporate VPN typically blocks
  FrameCAD's licensing server → `LICENSE_BLOCKED` exit. Disconnect VPN, then
  the worker activates fine. `forge/worker/license_watcher.py` emails + ntfy's
  when activation comes back.
- **Home PC** (`USERPROFILE=C:\Users\Scott`): no VPN issue; this is the path
  the predecessor handover assumed. Same code paths work without env tweaks.
- **Cache location**: resolves automatically to `OneDrive - Textor Metal Industries`
  on either PC. Override with `FORGE_CACHE_DIR=...` if needed.

## What's next (Phase 4+)

### Phase 4: Worker queue / serve-on-miss

Right now the Next.js route falls back to the rule-engine codec on cache miss
(82 % parity). Phase 4 would:
1. On miss, enqueue a Detailer run via the orchestrator.
2. Either:
   - **Sync mode**: block ~50 s and return Detailer's bytes (good UX for
     interactive single jobs).
   - **Async mode**: 202 Accepted + job ID; client polls for completion.
3. Subsequent identical XML hits the freshly-written cache entry.

Implementation sketch:
- `app/api/forge/enqueue/route.ts` — accepts XML, returns job ID, spawns worker
- `app/api/forge/status/[id]/route.ts` — returns pending/done/failed + RFY bytes
- File-based job queue under `<cache_root>/_queue/` (jobid.{json,rfy})

### Phase 5: Geometric engine (long-term)

Once the cache has thousands of entries, train an engine that maps XML → ops
without invoking Detailer. The cache IS the training set — every entry is a
ground-truth XML/RFY pair from Detailer. This is the "replace Detailer
dependency" endgame; Detailer's May 2026 EOL gives us the deadline.

## Backups / rollback

- `reference-2026-05-06-detailer-export-state` tags exist on both repos
  (`hytek-rfy-tools` + `hytek-rfy-codec`) — pre-Forge state.
- `master` head this session contains the full Phase 1–3 work, all pushed to
  GitHub `scotttextor/hytek-rfy-tools`.

## Files to know

| File | Purpose |
|------|---------|
| `forge/worker/detailer-worker.py` | Single XML → RFY via Detailer subprocess. The hard part. |
| `forge/worker/license_watcher.py` | Polls + emails Scott when Detailer activation comes back. |
| `forge/orchestrator/detailer-orchestrator.py` | Multi-job runner, retry, resume, summary JSON. |
| `forge/cache/store.py` | Cache writer + CLI (put/get/index/root). |
| `forge/cache/oracle-cache-hit.test.ts` | End-to-end cache hit test. |
| `lib/oracle-cache.ts` | TS reader. Now env-resolves cache root. |
| `app/api/encode-auto/route.ts` | Already calls oracleLookup; gets cache hits free. |
