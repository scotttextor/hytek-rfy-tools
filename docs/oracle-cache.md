# Oracle Cache

Bit-exact passthrough for known reference jobs. Sits in front of the codec
rule engine: when an input XML matches a captured Detailer reference, return
Detailer's exact bytes. Anything else falls through to the rule engine
unchanged.

## Why

Scott's standing requirement: *"I just want the output to be like original
detailer output."* The codec rule engine currently produces ~83% op-level
parity against Detailer (see RFY codec parity reports). For the three jobs
HYTEK has captured Detailer reference output for — HG260001, HG260023,
HG260044 — we have the actual `.rfy` bytes on disk. Returning them verbatim
on a match is, by definition, 100% Detailer-equivalent output for those
inputs.

The cache does **not** replace the codec. It only short-circuits the inputs
where a perfect answer is already available. Novel inputs still flow through
`framecadImportToRfy`.

## Architecture

```
              ┌────────────────────────────┐
input XML ──▶ │  oracleLookup(xmlText)     │
              │  - parse jobnum + plans    │
              │  - check single-plan only  │
              │  - validate frame count    │
              └─────┬───────────────┬──────┘
                    │ hit           │ miss
                    ▼               ▼
              read reference     framecadImportToRfy
              .rfy bytes         (rule engine)
                    │               │
                    └──────┬────────┘
                           ▼
                       response
```

### Index build (one-shot, lazy)

`buildIndex()` runs on first lookup. It walks each
`{jobRoot}/06 MANUFACTURING/04 ROLLFORMER FILES/...` directory, parses
`{jobnum}_{planName}.rfy` filenames, and indexes them. It also walks the
parallel `{jobRoot}/03 DETAILING/03 FRAMECAD DETAILER/01 XML OUTPUT/`
directories (and the `Packed/` subdirectory) and records the frame count
per `{jobnum, planName}` from the source XML. The frame count is used as a
sanity check at lookup time.

The index stores **paths**, not bytes. Bytes are read on lookup hit. Memory
footprint stays at ~hundreds of bytes per entry regardless of corpus size.

### Lookup contract

`oracleLookup(xmlText): OracleResult`

A hit requires **all** of:

1. `DISABLE_ORACLE_CACHE` env var is unset (or != "1")
2. XML has exactly one `<plan>` element
3. `<jobnum>` and `<plan name>` match an indexed reference
4. Frame count in input == frame count of source XML for that reference
   (skipped when the source XML couldn't be located at index time)
5. Reference RFY file is readable

Any failure → miss with a string `reason`. Caller falls through to the
codec.

The "single-plan" rule is conservative on purpose. The corpus contains
single-plan reference RFYs only. A multi-plan input would need merged or
per-plan output and the current encode routes don't split that way, so
falling through to the codec is the right behaviour.

## Wiring

The cache is consulted in two endpoints:

- `app/api/encode-auto/route.ts` — when input is `<framecad_import>` XML,
  oracle is checked first. On hit, return the reference bytes directly with
  `X-Oracle-Hit: true`. On miss, run `framecadImportToRfy` as before.
- `app/api/encode-bundle/route.ts` — same lookup, but the codec is still
  run because the bundle ZIP also contains per-plan CSVs (which the oracle
  doesn't carry). On hit, the `.rfy` file inside the ZIP is replaced with
  oracle bytes; CSVs come from the codec.

The simple `app/api/encode/route.ts` (which is just `encryptRfy(xml)` —
direct compress+XOR with no rule-engine logic) is **not** wired. The user
already has a Detailer-format inner XML at that point; the cache adds
nothing.

## Response headers

Every encode-auto / encode-bundle response gets:

- `X-Oracle-Hit: true | false` — whether the cache served this response
- `X-Oracle-Source: <abs path>` — only when hit, points at the .rfy used
- `X-Oracle-Miss-Reason: <text>` — only when miss, explains the fall-through

Useful for verifying behaviour from the client / browser devtools / logs.

## Disabling

```
DISABLE_ORACLE_CACHE=1 npm run dev    # local
```

Set the env var on Vercel's project settings to disable in production.
The codec rule engine then handles every request, identical to pre-cache
behaviour. Use this for regression-testing the codec.

## Adding new captured jobs

Edit `JOB_LOCATIONS` at the top of `lib/oracle-cache.ts`:

```typescript
{
  jobnum: "HG260099",
  rfyDir: "Y:\\(17) ...\\HG260099 ...\\06 MANUFACTURING\\04 ROLLFORMER FILES\\Split_HG260099",
  xmlDirs: [
    "Y:\\(17) ...\\HG260099 ...\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT",
    "Y:\\(17) ...\\HG260099 ...\\03 DETAILING\\03 FRAMECAD DETAILER\\01 XML OUTPUT\\Packed",
  ],
},
```

Filenames must follow `{jobnum}[#N-N]_{planName}.rfy` for the index to
parse them. The `#N-N` suffix is Detailer's "phase" stamp and is stripped
during indexing — the lookup key is the canonical jobnum.

## Limitations

- **Static reference set.** The cache cannot help with novel inputs.
  Any new house plan that wasn't run through Detailer is rule-engine
  territory.
- **Corpus location is fixed.** Y: drive paths are hardcoded. A workstation
  off the HYTEK network with no Y: drive will see "no reference RFYs found"
  warnings and lookups will all miss — the codec path remains live, so the
  app keeps working, but no oracle hits.
- **Single-plan only.** Multi-plan inputs always miss. To extend coverage
  we'd need a merger that combines reference RFY bytes — non-trivial because
  Detailer's pack splitting drops elements the codec re-emits differently.
- **Frame-count sanity check is soft.** It catches gross structural changes
  (frames added or removed) but not edits within frames (a single hole moved
  by 5mm won't trip it). Acceptable trade-off — false positives here would
  mean serving stale Detailer bytes for an edited variant. Mitigation: when
  in doubt, set `DISABLE_ORACLE_CACHE=1`.
