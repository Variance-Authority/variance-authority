#!/bin/sh
# Build the plugin against an installed IDE: its own JDK compiles against its own
# jars, so what compiles here is what that IDE loads. No Gradle, no download.
#
#   editors/webstorm/build.sh [path to the IDE's .app or install directory]
#
# Writes editors/webstorm/dist/variance-authority.jar, which Settings → Plugins →
# ⚙ → Install Plugin from Disk… takes as it is.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
ide=${1:-/Applications/WebStorm.app/Contents}
[ -d "$ide/Contents" ] && ide="$ide/Contents"
bin="$ide/jbr/Contents/Home/bin"
[ -x "$bin/javac" ] || bin="$ide/jbr/bin"
javac="$bin/javac"
java="$bin/java"
# A bundled runtime without a compiler falls back to the JDK on PATH, and says so.
if [ ! -x "$javac" ]; then
  echo "no compiler in $ide/jbr; compiling with the JDK on PATH" >&2
  javac=javac
  java=java
fi

out="$here/dist/classes"
rm -rf "$here/dist"
mkdir -p "$out/icons/variance"

"$javac" --release 21 -nowarn -cp "$ide/lib/*" -d "$out" $(find "$here/src" -name '*.java')
# The plugin's reading of the CLI's JSON is checked on the fixtures the VS Code client's
# test reads (editors/fixtures) before anything is packed; the check stays out of the jar.
check="$here/dist/check"
"$javac" --release 21 -nowarn -cp "$out:$ide/lib/*" -d "$check" $(find "$here/test" -name '*.java')
"$java" -cp "$check:$out:$ide/lib/*" dev.varianceauthority.webstorm.RecordCheck "$here/../fixtures"
cp -R "$here/resources/." "$out/"
# A release stamps its own version over the one in the source.
if [ -n "${VERSION:-}" ]; then
  sed "s|<version>[^<]*</version>|<version>$VERSION</version>|" "$here/resources/META-INF/plugin.xml" >"$out/META-INF/plugin.xml"
fi
# The same marks the VS Code client paints, so the two never disagree.
cp "$here/../vscode/media/"*.svg "$out/icons/variance/"

(cd "$out" && zip -qr "$here/dist/variance-authority.jar" .)
echo "$here/dist/variance-authority.jar"
