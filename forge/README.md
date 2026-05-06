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
  worker/        Detailer subprocess driver (Python). Reliable single-shot.
  cache/         Content-hashed cache with persistent storage.
  api/           HTTP API + worker queue (Next.js routes, eventual).
  docs/          Architecture notes + handoff docs.
```

## Phase status

- [x] **Phase 1: Reliable Detailer worker** — subprocess pattern with structured exit codes. See `worker/`.
- [ ] Phase 2: Cache layer — content-hash keyed, persistent storage. See `cache/`.
- [ ] Phase 3: API + queue — Vercel routes that serve cache or queue Detailer runs.
- [ ] Phase 4: Geometric engine — learned from the cache, replaces Detailer dependency.

## Phase 1 contract

The worker is a CLI:

```bash
python worker/detailer-worker.py <xml_path> <rfy_out_path>
```

**Exit codes:**
- `0` — success, RFY written to `rfy_out_path`
- `1` — license invalid / Detailer won't run
- `2` — input XML not found / unreadable
- `3` — Detailer launched but window not detectable (UI broken)
- `4` — Import failed (TdlgImport rejected the XML)
- `5` — Export failed (Detailer wrote nothing)
- `6` — Timeout (worker took >180s)
- `7` — Unknown / unexpected exception

**Stderr:** Structured JSON status line per major step (for orchestrator logging).

**No retry logic in the worker.** Retries are the orchestrator's job. The worker is one-shot, deterministic, killable.
