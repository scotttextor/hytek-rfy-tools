# Forge — Overnight Session Log (2026-05-06)

Scott left the work-PC running with "do not stop, work all night, complete
everything yourself, no input needed." This is what got built.

## Going-in state

Read from `HANDOVER-2026-05-06.md`:
- Phase 1.1 worker scaffolding existed but smoke-test was failing twice in a
  row (license-dialog false positive + no-main-window race).
- License watcher worked. `forge/cache/`, `forge/api/`, queue: empty.
- Memory landmark warned this should be a HOME-PC task because work-PC VPN
  blocks Detailer license activation.

## What changed

### Phase 1.1 — Detailer worker (smoke test passing)

The worker was failing at the Save dialog (silent "Information" popup loop).
Two diagnoses, one inserted at a time:

1. **`set_edit_text()` directly on the inner Edit child of ComboBoxEx32** —
   replaces the clipboard paste + Enter combo. Verified with readback. Without
   it, Enter triggered folder navigation in the Save dialog and Detailer fell
   back to its auto-suggested project filename in `Desktop/`. We were looking
   in the requested target dir and not finding the file, so the worker timed
   out.
2. **Click the explicit `&Save` Button** instead of pressing Enter — combined
   with (1) the file lands at the target every time.

Plus per-gate diagnostics (window snapshots, gate_passed/gate_failed lines,
popup_seen with title+lines, save dialog children enumeration) so the next
blocker is one log read away.

Reproducible: 75,536-byte RFY for HG260017 GF-LBW-70.075 in ~45 s, twice in a
row. Commit `608c420`.

### Phase 1.2 — Orchestrator (multi-job runner)

`forge/orchestrator/detailer-orchestrator.py`. Three input modes (manifest,
xml-glob, jobs CSV), retry/resume, structured per-job summary JSON.

Critical Windows fix: **`CREATE_NEW_CONSOLE` (0x10) creationflag** so the
worker subprocess owns its own console + foreground rights. Without that,
pyautogui's SetForegroundWindow calls failed with error 0 because the child
wasn't the foreground process. Stderr captured to a temp file — pipes break
the same foreground path even with a new console. Commit `9bb3a67`.

### Phase 2 — Cache writer (forge/cache/store.py)

Layout matches the existing `lib/oracle-cache.ts` reader:

```
<cache_root>/<jobnum>/<plan_name>.rfy
                       <plan_name>.meta.json
            /_index.json
```

CLI: `put`, `get`, `index`, `root`. Atomic writes via tempfile + os.replace.

Cache root resolves via `FORGE_CACHE_DIR` env > any
`%USERPROFILE%/OneDrive*/CLAUDE DATA FILE/detailer-oracle-cache` that exists
> prefer "OneDrive - <work suffix>" over plain "OneDrive". The OneDrive sync
keeps cache identical between Scott's home + work PCs. Commit `81ae564`.

Plus `validate.py` for integrity check, `test_store.py` (7 unit tests, all
passing), `oracle-cache-hit.test.ts` (vitest end-to-end). Commits `28c75bf`,
`fe22419`, `9be3dd0`.

### Phase 3 — encode-auto integration

`lib/oracle-cache.ts` had a hardcoded Scott-home-PC path for
DETAILER_PREROLLED_CACHE. Replaced with the same env-resolver as the Python
writer. Now the existing `app/api/encode-auto` route automatically benefits
from Forge cache entries. Commit (within `81ae564`).

### Phase 4 — sync + async API + UI

Three new pieces:

- **`POST /api/forge/encode`** (sync) — cache hit → instant bytes; cache miss
  → spawn worker, ~50 s blocking, return bytes. Commit `d0ee1e5`.
- **`POST /api/forge/encode/async`** + **`GET /api/forge/jobs/[id]`** —
  cache hit → 200 + bytes; miss → 202 + job id, runner.py runs detached, poll
  jobs/[id] for status, fetch with `?result=1` when done. Commit `7eacf43`.
- **Home-page card "Forge — Detailer-as-oracle (local only)"** that posts to
  /api/forge/encode. Commit `7926209`.

Per-job runner: `forge/queue/runner.py`. State + I/O under
`<cache_root>/_queue/<id>/`. Detached spawn with
`CREATE_NEW_CONSOLE | CREATE_NEW_PROCESS_GROUP`.

