#!/bin/sh
# Check the plugin's reading of the CLI's JSON against an installed IDE: its own JDK
# compiles the plugin and the check against its own jars and runs the check on the
# fixtures the VS Code client's test reads (editors/fixtures).
#
#   editors/webstorm/check.sh [path to the IDE's .app or install directory]
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
  echo "no compiler in $ide/jbr; checking with the JDK on PATH" >&2
  javac=javac
  java=java
fi

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

"$javac" --release 21 -nowarn -cp "$ide/lib/*" -d "$out" $(find "$here/src" "$here/test" -name '*.java')
"$java" -cp "$out:$ide/lib/*" dev.varianceauthority.webstorm.RecordCheck "$here/../fixtures"
