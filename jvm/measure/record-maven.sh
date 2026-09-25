#!/bin/sh
# Runs one Maven project's unit tests in the Maven image, bare or recorded.
# Usage: record-maven.sh <work dir> <repo dir> <mode> <exec out dir> [includes] [maven flags]
#   bare      — no agent, the baseline
#   agent     — JaCoCo agent only, output=none: the cost of the probes alone
#   split     — JaCoCo agent plus the per-class listener: one exec file per test class
#   presence  — the presence agent only: one flag per method, set on entry
#   pressplit — the presence agent plus the per-class listener: record.jsonl directly, no analyze step
# Without includes, JaCoCo probes every class and the presence agent the checkout's own.
# Maven flags pass through, e.g. '-DreuseForks=false' records every test class in its own JVM.
# A failing test is the suite's answer, not the run's: the run fails when Maven does,
# or when no forked JVM carried the recorder.
set -eu
WORK=$1 REPO=$2 MODE=$3 OUT=$4 INCLUDES=${5:-} FLAGS=${6:-}
mkdir -p "$OUT"
JACOCO="-javaagent:/va/lib/org.jacoco.agent-runtime.jar=output=none${INCLUDES:+,includes=$INCLUDES}"
PRESENCE="-javaagent:/va/bin/variance-agent.jar${INCLUDES:+=includes=$INCLUDES}"
AGENT=""
case "$MODE" in
  bare) ;;
  agent) AGENT="$JACOCO" ;;
  split) AGENT="$JACOCO -javaagent:/va/bin/variance-junit.jar -Dva.out=/out" ;;
  presence) AGENT="$PRESENCE" ;;
  pressplit) AGENT="$PRESENCE -javaagent:/va/bin/variance-junit.jar -Dva.out=/out" ;;
  *) echo "unknown mode $MODE" >&2; exit 64 ;;
esac
# Surefire writes each fork's system properties into its report, so this one says
# whether the pom's argLine interpolated ${agentArgs}.
[ -z "$AGENT" ] || AGENT="$AGENT -Dva.mode=$MODE"
SKIPS="-Drat.skip -Dcheckstyle.skip -Dspotbugs.skip -Dpmd.skip -Djapicmp.skip -Danimal.sniffer.skip \
  -Djacoco.skip -Dmaven.javadoc.skip -Dcyclonedx.skip -Dspdx.skip -Denforcer.skip -Dmoditect.skip \
  -Dbnd.skip -Dmaven.source.skip -Dsurefire.printSummary=true -Dmaven.test.failure.ignore=true"
docker run --rm -v "$WORK/m2:/root/.m2" -v "$WORK:/va:ro" -v "$REPO:/repo" -v "$OUT:/out" -w /repo \
  maven:3.9-eclipse-temurin-21 sh -euc "
    find . -path '*/target/surefire-reports' -type d -prune -exec rm -rf {} +
    start=\$(date +%s)
    mvn -B -q -o test $SKIPS $FLAGS -DagentArgs='$AGENT' > /out/mvn.log 2>&1 || { echo FAILED; tail -40 /out/mvn.log; exit 1; }
    echo seconds=\$(( \$(date +%s) - start ))
    if [ '$MODE' != bare ] && ! grep -rqs --include='TEST-*.xml' 'name=\"va.mode\" value=\"$MODE\"' .; then
      echo 'no test JVM carried the recorder: add \${agentArgs} to the Surefire argLine' >&2
      exit 1
    fi
  "
