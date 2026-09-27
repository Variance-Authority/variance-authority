#!/bin/sh
# Builds the agent, its runtime and the JUnit listener inside the Maven image, so
# nothing but Docker has to be installed.
#
#   jvm/build.sh [work dir]
#
# Writes variance-agent.jar, variance-agent-rt.jar and variance-junit.jar to
# <work dir>/bin, their libraries to <work dir>/lib and the Maven cache to
# <work dir>/m2. The work dir defaults to jvm/dist.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${1:-$HERE/dist}
mkdir -p "$WORK/m2" "$WORK/lib" "$WORK/bin"
JUNIT=1.13.4

docker run --rm -v "$WORK/m2:/root/.m2" -v "$WORK/lib:/lib-out" -v "$HERE:/src:ro" -v "$WORK/bin:/bin-out" \
  maven:3.9-eclipse-temurin-21 sh -euc "
    get() { mvn -q dependency:copy -Dartifact=\$1 -DoutputDirectory=/lib-out -Dmdep.stripVersion=true; }
    get org.ow2.asm:asm:9.9
    get org.ow2.asm:asm-commons:9.9
    get org.ow2.asm:asm-tree:9.9
    get org.junit.platform:junit-platform-launcher:$JUNIT
    get org.junit.platform:junit-platform-engine:$JUNIT
    get org.junit.platform:junit-platform-commons:$JUNIT
    get org.opentest4j:opentest4j:1.3.0
    rm -rf /tmp/rt /tmp/agent /tmp/junit && mkdir -p /tmp/rt /tmp/agent /tmp/junit
    javac --release 8 -nowarn -d /tmp/rt \$(find /src/agent/rt -name '*.java')
    jar cf /bin-out/variance-agent-rt.jar -C /tmp/rt .
    # javac's tree API is outside --release 8, so its one reader is built against the running JDK at level 8.
    javac -source 8 -target 8 -Xlint:-options -nowarn -d /tmp/agent /src/agent/src/dev/varianceauthority/jvm/Spans.java
    javac --release 8 -nowarn -d /tmp/agent -cp '/tmp/agent:/tmp/rt:/lib-out/asm.jar:/lib-out/asm-tree.jar' \$(find /src/agent/src -name '*.java' ! -name Spans.java)
    (cd /tmp/agent && jar xf /lib-out/asm.jar && jar xf /lib-out/asm-tree.jar && rm -rf META-INF module-info.class)
    printf 'Premain-Class: dev.varianceauthority.jvm.Agent\nBoot-Class-Path: variance-agent-rt.jar\n' > /tmp/agent.mf
    jar cfm /bin-out/variance-agent.jar /tmp/agent.mf -C /tmp/agent .
    javac --release 8 -nowarn -d /tmp/junit -cp '/lib-out/*' \$(find /src/junit/src -name '*.java')
    cp -r /src/junit/resources/META-INF /tmp/junit/
    jar cfm /bin-out/variance-junit.jar /src/junit/resources/MANIFEST.MF -C /tmp/junit .
  "
ls -la "$WORK/bin"