Shared TS path resolver: `lib/forge-paths.ts`.

### Hash canonicalization (bug fix)

End-to-end test caught a hash-mismatch bug:
- `cache_put` was hashing raw file bytes (`sha256_file`).
- `lib/oracle-cache.ts oracleLookup` hashes the .trim()ed UTF-8 string.
- Source XMLs end with two blank lines — so the two hashes differed by trim.
- Result: every prerolled cache entry silently missed; route fell through to
  the rule-engine codec.

Fix: `sha256_xml_canonical()` — read file, decode UTF-8, .strip(), encode,
sha256. Both `cache_put` and `cache_get` use it. Migrated existing entries
via `forge/cache/rehash-canonical.py`. Commit `26c8793`.

Bonus: mtime-based stale-index detection in `lib/oracle-cache.ts` so cache
writes by orchestrator / async runner / sync route get picked up by future
requests without restarting the Next.js server.

## Verified end-to-end (with running dev server)

| Endpoint | Input | Result |
|----------|-------|--------|
| `POST /api/forge/encode` | HG260017 LBW XML (cached) | `x-forge-cache-hit: true`, bit-exact 75,536 B |
| `POST /api/forge/encode/async` | HG260017 LBW XML (cached) | `x-forge-cache-hit: true`, instant bytes |
| `POST /api/forge/encode/async` | HG260017 NLBW XML (uncached) | 202 + job id, pending → running → done in ~50 s, fetched 150,144 B |
| `GET /api/forge/jobs/[id]` | running job | `{ status: "running", jobnum, plan_name, ... }` |
| `GET /api/forge/jobs/[id]?result=1` | done job | RFY bytes with `x-forge-cached: true` |

## Cache state at end of session

16 entries (15 from initial + 1 from async miss-path test). All validated.

```
HG250124 GF-LBW-70.075   43488 B   (XML jobnum collision in HG260014 dir)
HG260002 GF-LBW-89.075  659824 B
HG260005 GF-LBW-70.075  161792 B
HG260010 GF-LBW-70.075  133072 B
HG260016 GF-LBW-89.075  277376 B
HG260017 GF-LBW-70.075   75536 B
HG260017 GF-NLBW-70.075 150144 B   (added via async miss-path test)
HG260023 GF-LBW-70.075   76688 B
HG260024 GF-LBW-89.075  312576 B
HG260028 GF-LBW-89.075  557776 B
HG260032 GF-LBW-70.075  336544 B
HG260040 GF-LBW-70.075  323104 B
HG260043 GF-RP-89.115   103104 B
HG260044 GF-LBW-70.075  310464 B
HG260045 GF-LBW-70.075  632672 B
HG260052 GF-LBW-70.075  273120 B
```

A third batch (HG260060-HG260070) was kicked off in background just before
session end — those entries may have landed by morning.

## What I deliberately did NOT do

- **Phase 5 / learned engine** — too big for one session.
- **Auto-import HYTEK .sups files** — currently a manual one-time step on a
  fresh PC. Would need GUI-driving the File > Import > Setups dialog or
  registry edits. Not blocking — both Scott PCs already have it set up.
- **Vercel/cloud Forge integration** — Detailer can't run on Vercel. The cache
  is local-only for now. Eventually maybe move cache to S3 or Vercel Blob.

## Per-PC reminder

- **Work PC** has VPN that **blocks FrameCAD's licensing server**. Worker
  exits 1 with `LICENSE_BLOCKED:` when this happens. Disconnect VPN to
  unblock. THIS SESSION RAN ON WORK PC because Scott had VPN off.
- Cache writes to OneDrive - Textor Metal Industries; syncs to home PC.

## Resume entry point for next session

Read in this order:
1. `forge/docs/HANDOVER-PHASE-1-3-COMPLETE.md` (covers Phases 1-4 despite
   filename) — what works, file inventory, Phase 5 sketch.
2. This file — what got done overnight, decisions made, gotchas.
3. `forge/README.md` — quickstart commands.
4. Memory landmark `session_landmark_forge_2026_05_06.md` — TL;DR.

Branch `master` head: see `git log -8`. Last 8 commits all start with
`forge/` or `ui:` — that's this session's work.
