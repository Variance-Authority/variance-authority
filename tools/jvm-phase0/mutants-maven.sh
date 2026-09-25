#!/bin/sh
# Seeds faults on each replayed commit's changed lines and runs the full suite per fault,
# with no agent: the failing test classes are a truth that owes nothing to the recorder.
# Also writes <replay>/<child>/members.json (method spans of the parent's changed files),
# which score.mjs reads for the shape grain.
# Usage: mutants-maven.sh <work dir> <repo dir> <replay dir> <out dir> <max per file> <parallel>
# Output: <out>/<child>/m<k>/{desc.txt,status.tsv,result.txt}; m0 is the unmutated control.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$1 REPO=$2 REPLAY=$3 OUT=$4 MAX=$5 PAR=$6
IMAGE=maven:3.9-eclipse-temurin-21
mkdir -p "$OUT"
: > "$OUT/tasks.txt"
parent=""
for child in $(cat "$REPLAY/order.txt"); do
  prev=$parent
  parent=$child
  [ -n "$prev" ] || continue
  changed=$(node "$HERE/changed.mjs" "$REPLAY/$child/diff.patch")
  [ -n "$changed" ] || continue
  dir="$OUT/$child"
  if [ ! -d "$dir/base" ]; then
    mkdir -p "$dir"
    git -C "$REPO" worktree add -q --force --detach "$dir/base" "$child"
  fi
  rm -rf "$REPLAY/$child/parent-src"
  echo "$changed" | while IFS="$(printf '\t')" read -r path old lines; do
    if [ -n "$old" ]; then
      mkdir -p "$REPLAY/$child/parent-src/$(dirname "$old")"
      git -C "$REPO" show "$prev:$old" > "$REPLAY/$child/parent-src/$old"
    fi
  done
  if [ -d "$REPLAY/$child/parent-src" ]; then
    docker run --rm -v "$WORK:/va:ro" -v "$REPLAY/$child:/c" $IMAGE \
      java -cp '/va/bin/va-mutate.jar:/va/lib/*' va.phase0.JavaTools members /c/parent-src /c/members.json
  fi
  if [ ! -d "$dir/m0" ]; then
    mkdir -p "$dir/m0" && echo "control: no fault" > "$dir/m0/desc.txt"
    k=1
    echo "$changed" | while IFS="$(printf '\t')" read -r path old lines; do
      [ -n "$lines" ] || continue
      docker run --rm -v "$WORK:/va:ro" -v "$dir:/d" $IMAGE \
        java -cp '/va/bin/va-mutate.jar:/va/lib/*' va.phase0.JavaTools mutate "/d/base/$path" "$path" "$lines" "$MAX" /d "$k" |
        tee "$dir/mutate-$(basename "$path").txt"
      k=$(( k + MAX ))
    done
  fi
  for m in "$dir"/m[0-9]*; do
    [ -f "$m/result.txt" ] || echo "$dir $m" >> "$OUT/tasks.txt"
  done
done
echo "tasks: $(wc -l < "$OUT/tasks.txt")"
xargs -P "$PAR" -L 1 sh "$HERE/run-mutant.sh" "$WORK" < "$OUT/tasks.txt"
