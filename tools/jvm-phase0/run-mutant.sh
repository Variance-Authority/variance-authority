#!/bin/sh
# Runs the full suite, bare, on one seeded fault (or the control) and records per-class status.
# Usage: run-mutant.sh <work dir> <commit dir holding base/> <mutant dir>
set -eu
WORK=$1 DIR=$2 M=$3
TREE="$M/tree"
rm -rf "$TREE"
cp -R "$DIR/base" "$TREE"
if [ -f "$M/src.java" ]; then cp "$M/src.java" "$TREE/$(cat "$M/file.txt")"; fi
SKIPS="-Drat.skip -Dcheckstyle.skip -Dspotbugs.skip -Dpmd.skip -Djapicmp.skip -Danimal.sniffer.skip \
  -Djacoco.skip -Dmaven.javadoc.skip -Dcyclonedx.skip -Dspdx.skip -Denforcer.skip -Dmoditect.skip \
  -Dbnd.skip -Dmaven.source.skip -Dmaven.test.failure.ignore=true"
# A fault that loops forever must fail its test, not stall the suite: a preemptive per-test
# timeout turns the hang into a failure the class report carries.
TIMEOUT="-Djunit.jupiter.execution.timeout.default=120s -Djunit.jupiter.execution.timeout.thread.mode.default=SEPARATE_THREAD"
start=$(date +%s)
docker run --rm -v "$WORK/m2:/root/.m2" -v "$TREE:/repo" -w /repo maven:3.9-eclipse-temurin-21 \
  mvn -B -q -o test $SKIPS $TIMEOUT > "$M/run.log" 2>&1 || true
for f in "$TREE"/target/surefire-reports/TEST-*.xml; do
  [ -f "$f" ] || continue
  sed -n 's/.*<testsuite [^>]*name="\([^"]*\)"[^>]*tests="\([0-9]*\)"[^>]*errors="\([0-9]*\)"[^>]*failures="\([0-9]*\)".*/\1\t\2\t\3\t\4/p' "$f" | head -1
done > "$M/status.tsv"
if [ -s "$M/status.tsv" ]; then result=ran; else result=uncompilable; fi
echo "$result $(( $(date +%s) - start ))s" > "$M/result.txt"
rm -rf "$TREE"
echo "$M $(cat "$M/result.txt") $(cat "$M/desc.txt")"
