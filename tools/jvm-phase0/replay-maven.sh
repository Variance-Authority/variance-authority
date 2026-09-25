#!/bin/sh
# Records a per-class run and its method map at each of the last N first-parent commits.
# Usage: replay-maven.sh <work dir> <repo dir> <name> <N> <includes> <source root> <classes dir> [split|pressplit]
#   split (default) records under JaCoCo and analyzes the exec files; pressplit records under
#   the presence agent, which writes record.jsonl itself.
# Output: <work dir>/replay/<name>/<sha>/{events.tsv,record.jsonl,status.tsv,diff.patch} and order.txt (oldest first).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$1 REPO=$2 NAME=$3 N=$4 INCLUDES=$5 SRC=$6 CLASSES=$7 RECORDER=${8:-split}
BASE="$WORK/replay/$NAME"
mkdir -p "$BASE"
# The order is fixed on the first run: a resumed replay starts from a detached
# checkout, where `git log` would pick a different window.
[ -f "$BASE/order.txt" ] || git -C "$REPO" log --first-parent --format=%H -n "$N" | tail -r > "$BASE/order.txt"
for sha in $(cat "$BASE/order.txt"); do
  dir="$BASE/$sha"
  if [ -f "$dir/record.jsonl" ]; then continue; fi
  rm -rf "$dir" && mkdir -p "$dir/exec"
  git -C "$REPO" checkout -q --detach "$sha"
  git -C "$REPO" diff "$sha^1" "$sha" > "$dir/diff.patch" || true
  rm -rf "$REPO/target/classes" "$REPO/target/test-classes" "$REPO/target/surefire-reports"
  sh "$HERE/record-maven.sh" "$WORK" "$REPO" "$RECORDER" "$dir/exec" "$INCLUDES" > "$dir/run.txt" 2>&1
  for f in "$REPO"/target/surefire-reports/TEST-*.xml; do
    [ -f "$f" ] || continue
    sed -n 's/.*<testsuite [^>]*name="\([^"]*\)"[^>]*tests="\([0-9]*\)"[^>]*errors="\([0-9]*\)"[^>]*failures="\([0-9]*\)".*/\1\t\2\t\3\t\4/p' "$f" | head -1
  done > "$dir/status.tsv"
  if [ "$RECORDER" = pressplit ]; then
    mv "$dir/exec/record.jsonl" "$dir/record.jsonl" || echo "no record" >> "$dir/run.txt"
    echo "$sha $(cat "$dir/run.txt" | tr '\n' ' ')"
    continue
  fi
  docker run --rm -v "$WORK:/va:ro" -v "$REPO:/repo:ro" -v "$dir:/d" maven:3.9-eclipse-temurin-21 \
    java -cp '/va/bin/va-analyze.jar:/va/lib/*' va.phase0.Analyze /d/exec "/repo/$CLASSES" "$SRC" /d/record.jsonl > "$dir/analyze.txt" 2>&1 || echo "analyze failed" >> "$dir/run.txt"
  rm -rf "$dir/exec"/*.exec
  echo "$sha $(cat "$dir/run.txt" | tr '\n' ' ')"
done
