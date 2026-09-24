#!/bin/sh
# Times two analyzer jars on the same exec directory and class snapshot, and compares their output.
# Usage: bench-analyze.sh <scratch root> <old jar rel> <new jar rel> <exec dir rel> <classes rel>
set -eu
docker run --rm -v "$1:/s" maven:3.9-eclipse-temurin-21 sh -euc "
  run() {
    s=\$(date +%s%N)
    java -cp \"/s/\$2:/s/jvm/lib/*\" va.phase0.Analyze /s/$4 /s/$5 src/main/java /s/bench-\$1.jsonl
    echo \"\$1 \$(( (\$(date +%s%N) - s) / 1000000 ))ms\"
  }
  run old $2
  run new $3
  cmp /s/bench-old.jsonl /s/bench-new.jsonl && echo identical
  wc -l < /s/bench-new.jsonl
"
