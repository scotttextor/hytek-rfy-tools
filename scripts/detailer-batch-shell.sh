#!/bin/bash
# Shell-driven batch: invokes the proven single-shot detailer-batch.py mode
# once per XML, in a fresh Python+Detailer process each time. Slower than
# the in-Python batch loop (~30s of Detailer launch overhead per call) but
# isolates state issues — every iteration starts clean.
#
# Usage:
#   bash scripts/detailer-batch-shell.sh HG260017
#   bash scripts/detailer-batch-shell.sh HG260017 HG260023 HG260044
#   bash scripts/detailer-batch-shell.sh ALL    # walks Y: drive
#
# Output: $CACHE_DIR/<jobnum>/<plan>.rfy + .meta.json

set -u  # unset vars are errors

PROJECTS_ROOT="Y:/(17) 2026 HYTEK PROJECTS"
CACHE_DIR="C:/Users/Scott/OneDrive - Textor Metal Industries/CLAUDE DATA FILE/detailer-oracle-cache"
TMP_DIR="C:/tmp/detailer-batch"
SCRIPT="$(dirname "$0")/detailer-batch.py"

# Plan types that don't have rollformer output (skip these)
SKIP_PATTERNS="GF-CP- GF-MH- GF-FJ- GF-Pan GF-Roo"

mkdir -p "$TMP_DIR"
mkdir -p "$CACHE_DIR"

# Resolve jobs
if [ "${1:-}" = "ALL" ]; then
    JOBS=$(find "$PROJECTS_ROOT" -maxdepth 2 -type d -name 'HG*' 2>/dev/null | xargs -I {} basename {} | grep -oE '^HG[0-9]+' | sort -u)
elif [ "$#" -ge 1 ]; then
    JOBS="$@"
else
    echo "Usage: bash $0 <jobnum>... | ALL"
    exit 1
fi

TOTAL=0
DONE=0
FAILED=0
SKIPPED=0

for JOB in $JOBS; do
    # Find XMLs for this job
    JOB_DIR=$(find "$PROJECTS_ROOT" -maxdepth 2 -type d -iname "${JOB}*" 2>/dev/null | head -1)
    if [ -z "$JOB_DIR" ]; then
        echo "[skip] $JOB: directory not found"
        continue
    fi
    XML_DIR="$JOB_DIR/03 DETAILING/03 FRAMECAD DETAILER/01 XML OUTPUT"
    if [ ! -d "$XML_DIR" ]; then
        echo "[skip] $JOB: no XML output dir"
        continue
    fi

    JOB_CACHE="$CACHE_DIR/$JOB"
    mkdir -p "$JOB_CACHE"

    # For each XML
    for XML in "$XML_DIR"/*.xml; do
        [ -f "$XML" ] || continue
        XML_BASE=$(basename "$XML" .xml)
        # Extract plan from name: ...-<floor>-<plan>
        PLAN=$(echo "$XML_BASE" | grep -oE '\-(GF|FF|RF)\-.+$' | sed 's/^-//')
        if [ -z "$PLAN" ]; then
            continue
        fi

        TOTAL=$((TOTAL+1))

        # Skip non-rollformed plan types
        SKIP=0
        for PFX in $SKIP_PATTERNS; do
            case "$PLAN" in
                $PFX*) SKIP=1; break ;;
            esac
        done
        if [ "$SKIP" -eq 1 ]; then
            echo "[$TOTAL] $JOB $PLAN [skip: not roll-formed]"
            SKIPPED=$((SKIPPED+1))
            continue
        fi

        OUTPUT_FILE="$JOB_CACHE/$PLAN.rfy"
        # Skip if already cached and source XML hash matches
        if [ -f "$OUTPUT_FILE" ] && [ -f "$JOB_CACHE/$PLAN.meta.json" ]; then
            CURRENT_SHA=$(sha256sum "$XML" | awk '{print $1}')
            CACHED_SHA=$(grep -oE '"xml_sha256": "[a-f0-9]+"' "$JOB_CACHE/$PLAN.meta.json" 2>/dev/null | head -1 | grep -oE '[a-f0-9]{64}')
            if [ "$CURRENT_SHA" = "$CACHED_SHA" ]; then
                echo "[$TOTAL] $JOB $PLAN [cached, skip]"
                SKIPPED=$((SKIPPED+1))
                continue
            fi
        fi

        echo -n "[$TOTAL] $JOB $PLAN ... "
        # Run the single-shot driver. Output goes to TMP_DIR with the XML stem.
        TMP_OUT="$TMP_DIR/$XML_BASE.rfy"
        rm -f "$TMP_OUT" 2>/dev/null

        # Kill any zombie Detailer (defensive)
        taskkill //IM 'FRAMECAD Detailer.exe' //F > /dev/null 2>&1
        sleep 2

        # Run the Python driver in single-shot mode
        if python -u "$SCRIPT" "$XML" "$TMP_OUT" > "$TMP_DIR/run.log" 2>&1; then
            if [ -f "$TMP_OUT" ] && [ -s "$TMP_OUT" ]; then
                # Move to cache + write metadata
                mv "$TMP_OUT" "$OUTPUT_FILE"
                XML_SHA=$(sha256sum "$XML" | awk '{print $1}')
                XML_SIZE=$(stat -c '%s' "$XML")
                RFY_SIZE=$(stat -c '%s' "$OUTPUT_FILE")
                cat > "$JOB_CACHE/$PLAN.meta.json" <<EOF
{
  "jobnum": "$JOB",
  "plan": "$PLAN",
  "xml_path": "$XML",
  "xml_size": $XML_SIZE,
  "xml_sha256": "$XML_SHA",
  "rfy_size": $RFY_SIZE,
  "generated_at": "$(date -u +%FT%TZ)",
  "detailer_version": "5.x"
}
EOF
                echo "OK ($RFY_SIZE bytes)"
                DONE=$((DONE+1))
            else
                echo "FAIL (no output file)"
                FAILED=$((FAILED+1))
            fi
        else
            echo "FAIL (driver exit $?)"
            tail -5 "$TMP_DIR/run.log" | sed 's/^/    /'
            FAILED=$((FAILED+1))
        fi
    done
done

echo
echo "============================================================"
echo "TOTAL=$TOTAL  DONE=$DONE  FAILED=$FAILED  SKIPPED=$SKIPPED"
echo "Cache: $CACHE_DIR"
echo "============================================================"
