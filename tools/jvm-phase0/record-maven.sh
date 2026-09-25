#!/bin/sh
# Runs one Maven project's unit tests in the Maven image, bare or recorded.
# Usage: record-maven.sh <work dir> <repo dir> <mode: bare|agent|split> <exec out dir> [includes] [maven flags]
#   bare  — no agent, the baseline
#   agent — JaCoCo agent only, output=none: the cost of the probes alone
#   split — JaCoCo agent plus the per-class listener: one exec file per test class
# Maven flags pass through, e.g. '-DreuseForks=false' records every test class in its own JVM.
set -eu
WORK=$1 REPO=$2 MODE=$3 OUT=$4 INCLUDES=${5:-*} FLAGS=${6:-}
mkdir -p "$OUT"
AGENT=""
case "$MODE" in
  bare) ;;
  agent) AGENT="-javaagent:/va/lib/org.jacoco.agent-runtime.jar=output=none,includes=$INCLUDES" ;;
  split) AGENT="-javaagent:/va/lib/org.jacoco.agent-runtime.jar=output=none,includes=$INCLUDES -javaagent:/va/bin/va-listener.jar -Dva.out=/out" ;;
  *) echo "unknown mode $MODE" >&2; exit 64 ;;
esac
SKIPS="-Drat.skip -Dcheckstyle.skip -Dspotbugs.skip -Dpmd.skip -Djapicmp.skip -Danimal.sniffer.skip \
  -Djacoco.skip -Dmaven.javadoc.skip -Dcyclonedx.skip -Dspdx.skip -Denforcer.skip -Dmoditect.skip \
  -Dbnd.skip -Dmaven.source.skip -Dsurefire.printSummary=true"
docker run --rm -v "$WORK/m2:/root/.m2" -v "$WORK:/va:ro" -v "$REPO:/repo" -v "$OUT:/out" -w /repo \
  maven:3.9-eclipse-temurin-21 sh -euc "
    start=\$(date +%s)
    mvn -B -q -o test $SKIPS $FLAGS -DagentArgs='$AGENT' > /out/mvn.log 2>&1 || { echo FAILED; tail -40 /out/mvn.log; }
    echo seconds=\$(( \$(date +%s) - start ))
  "
