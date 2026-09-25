#!/bin/sh
# Builds the Phase 0 listener, analyzer, presence agent and source tools inside the Maven image.
# Usage: build.sh <work dir>  — jars and the Maven cache land under it, never in the repo.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$1
mkdir -p "$WORK/m2" "$WORK/lib" "$WORK/bin"
JACOCO=0.8.15
JUNIT=1.13.4

docker run --rm -v "$WORK/m2:/root/.m2" -v "$WORK/lib:/lib-out" -v "$HERE:/src:ro" -v "$WORK/bin:/bin-out" \
  maven:3.9-eclipse-temurin-21 sh -euc "
    get() { mvn -q dependency:copy -Dartifact=\$1 -DoutputDirectory=/lib-out -Dmdep.stripVersion=true; }
    get org.jacoco:org.jacoco.agent:$JACOCO:jar:runtime
    get org.jacoco:org.jacoco.core:$JACOCO
    get org.ow2.asm:asm:9.9
    get org.ow2.asm:asm-commons:9.9
    get org.ow2.asm:asm-tree:9.9
    get org.junit.platform:junit-platform-launcher:$JUNIT
    get org.junit.platform:junit-platform-engine:$JUNIT
    get org.junit.platform:junit-platform-commons:$JUNIT
    get org.opentest4j:opentest4j:1.3.0
    get com.github.javaparser:javaparser-core:3.28.2
    rm -rf /tmp/l /tmp/a /tmp/m && mkdir -p /tmp/l /tmp/a /tmp/m
    javac --release 8 -nowarn -d /tmp/l -cp '/lib-out/*' \$(find /src/listener/src -name '*.java')
    cp -r /src/listener/res/META-INF /tmp/l/
    jar cfm /bin-out/va-listener.jar /src/listener/res/MANIFEST.MF -C /tmp/l .
    javac -d /tmp/a -cp '/lib-out/*' \$(find /src/analyze/src -name '*.java')
    jar cf /bin-out/va-analyze.jar -C /tmp/a .
    javac -d /tmp/m -cp '/lib-out/*' \$(find /src/mutate/src -name '*.java')
    jar cf /bin-out/va-mutate.jar -C /tmp/m .
    rm -rf /tmp/pr /tmp/pa && mkdir -p /tmp/pr /tmp/pa
    javac --release 8 -nowarn -d /tmp/pr \$(find /src/presence/rt -name '*.java')
    jar cf /bin-out/va-presence-rt.jar -C /tmp/pr .
    javac --release 8 -nowarn -d /tmp/pa -cp '/tmp/pr:/lib-out/asm.jar:/lib-out/asm-tree.jar' \$(find /src/presence/src -name '*.java')
    (cd /tmp/pa && jar xf /lib-out/asm.jar && jar xf /lib-out/asm-tree.jar && rm -rf META-INF module-info.class)
    printf 'Premain-Class: va.presence.Agent\nBoot-Class-Path: va-presence-rt.jar\n' > /tmp/presence.mf
    jar cfm /bin-out/va-presence.jar /tmp/presence.mf -C /tmp/pa .
  "
ls -la "$WORK/bin" "$WORK/lib"
