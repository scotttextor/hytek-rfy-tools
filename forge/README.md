# Forge — HYTEK RFY 100% Solution

**Architecture:** Detailer is the oracle. We use it (programmatically) to produce
authentic RFY bytes. Cache them. Serve cache hits instantly. Run Detailer in
background for cache misses. Eventually replace Detailer with a learned
geometric engine derived from the cache itself.

**Why this works:** We stop trying to mimic Detailer. We USE Detailer. The
cache grows to cover everything HYTEK ever runs.

## Directory layout

```
forge/
  worker/         Detailer subprocess driver (Python). Reliable single-shot.
  orchestrator/   Multi-job runner with retry, resume, structured logging.
  cache/          Content-hashed cache writer + cache-hit integration test.
  api/            HTTP API + worker queue (Next.js routes, eventual).
  docs/           Architecture notes + handoff docs.
```

## Phase status

- [x] **Phase 1.1: Reliable Detailer worker** — single-shot subprocess driver, structured exit codes + per-gate diagnostics. ~45s/job, 75K-byte RFYs.
- [x] **Phase 1.2: Orchestrator** — multi-job runner with bounded retry, resume support, JSON summary. CREATE_NEW_CONSOLE for foreground rights. ~50s/job end-to-end.
- [x] **Phase 2: Cache writer** — `forge/cache/store.py`. Layout matches existing `lib/oracle-cache.ts` reader. Cross-PC path resolution via FORGE_CACHE_DIR env var or OneDrive autodetection.
- [x] **Phase 3: API integration** — `app/api/encode-auto/route.ts` was already calling `oracleLookup()`; updating `lib/oracle-cache.ts` to env-resolve the cache root closed the loop. Verified by `forge/cache/oracle-cache-hit.test.ts`.
- [ ] Phase 4: Worker queue / orchestrator-as-service — call worker on cache miss from the Next.js route, return RFY when ready (or 202 + poll). Currently the rule-engine codec is the cache-miss fallback.
- [ ] Phase 5: Geometric engine — learned from the cache, replaces Detailer dependency.

## Quickstart

### Convert one XML through Detailer (Phase 1.1)

```bash
python forge/worker/detailer-worker.py \
  "Y:/(17) 2026 HYTEK PROJECTS/.../HG260017-GF-LBW-70.075.xml" \
  C:/tmp/test.rfy
# stderr: structured JSON status lines.
# success → exit 0, stdout = output path, file lands at C:/tmp/test.rfy
```

### Convert a batch with retry + cache write (Phase 1.2 + 2)

```bash
python forge/orchestrator/detailer-orchestrator.py \
  --jobs HG260017,HG260023,HG260040 \
  --out-dir C:/tmp/forge-out \
  --resume
# Each job: retries up to 2x on transient failure, writes cache entry on
# success, skips if rfy_out already exists. Summary at <out-dir>/_orchestrator-summary.json
```

Source modes:
- `--manifest <file.json>` — explicit list of `{xml_path, rfy_out, id}`
- `--xml-glob "<pattern>"` — glob; output paths = `<out-dir>/<stem>.rfy`
- `--jobs HG260001,HG260023,...` — auto-pick best XML per job (LBW > NLBW > RP > TIN)

### Inspect / test the cache (Phase 2 + 3)

```bash
python forge/cache/store.py root            # show resolved cache dir
python forge/cache/store.py index           # list every cached entry
python forge/cache/store.py get --xml <x>   # cache lookup, prints meta or MISS
python forge/cache/store.py put --xml <x> --rfy <r>   # manual seed

npx vitest run forge/cache/oracle-cache-hit.test.ts   # end-to-end cache hit
```

## Phase 1.1 worker contract

```bash
python worker/detailer-worker.py <xml_path> <rfy_out_path>
```

**Exit codes:**
- `0` — success, RFY written
- `1` — license invalid / Detailer won't activate (typically work-PC VPN)
- `2` — input XML not found
- `3` — Detailer UI not detected
- `4` — Import phase failed
- `5` — Export phase failed
- `6` — Timeout (>180s)
- `7` — Unexpected exception

**Stderr:** structured JSON per step. `{"step": "done", "rfy_bytes": 75552}` on success.

**No retry inside the worker.** It's one-shot, deterministic, killable. Retries live in the orchestrator.

## Cross-PC notes

- Detailer activation requires reaching FrameCAD's licensing server. **Work-PC corporate VPN typically blocks it** — disconnect VPN before running. Worker exits 1 with `LICENSE_BLOCKED:` when this happens; `forge/worker/license_watcher.py` polls + emails Scott when activation comes back.
- The cache root resolves to `<USERPROFILE>/OneDrive - <suffix>/CLAUDE DATA FILE/detailer-oracle-cache` so the Forge cache syncs between Scott's home + work PCs via OneDrive.

## Reference docs

- `docs/HANDOVER-2026-05-06.md` — original kickoff handover (Phase 1.1 was blocked there)
- `docs/HANDOVER-PHASE-1-3-COMPLETE.md` — what's working now, what's next
- `../docs/detailer-as-oracle.md` — original architecture rationale
