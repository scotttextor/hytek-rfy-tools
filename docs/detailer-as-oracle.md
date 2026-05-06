# Detailer-as-Oracle: 100% Bit-Exact RFY Output

## TL;DR

For any HYTEK job that's been pre-rolled through Detailer once, the codec
returns Detailer's **exact bytes** to the rollformer. 100% match by definition,
because they ARE Detailer's bytes.

For any job that hasn't been pre-rolled, the codec rule engine runs as a
fallback (currently ~80%+ ops parity, 0% bit-exact byte match — see
`scripts/verify-y-drive.test.ts`).

This is the strategic answer to "100% bit-exact match" — instead of reverse-
engineering Detailer's compiled tooling algorithms, use Detailer itself as the
oracle, run it once per (jobnum, plan), and serve the cached bytes forever.

## How it works

### 1. Build the cache (one-time setup, ~hours)

On a machine with a working Detailer 5.x license:

```powershell
cd "C:\Users\Scott\CLAUDE CODE\hytek-rfy-tools"
pip install psutil pyautogui pywinauto pillow

# Test single conversion:
python scripts\detailer-batch.py "Y:\(17) 2026 HYTEK PROJECTS\CORAL HOMES\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA\03 DETAILING\03 FRAMECAD DETAILER\01 XML OUTPUT\HG260017 LOT 925 (42) STUNNING CRESCENT NARANGBA-GF-LBW-70.075.xml" "C:\tmp\test.rfy"

# Run full batch — walks Y: drive, processes every job's XMLs:
python scripts\detailer-batch.py --batch
```

The batch:

1. Launches Detailer once
2. For each `HG*` job under `Y:\(17) 2026 HYTEK PROJECTS\<builder>\`:
   - Finds all `.xml` files under `03 DETAILING\03 FRAMECAD DETAILER\01 XML OUTPUT\`
   - For each XML: import → export RFY → save to cache
3. Writes results to `C:\Users\Scott\OneDrive...\detailer-oracle-cache\<jobnum>\<plan>.rfy`
4. Saves metadata (`<plan>.meta.json`) including `xml_sha256` for invalidation

If the source XML is later edited, the cache entry's `xml_sha256` no longer
matches the input hash and the cache misses (forcing re-roll). This is the
safety against stale cached output.

### 2. Production use (automatic)

The Vercel app's `oracle-cache.ts` walks the cache dir at startup. When a user
uploads an XML through `/api/encode-bundle`:

1. Compute SHA-256 of the input XML
2. Look up in the index by `(jobnum, plan)`
3. If found AND `xml_sha256` matches: return cached RFY bytes (bit-exact)
4. If hash mismatches: log "stale, re-run detailer-batch.py" and fall through
   to codec rule engine
5. If no entry: fall through to codec rule engine

Response headers:
- `X-Oracle-Hit: true` when cached bytes are served
- `X-Oracle-Source: <rfyPath>` for debugging
- `X-Oracle-Per-Plan-Hits: N/M` for multi-plan packed XMLs

## Cache directory layout

```
C:\Users\Scott\OneDrive...\detailer-oracle-cache\
  HG260001\
    GF-RP-70.075.rfy
    GF-RP-70.075.meta.json
    GF-LBW-70.075.rfy
    GF-LBW-70.075.meta.json
    PK4-GF-LBW-70.075.rfy        ← pack-split RFYs also indexed
    ...
  HG260017\
    GF-LBW-70.075.rfy
    GF-LBW-70.075.meta.json
    ...
  _index.json                    ← summary of all entries
  _tmp\                          ← scratch, can be deleted any time
```

## Maintenance

### Adding a new job to the cache

```powershell
# After HYTEK estimates a new job and Detailer-detailing has happened:
python scripts\detailer-batch.py --batch --filter HG260100
```

The `--filter` arg limits the batch to specified job numbers.

### Invalidating after XML edits

When a job's XML is modified (e.g. design changes), the stored
`xml_sha256` won't match. The cache automatically falls through to the rule
engine for the affected plan. To refresh:

```powershell
python scripts\detailer-batch.py --batch --filter HG260100 --no-skip
```

`--no-skip` re-processes even cached entries.

### Re-building from scratch

Delete the cache dir and re-run:

```powershell
Remove-Item "C:\Users\Scott\OneDrive...\detailer-oracle-cache\*" -Recurse
python scripts\detailer-batch.py --batch
```

## License requirements

Detailer 5.x must have a valid license on the runner machine. The script
aborts at startup if the license dialog can't be dismissed:

```
ERROR: Detailer license dialog is up — license is not valid. Activate the
license (Sign In with online account, or attach HASP dongle) manually first,
then re-run this script.
```

If license issues persist:
1. Check `C:\Users\Scott\AppData\Local\Temp\Settings_00.info` for license state
2. Try Detailer manually (start menu → File → New Project) to confirm it works
3. The Activate Online button may need a one-time manual click before headless
   batch processing works

## Troubleshooting

### "Detailer launched but PID not found"

Detailer's exe is usually slow to register on cold-launch (~5-10 seconds).
The script waits up to 15s. If it consistently times out, increase the
deadline in `launch_detailer()`.

### UI automation hotkeys don't work

The script uses `pyautogui.hotkey("alt", "f")` then keystrokes for menu walks.
This depends on Detailer's menu accelerators. If the UI changes between
versions, the keystrokes may need updating. The mapping for 5.3.x:

- `Alt+F` → File menu
- `i` → Import
- `x` → XML
- (after import) `Alt+F` → `e` → `r` → Export RFY

### Detailer crashes mid-batch

The script catches exceptions, logs the failure, and tries to re-acquire the
Detailer handle for the next item. If Detailer fully crashes:

```
[detailer-batch] cannot re-acquire Detailer; aborting
```

Re-run the batch — `skip_existing=True` (the default) will skip cached items
and resume from where it left off.

## Why this is the right architecture

The .sups files (machine setups, frame types) and FC_Textor_Qld.dat (Structure
configuration) define **constants and configurations**, not the algorithms
that use them. Detailer's executable code is what turns "EndClearance=2.0" into
"place a Swage at position X on this stud". That code lives in the compiled
binary, not in any text file.

Reverse-engineering the algorithm from observation (diff harness against ref
RFYs) is asymptotically slow — see this session's history for the path.

Using Detailer directly as the oracle is **the only realistic path to 100%
bit-exact match for any HYTEK input**:

| Path | Bit-exact? | Effort | Generalizes to new jobs? |
|---|---|---|---|
| Reverse-engineer rule engine | Probably never | Indefinite | Yes |
| Headless Detailer-as-oracle | **Yes, always** | One-time batch run + maintenance | **Yes (with one Detailer pass)** |
| Manual pre-rolling per job | Yes | Per-job manual labor | Yes |

The batch script automates path 2. After running it once, every job HYTEK
estimates can be added with a single `--filter HG260XXX` command.

## Verification

After running the batch, verify with:

```bash
cd "C:\Users\Scott\CLAUDE CODE\hytek-rfy-tools"
VERIFY_Y_DRIVE=1 npx vitest run scripts/verify-y-drive.test.ts
```

If the batch is complete, the verifier should report ~100% bit-exact across
all jobs that have both XML inputs and reference RFYs on Y: drive.
