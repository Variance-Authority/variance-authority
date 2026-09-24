#!/bin/sh
# Measures what recording adds to the test phase alone: compile once, then run only
# surefire:test in bare, agent and split modes, interleaved, R rounds.
# Usage: overhead-maven.sh <work dir> <repo dir> <includes> <rounds> <out dir>
# Prints: mode round wall_seconds surefire_seconds(sum of suite times) tests
set -eu
WORK=$1 REPO=$2 INCLUDES=$3 ROUNDS=$4 OUT=$5
mkdir -p "$OUT"
SKIPS="-Drat.skip -Dcheckstyle.skip -Dspotbugs.skip -Dpmd.skip -Djapicmp.skip -Danimal.sniffer.skip \
  -Djacoco.skip -Dmaven.javadoc.skip -Dcyclonedx.skip -Dspdx.skip -Denforcer.skip -Dmoditect.skip \
  -Dbnd.skip -Dmaven.source.skip"
JACOCO="-javaagent:/va/lib/org.jacoco.agent-runtime.jar=output=none,includes=$INCLUDES"
docker run --rm -v "$WORK/m2:/root/.m2" -v "$WORK:/va:ro" -v "$REPO:/repo" -v "$OUT:/out" -w /repo \
  maven:3.9-eclipse-temurin-21 sh -euc "
    mvn -B -q -o test-compile $SKIPS > /out/compile.log 2>&1
    for r in \$(seq 1 $ROUNDS); do
      for mode in bare agent split; do
        case \$mode in
          bare) A='-XX:+EnableDynamicAgentLoading' ;;
          agent) A='-XX:+EnableDynamicAgentLoading $JACOCO' ;;
          split) rm -rf /tmp/x && mkdir -p /tmp/x; A='-XX:+EnableDynamicAgentLoading $JACOCO -javaagent:/va/bin/va-listener.jar -Dva.out=/tmp/x' ;;
        esac
        rm -rf target/surefire-reports
        s=\$(date +%s%N)
        mvn -B -q -o surefire:test $SKIPS -DagentArgs=\"\$A\" > /out/\$mode-\$r.log 2>&1 || echo \"\$mode \$r FAILED\"
        e=\$(date +%s%N)
        sum=\$(cat target/surefire-reports/TEST-*.xml | sed -n 's/.*<testsuite [^>]* time=\"\\([0-9.,]*\\)\".*/\\1/p' | tr -d , | awk '{s+=\$1} END {printf \"%.1f\", s}')
        n=\$(cat target/surefire-reports/TEST-*.xml | sed -n 's/.*<testsuite [^>]* tests=\"\\([0-9]*\\)\".*/\\1/p' | awk '{s+=\$1} END {print s}')
        echo \"\$mode \$r \$(( (e - s) / 1000000 ))ms surefire=\${sum}s tests=\$n\"
      done
    done
  "
