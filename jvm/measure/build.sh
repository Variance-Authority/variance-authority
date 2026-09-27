#!/bin/sh
# Builds what the measurements add to the agent: the JaCoCo agent and analyzer,
# and the source tools that seed faults, inside the Maven image.
#
#   jvm/measure/build.sh <work dir>
#
# Run jvm/build.sh into the same work dir first: the measurements record with
# both. Jars land in <work dir>/bin, libraries in <work dir>/lib.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$1
mkdir -p "$WORK/m2" "$WORK/lib" "$WORK/bin"
JACOCO=0.8.15

docker run --rm -v "$WORK/m2:/root/.m2" -v "$WORK/lib:/lib-out" -v "$HERE:/src:ro" -v "$WORK/bin:/bin-out" \
  maven:3.9-eclipse-temurin-21 sh -euc "
    get() { mvn -q dependency:copy -Dartifact=\$1 -DoutputDirectory=/lib-out -Dmdep.stripVersion=true; }
    get org.jacoco:org.jacoco.agent:$JACOCO:jar:runtime
    get org.jacoco:org.jacoco.core:$JACOCO
    get org.ow2.asm:asm:9.9
    get org.ow2.asm:asm-commons:9.9
    get org.ow2.asm:asm-tree:9.9
    get com.github.javaparser:javaparser-core:3.28.2
    rm -rf /tmp/a /tmp/m && mkdir -p /tmp/a /tmp/m
    javac -d /tmp/a -cp '/lib-out/*' \$(find /src/analyze/src -name '*.java')
    jar cf /bin-out/variance-analyze.jar -C /tmp/a .
    javac -d /tmp/m -cp '/lib-out/*' \$(find /src/mutate/src -name '*.java')
    jar cf /bin-out/variance-mutate.jar -C /tmp/m .
  "
ls -la "$WORK/bin"
